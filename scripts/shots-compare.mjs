#!/usr/bin/env node
// Read a re-shot visual baseline against the committed one and say, per file,
// whether anything moved.
//
// `npm run map:shots` and `npm run market:shots` overwrite the committed PNGs
// in place, so after a run the working tree holds the after and git holds the
// before. Several iteration-2 items promise the same thing of a restyle - the
// shots differ from the baseline in colour only - and that promise needs a
// number a reviewer can sign off on, not a byte comparison, which every one of
// those changes fails by design.
//
// So two measures per file:
//
//   colour      the share of pixels whose bytes changed at all. A recolour
//               moves this a long way and means nothing on its own.
//   structure   the share of edge pixels with no partner on the other side,
//               within a 1px tolerance, in whichever direction is worse. Edges
//               come from a Sobel gradient of luminance, thresholded, so a
//               recolour that keeps the same contrasts keeps the same edges,
//               while anything that moves, resizes, appears or vanishes takes
//               its edges with it.
//
// The second is not a proof. A recolour legitimately weakens or strengthens an
// edge, and one that crosses the gradient threshold drops out of the map; text
// antialiasing shifts under a new background. So the number is reported, a
// default is picked from experiment, and every file that is not byte-identical
// gets an overlay the reviewer can look at.
//
// Where the default came from. The map baseline re-shot unchanged comes back
// byte-identical, so there is no noise floor to allow for, and both runs below
// are the whole 36-file set at 1440 and 390, against the committed baseline:
//
//   a recolour only    src/styles.css ink, page background, muted and the
//                      glass panel gradient moved to another hue, plus three
//                      literals in src/dock.css. All 36 shots changed: colour
//                      7.69% to 88.54%, structure 0.00% to 0.32% (worst
//                      warning-1440).
//   a 2px layout move  .spot-row padding 11px -> 13px and the dock toolbar's
//                      0 16px -> 0 18px. 20 shots changed. The four whose
//                      search list reflows: 3.78% to 5.70% (worst search-390).
//                      The other sixteen, where only the toolbar's own row
//                      shifts: 0.26% to 0.79%.
//
// So 1% is the default: three times the recolour ceiling, and well under the
// smallest real reflow. `--threshold` overrides it.
//
// The gap between those two groups is the honest limit of the measure. A move
// confined to a small part of a full-page shot lands in the same range as a
// recolour, because the share is taken over every edge in the frame and a
// toolbar holds few of them. That is why the numbers are printed rather than
// reduced to a verdict, and why every file that moved at all gets an overlay.
//
//   npm run shots:compare -- e2e/map/__baseline__
//   npm run shots:compare -- e2e/map/__baseline__ --ref community-forum-2
//   npm run shots:compare -- e2e/market/__baseline__ --only listing
//   npm run shots:compare -- <dirA> <dirB>
//
// Exit 1 if any file changed size, is missing on one side, or is over the
// threshold; exit 2 on a bad argument.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Overlays land here. `.cache/` is git-ignored. */
const OVERLAYS = join(REPO, ".cache/shots-compare");

/** Sobel magnitude, on 0-255 luminance, at which a pixel counts as an edge. */
const EDGE = 40;
/**
 * How far a partner edge may have moved and still count as the same edge.
 * 1, not 2: a recolour jitters an antialiased edge by about a pixel, and 2
 * forgives an actual 2px move outright, which is the regression being looked
 * for. It cost nothing to tighten - see the numbers at the head of this file.
 */
const RADIUS = 1;
/** The share of unpartnered edge pixels that fails the file. */
const THRESHOLD = 0.01;

/* ---------- PNG ---------- */
// Playwright writes 8-bit non-interlaced RGB or RGBA and nothing else, so that
// is all that is read here. Nothing in the repo ships a PNG decoder - the only
// one on disk is bundled inside Playwright's own internals, behind a subpath
// that is not ours to depend on - and the format's own filters over zlib are a
// page of code, so it is done here rather than by adding a dependency. It was
// checked against that bundled decoder once, over all 36 map shots: the same
// byte everywhere. tests/shots-compare.test.ts holds what is left of that.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** `{ width, height, channels, data }`, the data one row after another. */
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE))
    throw new Error("not a PNG: the signature is wrong");
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      if (body[8] !== 8 || !channels || body[12] !== 0)
        throw new Error(
          `unsupported PNG: ${body[8]}-bit, colour type ${body[9]}, interlace ${body[12]}`,
        );
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);
  // Each row carries its filter byte and is undone against the row above it and
  // the pixel to its left, both of which are already whole by the time we are
  // here. Writing into a Buffer takes the low byte, which is the modulo the
  // format asks for.
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1);
    const filter = raw[from];
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? data[out + i - channels] : 0;
      const up = y > 0 ? data[out - stride + i] : 0;
      const upLeft =
        y > 0 && i >= channels ? data[out - stride + i - channels] : 0;
      let value = raw[from + 1 + i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - upLeft;
        const dl = Math.abs(guess - left);
        const du = Math.abs(guess - up);
        const dul = Math.abs(guess - upLeft);
        value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      } else if (filter !== 0)
        throw new Error(`unknown PNG row filter ${filter}`);
      data[out + i] = value;
    }
  }
  return { width, height, channels, data };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** An RGB image back out as a PNG. Every row unfiltered; these are overlays. */
export function encodePng({ width, height, data }) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++)
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- the measures ---------- */

/** Rec. 709 luminance, one byte per pixel. */
export function luminance({ width, height, channels, data }) {
  const grey = new Uint8Array(width * height);
  for (let i = 0, at = 0; i < grey.length; i++, at += channels)
    grey[i] = (data[at] * 54 + data[at + 1] * 183 + data[at + 2] * 19) >> 8;
  return grey;
}

/** 1 where the Sobel gradient of `grey` reaches `threshold`, 0 elsewhere. */
export function edgeMap(grey, width, height, threshold = EDGE) {
  const map = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = grey[i - width - 1];
      const t = grey[i - width];
      const tr = grey[i - width + 1];
      const l = grey[i - 1];
      const r = grey[i + 1];
      const bl = grey[i + width - 1];
      const b = grey[i + width];
      const br = grey[i + width + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      // /4 puts a clean step of 255 back at about 255, so the threshold reads
      // as a contrast in the same units as the pixels.
      if ((Math.abs(gx) + Math.abs(gy)) >> 2 >= threshold) map[i] = 1;
    }
  }
  return map;
}

/**
 * Every pixel within `radius` of a set one, Chebyshev - a horizontal pass then
 * a vertical one. Written as a scatter from the set pixels, which are sparse.
 */
function dilate(map, width, height, radius) {
  const wide = new Uint8Array(map.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++)
      if (map[row + x])
        wide.fill(
          1,
          row + Math.max(0, x - radius),
          row + Math.min(width - 1, x + radius) + 1,
        );
  }
  const out = new Uint8Array(map.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++)
      if (wide[row + x])
        for (let yy = from; yy <= to; yy++) out[yy * width + x] = 1;
  }
  return out;
}

/**
 * Two images of the same size, as `{ colour, gone, fresh, structure }` plus the
 * two edge maps and the pixels each side could not partner, which the overlay
 * draws. `gone` is the share of the before's edge pixels with nothing near them
 * in the after, `fresh` the same the other way, and `structure` the worse of
 * the two: an element that vanishes shows in one, one that appears in the other.
 */
export function compare(before, after, options = {}) {
  const { edge = EDGE, radius = RADIUS } = options;
  const { width, height } = before;
  let changed = 0;
  for (let i = 0; i < width * height; i++) {
    const a = i * before.channels;
    const b = i * after.channels;
    if (
      before.data[a] !== after.data[b] ||
      before.data[a + 1] !== after.data[b + 1] ||
      before.data[a + 2] !== after.data[b + 2]
    )
      changed += 1;
  }
  const edgesBefore = edgeMap(luminance(before), width, height, edge);
  const edgesAfter = edgeMap(luminance(after), width, height, edge);
  const nearAfter = dilate(edgesAfter, width, height, radius);
  const nearBefore = dilate(edgesBefore, width, height, radius);
  const lostBefore = new Uint8Array(edgesBefore.length);
  const lostAfter = new Uint8Array(edgesAfter.length);
  let onBefore = 0;
  let onAfter = 0;
  let goneCount = 0;
  let freshCount = 0;
  for (let i = 0; i < edgesBefore.length; i++) {
    if (edgesBefore[i]) {
      onBefore += 1;
      if (!nearAfter[i]) {
        lostBefore[i] = 1;
        goneCount += 1;
      }
    }
    if (edgesAfter[i]) {
      onAfter += 1;
      if (!nearBefore[i]) {
        lostAfter[i] = 1;
        freshCount += 1;
      }
    }
  }
  const gone = onBefore ? goneCount / onBefore : 0;
  const fresh = onAfter ? freshCount / onAfter : 0;
  return {
    colour: changed / (width * height),
    gone,
    fresh,
    structure: Math.max(gone, fresh),
    edgesBefore,
    edgesAfter,
    lostBefore,
    lostAfter,
  };
}

/* ---------- the overlay ---------- */
// The before, greyed and faded, with the edges neither side could partner on
// top of it: what the baseline had and the new shot has not, and the other way
// round. These two are a tool's colours picked to be told apart on a grey
// ground and by each other, not product design; scripts/lint-ui.mjs reads ui/,
// market/web/ and community/web/ and never scripts/, so nothing here is a
// design value and nothing here is linted as one.
const WAS = [217, 4, 148]; // magenta: in the baseline, gone from the new shot
const NOW = [0, 160, 233]; // blue: in the new shot, not in the baseline

/** An RGB image, the size of the larger side, ready for `encodePng`. */
function overlay(before, after, marks) {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  // Outside the before's own frame the ground is left black, so a shot that
  // grew shows its new room as a band rather than as more of the same.
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      const from = (y * before.width + x) * before.channels;
      const grey =
        ((before.data[from] * 54 +
          before.data[from + 1] * 183 +
          before.data[from + 2] * 19) >>
          8) /
        3;
      const to = (y * width + x) * 3;
      // A third of the luminance, so the marks read over the lightest panels.
      data[to] = 60 + grey;
      data[to + 1] = 60 + grey;
      data[to + 2] = 60 + grey;
    }
  }
  if (!marks) return { width, height, data };
  for (const [map, colour] of [
    [marks.lostBefore, WAS],
    [marks.lostAfter, NOW],
  ]) {
    for (let y = 0; y < before.height; y++) {
      for (let x = 0; x < before.width; x++) {
        if (!map[y * before.width + x]) continue;
        const to = (y * width + x) * 3;
        data[to] = colour[0];
        data[to + 1] = colour[1];
        data[to + 2] = colour[2];
      }
    }
  }
  return { width, height, data };
}

/* ---------- the two sides ---------- */

function git(args) {
  const run = spawnSync("git", args, {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0)
    throw new Error(
      `git ${args.join(" ")} failed: ${String(run.stderr).trim()}`,
    );
  return run.stdout;
}

/** A repo-relative POSIX path, which is what git wants to be asked in. */
function inRepo(dir) {
  const at = relative(REPO, resolve(dir));
  if (at.startsWith("..")) throw new Error(`${dir} is outside the repo`);
  return at.split(sep).join("/");
}

/** The PNGs in a directory on disk, by name without the extension. */
function fromDisk(dir) {
  if (!existsSync(dir)) throw new Error(`no such directory: ${dir}`);
  const shots = new Map();
  for (const entry of readdirSync(dir).sort())
    if (entry.endsWith(".png"))
      shots.set(entry.slice(0, -4), () => readFileSync(join(dir, entry)));
  return shots;
}

/** The same, read out of a git ref without touching the working tree. */
function fromRef(dir, ref) {
  const at = inRepo(dir);
  const listed = String(git(["ls-tree", "-r", "--name-only", ref, "--", at]))
    .split("\n")
    .filter((path) => path.endsWith(".png"))
    .sort();
  const shots = new Map();
  for (const path of listed)
    shots.set(path.slice(at.length + 1, -4), () =>
      git(["show", `${ref}:${path}`]),
    );
  return shots;
}

/* ---------- run ---------- */

function pct(share) {
  return `${(share * 100).toFixed(2)}%`;
}

function main(argv) {
  const flags = new Map();
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`shots compare: ${argv[i]} needs a value`);
        return 2;
      }
      flags.set(argv[i], value);
      i += 1;
    } else dirs.push(argv[i]);
  }
  if (dirs.length === 0 || dirs.length > 2) {
    console.error(
      "shots compare: usage: shots-compare.mjs <dir> [--ref <git ref>] [--only <substring>] [--threshold <share>]\n" +
        "               or:    shots-compare.mjs <dirA> <dirB> [--only <substring>] [--threshold <share>]",
    );
    return 2;
  }
  const only = flags.get("--only") || "";
  const threshold = flags.has("--threshold")
    ? Number(flags.get("--threshold"))
    : THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0) {
    console.error("shots compare: --threshold wants a share, such as 0.02");
    return 2;
  }
  if (dirs.length === 2 && flags.has("--ref")) {
    console.error(
      "shots compare: --ref and a second directory are two answers to the same question",
    );
    return 2;
  }

  const ref = flags.get("--ref") || "HEAD";
  const before = dirs.length === 2 ? fromDisk(dirs[1]) : fromRef(dirs[0], ref);
  const after = fromDisk(dirs[0]);
  const source = dirs.length === 2 ? dirs[1] : `${ref}:${inRepo(dirs[0])}`;

  const names = [...new Set([...before.keys(), ...after.keys()])]
    .filter((name) => name.includes(only))
    .sort();
  if (names.length === 0) {
    console.error(
      only
        ? `shots compare: no shot matches ${only}`
        : `shots compare: no PNGs in ${dirs[0]}`,
    );
    return 2;
  }

  rmSync(OVERLAYS, { recursive: true, force: true });
  mkdirSync(OVERLAYS, { recursive: true });
  console.log(`shots compare: ${dirs[0]} against ${source}\n`);

  const counts = { same: 0, colour: 0, moved: 0, resized: 0, alone: 0 };
  const width = Math.max(...names.map((name) => name.length));
  for (const name of names) {
    const line = `  ${name.padEnd(width)}  `;
    if (!before.has(name)) {
      counts.alone += 1;
      console.log(`${line}new shot - not in ${source}`);
      continue;
    }
    if (!after.has(name)) {
      counts.alone += 1;
      console.log(`${line}removed shot - only in ${source}`);
      continue;
    }
    const oldBytes = before.get(name)();
    const newBytes = after.get(name)();
    if (oldBytes.equals(newBytes)) {
      counts.same += 1;
      console.log(`${line}identical`);
      continue;
    }
    const oldImage = decodePng(oldBytes);
    const newImage = decodePng(newBytes);
    const size = `${oldImage.width}x${oldImage.height}`;
    if (
      oldImage.width !== newImage.width ||
      oldImage.height !== newImage.height
    ) {
      counts.resized += 1;
      writeFileSync(
        join(OVERLAYS, `${name}.png`),
        encodePng(overlay(oldImage, newImage, null)),
      );
      console.log(
        `${line}size ${size} -> ${newImage.width}x${newImage.height} - a layout change`,
      );
      continue;
    }
    const result = compare(oldImage, newImage, { edge: EDGE, radius: RADIUS });
    const over = result.structure > threshold;
    if (over) counts.moved += 1;
    else counts.colour += 1;
    writeFileSync(
      join(OVERLAYS, `${name}.png`),
      encodePng(overlay(oldImage, newImage, result)),
    );
    console.log(
      `${line}colour ${pct(result.colour).padStart(7)}  structure ${pct(
        result.structure,
      ).padStart(7)}  (gone ${pct(result.gone)}, new ${pct(result.fresh)})${
        over ? "  MOVED" : ""
      }`,
    );
  }

  const bad = counts.moved + counts.resized + counts.alone;
  console.log(
    `\nshots compare: ${names.length} shot${names.length === 1 ? "" : "s"} - ` +
      `${counts.same} identical, ${counts.colour} colour only, ` +
      `${counts.moved} over ${pct(threshold)}, ${counts.resized} resized, ` +
      `${counts.alone} on one side only`,
  );
  if (counts.same < names.length)
    console.log(
      `overlays in ${relative(REPO, OVERLAYS)} - magenta was in the baseline, blue is new`,
    );
  if (bad)
    console.error(
      "\nstructure moved. Look at the overlays before calling this a recolour.\n",
    );
  else
    console.log(
      "\nStructure held within tolerance. A reviewer still signs the overlays off.\n",
    );
  return bad ? 1 : 0;
}

// Run, unless something has imported this for the measure alone.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`shots compare: ${error.message}`);
    process.exit(2);
  }
}
