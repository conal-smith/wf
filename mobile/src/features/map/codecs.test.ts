import { deflateRawSync, gzipSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gunzip, inflateRaw } from "./inflate";
import { adler32, base64, crc32, encodePng, pngDataUri } from "./png";
import { Archive, findEntry, readDirectory, zxyToTileId, type Fetcher } from "./pmtiles";

const bytes = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    // Runs and noise, so every kind of block turns up.
    out[i] = i % 97 < 40 ? 65 + (i % 7) : x >>> 24;
  }
  return out;
};

describe("png", () => {
  it("checks its sums as zlib does", () => {
    const data = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(data)).toBe(0x414fa339);
    expect(adler32(data)).toBe(0x5bdc0fda);
  });

  it("writes a PNG whose pixels read back", () => {
    const rgba = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) % 256);
    const png = encodePng(3, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: 3 × 2, 8-bit RGBA.
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(3);
    expect(view.getUint32(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    // IDAT: each row is a filter byte, then the row.
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe((3 * 4 + 1) * 2);
    expect([...raw.subarray(1, 13)]).toEqual([...rgba.subarray(0, 12)]);
    expect([...raw.subarray(14, 26)]).toEqual([...rgba.subarray(12, 24)]);
    // Every chunk's CRC covers its type and data.
    expect(view.getUint32(41 + idatLength)).toBe(crc32(png, 37, 41 + idatLength));
  });

  it("splits a large image across stored blocks", () => {
    const rgba = bytes(200 * 100 * 4);
    const png = encodePng(200, 100, rgba);
    const view = new DataView(png.buffer);
    const raw = inflateSync(png.subarray(41, 41 + view.getUint32(33)));
    expect(raw.length).toBe((200 * 4 + 1) * 100);
    expect(raw[801 + 1]).toBe(rgba[800]);
  });

  it("refuses pixels that do not fit", () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow();
  });

  it("encodes base64 as the platform does", () => {
    for (const n of [0, 1, 2, 3, 10, 257]) {
      const data = bytes(n, n);
      expect(base64(data)).toBe(Buffer.from(data).toString("base64"));
    }
    expect(pngDataUri(1, 1, new Uint8Array(4))).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
  });
});

describe("inflate", () => {
  it("reads stored, fixed and dynamic blocks", () => {
    for (const level of [0, 1, 6, 9]) {
      const data = bytes(70000, level + 3);
      expect(inflateRaw(new Uint8Array(deflateRawSync(data, { level })))).toEqual(data);
    }
    const short = new TextEncoder().encode("abcabcabcabcabc");
    expect(new TextDecoder().decode(inflateRaw(new Uint8Array(deflateRawSync(short))))).toBe("abcabcabcabcabc");
  });

  it("unwraps gzip", () => {
    const data = bytes(5000);
    expect(gunzip(new Uint8Array(gzipSync(data)))).toEqual(data);
    expect(() => gunzip(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

/* ---- a small PMTiles v3 archive, written here ---- */

const varint = (out: number[], value: number) => {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
};

function directory(entries: { tileId: number; offset: number; length: number; runLength: number }[]) {
  const out: number[] = [];
  varint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(out, e.runLength);
  for (const e of entries) varint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(out, i > 0 && prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return new Uint8Array(out);
}

function archive(tiles: Map<number, Uint8Array>, leaf = false) {
  const ids = [...tiles.keys()].sort((a, b) => a - b);
  let offset = 0;
  const entries = ids.map((tileId) => {
    const e = { tileId, offset, length: tiles.get(tileId)!.length, runLength: 1 };
    offset += e.length;
    return e;
  });
  const data = new Uint8Array(offset);
  for (const e of entries) data.set(tiles.get(e.tileId)!, e.offset);
  let root: Uint8Array;
  let leaves = new Uint8Array(0);
  if (leaf) {
    leaves = new Uint8Array(gzipSync(directory(entries)));
    root = new Uint8Array(gzipSync(directory([{ tileId: ids[0], offset: 0, length: leaves.length, runLength: 0 }])));
  } else root = new Uint8Array(gzipSync(directory(entries)));
  const header = new Uint8Array(127);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode("PMTiles"), 0);
  header[7] = 3;
  const put = (at: number, v: number) => view.setUint32(at, v, true);
  put(8, 127);
  put(16, root.length);
  put(40, 127 + root.length);
  put(48, leaves.length);
  put(56, 127 + root.length + leaves.length);
  put(64, data.length);
  header[97] = 2; // gzip directories
  header[98] = 1; // tiles as stored
  header[100] = 0;
  header[101] = 14;
  const file = new Uint8Array(127 + root.length + leaves.length + data.length);
  file.set(header, 0);
  file.set(root, 127);
  file.set(leaves, 127 + root.length);
  file.set(data, 127 + root.length + leaves.length);
  return file;
}

const host = (file: Uint8Array, ranges = true): { fetch: Fetcher; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (_url, init) => {
      const range = init.headers.range;
      calls.push(range);
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const body = ranges ? file.slice(Number(a), Math.min(file.length, Number(b) + 1)) : file.slice();
      return new Response(body, { status: ranges ? 206 : 200 });
    },
  };
};

describe("pmtiles", () => {
  it("numbers tiles along the Hilbert curve", () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
    expect(() => zxyToTileId(1, 2, 0)).toThrow();
    // Every id at a zoom is used once.
    const seen = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(zxyToTileId(3, x, y));
    expect(seen.size).toBe(64);
    expect(Math.min(...seen)).toBe(21);
  });

  it("reads a directory back and finds runs in it", () => {
    const entries = [
      { tileId: 3, offset: 0, length: 10, runLength: 1 },
      { tileId: 10, offset: 10, length: 5, runLength: 3 },
      { tileId: 20, offset: 100, length: 7, runLength: 1 },
    ];
    expect(readDirectory(directory(entries))).toEqual(entries);
    const read = readDirectory(directory(entries));
    expect(findEntry(read, 11)?.tileId).toBe(10);
    expect(findEntry(read, 13)).toBeNull();
    expect(findEntry(read, 2)).toBeNull();
  });

  it("reads a tile by range, through a leaf directory", async () => {
    const id = zxyToTileId(9, 250, 166);
    const tiles = new Map([
      [id, new Uint8Array([1, 2, 3, 4])],
      [id + 1, new Uint8Array([9, 9])],
    ]);
    for (const leaf of [false, true]) {
      const { fetch, calls } = host(archive(tiles, leaf));
      const a = new Archive("https://data.example/x.pmtiles", fetch);
      expect([...(await a.tile(9, 250, 166))!]).toEqual([1, 2, 3, 4]);
      expect(await a.tile(9, 0, 0)).toBeNull();
      expect(calls.every((c) => c.startsWith("bytes="))).toBe(true);
    }
  });

  it("keeps the whole file from a host that will not serve a range", async () => {
    const id = zxyToTileId(4, 7, 5);
    const { fetch, calls } = host(archive(new Map([[id, new Uint8Array([5, 6, 7])]])), false);
    const a = new Archive("https://site.example/x.pmtiles", fetch);
    expect([...(await a.tile(4, 7, 5))!]).toEqual([5, 6, 7]);
    expect(calls).toHaveLength(1);
  });
});
