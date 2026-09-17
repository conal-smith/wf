// The browser's reader for "F5 int16" wind frames (`encoding: "f5-int16-v1"`).
//
// The format, the header layout and the two rules both sides must agree on —
// rounding half away from zero, and delta arithmetic that wraps in int16 — are
// written out once in force5/ingest/f5bin.py. This file is the other side of
// that contract and must not drift from it; `tests/f5bin.test.ts` decodes
// the same golden file the Python suite does, so a drift fails both suites.
//
// `decodeFrame` returns exactly today's `Frame`, so `WindMap`, `sample()` and
// the particle layer never learn that the wire format changed. What the header
// cannot carry — the model, the valid time, the grid geometry and the gust
// window — is taken from the manifest, which is where those have always lived;
// what it does carry, the run and the forecast hour, is checked against the
// manifest here, so a frame from another run or another step is refused with
// the same message a mismatched JSON frame has always produced.
import type { Frame, FrameInfo, Manifest } from "./weather";

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
 * The caller still runs `validateFrame` afterwards: this function proves the
 * file belongs to this run, this hour and this grid, and `validateFrame` applies
 * every other rule the JSON path has always applied.
 */
export function decodeFrame(
  buffer: ArrayBuffer,
  manifest: Manifest,
  info: FrameInfo,
): Frame {
  const header = readHeader(buffer);
  const grid = manifest.grid;
  if (header.hour !== info.hour || String(header.run) !== manifest.run)
    throw new Error(WRONG_RUN);
  if (header.width !== grid.width || header.height !== grid.height)
    throw new Error("Forecast grids do not match.");
  const count = header.width * header.height;
  if (buffer.byteLength !== HEADER_BYTES + header.blockCount * count * 2)
    throw new Error("This forecast frame could not be read. Try again.");
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
