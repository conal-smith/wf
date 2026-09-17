import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  F5_ENCODING,
  HEADER_BYTES,
  decodeFrame,
  readHeader,
} from "../force5/src/f5bin";
import {
  loadFrame,
  validateFrame,
  type FrameInfo,
  type Manifest,
} from "../force5/src/weather";
// The Node encoder the sample generator uses. Decoding the golden file here and
// re-encoding it through that module pins all three implementations of the
// format to one another: this one, scripts/f5bin.mjs and force5/ingest/f5bin.py.
import { encodeFrame, quantiseValue } from "../scripts/f5bin.mjs";
import { FIXTURE_ROOT } from "./bundles";

// The same two files force5/ingest/test_f5bin.py reads.
const golden = JSON.parse(
  readFileSync(`${FIXTURE_ROOT}/f5bin/golden.json`, "utf8"),
);
const goldenBytes = readFileSync(`${FIXTURE_ROOT}/f5bin/golden.bin`);

/** A Node Buffer as the ArrayBuffer a `fetch` response would hand the decoder. */
const bytes = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

/** `null` in the golden values is a missing cell; the decoder returns NaN. */
const nulled = (values: number[]) =>
  values.map((value) => (Number.isNaN(value) ? null : value));

/** A grid `validateGrid` accepts, at whatever size a case needs. */
const gridOf = (width: number, height: number) => ({
  width,
  height,
  west: -10,
  east: -10 + (width - 1) * 0.5,
  north: 54,
  south: 54 - (height - 1) * 0.5,
  dx: 0.5,
  dy: 0.5,
});
const grid = gridOf(golden.width, golden.height);
const info: FrameInfo = {
  hour: golden.hour,
  validTime: "2026-09-19T06:00:00Z",
  url: "weather/run/042-abc.bin",
  gustIntervalHours: [golden.hour - 1, golden.hour],
};
const manifest = {
  schemaVersion: 1,
  model: "golden",
  run: golden.run,
  runTime: "2026-09-17T12:00:00Z",
  grid,
  encoding: F5_ENCODING,
  frames: [info],
} as unknown as Manifest;

const source = {
  model: "golden",
  run: golden.run,
  hour: golden.hour,
  grid: { width: golden.width, height: golden.height },
  ...golden.source,
};

describe("the golden binary frame", () => {
  it("decodes to exactly the values every reader must agree on", () => {
    const frame = decodeFrame(bytes(goldenBytes), manifest, info);
    expect(nulled(frame.u)).toEqual(golden.expected.u);
    expect(nulled(frame.v)).toEqual(golden.expected.v);
    expect(nulled(frame.gust!)).toEqual(golden.expected.gust);
    expect(frame.hour).toBe(golden.hour);
    expect(frame.run).toBe(golden.run);
  });

  it("is what the Node encoder produces from the same source values", () => {
    expect(encodeFrame(source).equals(goldenBytes)).toBe(true);
    expect(goldenBytes.byteLength).toBe(golden.bytes);
  });

  it("reads a header that says what the file is", () => {
    expect(readHeader(bytes(goldenBytes))).toEqual({
      version: 1,
      blockCount: golden.blockCount,
      width: golden.width,
      height: golden.height,
      scale: golden.scale,
      hour: golden.hour,
      run: Number(golden.run),
    });
  });
});

describe("rounding and wrap-around, which both sides must spell the same way", () => {
  it("rounds halves away from zero, not to even and not towards +infinity", () => {
    // Math.round would give 0 for -0.5 and numpy's round would give 2 for 2.5.
    expect(quantiseValue(0.05)).toBe(1);
    expect(quantiseValue(-0.05)).toBe(-1);
    expect(quantiseValue(0.25)).toBe(3);
    expect(quantiseValue(-0.25)).toBe(-3);
    expect(quantiseValue(0.04)).toBe(0);
    expect(quantiseValue(-0.04)).toBe(-0);
  });

  it("carries a missing value through the middle of a delta run", () => {
    const values = [1.2, null, -3.4, 0.0, null, null, 9.9, -0.1];
    const frame = decodeFrame(
      bytes(
        encodeFrame({
          ...source,
          grid: { width: 4, height: 2 },
          u: values,
          v: new Array(8).fill(0),
          gust: null,
        }),
      ),
      { ...manifest, grid: gridOf(4, 2) } as Manifest,
      info,
    );
    expect(nulled(frame.u)).toEqual(values);
    expect(frame.gust).toBeNull();
  });

  it("treats -32768 as a delta as an ordinary number", () => {
    // A marker beside a zero makes the delta exactly -32768 in both directions.
    for (const values of [
      [0, null, 0, null],
      [null, 0, null, 0],
    ]) {
      const data = encodeFrame({
        ...source,
        grid: { width: 2, height: 2 },
        u: values,
        v: [0, 0, 0, 0],
        gust: null,
      });
      const view = new DataView(bytes(data));
      expect(view.getInt16(HEADER_BYTES + 2, true)).toBe(-32768);
      const frame = decodeFrame(
        bytes(data),
        { ...manifest, grid: gridOf(2, 2) } as Manifest,
        info,
      );
      expect(nulled(frame.u)).toEqual(values);
    }
  });

  it("hands a missing wind value to validateFrame, which refuses it as before", () => {
    // A wind frame has never been allowed a hole; a JSON null failed the same
    // check. The codec carries the marker so the format can grow, and the frame
    // contract still refuses it here rather than drawing NaN on the map.
    const small = {
      ...manifest,
      grid: gridOf(2, 2),
      gustAvailable: false,
    } as Manifest;
    const holed = { ...info, gustIntervalHours: null };
    const frame = decodeFrame(
      bytes(
        encodeFrame({
          ...source,
          grid: { width: 2, height: 2 },
          u: [1, null, 2, 3],
          v: [0, 0, 0, 0],
          gust: null,
        }),
      ),
      small,
      holed,
    );
    expect(() => validateFrame(frame, small, holed)).toThrow(
      /Invalid u wind data/,
    );
  });
});

describe("a frame that is not the one that was asked for", () => {
  const wrongRun = /does not match the selected model run/;

  it("refuses another forecast hour", () => {
    expect(() =>
      decodeFrame(bytes(goldenBytes), manifest, { ...info, hour: 41 }),
    ).toThrow(wrongRun);
  });

  it("refuses another run", () => {
    expect(() =>
      decodeFrame(
        bytes(goldenBytes),
        { ...manifest, run: "2026091700" } as Manifest,
        info,
      ),
    ).toThrow(wrongRun);
    // The same file under a run that only differs in its cycle hour.
    expect(() =>
      decodeFrame(
        bytes(goldenBytes),
        { ...manifest, run: "2026091713" } as Manifest,
        info,
      ),
    ).toThrow(wrongRun);
  });

  it("refuses another grid", () => {
    expect(() =>
      decodeFrame(
        bytes(goldenBytes),
        { ...manifest, grid: { ...grid, width: golden.width + 1 } } as Manifest,
        info,
      ),
    ).toThrow(/grids do not match/);
  });

  it("refuses a truncated, oversized or foreign buffer", () => {
    const cases = [
      goldenBytes.subarray(0, goldenBytes.length - 2),
      goldenBytes.subarray(0, HEADER_BYTES),
      Buffer.concat([goldenBytes, Buffer.alloc(2)]),
      Buffer.alloc(0),
      Buffer.from('{"model":"golden"}'),
    ];
    for (const broken of cases)
      expect(() => decodeFrame(bytes(broken), manifest, info)).toThrow();
  });

  it("refuses a newer format version rather than guessing at it", () => {
    const future = Buffer.from(goldenBytes);
    future.writeUInt8(2, 4);
    expect(() => decodeFrame(bytes(future), manifest, info)).toThrow(
      /newer format/,
    );
  });

  it("refuses an out-of-range value the encoder would never have written", () => {
    const tampered = Buffer.from(goldenBytes);
    tampered.writeInt16LE(1501, HEADER_BYTES);
    expect(() => decodeFrame(bytes(tampered), manifest, info)).toThrow(
      /Invalid wind data/,
    );
    const negativeGust = Buffer.from(goldenBytes);
    negativeGust.writeInt16LE(
      -1,
      HEADER_BYTES + 2 * golden.width * golden.height * 2,
    );
    expect(() => decodeFrame(bytes(negativeGust), manifest, info)).toThrow(
      /Invalid gust data/,
    );
  });
});

describe("loadFrame reads whichever encoding the manifest declares", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A complete frame, unlike the golden, which carries deliberate holes that a
  // wind frame is never allowed to publish.
  const cells = 4;
  const whole = {
    ...source,
    grid: { width: 2, height: 2 },
    u: [3, 3.5, -4, 0],
    v: [-4, -4, 1, 2],
    gust: [9, 9.5, 10, 11],
  };
  const small = { ...manifest, grid: gridOf(2, 2) } as Manifest;
  const binary = {
    ...small,
    frames: [{ ...info, url: "weather/run/042-binary.bin" }],
  } as Manifest;
  const asJson = {
    ...small,
    encoding: undefined,
    frames: [{ ...info, url: "weather/run/042-legacy.json" }],
  } as Manifest;

  it("decodes a binary frame into the shape the map already draws", async () => {
    const data = encodeFrame(whole);
    vi.stubGlobal(
      "fetch",
      async () => new Response(new Uint8Array(data), { status: 200 }),
    );
    const frame = await loadFrame(binary, 0);
    expect(frame.model).toBe("golden");
    expect(frame.run).toBe(golden.run);
    expect(frame.validTime).toBe(info.validTime);
    expect(frame.u).toEqual(whole.u);
    expect(frame.gust).toEqual(whole.gust);
    expect(frame.u.length).toBe(cells);
    expect(frame.gustIntervalHours).toEqual(info.gustIntervalHours);
  });

  it("still reads a JSON frame when no encoding is declared", async () => {
    const body = {
      model: "golden",
      run: golden.run,
      hour: golden.hour,
      validTime: info.validTime,
      grid: gridOf(2, 2),
      gustIntervalHours: info.gustIntervalHours,
      u: new Array(cells).fill(3),
      v: new Array(cells).fill(-4),
      gust: new Array(cells).fill(9),
    };
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );
    const frame = await loadFrame(asJson, 0);
    expect(frame.u[0]).toBe(3);
    expect(frame.gust![0]).toBe(9);
  });

  it("refuses a binary frame served where a JSON one was declared", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(new Uint8Array(encodeFrame(whole)), { status: 200 }),
    );
    await expect(
      loadFrame(
        {
          ...asJson,
          frames: [{ ...info, url: "weather/run/042-other.json" }],
        } as Manifest,
        0,
      ),
    ).rejects.toThrow();
  });
});
