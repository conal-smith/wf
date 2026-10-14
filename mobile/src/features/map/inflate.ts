/**
 * Inflate (RFC 1951), and gunzip round it (RFC 1952): a PMTiles archive
 * compresses its directories with gzip, and Hermes has no
 * DecompressionStream. A small canonical-Huffman decoder after tinf
 * (Jørgen Ibsen), for the few kilobytes a directory is; the tiles themselves
 * are WebP and need none of it.
 */

interface Tree {
  /** Codes of each length. */
  counts: Uint16Array;
  /** Symbols in canonical order. */
  symbols: Uint16Array;
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildTree(lengths: ArrayLike<number>, offset: number, n: number): Tree {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) counts[lengths[offset + i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 0, sum = 0; i < 16; i++) {
    offs[i] = sum;
    sum += counts[i];
  }
  for (let i = 0; i < n; i++) if (lengths[offset + i]) symbols[offs[lengths[offset + i]]++] = i;
  return { counts, symbols };
}

const FIXED = (() => {
  const lengths = new Uint8Array(288 + 30);
  for (let i = 0; i < 144; i++) lengths[i] = 8;
  for (let i = 144; i < 256; i++) lengths[i] = 9;
  for (let i = 256; i < 280; i++) lengths[i] = 7;
  for (let i = 280; i < 288; i++) lengths[i] = 8;
  for (let i = 288; i < 318; i++) lengths[i] = 5;
  return { lit: buildTree(lengths, 0, 288), dist: buildTree(lengths, 288, 30) };
})();

class Reader {
  pos = 0;
  private bit = 0;
  private bits = 0;
  constructor(readonly data: Uint8Array) {}

  bitsOf(n: number): number {
    while (this.bits < n) {
      if (this.pos >= this.data.length) throw new Error("inflate: the data ends early.");
      this.bit |= this.data[this.pos++] << this.bits;
      this.bits += 8;
    }
    const out = this.bit & ((1 << n) - 1);
    this.bit >>>= n;
    this.bits -= n;
    return out;
  }

  /** To the next byte, for a stored block. */
  align() {
    this.bit = 0;
    this.bits = 0;
  }

  decode(tree: Tree): number {
    let sum = 0;
    let cur = 0;
    let len = 0;
    do {
      cur = 2 * cur + this.bitsOf(1);
      len++;
      if (len > 15) throw new Error("inflate: a bad code.");
      sum += tree.counts[len];
      cur -= tree.counts[len];
    } while (cur >= 0);
    return tree.symbols[sum + cur];
  }
}

class Output {
  buf = new Uint8Array(1 << 15);
  length = 0;
  push(byte: number) {
    if (this.length === this.buf.length) this.grow(1);
    this.buf[this.length++] = byte;
  }
  grow(n: number) {
    let size = this.buf.length;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
}

function dynamicTrees(r: Reader): { lit: Tree; dist: Tree } {
  const hlit = r.bitsOf(5) + 257;
  const hdist = r.bitsOf(5) + 1;
  const hclen = r.bitsOf(4) + 4;
  const clens = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = r.bitsOf(3);
  const clTree = buildTree(clens, 0, 19);
  const lengths = new Uint8Array(hlit + hdist);
  for (let n = 0; n < hlit + hdist; ) {
    const sym = r.decode(clTree);
    if (sym < 16) lengths[n++] = sym;
    else {
      let repeat: number;
      let value = 0;
      if (sym === 16) {
        if (!n) throw new Error("inflate: a repeat with nothing before it.");
        value = lengths[n - 1];
        repeat = r.bitsOf(2) + 3;
      } else if (sym === 17) repeat = r.bitsOf(3) + 3;
      else repeat = r.bitsOf(7) + 11;
      while (repeat--) lengths[n++] = value;
    }
  }
  return { lit: buildTree(lengths, 0, hlit), dist: buildTree(lengths, hlit, hdist) };
}

/** A raw deflate stream's bytes. */
export function inflateRaw(data: Uint8Array, start = 0): Uint8Array {
  const r = new Reader(data);
  r.pos = start;
  const out = new Output();
  let last = 0;
  while (!last) {
    last = r.bitsOf(1);
    const type = r.bitsOf(2);
    if (type === 0) {
      r.align();
      const at = r.pos;
      const len = data[at] | (data[at + 1] << 8);
      const nlen = data[at + 2] | (data[at + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error("inflate: a bad stored block.");
      if (at + 4 + len > data.length) throw new Error("inflate: the data ends early.");
      if (out.length + len > out.buf.length) out.grow(len);
      out.buf.set(data.subarray(at + 4, at + 4 + len), out.length);
      out.length += len;
      r.pos = at + 4 + len;
      continue;
    }
    if (type === 3) throw new Error("inflate: a bad block type.");
    const { lit, dist } = type === 1 ? FIXED : dynamicTrees(r);
    for (;;) {
      const sym = r.decode(lit);
      if (sym < 256) out.push(sym);
      else if (sym === 256) break;
      else {
        const l = sym - 257;
        const length = LENGTH_BASE[l] + r.bitsOf(LENGTH_EXTRA[l]);
        const d = r.decode(dist);
        const distance = DIST_BASE[d] + r.bitsOf(DIST_EXTRA[d]);
        if (distance > out.length) throw new Error("inflate: a distance too far back.");
        if (out.length + length > out.buf.length) out.grow(length);
        for (let i = 0; i < length; i++) out.buf[out.length] = out.buf[out.length++ - distance];
      }
    }
  }
  return out.buf.slice(0, out.length);
}

/** A gzip member's bytes (the first member; the trailer is not checked). */
export function gunzip(data: Uint8Array): Uint8Array {
  if (data[0] !== 0x1f || data[1] !== 0x8b || data[2] !== 8) throw new Error("gunzip: not gzip.");
  const flags = data[3];
  let at = 10;
  if (flags & 4) at += 2 + (data[at] | (data[at + 1] << 8));
  if (flags & 8) while (data[at++]);
  if (flags & 16) while (data[at++]);
  if (flags & 2) at += 2;
  return inflateRaw(data, at);
}
