/**
 * A PNG from RGBA bytes, with nothing but arithmetic: the chart's icons (SDF
 * glyphs, sdfIcons.ts) and the wind's wash (washLogic.ts) are made in the app
 * and handed to MapLibre as images, and neither React Native nor Hermes can
 * encode one. The pixels go in deflate's stored blocks: an icon is a few
 * kilobytes, the wash a hundred or so on the device's own disk, and a
 * compressor would cost more time than the bytes it saved.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the most bytes summed before the sums must be reduced.
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib's stream round `raw`, in stored (uncompressed) blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const BLOCK = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / BLOCK));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * BLOCK;
    const len = Math.min(BLOCK, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const sum = adler32(raw);
  out[o++] = sum >>> 24;
  out[o++] = (sum >>> 16) & 0xff;
  out[o++] = (sum >>> 8) & 0xff;
  out[o++] = sum & 0xff;
  return out;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** An 8-bit RGBA PNG of `width` × `height` from `rgba` (row-major, 4 bytes a pixel). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error("PNG: the pixels do not fit the size.");
  // Each row with its filter byte (0, none).
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const idat = zlibStored(raw);
  const chunks: [string, Uint8Array][] = [
    ["IHDR", ihdr(width, height)],
    ["IDAT", idat],
    ["IEND", new Uint8Array(0)],
  ];
  const size = SIGNATURE.length + chunks.reduce((n, [, data]) => n + data.length + 12, 0);
  const out = new Uint8Array(size);
  out.set(SIGNATURE, 0);
  let o = SIGNATURE.length;
  for (const [type, data] of chunks) {
    writeU32(out, o, data.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    writeU32(out, o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += data.length + 12;
  }
  return out;
}

function ihdr(width: number, height: number) {
  const out = new Uint8Array(13);
  writeU32(out, 0, width);
  writeU32(out, 4, height);
  out[8] = 8; // bit depth
  out[9] = 6; // RGBA
  return out;
}

function writeU32(out: Uint8Array, at: number, value: number) {
  out[at] = value >>> 24;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += B64[n >>> 18] + B64[(n >>> 12) & 63] + "==";
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + "=";
  }
  return out;
}

export const pngDataUri = (width: number, height: number, rgba: Uint8Array) =>
  `data:image/png;base64,${base64(encodePng(width, height, rgba))}`;
