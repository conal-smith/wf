/**
 * The chart's PMTiles archives (the seabed's and the foilable depth's, on the
 * data host under versioned folders: scripts/foildepth/publish.py), as
 * MapLibre and the foil probe read them.
 *
 * An archive is one static file read by HTTP range. Not every host serves
 * ranges: Cloudflare Pages, where staging and production are deployed, answers
 * every `Range:` with a 200 and the whole file. The pmtiles package's own
 * reader refuses that answer ("Check that your storage backend supports HTTP
 * Byte Serving") and MapLibre's error goes to the map's own handler, so on
 * Pages the depth tints and the foil layer were silently never drawn. Here a
 * host that sends the whole file is taken at its word: the file is kept, and
 * every later read is a slice of it. A host that serves ranges (vite, Caddy,
 * R2) is read by range exactly as before.
 */
import {
  EtagMismatch,
  PMTiles,
  Protocol,
  type RangeResponse,
  type Source,
} from "pmtiles";

/** A weak validator names no particular bytes, so it cannot be compared. */
const strong = (etag: string | null) =>
  etag && !etag.startsWith("W/") ? etag : undefined;

/**
 * Chrome on Windows can serve a cached range from the wrong file; pmtiles'
 * FetchSource reads ranges past the cache there, and so does this.
 */
const noRangeCache =
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Windows") &&
  /Chrome|Chromium|Edg|OPR|Brave/.test(navigator.userAgent);

export class ArchiveSource implements Source {
  /** The whole file, once the host has answered a range with all of it. */
  private whole: Promise<ArrayBuffer> | null = null;
  private reload = false;

  constructor(
    readonly url: string,
    private readonly load: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  getKey() {
    return this.url;
  }

  /** True once the host is known to answer a range with the whole file. */
  get isWhole() {
    return this.whole !== null;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    if (!this.whole) {
      const response = await this.load(this.url, {
        signal,
        cache: this.reload ? "reload" : noRangeCache ? "no-store" : undefined,
        headers: { range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (response.status === 206) {
        const tag = strong(response.headers.get("ETag"));
        if (etag && tag && tag !== etag) {
          // The file changed under the reader: pmtiles drops what it knew
          // and reads the header again, past the cache.
          this.reload = true;
          await response.body?.cancel();
          throw new EtagMismatch(
            `${this.url} changed (ETag ${tag}, expected ${etag}).`,
          );
        }
        return {
          data: await response.arrayBuffer(),
          etag: tag,
          cacheControl: response.headers.get("Cache-Control") ?? undefined,
          expires: response.headers.get("Expires") ?? undefined,
        };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`${this.url} answered ${response.status}.`);
      }
      // The whole file, whatever was asked. Two reads can be in flight when
      // the first such answer lands: the first body is kept, the other let go.
      if (this.whole) await response.body?.cancel();
      else {
        const kept = response.arrayBuffer();
        this.whole = kept;
        // A body cut off half way is no file: the next read starts again.
        kept.catch(() => {
          if (this.whole === kept) this.whole = null;
        });
      }
    }
    const data = await this.whole!;
    return { data: data.slice(offset, offset + length) };
  }
}

const protocol = new Protocol();

/** MapLibre's `pmtiles://` handler, over the archives opened here. */
export const pmtilesTile = protocol.tile;

/**
 * The archive at an absolute URL, opened once a page and shared by the map
 * (`pmtiles://` + the URL) and anything reading it directly (foilProbe.ts),
 * so a host without ranges sends the file once.
 */
export function archive(url: string): PMTiles {
  let found = protocol.get(url);
  if (!found) protocol.add((found = new PMTiles(new ArchiveSource(url))));
  return found;
}

/** A style's source URL for the archive at an absolute URL. */
export function archiveUrl(url: string) {
  archive(url);
  return `pmtiles://${url}`;
}
