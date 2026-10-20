// The mark round the chosen spot: a loupe laid on the chart, a range ring, or
// nothing. Pure geometry, so the sizes can be tested without a map; WindMap.tsx
// draws them.
import { offshoreSpans, rideRose, type Rose, type Span } from "./rideWedge";
import type { Rider } from "./stars";
import { convert, KNOTS, unitLabel, type Units } from "./units";
import { compass, windColor } from "./weather";

/** How the map marks the chosen spot's surroundings. */
export type FocusStyle = "loupe" | "ring" | "off";

export const FOCUS_STYLES: readonly FocusStyle[] = ["loupe", "ring", "off"];

export const isFocusStyle = (value: unknown): value is FocusStyle =>
  FOCUS_STYLES.includes(value as FocusStyle);

/** Metres a CSS pixel covers at a zoom and latitude (MapLibre's 512 px tiles). */
export const metresPerPixel = (zoom: number, lat: number) =>
  (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/** The paper band of the loupe's rim, between its two ink lines, in pixels. */
export const LOUPE_BAND = 13;

/** A tick of the loupe's compass bezel, from its centre; every 5°, longer every 30°. */
export function bezelTicks(r: number) {
  const ticks: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    long: boolean;
  }[] = [];
  // North is a letter, not a tick.
  for (let a = 5; a < 360; a += 5) {
    const long = a % 30 === 0;
    const t = ((a - 90) * Math.PI) / 180;
    const r0 = r + 1.5;
    const r1 = r + (long ? 8 : 4.5);
    ticks.push({
      x1: Math.cos(t) * r0,
      y1: Math.sin(t) * r0,
      x2: Math.cos(t) * r1,
      y2: Math.sin(t) * r1,
      long,
    });
  }
  return ticks;
}

/**
 * The distance a range ring is measured in, after the rider's speed units:
 * nautical miles with knots, miles with miles an hour, kilometres with
 * kilometres an hour, and metres (kilometres past one) with metres a second.
 */
const RANGE_UNITS: Record<
  Units,
  { metres: number; steps: readonly number[]; label: (n: number) => string }
> = {
  kn: {
    metres: 1852,
    steps: [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100],
    label: (n) => `${n} NM`,
  },
  mph: {
    metres: 1609.344,
    steps: [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100],
    label: (n) => `${n} mi`,
  },
  "km/h": {
    metres: 1000,
    steps: [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200],
    label: (n) => `${n} km`,
  },
  "m/s": {
    metres: 1000,
    steps: [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200],
    label: (n) => (n < 1 ? `${n * 1000} m` : `${n} km`),
  },
};

/**
 * The range ring: the longest round distance that sits inside 42% of the
 * map's shorter side, in the rider's units, and its radius on screen. Chosen
 * again whenever the camera rests, so it steps through the distances as the
 * rider zooms; in between it is a distance on the chart and moves with it.
 */
export function rangeRing(
  metresPerPx: number,
  short: number,
  units: Units = "kn",
) {
  const unit = RANGE_UNITS[units];
  const max = 0.42 * short;
  const n =
    [...unit.steps]
      .reverse()
      .find((d) => (d * unit.metres) / metresPerPx <= max) ?? unit.steps[0];
  const metres = n * unit.metres;
  // "0.5 NM", "500 m": the ring's distance, as it is written beside it.
  return { metres, label: unit.label(n), px: metres / metresPerPx };
}

/** The most bands the wash is ever cut in: each is a layer of its own on the map. */
export const WASH_BANDS = 5;

/**
 * The light paper wash beyond the mark: holes round the spot in pixels, and
 * the wash's strength from each hole out to the next, the last out to the
 * edge of the world. The loupe's is one flat 18%, its edge under the rim's
 * paper band. The ring's is barely there and only well beyond it, feathered
 * out to 10% in five steps too slight to see.
 *
 * Each band is as strong as that many sheets of the first one's paper laid
 * on one another, which is how the ring's wash was first drawn: five sheets
 * of the whole world, each with its hole, stacked. That filled the map five
 * times over on every frame; a band apiece fills it once.
 */
export function washHoles(
  style: FocusStyle,
  px: number,
): { holes: number[]; opacity: number[] } {
  if (style === "loupe")
    return { holes: [px + LOUPE_BAND / 2], opacity: [0.18] };
  if (style === "ring") {
    const steps = WASH_BANDS;
    const start = px * 1.45;
    const sheet = 1 - (1 - 0.1) ** (1 / steps);
    return {
      holes: Array.from(
        { length: steps },
        (_, i) => start + (i * 160) / (steps - 1),
      ),
      opacity: Array.from(
        { length: steps },
        (_, i) => 1 - (1 - sheet) ** (i + 1),
      ),
    };
  }
  return { holes: [], opacity: [] };
}

/* ---- the ride rose: the loupe's glass, at a true distance ----------------- */

/**
 * How far the rose reaches on the ground, in the rider's units: the round
 * distance nearest a kilometre (about as far as a rider goes on one tack
 * before turning), with a ring at half of it. Half a nautical mile with knots,
 * half a mile with miles an hour, a kilometre with either metric unit.
 */
export interface RoseScale {
  metres: number;
  label: string;
  /** The inner ring, at half the distance. */
  inner: number;
  innerLabel: string;
}

const metricLabel = (km: number) => (km < 1 ? `${km * 1000} m` : `${km} km`);

export function roseScale(units: Units): RoseScale {
  const unit = RANGE_UNITS[units];
  const n = unit.steps.reduce((best, d) =>
    Math.abs(d * unit.metres - 1000) < Math.abs(best * unit.metres - 1000)
      ? d
      : best,
  );
  const label = unit.metres === 1000 ? metricLabel : unit.label;
  return {
    metres: n * unit.metres,
    label: label(n),
    inner: (n / 2) * unit.metres,
    innerLabel: label(n / 2),
  };
}

/**
 * Under this radius the rose is too small to read: it is drawn this size,
 * no longer to scale, as a compass with the wind and nothing inside.
 */
export const ROSE_MIN_PX = 70;

/** The rose's radius on screen at this many metres a pixel, and whether it is to scale. */
export function roseRadius(metres: number, metresPerPx: number) {
  const px = metres / metresPerPx;
  return px >= ROSE_MIN_PX
    ? { r: px, toScale: true }
    : { r: ROSE_MIN_PX, toScale: false };
}

/**
 * The rose's radius when a spot is flown to: a little under half the shorter
 * side of the map left clear of the boxes and the dock, so the bezel, its
 * labels and the foot box all fit, and no more than 200 px on a desktop.
 */
export function roseFitRadius(width: number, height: number): number {
  const short = Math.min(width, height);
  return Math.round(
    Math.min(200, Math.max(ROSE_MIN_PX + 20, 0.45 * short - LOUPE_BAND)),
  );
}

/** The zoom at which `metres` on the ground at `lat` are `px` on the screen. */
export const zoomFor = (metres: number, px: number, lat: number) =>
  Math.log2(
    (40075016.686 * Math.cos((lat * Math.PI) / 180) * px) / (512 * metres),
  );

const f1 = (n: number) => (Math.abs(n) < 0.05 ? "0" : n.toFixed(1));

/** A point `r` out from the centre on a compass bearing, y down as on the screen. */
export function polar(bearing: number, r: number): [number, number] {
  const a = (bearing * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
}

/** An arc of radius `r`, clockwise along a span (or back, `reverse`). */
export function arcPath(s: Span, r: number, reverse = false): string {
  const [a, b] = reverse ? [s.to, s.from] : [s.from, s.to];
  const [x1, y1] = polar(a, r);
  const [x2, y2] = polar(b, r);
  const large = s.to - s.from > 180 ? 1 : 0;
  return `M${f1(x1)} ${f1(y1)}A${f1(r)} ${f1(r)} 0 ${large} ${reverse ? 0 : 1} ${f1(x2)} ${f1(y2)}`;
}

/** A sector between radii `r0` (0: from the centre) and `r1`, clockwise along a span. */
export function sectorPath(s: Span, r0: number, r1: number): string {
  const large = s.to - s.from > 180 ? 1 : 0;
  const [ax, ay] = polar(s.from, r1);
  const [bx, by] = polar(s.to, r1);
  const outer = `A${f1(r1)} ${f1(r1)} 0 ${large} 1 ${f1(bx)} ${f1(by)}`;
  if (r0 <= 0) return `M0 0L${f1(ax)} ${f1(ay)}${outer}Z`;
  const [cx, cy] = polar(s.to, r0);
  const [dx, dy] = polar(s.from, r0);
  return `M${f1(ax)} ${f1(ay)}${outer}L${f1(cx)} ${f1(cy)}A${f1(r0)} ${f1(r0)} 0 ${large} 0 ${f1(dx)} ${f1(dy)}Z`;
}

/** A filled arrowhead with its tip `r` out on a bearing, pointing outwards. */
export function arrowHead(bearing: number, r: number, size: number): string {
  const [x, y] = polar(bearing, r);
  const [bx, by] = polar(bearing, -size);
  const [lx, ly] = polar(bearing - 90, size * 0.55);
  return `M${f1(x)} ${f1(y)}L${f1(x + bx + lx)} ${f1(y + by + ly)}L${f1(x + bx - lx)} ${f1(y + by - ly)}Z`;
}

const mid = (s: Span) => (s.from + s.to) / 2;
const bearings = (s: Span) => `${s.from % 360}–${s.to % 360}°`;

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const ray = (bearing: number, r0: number, r1: number): Line => {
  const [x1, y1] = polar(bearing, r0);
  const [x2, y2] = polar(bearing, r1);
  return { x1, y1, x2, y2 };
};

export interface RoseLabel {
  x: number;
  y: number;
  text: string;
  /** A name in tracked capitals, a figure under it, or the pen's words. */
  kind: "name" | "figure" | "warn";
}

export interface RoseFan {
  kind: "out" | "home" | "reach";
  /** The fan's fill, to the rim: the tack out only. */
  fill: string | null;
  edges: Line[];
  /** Along the rim: heavy for out, dashed for home and a plain reach. */
  arc: string;
  /** An arrowhead on the rim, at the middle of the tack out. */
  head: string | null;
}

export interface RoseDrawing {
  nogo: { fill: string; edges: Line[] } | null;
  fans: RoseFan[];
  drift: { line: Line; head: string; out: boolean } | null;
  rings: { r: number; label: RoseLabel }[];
  labels: RoseLabel[];
}

/** Labels are written from this radius, and bearings under them from this. */
const ROSE_NAMES_PX = 90;
const ROSE_FIGURES_PX = 120;
/** The fans start this far out, clear of the light in the middle. */
const ROSE_HUB = 16;

/**
 * Inside the glass, at radius `r`: the no-go upwind, the reaches (the tack out
 * washed to the rim, the tack home dashed), the drift downwind, and when it is
 * to scale, the ring at half the distance with both distances written. Under
 * ROSE_MIN_PX nothing; names from 90 px and bearings from 120, so a small rose
 * is shapes, not a page of print.
 */
export function roseDrawing(
  rose: Rose | null,
  r: number,
  scale: RoseScale | null,
): RoseDrawing {
  const out: RoseDrawing = {
    nogo: null,
    fans: [],
    drift: null,
    rings: [],
    labels: [],
  };
  if (r < ROSE_MIN_PX) return out;
  const names = r >= ROSE_NAMES_PX;
  const figures = r >= ROSE_FIGURES_PX;
  const label = (
    bearing: number,
    at: number,
    text: string,
    kind: RoseLabel["kind"],
    dy = 0,
  ) => {
    const [x, y] = polar(bearing, at);
    out.labels.push({ x, y: y + dy, text, kind });
  };
  if (rose?.nogo) {
    out.nogo = {
      fill: sectorPath(rose.nogo, 0, r),
      edges: [ray(rose.nogo.from, 0, r), ray(rose.nogo.to, 0, r)],
    };
    if (names) label(mid(rose.nogo), r * 0.6, "NO-GO", "name", 3);
  }
  for (const reach of rose?.reaches ?? []) {
    const isOut = reach.kind === "out";
    out.fans.push({
      kind: reach.kind,
      fill: isOut ? sectorPath(reach, ROSE_HUB, r) : null,
      edges: [ray(reach.from, ROSE_HUB, r), ray(reach.to, ROSE_HUB, r)],
      arc: arcPath(reach, r - 3),
      head: isOut ? arrowHead(mid(reach), r - 1, 9) : null,
    });
    if (names) label(mid(reach), r * 0.7, reach.kind.toUpperCase(), "name", -2);
    if (figures) label(mid(reach), r * 0.7, bearings(reach), "figure", 11);
  }
  if (rose?.drift != null) {
    const tip = r * 0.66;
    out.drift = {
      line: ray(rose.drift, 30, tip),
      head: arrowHead(rose.drift, tip + 7, 8),
      out: rose.driftOut,
    };
    if (names) {
      const kind = rose.driftOut ? "warn" : "name";
      label(rose.drift, r * 0.45, "DRIFT", kind, 15);
      if (rose.driftOut && figures)
        label(rose.drift, r * 0.45, "OUT TO SEA", kind, 27);
    }
  }
  if (scale) {
    // Written 45° round from the drift, where no fan reaches, on the side
    // higher on the screen: the drift's own words hang below its arrow.
    const drift = rose?.drift ?? 180;
    const at = [drift - 45, drift + 45].reduce((a, b) =>
      Math.cos((b * Math.PI) / 180) > Math.cos((a * Math.PI) / 180) ? b : a,
    );
    const ratio = scale.inner / scale.metres;
    const [ix, iy] = polar(at, r * ratio);
    // In from the rim by half the words' width where the rim is upright.
    const half = scale.label.length * 3.6;
    const sin = Math.abs(Math.sin((at * Math.PI) / 180));
    const [ox, oy] = polar(at, r - 12 - sin * half);
    out.rings.push({
      r: r * ratio,
      label: { x: ix, y: iy + 4, text: scale.innerLabel, kind: "figure" },
    });
    out.labels.push({ x: ox, y: oy + 4, text: scale.label, kind: "figure" });
  }
  return out;
}

export interface DialDrawing {
  /** The offshore winds' span on the bezel, densely hatched, and its red arc outside. */
  offshore: { band: string; arc: string; text: string } | null;
  /** The cross-offshore spans either side, lightly hatched. */
  crossOff: string[];
  /** The wind's needle, from outside the bezel in to the glass. */
  needle: string;
  /** The pin it turns on, on the band. */
  pin: [number, number];
}

/** How far in from the rim the needle reaches. */
const NEEDLE = 30;

/**
 * On the bezel at radius `r`: the wind directions that are offshore here in
 * red (none without a facing), and the needle at the wind's from-bearing.
 * OFFSHORE is written along an arc outside the band, the right way up: on
 * the lower half of the dial the arc runs back, and a little further out, so
 * the letters stand on it.
 */
export function dialDrawing(
  windFrom: number,
  facing: number | null,
  r: number,
): DialDrawing {
  const inner = r + 0.9;
  const outer = r + LOUPE_BAND - 0.6;
  let offshore: DialDrawing["offshore"] = null;
  let crossOff: string[] = [];
  if (facing !== null) {
    const spans = offshoreSpans(facing);
    const o = spans.offshore;
    const lower = Math.cos((mid(o) * Math.PI) / 180) < 0;
    const words = { from: o.from - 10, to: o.to + 10 };
    offshore = {
      band: sectorPath(o, inner, outer),
      arc: arcPath(o, r + LOUPE_BAND + 2.2),
      text: lower
        ? arcPath(words, r + LOUPE_BAND + 14, true)
        : arcPath(words, r + LOUPE_BAND + 6),
    };
    crossOff = spans.crossOff.map((s) => sectorPath(s, inner, outer));
  }
  const [tx, ty] = polar(windFrom, r - NEEDLE);
  const [ax, ay] = polar(windFrom - 2.6, r + LOUPE_BAND + 5);
  const [bx, by] = polar(windFrom + 2.6, r + LOUPE_BAND + 5);
  const [mx, my] = polar(windFrom, r + LOUPE_BAND - 1);
  return {
    offshore,
    crossOff,
    needle: `M${f1(tx)} ${f1(ty)}L${f1(ax)} ${f1(ay)}L${f1(mx)} ${f1(my)}L${f1(bx)} ${f1(by)}Z`,
    pin: polar(windFrom, r + LOUPE_BAND / 2),
  };
}

/** What the loupe is given for the hour: the rose, the beach, and the reading for its foot. */
export interface LoupeRose {
  rose: Rose;
  facing: number | null;
  windKn: number;
  /** The needle's fill: the wind's colour at its speed, on PALETTE. */
  colour: string;
  /** "SW 16 g22", in the rider's units. */
  reading: string;
  /** "CROSS", or the units where there is no beach. */
  relation: string;
  /** The relation in the pen's red: cross-offshore or offshore. */
  warn: boolean;
}

/** The shore relation as the foot box writes it. */
export const RELATION: Record<NonNullable<Rose["shore"]>, string> = {
  onshore: "ON",
  "cross-on": "CROSS-ON",
  cross: "CROSS",
  "cross-off": "CROSS-OFF",
  offshore: "OFF",
};

/**
 * The foot box's size and place: wide enough for its words in the mono face,
 * on the bezel's foot, or pinned inside `view` (the map's clear area, in the
 * glass's own coordinates) when the foot is off it.
 */
export function footBox(
  reading: string,
  relation: string,
  r: number,
  view?: { left: number; right: number; bottom: number },
) {
  const w = Math.max(150, 30 + reading.length * 7.9 + relation.length * 7);
  let x = 0;
  let y = r + LOUPE_BAND / 2;
  if (view) {
    y = Math.min(y, view.bottom - 14);
    x = Math.min(Math.max(x, view.left + w / 2 + 6), view.right - w / 2 - 6);
  }
  return { x, y, w, h: 24 };
}

/**
 * The loupe's rose for the hour the dock shows, at the focus: a spot with its
 * beach, or a tapped point with none. Null with no wind or no direction.
 */
export function loupeRose(
  rider: Rider,
  hour: {
    windKn: number | null;
    gustKn: number | null;
    from: number | null;
    daylight: boolean;
  },
  facing: number | null,
  units: Units,
): LoupeRose | null {
  const rose = rideRose(rider, hour, facing);
  if (!rose || hour.windKn === null) return null;
  const speed = (kn: number) => Math.round(convert(kn / KNOTS, units));
  const gust =
    hour.gustKn !== null && hour.gustKn > hour.windKn
      ? ` g${speed(hour.gustKn)}`
      : "";
  return {
    rose,
    facing,
    windKn: hour.windKn,
    colour: `rgb(${windColor(hour.windKn).join(",")})`,
    reading: `${compass(rose.windFrom)} ${speed(hour.windKn)}${gust}`,
    relation: rose.shore
      ? RELATION[rose.shore]
      : unitLabel(units).toUpperCase(),
    warn: rose.shore === "cross-off" || rose.shore === "offshore",
  };
}
