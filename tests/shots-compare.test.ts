import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { compare, decodePng, encodePng } from "../scripts/shots-compare.mjs";

/**
 * The measure `scripts/shots-compare.mjs` reports, on shapes small enough to
 * reason about: the same picture, the same picture in another colour, and the
 * same picture moved two pixels. The real baseline is what the default
 * threshold was read off (see the head of the script); this is what pins the
 * arithmetic under it, so a change to the edge map or the tolerance that
 * stopped telling a move from a recolour would fail here.
 *
 * The script is also run as a process, the way `npm run shots:compare` runs it,
 * for the answers that are not a number: a shot on one side only, and a shot
 * that changed size.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/shots-compare.mjs");
/** The script's own default; a case here is meant to sit clear of it. */
const THRESHOLD = 0.01;

type Image = {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
};

/** A plain canvas, one flat colour. */
function canvas(width: number, height: number, fill: number[]): Image {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = fill[0];
    data[i * 3 + 1] = fill[1];
    data[i * 3 + 2] = fill[2];
  }
  return { width, height, channels: 3, data };
}

function rect(
  image: Image,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: number[],
): Image {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const at = (row * image.width + col) * 3;
      image.data[at] = colour[0];
      image.data[at + 1] = colour[1];
      image.data[at + 2] = colour[2];
    }
  }
  return image;
}

const PAPER = [240, 244, 246];
const INK = [32, 48, 64];
/** Another hue at much the same luminance: a recolour, not a redraw. */
const OTHER_INK = [64, 40, 32];

const boxed = (x: number, y: number, colour = INK) =>
  rect(canvas(120, 90, PAPER), x, y, 40, 30, colour);

describe("the structure measure", () => {
  it("is zero for a picture against itself", () => {
    const image = boxed(30, 25);
    const result = compare(image, image);
    expect(result.colour).toBe(0);
    expect(result.structure).toBe(0);
  });

  it("stays under the threshold when only the colour changed", () => {
    const result = compare(boxed(30, 25), boxed(30, 25, OTHER_INK));
    // Every pixel of the box is a different colour, and not one edge moved.
    expect(result.colour).toBeGreaterThan(0.1);
    expect(result.structure).toBeLessThan(THRESHOLD);
  });

  it("goes well over the threshold when the box moves two pixels", () => {
    const result = compare(boxed(30, 25), boxed(32, 27));
    expect(result.structure).toBeGreaterThan(THRESHOLD * 10);
    // A move is unpartnered from both ends: the old edge has no new one near
    // it and the new edge has no old one. That is what tells it from a box
    // that merely vanished.
    expect(result.gone).toBeGreaterThan(THRESHOLD * 10);
    expect(result.fresh).toBeGreaterThan(THRESHOLD * 10);
  });

  it("catches a box that vanished, from the one side that can see it", () => {
    const result = compare(boxed(30, 25), canvas(120, 90, PAPER));
    expect(result.gone).toBe(1);
    expect(result.fresh).toBe(0);
    expect(result.structure).toBe(1);
  });

  it("forgives a single pixel, which is what antialiasing moves", () => {
    expect(compare(boxed(30, 25), boxed(31, 25)).structure).toBeLessThan(
      THRESHOLD,
    );
  });
});

describe("the PNG codec", () => {
  it("reads back what it wrote", () => {
    const image = boxed(30, 25);
    const read = decodePng(encodePng(image));
    expect(read.width).toBe(image.width);
    expect(read.height).toBe(image.height);
    expect(read.channels).toBe(3);
    expect(read.data.equals(image.data)).toBe(true);
  });

  it("reads a real shot out of the committed baseline", () => {
    // The shapes above are written by the encoder here, so they come back
    // through filter 0 alone. A real shot is filtered adaptively and uses all
    // five, which is the part worth pinning to a file nothing here wrote.
    const shot = decodePng(
      readFileSync(join(ROOT, "e2e/map/__baseline__/idle-1440.png")),
    );
    expect([shot.width, shot.height, shot.channels]).toEqual([1440, 1000, 3]);
    expect(shot.data.length).toBe(1440 * 1000 * 3);
    // The corner of the chart's neatline, in ink. What this test is about is
    // the codec, not the palette: a pixel nothing here wrote, read back.
    expect([...shot.data.subarray(0, 3)]).toEqual([0x1a, 0x1d, 0x21]);
  });
});

describe("the script", () => {
  const trees: string[] = [];
  afterEach(() => {
    for (const tree of trees.splice(0))
      rmSync(tree, { recursive: true, force: true });
  });

  /** Two directories of PNGs, compared the way the npm script compares them. */
  function run(a: Record<string, Image>, b: Record<string, Image>) {
    const root = mkdtempSync(join(tmpdir(), "shots-compare-test-"));
    trees.push(root);
    for (const [side, shots] of [
      ["a", a],
      ["b", b],
    ] as const) {
      mkdirSync(join(root, side));
      for (const [name, image] of Object.entries(shots))
        writeFileSync(join(root, side, `${name}.png`), encodePng(image));
    }
    const done = spawnSync(
      process.execPath,
      [SCRIPT, join(root, "a"), join(root, "b")],
      { encoding: "utf8" },
    );
    return { status: done.status, output: done.stdout + done.stderr };
  }

  it("passes two identical directories", () => {
    const shot = boxed(30, 25);
    const { status, output } = run({ idle: shot }, { idle: shot });
    expect(status).toBe(0);
    expect(output).toContain("identical");
  });

  it("fails a shot that is only on one side", () => {
    const shot = boxed(30, 25);
    const { status, output } = run({ idle: shot, extra: shot }, { idle: shot });
    expect(status).toBe(1);
    expect(output).toContain("new shot");
  });

  it("fails a shot that changed size, without measuring it", () => {
    const { status, output } = run(
      { idle: rect(canvas(120, 100, PAPER), 30, 25, 40, 30, INK) },
      { idle: boxed(30, 25) },
    );
    expect(status).toBe(1);
    expect(output).toContain("size 120x90 -> 120x100");
  });
});
