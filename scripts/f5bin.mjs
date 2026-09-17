/**
 * The "F5 int16" wind frame, for Node: the encoder the sample generator needs,
 * and a decoder beside it so a round trip can be checked without a browser.
 *
 * There are three implementations of this format and they must agree byte for
 * byte: force5/ingest/f5bin.py (which documents the layout and the rules),
 * force5/src/f5bin.ts (the browser's reader) and this one. A single golden file,
 * tests/fixtures/f5bin/golden.bin, is decoded by all three in their own suites,
 * and tests/f5bin.test.ts additionally re-encodes it through this module,
 * so a drift in any one of them fails a test rather than a forecast.
 *
 * The two rules worth repeating here, because they are the ones easy to get
 * subtly wrong:
 *
 *   - rounding is half AWAY FROM ZERO, written out rather than left to
 *     `Math.round` (which rounds -0.5 towards +∞) or numpy's `round` (which
 *     rounds halves to even);
 *   - delta arithmetic WRAPS in int16, so the missing marker -32768 can sit in
 *     the middle of a delta run without overflowing it.
 */
export const F5_ENCODING = "f5-int16-v1";
export const HEADER_BYTES = 24;
export const SCALE = 10;
export const MISSING = -32768;
const MAGIC = "F5F1";
const VERSION = 1;
const MAX_SCALED = 1500; // ±150 m/s.
const FIELDS = ["u", "v", "gust"];

/** Half away from zero, the one rounding every side of this format uses. */
export const quantiseValue = (value) => {
  const scaled = value * SCALE;
  return Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
};

const fold = (value) => ((value + 32768) & 0xffff) - 32768;

/** One field as int16 tenths; null and non-finite become the missing marker. */
function quantise(values, count, field, what) {
  if (!Array.isArray(values) || values.length !== count)
    throw new Error(`${what}: expected ${count} values`);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) {
      out[i] = MISSING;
      continue;
    }
    const scaled = quantiseValue(value);
    if (Math.abs(scaled) > MAX_SCALED)
      throw new Error(`${what}: ${value} is outside ±150 m/s`);
    if (field === "gust" && scaled < 0)
      throw new Error(`${what}: ${value} is negative`);
    out[i] = scaled;
  }
  return out;
}

/** One published wind frame's bytes, from the payload the generators build. */
export function encodeFrame(payload) {
  const { width, height } = payload.grid;
  if (!(width >= 2 && width <= 65535 && height >= 2 && height <= 65535))
    throw new Error("Grid dimensions do not fit a binary frame header");
  const count = width * height;
  const blocks = FIELDS.filter((field) => payload[field] != null);
  if (payload.u == null || payload.v == null || blocks.length < 2)
    throw new Error("A wind frame carries u and v, and gust or nothing");
  if (!/^\d{10}$/.test(String(payload.run)))
    throw new Error("A binary frame header carries the run as YYYYMMDDHH");
  const buffer = Buffer.alloc(HEADER_BYTES + blocks.length * count * 2);
  buffer.write(MAGIC, 0, "latin1");
  buffer.writeUInt8(VERSION, 4);
  buffer.writeUInt8(blocks.length, 5);
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  buffer.writeUInt16LE(SCALE, 10);
  buffer.writeUInt16LE(payload.hour, 12);
  buffer.writeUInt32LE(Number(payload.run), 14);
  blocks.forEach((field, index) => {
    const values = quantise(
      payload[field],
      count,
      field,
      `${payload.model} ${field}`,
    );
    let at = HEADER_BYTES + index * count * 2;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const here = values[row * width + column];
        const delta =
          column === 0 ? here : fold(here - values[row * width + column - 1]);
        buffer.writeInt16LE(delta, at);
        at += 2;
      }
    }
  });
  return buffer;
}

/** Header fields plus u/v/gust in m/s; a missing value comes back as null. */
export function decodeFrame(data) {
  const buffer = Buffer.from(data);
  if (buffer.length < HEADER_BYTES)
    throw new Error("Binary frame is shorter than its header");
  if (buffer.toString("latin1", 0, 4) !== MAGIC)
    throw new Error("Not an F5 binary frame");
  const version = buffer.readUInt8(4);
  if (version !== VERSION)
    throw new Error(`Unsupported binary frame version ${version}`);
  const blockCount = buffer.readUInt8(5);
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const scale = buffer.readUInt16LE(10);
  const hour = buffer.readUInt16LE(12);
  const run = buffer.readUInt32LE(14);
  if (blockCount !== 2 && blockCount !== 3)
    throw new Error("A wind frame carries u and v, and gust or nothing");
  if (scale !== SCALE) throw new Error(`Unsupported scale ${scale}`);
  if (width < 2 || height < 2) throw new Error("Invalid binary frame grid");
  const count = width * height;
  if (buffer.length !== HEADER_BYTES + blockCount * count * 2)
    throw new Error(
      `Binary frame is ${buffer.length} bytes, not the ` +
        `${HEADER_BYTES + blockCount * count * 2} its header describes`,
    );
  const frame = {
    version,
    blockCount,
    width,
    height,
    scale,
    hour,
    run: String(run),
    gust: null,
  };
  FIELDS.slice(0, blockCount).forEach((field, index) => {
    const values = new Array(count);
    let at = HEADER_BYTES + index * count * 2;
    for (let row = 0; row < height; row++) {
      let previous = 0;
      for (let column = 0; column < width; column++) {
        const delta = buffer.readInt16LE(at);
        at += 2;
        const value = column === 0 ? delta : fold(previous + delta);
        previous = value;
        if (value === MISSING) {
          values[row * width + column] = null;
          continue;
        }
        if (Math.abs(value) > MAX_SCALED || (field === "gust" && value < 0))
          throw new Error(`Implausible ${field} value in a binary frame`);
        values[row * width + column] = value / SCALE;
      }
    }
    frame[field] = values;
  });
  return frame;
}
