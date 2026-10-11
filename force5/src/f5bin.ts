// The reader for "F5 int16" whole wind frames (`encoding: "f5-int16-v1"`).
//
// No run publishes whole frames any more: a wind frame is a pyramid of tiles
// (f5tile.ts), whose blocks use this format's rounding and deltas. This reader
// stays as the reference for the golden whole frame, which the tiles' level 0
// is tested against.
//
// The format, the header layout and the two rules both sides must agree on —
// rounding half away from zero, and delta arithmetic that wraps in int16 — are
// written out once in force5/ingest/f5bin.py. This file is the other side of
// that contract and must not drift from it; `tests/f5bin.test.ts` decodes
// the same golden file the Python suite does, so a drift fails both suites.
//
// `decodeFrame` returns exactly today's `Frame`, so `WindMap`, `sample()` and
// the particle layer never learn that the wire format changed. What the header
// carries — the run, the forecast hour and the grid size — is checked against
// the manifest here, so a frame from another run or another step is refused with
// the same message a mismatched JSON frame has always produced. What it does not
// carry — the model, the valid time, the grid geometry and the gust window — is
// filled in from the manifest, which means `validateFrame`'s comparisons on
// those four are tautologies here and cannot be leaned on. The model is
// established at ingest instead, by the run directory's name and the frame's
// content hash; see `wind_frame` in force5/ingest/publish_s3.py.
import type { FrameInfo, GridFrame, Manifest } from "./weather";

/** What a manifest's `encoding` says when its frames are binary. */
export const F5_ENCODING = "f5-int16-v1";
const MAGIC = 0x46354631; // "F5F1", read big-endian so the bytes read in order.
const VERSION = 1;
export const HEADER_BYTES = 24;
const SCALE = 10;
const MISSING = -32768;
const MAX_SCALED = 1500; // ±150 m/s, the range check the JSON frames have.

const WRONG_RUN =
  "Forecast file does not match the selected model run. Refresh the page.";

/**
 * `Int16Array` reads the platform's byte order, and the file's is little-endian.
 * Every browser in service runs little-endian, so this is a guard rather than a
 * case to handle: it turns an impossible platform into a clear error instead of
 * a map full of plausible, wrong wind.
 */
const LITTLE_ENDIAN = new Int16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

/** Header fields, or a throw. Exported for the tests; `decodeFrame` is the reader. */
export function readHeader(buffer: ArrayBuffer) {
  if (!LITTLE_ENDIAN)
    throw new Error("This browser cannot read binary forecast frames.");
  if (buffer.byteLength < HEADER_BYTES)
    throw new Error("This forecast frame could not be read. Try again.");
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== MAGIC)
    throw new Error("This forecast frame could not be read. Try again.");
  const version = view.getUint8(4);
  if (version !== VERSION)
    throw new Error(
      "This forecast frame is in a newer format. Refresh the page.",
    );
  const blockCount = view.getUint8(5);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const scale = view.getUint16(10, true);
  const hour = view.getUint16(12, true);
  const run = view.getUint32(14, true);
  // Bytes 18-23 are reserved and must be zero. Refusing a frame that uses them
  // is what lets them be given a meaning later: a reader that skipped them
  // would accept a future encoder's file and quietly misread it.
  for (let at = 18; at < HEADER_BYTES; at++)
    if (view.getUint8(at) !== 0)
      throw new Error(
        "This forecast frame is in a newer format. Refresh the page.",
      );
  if (blockCount !== 2 && blockCount !== 3)
    throw new Error("This forecast frame could not be read. Try again.");
  if (scale !== SCALE || width < 2 || height < 2)
    throw new Error("This forecast frame could not be read. Try again.");
  return { version, blockCount, width, height, scale, hour, run };
}

/**
 * One block: deltas along each row, summed back with int16 wrap-around.
 *
 * `(previous + delta) << 16 >> 16` is the wrap, and it is what lets the missing
 * marker sit inside a delta run: the value before and after it both come back
 * exactly. A marker decodes to NaN, which `validateFrame` then refuses for wind
 * exactly as it refuses a null in a JSON frame.
 */
function block(
  deltas: Int16Array,
  offset: number,
  width: number,
  height: number,
  gust: boolean,
): number[] {
  const values = new Array<number>(width * height);
  for (let row = 0; row < height; row++) {
    let previous = 0;
    const start = row * width;
    for (let column = 0; column < width; column++) {
      const delta = deltas[offset + start + column];
      const value = column === 0 ? delta : ((previous + delta) << 16) >> 16;
      previous = value;
      if (value === MISSING) {
        values[start + column] = NaN;
        continue;
      }
      if (value > MAX_SCALED || value < -MAX_SCALED || (gust && value < 0))
        throw new Error(
          `Invalid ${gust ? "gust" : "wind"} data in this forecast frame.`,
        );
      values[start + column] = value / SCALE;
    }
  }
  return values;
}

/**
 * A binary frame as today's `Frame`, checked against the manifest it came from.
 *
 * What the file proves about itself is the run, the forecast hour, the grid size
 * and the number of blocks. What it does not carry — the model, the valid time,
 * the grid geometry and the gust window — comes from the manifest, so the
 * corresponding comparisons inside `validateFrame` are tautologies for a binary
 * frame and cannot be relied on. The url establishes the model instead: the
 * ingest validator refuses a manifest whose frames sit under another model's
 * run directory, and refuses a frame whose name is not the hash of its bytes.
 *
 * The one thing the file and the manifest can still be made to agree about is
 * whether there is a gust block at all, and that is checked here.
 */
export function decodeFrame(
  buffer: ArrayBuffer,
  manifest: Manifest,
  info: FrameInfo,
): GridFrame {
  const header = readHeader(buffer);
  const grid = manifest.grid;
  if (header.hour !== info.hour || String(header.run) !== manifest.run)
    throw new Error(WRONG_RUN);
  if (header.width !== grid.width || header.height !== grid.height)
    throw new Error("Forecast grids do not match.");
  const count = header.width * header.height;
  if (buffer.byteLength !== HEADER_BYTES + header.blockCount * count * 2)
    throw new Error("This forecast frame could not be read. Try again.");
  // A frame with no published gust period must carry no gust block, and one
  // with a period must carry it. The period itself is only in the manifest.
  if ((info.gustIntervalHours === null) !== (header.blockCount === 2))
    throw new Error("Gust period does not match the selected forecast.");
  // The header length is even, so this view is always aligned; an odd offset
  // would throw here rather than give wrong numbers.
  const deltas = new Int16Array(
    buffer,
    HEADER_BYTES,
    header.blockCount * count,
  );
  return {
    model: manifest.model,
    run: manifest.run,
    hour: header.hour,
    validTime: info.validTime,
    grid,
    gustIntervalHours: info.gustIntervalHours,
    u: block(deltas, 0, header.width, header.height, false),
    v: block(deltas, count, header.width, header.height, false),
    gust:
      header.blockCount === 3
        ? block(deltas, 2 * count, header.width, header.height, true)
        : null,
  };
}
