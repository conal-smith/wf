import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EtagMismatch, FetchSource, PMTiles } from "pmtiles";
import { ArchiveSource } from "./archives";
import { tilePixel } from "./foilDepth";

// A real archive: the Malahide lagoon's, the committed copy of the data
// host's (public-data/, under the index's versioned base).
const BASE = (
  JSON.parse(
    readFileSync(
      new URL("../../public/foildepth/index.json", import.meta.url),
      "utf8",
    ),
  ) as { base: string }
).base;
const FILE = readFileSync(
  new URL(
    `../../public-data/${BASE}malahide-lagoon.pmtiles`,
    import.meta.url,
  ),
);
const URL_ = "https://example.test/foildepth/malahide-lagoon.pmtiles";
const body = (from: number, to: number) => FILE.subarray(from, to + 1);

/**
 * A host for the archive: one that serves byte ranges (vite, Caddy, R2), or
 * one that answers every range with the whole file and a 200, as Cloudflare
 * Pages does. Counts what it is asked and how many bytes it sends.
 */
function host(ranges: boolean, etag = '"one"') {
  const asked: { range: string | null; status: number; bytes: number }[] = [];
  const load = (async (_url: unknown, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    const m = range && /^bytes=(\d+)-(\d+)$/.exec(range);
    if (ranges && m) {
      const to = Math.min(Number(m[2]), FILE.length - 1);
      const part = body(Number(m[1]), to);
      asked.push({ range, status: 206, bytes: part.length });
      return new Response(part, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${m[1]}-${to}/${FILE.length}`,
          "Content-Length": String(part.length),
          ETag: etag,
        },
      });
    }
    asked.push({ range, status: 200, bytes: FILE.length });
    return new Response(FILE, {
      status: 200,
      headers: { "Content-Length": String(FILE.length), ETag: etag },
    });
  }) as typeof fetch;
  return { asked, load };
}

// A tile in the middle of the lagoon at the archive's finest zoom.
const at = tilePixel(-6.185, 53.455, 14, 512); // the lagoon's water

describe("ArchiveSource", () => {
  it("reads by range where the host serves ranges", async () => {
    const { asked, load } = host(true);
    const archive = new PMTiles(new ArchiveSource(URL_, load));
    const tile = await archive.getZxy(at.z, at.x, at.y);
    expect(tile?.data.byteLength).toBeGreaterThan(0);
    expect(asked.every((a) => a.status === 206)).toBe(true);
    // Never the whole file.
    expect(asked.reduce((n, a) => n + a.bytes, 0)).toBeLessThan(FILE.length);
  });

  it("keeps the whole file where the host answers a range with all of it", async () => {
    const ranged = host(true);
    const want = await new PMTiles(new ArchiveSource(URL_, ranged.load)).getZxy(
      at.z,
      at.x,
      at.y,
    );

    const { asked, load } = host(false);
    const source = new ArchiveSource(URL_, load);
    const archive = new PMTiles(source);
    const tile = await archive.getZxy(at.z, at.x, at.y);
    // The same bytes as by range, from one download.
    expect(new Uint8Array(tile!.data)).toEqual(new Uint8Array(want!.data));
    expect(source.isWhole).toBe(true);
    expect(asked).toHaveLength(1);
    // And every later read is a slice of it, the probe's included.
    const other = tilePixel(-6.163, 53.455, 14, 512);
    await archive.getZxy(other.z, other.x, other.y);
    await archive.getZxy(13, at.x >> 1, at.y >> 1);
    expect(asked).toHaveLength(1);
  });

  it("refuses the whole file where it is to be read by range only", async () => {
    const { asked, load } = host(false);
    const source = new ArchiveSource(URL_, load, true);
    await expect(
      new PMTiles(source).getZxy(at.z, at.x, at.y),
    ).rejects.toThrow(/whole file/);
    expect(source.isWhole).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it("is what pmtiles' own reader refuses on such a host", async () => {
    // The fault this works round: FetchSource throws on a 200 to a range, and
    // the map, which listens for errors itself, says nothing.
    const { load } = host(false);
    const real = globalThis.fetch;
    globalThis.fetch = load;
    try {
      await expect(
        new PMTiles(new FetchSource(URL_)).getZxy(at.z, at.x, at.y),
      ).rejects.toThrow(/Byte Serving/);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("keeps one body when two whole-file answers cross", async () => {
    const { asked, load } = host(false);
    const source = new ArchiveSource(URL_, load);
    const [a, b] = await Promise.all([
      source.getBytes(0, 10),
      source.getBytes(100, 20),
    ]);
    expect(asked).toHaveLength(2);
    expect(new Uint8Array(a.data)).toEqual(new Uint8Array(body(0, 9)));
    expect(new Uint8Array(b.data)).toEqual(new Uint8Array(body(100, 119)));
    await source.getBytes(5000, 5);
    expect(asked).toHaveLength(2);
  });

  it("starts again after a whole file cut off half way", async () => {
    let calls = 0;
    const load = (async () => {
      calls++;
      if (calls === 1)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(FILE.subarray(0, 100)));
              controller.error(new Error("cut"));
            },
          }),
          { status: 200 },
        );
      return new Response(FILE, { status: 200 });
    }) as typeof fetch;
    const source = new ArchiveSource(URL_, load);
    await expect(source.getBytes(0, 10)).rejects.toThrow();
    expect(source.isWhole).toBe(false);
    const again = await source.getBytes(0, 10);
    expect(new Uint8Array(again.data)).toEqual(new Uint8Array(body(0, 9)));
  });

  it("says when the file changed under it, and reads past the cache after", async () => {
    const caches: (RequestCache | undefined)[] = [];
    const { load } = host(true, '"two"');
    const source = new ArchiveSource(URL_, (url, init) => {
      caches.push(init?.cache);
      return load(url, init);
    });
    await expect(source.getBytes(0, 10, undefined, '"one"')).rejects.toThrow(
      EtagMismatch,
    );
    await source.getBytes(0, 10, undefined, '"two"');
    expect(caches.at(-1)).toBe("reload");
    // A weak validator is not compared.
    const weak = host(true, 'W/"x"');
    await expect(
      new ArchiveSource(URL_, weak.load).getBytes(0, 10, undefined, '"one"'),
    ).resolves.toBeTruthy();
  });

  it("fails on a missing file rather than reading an error page", async () => {
    const source = new ArchiveSource(
      URL_,
      (async () => new Response("Not found", { status: 404 })) as typeof fetch,
    );
    await expect(source.getBytes(0, 10)).rejects.toThrow(/404/);
    expect(source.isWhole).toBe(false);
  });
});
