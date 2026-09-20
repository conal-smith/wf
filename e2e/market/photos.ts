/**
 * The photos the baseline's listings are sold with, drawn here rather than
 * kept as image files.
 *
 * A card, a gallery and a strip of thumbnails are half photo, so a baseline of
 * the marketplace with no photos in it would be a baseline of nothing: the
 * conversion needs to see what a cover image does to a card. Drawing them
 * costs a few hundred bytes of code and gives the same pixels on every machine
 * and every run, which a downloaded or committed JPEG would not promise.
 *
 * A plain truecolour PNG: no interlacing, no palette, one unfiltered row after
 * another, which is the shortest encoder that a browser will decode.
 */
import { crc32, deflateSync } from "node:zlib";

/** What the fixtures tell the API every photo is, and what it is. */
export const PHOTO = { width: 1200, height: 900 } as const;

/** Sky over water, one pair a frame, so no two cards in a row are the same. */
const FRAMES: [[number, number, number], [number, number, number]][] = [
  [
    [0x9f, 0xc4, 0xcf],
    [0x18, 0x3c, 0x52],
  ],
  [
    [0xe6, 0xd8, 0xbc],
    [0x2b, 0x6b, 0x6b],
  ],
  [
    [0xb9, 0xc9, 0xc0],
    [0x24, 0x4a, 0x3e],
  ],
  [
    [0xd8, 0xc0, 0xb4],
    [0x5a, 0x3c, 0x46],
  ],
];

/** How many different frames there are; a fixture asking past the end wraps. */
export const FRAME_COUNT = FRAMES.length;

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, check]);
}

/** Frame `index`, as PNG bytes. The same index is always the same bytes. */
export function photo(index: number): Buffer {
  const { width, height } = PHOTO;
  const [sky, water] = FRAMES[index % FRAMES.length];
  // A filter byte (0, none) in front of each row of RGB triples.
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const down = y / (height - 1);
    const row = y * stride + 1;
    for (let x = 0; x < width; x++) {
      // A band of light across the frame, so the crop of a card and the whole
      // of the gallery are visibly the same photo.
      const lit = (x * 3 + y * 5) % 540 < 70 ? 18 : 0;
      for (let c = 0; c < 3; c++)
        raw[row + x * 3 + c] = Math.min(
          255,
          Math.round(sky[c] + (water[c] - sky[c]) * down) + lit,
        );
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
