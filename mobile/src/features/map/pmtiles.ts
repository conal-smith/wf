/**
 * One tile out of a PMTiles (v3) archive, read by HTTP range: what the foil
 * probe needs to read the seabed under a tapped point (force5/src/foilProbe.ts
 * does it in the browser through the pmtiles package, which is not in the
 * app; MapLibre Native reads `pmtiles://` itself for the map). The header and
 * root directory once an archive, a leaf directory once it is needed, then
 * the tile's own bytes. A host that answers a range with the whole file is
 * taken at its word and the file kept, as force5/src/archives.ts does.
 */
import { gunzip } from "./inflate";

export type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

interface Header {
  rootOffset: number;
  rootLength: number;
  leafOffset: number;
  tileOffset: number;
  /** 1 none, 2 gzip. */
  internalCompression: number;
  tileCompression: number;
  minZoom: number;
  maxZoom: number;
}

export interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

const u64 = (v: DataView, at: number) => v.getUint32(at + 4, true) * 2 ** 32 + v.getUint32(at, true);

export function readHeader(bytes: Uint8Array): Header {
  const magic = String.fromCharCode(...bytes.subarray(0, 7));
  if (magic !== "PMTiles" || bytes[7] !== 3) throw new Error("Not a PMTiles v3 archive.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rootOffset: u64(v, 8),
    rootLength: u64(v, 16),
    leafOffset: u64(v, 40),
    tileOffset: u64(v, 56),
    internalCompression: bytes[97],
    tileCompression: bytes[98],
    minZoom: bytes[100],
    maxZoom: bytes[101],
  };
}

/** The Hilbert-curve tile id PMTiles files a tile under. */
export function zxyToTileId(z: number, x: number, y: number): number {
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) throw new Error("Tile out of range.");
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  let d = 0;
  let tx = x;
  let ty = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const t = tx;
      tx = ty;
      ty = t;
    }
  }
  return acc + d;
}

function varints(bytes: Uint8Array) {
  let at = 0;
  return () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const b = bytes[at++];
      if (b === undefined) throw new Error("PMTiles: a directory ends early.");
      value += (b & 0x7f) * shift;
      if (b < 0x80) return value;
      shift *= 128;
    }
  };
}

export function readDirectory(bytes: Uint8Array): Entry[] {
  const next = varints(bytes);
  const n = next();
  const entries: Entry[] = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    id += next();
    entries.push({ tileId: id, offset: 0, length: 0, runLength: 1 });
  }
  for (let i = 0; i < n; i++) entries[i].runLength = next();
  for (let i = 0; i < n; i++) entries[i].length = next();
  for (let i = 0; i < n; i++) {
    const v = next();
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

/** The entry holding a tile id (a tile, or a leaf directory with runLength 0), or null. */
export function findEntry(entries: readonly Entry[], tileId: number): Entry | null {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = tileId - entries[mid].tileId;
    if (c > 0) lo = mid + 1;
    else if (c < 0) hi = mid - 1;
    else return entries[mid];
  }
  if (hi >= 0) {
    const e = entries[hi];
    if (e.runLength === 0) return e;
    if (tileId - e.tileId < e.runLength) return e;
  }
  return null;
}

export class Archive {
  private header: Promise<Header> | null = null;
  private root: Promise<Entry[]> | null = null;
  private leaves = new Map<number, Promise<Entry[]>>();
  private whole: Promise<Uint8Array> | null = null;

  constructor(
    readonly url: string,
    private readonly load: Fetcher = (url, init) => fetch(url, init),
  ) {}

  /** Bytes [offset, offset + length), by range, or out of the whole file. */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    if (!this.whole) {
      const response = await this.load(this.url, {
        headers: { range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (response.status === 206) return new Uint8Array(await response.arrayBuffer());
      if (response.status !== 200) throw new Error(`${this.url} answered ${response.status}.`);
      if (!this.whole) this.whole = response.arrayBuffer().then((b) => new Uint8Array(b));
    }
    const all = await this.whole!;
    return all.subarray(offset, offset + length);
  }

  private async directory(offset: number, length: number, header: Header) {
    const raw = await this.bytes(offset, length);
    return readDirectory(header.internalCompression === 2 ? gunzip(raw) : raw);
  }

  private start() {
    if (!this.header || !this.root) {
      const header = this.bytes(0, 16384).then(readHeader);
      const root = header.then((h) => this.directory(h.rootOffset, h.rootLength, h));
      this.header = header;
      this.root = root;
      // A failed read is tried again on the next tap, not remembered.
      root.catch(() => {
        if (this.root === root) this.header = this.root = null;
      });
    }
    return Promise.all([this.header, this.root]);
  }

  /** A tile's bytes (as stored: WebP for the depth archives), or null where it has none. */
  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const [h, root] = await this.start();
    if (z < h.minZoom || z > h.maxZoom) return null;
    if (h.tileCompression === 2) throw new Error("PMTiles: compressed tiles are not read here.");
    const id = zxyToTileId(z, x, y);
    let entries = root;
    for (let depth = 0; depth < 4; depth++) {
      const entry = findEntry(entries, id);
      if (!entry) return null;
      if (entry.runLength > 0) return this.bytes(h.tileOffset + entry.offset, entry.length);
      const at = h.leafOffset + entry.offset;
      let leaf = this.leaves.get(at);
      if (!leaf) {
        leaf = this.directory(at, entry.length, h);
        this.leaves.set(at, leaf);
        leaf.catch(() => this.leaves.delete(at));
      }
      entries = await leaf;
    }
    return null;
  }
}

const archives = new Map<string, Archive>();

/** The archive at an absolute URL, opened once. */
export function archiveAt(url: string): Archive {
  let found = archives.get(url);
  if (!found) archives.set(url, (found = new Archive(url)));
  return found;
}
