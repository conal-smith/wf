/**
 * The glyph set: one 24-unit grid, one 1.5 stroke (1.6 at 18 pixels and
 * under), round ends, as the customise-wizard mockup's glyph sheet draws them
 * (wingfoil-mockups/customise-wizard, "The glyphs"). Each is drawn as a chart
 * draws a buoy: an ink outline, and a colour inside only where it means
 * something.
 *
 * The colour policy (docs/BRAND.md): colour for the weather's state (the sun's
 * yellow, rain's blue, a cloud's grey, the moon's pale fill), the wind-speed
 * scale, the chart's magenta for the best of something, and the warm red for a
 * warning. Everything else is ink on paper.
 *
 * Plain data and no React, so the site (shared/web/ChartGlyph.tsx, which the
 * map's src/chartGlyphs.tsx and the spot page both draw with) and the app
 * (mobile/src/components/Glyphs.tsx, `SetGlyph`) draw the same glyphs from
 * this one file. It lives in shared/web because the map and the spot page
 * may each import from there, and not from each other. A part names its
 * paint, and each renderer maps the paint to the theme's colour. Import a
 * glyph by name; one not imported is not in the bundle.
 *
 * The layers' glyphs and the site menu's rows are src/chartGlyphs.tsx's own
 * (drawn first, as JSX); the stars are ui/StarGlyphs.tsx's.
 */
import type { WeatherIcon } from "../../force5/src/surface";

/**
 * What a part is painted with. `ink` is the text's own colour (currentColor);
 * `paper` the ground; `wind` the colour the renderer is handed for a speed.
 */
export type GlyphPaint =
  | "ink"
  | "paper"
  | "sun"
  | "rain"
  | "cloud"
  | "night"
  | "gust"
  | "magenta"
  | "pen"
  | "depth"
  | "wind";

interface Paint {
  /** No fill unless named. */
  fill?: GlyphPaint;
  /** Ink unless named; "none" for a filled shape with no outline. */
  stroke?: GlyphPaint | "none";
  /** The glyph's own stroke unless named, in grid units. */
  width?: number;
  dash?: string;
  opacity?: number;
}
export interface GlyphPath extends Paint {
  d: string;
}
export interface GlyphCircle extends Paint {
  cx: number;
  cy: number;
  r: number;
}
export interface GlyphText {
  text: string;
  x: number;
  y: number;
  size: number;
  /** mono for a letter or a rate; body (the chart's italic) for a sounding. */
  face: "mono" | "body";
  weight?: number;
  italic?: boolean;
  middle?: boolean;
  fill?: GlyphPaint;
}
export type GlyphPart = GlyphPath | GlyphCircle | GlyphText;
export type GlyphDef = readonly GlyphPart[];

/** The stroke a glyph is drawn at, by the size it is drawn at. */
export const glyphStroke = (size: number) => (size <= 18 ? 1.6 : 1.5);

/* ---- drawing helpers ---- */

const n = (v: number) => String(Math.round(v * 100) / 100);

/**
 * A path scaled by `s` and moved by (tx, ty), its numbers rewritten rather
 * than a transform laid over it, so its stroke stays the glyph's. Takes the
 * commands the set uses: M L C S Q T H V A Z, either case.
 */
function placed(d: string, tx: number, ty: number, s: number): string {
  let out = "";
  for (const [, cmd, args] of d.matchAll(/([MLCSQTHVAZ])([^MLCSQTHVAZ]*)/gi)) {
    const v = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const x = (k: number) => (rel ? k * s : tx + k * s);
    const y = (k: number) => (rel ? k * s : ty + k * s);
    const up = cmd.toUpperCase();
    const mapped = v.map((k, i) => {
      if (up === "H") return x(k);
      if (up === "V") return y(k);
      if (up === "A") {
        const at = i % 7;
        if (at < 2) return k * s;
        if (at < 5) return k;
        return at === 5 ? x(k) : y(k);
      }
      return i % 2 ? y(k) : x(k);
    });
    out += cmd + mapped.map(n).join(" ");
  }
  return out;
}

/** Rays round a centre, from r0 to r1, at each angle in degrees. */
function rays(cx: number, cy: number, r0: number, r1: number, at: number[]) {
  return at
    .map((a) => {
      const t = (a * Math.PI) / 180;
      return `M${(cx + r0 * Math.cos(t)).toFixed(2)} ${(cy + r0 * Math.sin(t)).toFixed(2)}L${(cx + r1 * Math.cos(t)).toFixed(2)} ${(cy + r1 * Math.sin(t)).toFixed(2)}`;
    })
    .join("");
}
const ALL8 = [0, 45, 90, 135, 180, 225, 270, 315];

const CLOUD =
  "M6.5 17.5 C3.6 17.5 2.9 13.7 5.5 12.7 C5.1 9.4 8.7 7.6 11.1 9.3 C12.3 6.3 16.8 6.5 17.3 10.1 C20.2 10.3 21.3 13.3 20 15.3 C19.3 16.8 18.2 17.5 17 17.5 Z";
const cloud = (tx: number, ty: number, s = 1): GlyphPath => ({
  d: placed(CLOUD, tx, ty, s),
  fill: "cloud",
});
const MOON = "M13 3.2a7.2 7.2 0 0 0 7.8 10.5A8.8 8.8 0 1 1 13 3.2Z";
/** The chart's star (ui/StarGlyphs.tsx), on a 10-unit grid about 0,0. */
const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";
const dot = (cx: number, cy: number, r: number): GlyphCircle => ({
  cx,
  cy,
  r,
  fill: "ink",
  stroke: "none",
});
const rainDot = (cx: number, cy: number): GlyphCircle => ({
  cx,
  cy,
  r: 1.05,
  fill: "rain",
  stroke: "none",
});
const RAIN = { stroke: "rain", width: 1.8 } as const;

/* ---- the weather: the one place for colour ---- */

export const sun: GlyphDef = /* @__PURE__ */ (() => [
  { cx: 12, cy: 12, r: 4.4, fill: "sun" },
  { d: rays(12, 12, 6.9, 9.4, ALL8) },
])();
export const partly: GlyphDef = /* @__PURE__ */ (() => [
  { cx: 8.6, cy: 8.4, r: 3.3, fill: "sun" },
  { d: rays(8.6, 8.4, 5, 6.7, [180, 225, 270, 315, 135]) },
  cloud(6, 6, 0.78),
])();
export const cloudy: GlyphDef = /* @__PURE__ */ (() => [
  cloud(-1.5, 2.6, 1.08),
])();
export const fog: GlyphDef = /* @__PURE__ */ (() => [
  cloud(0, -3),
  { d: "M4 17.8h16M7 21h10" },
])();
export const drizzle: GlyphDef = /* @__PURE__ */ (() => [
  cloud(0, -4),
  rainDot(8, 17),
  rainDot(12.2, 18.6),
  rainDot(16.4, 17),
  rainDot(10.1, 21.4),
  rainDot(14.3, 21.4),
])();
export const rain: GlyphDef = /* @__PURE__ */ (() => [
  cloud(0, -4),
  { d: "M8.5 16.3l-1.6 4.4M12.6 16.3l-1.6 5M16.7 16.3l-1.6 4.4", ...RAIN },
])();
export const showers: GlyphDef = /* @__PURE__ */ (() => [
  { cx: 7.2, cy: 7, r: 2.8, fill: "sun" },
  { d: rays(7.2, 7, 4.4, 5.9, [180, 225, 270, 315]) },
  cloud(4.4, 1.6, 0.8),
  { d: "M11 17.8l-1.3 3.6M15.2 17.8l-1.3 3.6", ...RAIN },
])();
export const thunder: GlyphDef = /* @__PURE__ */ (() => [
  cloud(0, -4),
  { d: "M12.6 13.2 9.4 18.4h2.8l-1.4 4 5-6.1h-2.8l1.5-3.1Z", fill: "sun" },
])();
export const snow: GlyphDef = /* @__PURE__ */ (() => [
  cloud(0, -4),
  {
    d: "M8 17.2v2.8M6.8 17.9l2.4 1.4M9.2 17.9l-2.4 1.4M16 17.2v2.8M14.8 17.9l2.4 1.4M17.2 17.9l-2.4 1.4M12 19.6v2.8M10.8 20.3l2.4 1.4M13.2 20.3l-2.4 1.4",
  },
])();
export const night: GlyphDef = [
  { d: MOON, fill: "night" },
  { d: "M18.2 3.4v2.4M17 4.6h2.4", width: 1.2 },
];
export const nightCloud: GlyphDef = /* @__PURE__ */ (() => [
  { d: placed(MOON, 5.5, -1, 0.72), fill: "night" },
  cloud(-1, 4, 0.86),
])();

const SKY: Record<WeatherIcon, GlyphDef> = {
  clear: sun,
  partly,
  cloudy,
  fog,
  drizzle,
  rain,
  showers,
  thunder,
  snow,
};
/**
 * The sky for a present-weather group, and at night the moon for a clear or a
 * part-cloudy one: the sun is not out in the dark hours.
 */
export const skyGlyph = (icon: WeatherIcon, dark = false): GlyphDef =>
  dark && icon === "clear"
    ? night
    : dark && icon === "partly"
      ? nightCloud
      : SKY[icon];

/* ---- the wind and the blend: the wind's colour on the arrow alone ---- */

/** An arrow, the way the wind goes. */
export const arrow: GlyphDef = [{ d: "M12 20.5V4M7.4 8.6 12 4l4.6 4.6" }];
/** The arrow filled with the wind's colour for a speed (`wind` paint). */
export const speedArrow: GlyphDef = [
  { d: "M12 3.2 17.8 10h-3.6v10.6H9.8V10H6.2Z", fill: "wind" },
];
export const wind: GlyphDef = [
  {
    d: "M3 8.5h9.5a2.5 2.5 0 1 0-2.4-3.2M3 12.5h14.5a2.8 2.8 0 1 1-2.6 3.8M3 16.5h7",
  },
];
export const gust: GlyphDef = [
  { d: "M3 8h9M3 12h12M3 16h7" },
  {
    d: "M16.5 6.5l3.5-1.8M17.5 11.5l3.8-.3M15.5 16.2l3.3 1.8",
    stroke: "gust",
    width: 1.8,
  },
];
export const calm: GlyphDef = [
  { cx: 12, cy: 12, r: 7.5 },
  { cx: 12, cy: 12, r: 3 },
];
/** Where the wind goes, in its ring: a row's direction. */
export const direction: GlyphDef = [
  { cx: 12, cy: 12, r: 8.6 },
  { d: "M8.6 15.4 15.4 8.6M11 8.4h4.6V13" },
];
/** The blend: strands merging into one. */
export const blend: GlyphDef = [
  {
    d: "M3 5.5C8.5 5.5 9.5 12 14.6 12M3 12h11.6M3 18.5C8.5 18.5 9.5 12 14.6 12",
  },
  { d: "M14.6 12H21.2", width: 2.6 },
  dot(14.6, 12, 1.5),
];
export const model: GlyphDef = [
  { d: "M3.5 3.5h17v17h-17Z" },
  {
    d: "M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17",
    width: 0.8,
    opacity: 0.55,
  },
  { d: "M3.5 16.5C8 16.5 11 8 20.5 7.5", width: 2 },
];
export const ensemble: GlyphDef = [
  {
    d: "M3 12C9 12 12 4.5 21 4M3 12C9 12 13 8.5 21 8.6M3 12h18M3 12C9 12 13 15.5 21 15.4M3 12C9 12 12 19.5 21 20",
    width: 1.2,
  },
  dot(3, 12, 1.4),
];
/** Which model the stars come from. */
export const starsFrom: GlyphDef = /* @__PURE__ */ (() => [
  { d: "M3 17C8 17 10 9 16 8.5", width: 2 },
  { d: placed(STAR, 18.6, 7.6, 0.62), fill: "ink", stroke: "none" },
  { d: "M3 20.5h18", width: 1, opacity: 0.5 },
])();

/* ---- the sea and the sky ---- */

export const waves: GlyphDef = [
  {
    d: "M2 9.5c1.7-2.4 3.3-2.4 5 0s3.3 2.4 5 0 3.3-2.4 5 0 3.3 2.4 5 0M2 15c1.7-2.4 3.3-2.4 5 0s3.3 2.4 5 0 3.3-2.4 5 0 3.3 2.4 5 0M5 20h14",
  },
];
export const tide: GlyphDef = [
  { d: "M2.5 13C5 5.5 8 5.5 12 13s7 7.5 9.5 0" },
  dot(12, 13, 1.6),
  { d: "M2.5 21h19", width: 1, opacity: 0.5 },
];
export const tideRising: GlyphDef = [
  { d: "M3 18c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" },
  { d: "M12 14V4M8.4 7.6 12 4l3.6 3.6" },
];
export const tideFalling: GlyphDef = [
  { d: "M3 18c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" },
  { d: "M12 4v10M8.4 10.4 12 14l3.6-3.6" },
];
/** The air's temperature: a thermometer, its bulb full. */
/**
 * The dock's Current row: the Layers panel's Currents glyph
 * (src/chartGlyphs.tsx, `CurrentsGlyph`), the stream's arrow feathered as a
 * chart sets the flood, without its rate: the row's figures are the rate.
 */
export const current: GlyphDef = [
  { d: "M3 17 17 7M12.6 6.8H17v4.4" },
  { d: "M3 17l-.4-3.6M5.6 15.1l-.4-3.6M8.2 13.3l-.4-3.6", width: 1.2 },
];
export const air: GlyphDef = [
  { d: "M14 14.6V4.8a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z" },
  dot(12, 17.6, 1.9),
  { d: "M12 9v7" },
];
/** The sea's temperature: a thermometer standing in a wave. */
export const seaTemp: GlyphDef = [
  { d: "M12 3a2 2 0 0 0-2 2v7.3a3.5 3.5 0 1 0 4 0V5a2 2 0 0 0-2-2Z" },
  { d: "M2 21c2-1.3 3.3-1.3 5 0s3 1.3 5 0 3.3-1.3 5 0 3 1.3 5 0" },
];
/** Rain, in millimetres: a drop, filled with rain's blue. */
export const drop: GlyphDef = [
  {
    d: "M12 3.2S6.5 10 6.5 14.2a5.5 5.5 0 0 0 11 0C17.5 10 12 3.2 12 3.2Z",
    fill: "rain",
  },
];
/** A wing: the leading edge's arc and the strut across it. */
export const wing: GlyphDef = [
  { d: "M3 17C6 8 13 4 21 5C17 9 12 14 3 17Z" },
  { d: "M7 14L17 7" },
];
/** A distance: a scale rule. */
export const ruler: GlyphDef = [
  { d: "M3 15.5 15.5 3 21 8.5 8.5 21Z" },
  { d: "M7 11.5l2 2M9.5 9l1.5 1.5M12 6.5l2 2M14.5 4l1.5 1.5", width: 1.2 },
];

/* ---- from the chart: INT 1, the Admiralty's book of symbols ---- */

/** A flood stream: feathered, as a chart sets it. */
export const flood: GlyphDef = [
  { d: "M4 20 19 5M12.6 5.3 19 5l-.3 6.4" },
  { d: "M6.4 17.6 2.6 16.5M8.8 15.2 5 14.1M11.2 12.8 7.4 11.7", width: 1.3 },
];
/** An ebb stream: plain. */
export const ebb: GlyphDef = [{ d: "M4 20 19 5M12.6 5.3 19 5l-.3 6.4" }];
/** A tidal diamond: a station, lettered. */
export const diamond: GlyphDef = [
  { d: "M12 3.2 18.6 12 12 20.8 5.4 12Z" },
  {
    text: "A",
    x: 12,
    y: 14.8,
    size: 8,
    face: "mono",
    weight: 600,
    middle: true,
  },
];
/** A drying height, underlined. */
export const drying: GlyphDef = [
  {
    text: "2",
    x: 5,
    y: 15.5,
    size: 12,
    face: "body",
    weight: 600,
    italic: true,
  },
  {
    text: "5",
    x: 12.6,
    y: 18.4,
    size: 8,
    face: "body",
    weight: 600,
    italic: true,
  },
  { d: "M4.5 20h13" },
];
/** A dotted contour and its italic soundings, in the depth's ink. */
export const sounding: GlyphDef = [
  {
    d: "M2.5 9.5C7.5 6 12 12.5 21.5 8",
    stroke: "depth",
    dash: ".1 2.8",
    width: 1.8,
  },
  {
    text: "12",
    x: 6,
    y: 19.5,
    size: 10,
    face: "body",
    weight: 500,
    italic: true,
    fill: "depth",
  },
  {
    text: "4",
    x: 17.2,
    y: 20.8,
    size: 7,
    face: "body",
    weight: 500,
    italic: true,
    fill: "depth",
  },
];
/** A light's flare, in magenta: the best of something. */
export const flare: GlyphDef = [
  {
    d: "M9.2 15.8C11.2 11.6 14.6 7.6 18.4 5.6c.6 3.4-3.6 8-9.2 10.2Z",
    fill: "magenta",
    stroke: "magenta",
    width: 1,
  },
  dot(8, 17.6, 2),
  { d: "M4 21h8", width: 1.2 },
];
export const rose: GlyphDef = /* @__PURE__ */ (() => [
  { cx: 12, cy: 12, r: 9.6 },
  { cx: 12, cy: 12, r: 6.6, width: 0.8 },
  {
    d: rays(
      12,
      12,
      6.6,
      8,
      [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
    ),
    width: 0.9,
  },
  { d: "M12 1.2 13.4 10.6 12 12 10.6 10.6Z", fill: "ink", stroke: "none" },
  { d: "M12 22.8 10.6 13.4 12 12 13.4 13.4Z", width: 0.8 },
])();
/** A rock awash: a danger. */
export const rockAwash: GlyphDef = [
  { d: "M12 5.5v13M5.5 12h13" },
  dot(8.2, 8.2, 1.05),
  dot(15.8, 8.2, 1.05),
  dot(8.2, 15.8, 1.05),
  dot(15.8, 15.8, 1.05),
];
/** A buoy, its colour inside: how the set draws colour. */
export const buoy: GlyphDef = [
  { d: "M12 4.5 17 17H7Z", fill: "sun" },
  { d: "M4 19.5c2.6-1.6 5.3-1.6 8 0s5.4 1.6 8 0" },
  { d: "M12 2v2.5", width: 1.2 },
];

/* ---- the app: ink only ---- */

export const menu: GlyphDef = [{ d: "M4 7h16M4 12h16M4 17h16" }];
export const customise: GlyphDef = [
  { d: "M4 7h16M4 12h16M4 17h16" },
  { cx: 8.5, cy: 7, r: 2.3, fill: "paper" },
  { cx: 15.5, cy: 12, r: 2.3, fill: "paper" },
  { cx: 10, cy: 17, r: 2.3, fill: "paper" },
];
export const tour: GlyphDef = [
  { d: "M5 19.5C9 19.5 8.5 14 12 14s3.5-5 6.2-5", dash: "1.2 2.6" },
  dot(5, 19.5, 1.7),
  { d: "M18.2 11V3.2" },
  { d: "M18.2 3.4l4 1.8-4 1.8Z", fill: "ink", stroke: "none" },
];
export const search: GlyphDef = [
  { cx: 10.5, cy: 10.5, r: 6 },
  { d: "M15 15l5.5 5.5" },
];
export const close: GlyphDef = [{ d: "M6 6l12 12M18 6 6 18" }];
/** The spot finder: a loupe over a star, the places rated for the rider. */
export const spotFinder: GlyphDef = [
  { cx: 10.5, cy: 10.5, r: 7 },
  { d: "M15.6 15.6l5.4 5.4", width: 2.2 },
  {
    d: "M10.5 6.6l1.15 2.45 2.65.25-2 1.75.6 2.6-2.4-1.4-2.35 1.4.55-2.6-2-1.75 2.65-.25Z",
    width: 1.1,
  },
];
/** A spot's own page. */
export const page: GlyphDef = [
  { d: "M6 3h8.5L18.5 7v14H6Z" },
  { d: "M14.5 3v4h4M9 11.5h6.5M9 14.5h6.5M9 17.5h4" },
];
export const fold: GlyphDef = [{ d: "M6 9l6 6 6-6" }];
export const market: GlyphDef = [
  { d: "M3.5 12.2V4h8.2l9 9-8.2 8.2Z" },
  { cx: 7.8, cy: 8.2, r: 1.4 },
];
export const community: GlyphDef = [
  { d: "M3.5 5h11v8h-6L5 16v-3H3.5Z" },
  { d: "M17 9h3.5v8H19v3l-3.5-3h-5v-2" },
];
export const ai: GlyphDef = [
  { d: "M12 3c.8 5 3 7.5 8 9-5 1.5-7.2 4-8 9-.8-5-3-7.5-8-9 5-1.5 7.2-4 8-9Z" },
];
/** The wind map: a chart, folded in three. */
export const chartMap: GlyphDef = [
  { d: "M3 6l6-2.5 6 2.5 6-2.5V18l-6 2.5L9 18l-6 2.5Z" },
  { d: "M9 3.5V18M15 6v14.5" },
];
/**
 * The wind map, as the site menu names it: a chart folded in three, a coast
 * coming in on its right-hand panel and a streak of wind across the others.
 */
export const windMap: GlyphDef = [
  { d: "M3 6.5l5.5-2 7 2 5.5-2v13l-5.5 2-7-2-5.5 2Z" },
  { d: "M8.5 4.5v13M15.5 6.5v13", width: 1, opacity: 0.55 },
  {
    d: "M21 10c-1.5.2-2.2 1.4-3.4 1.6-1.3.2-1.6 1.8-2.6 2.5-1 .7-1.2 2.4-1.4 4.8",
    width: 1.2,
  },
  { d: "M5 12.5c2.2-.9 4-3 7-3.8", width: 1.3 },
];
/** Use with AI: a speech bubble with a four-pointed spark in it. */
export const useWithAi: GlyphDef = [
  { d: "M4 5.5h16V16H10l-4.5 3.5V16H4Z" },
  {
    d: "M12 7.6l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z",
    fill: "ink",
    width: 0.8,
  },
];
/** A warning: drawn in ink; set it in the warm red where it warns. */
export const warn: GlyphDef = [
  { d: "M12 3.5 21.5 20H2.5Z" },
  { d: "M12 9.5v5" },
  dot(12, 17.2, 0.95),
];
export const lock: GlyphDef = [
  { d: "M5.5 10.5h13v10h-13Z" },
  { d: "M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" },
];
export const compass: GlyphDef = [
  { cx: 12, cy: 12, r: 9 },
  { d: "M12 4.2 14 12H10Z", fill: "ink", stroke: "none" },
  { d: "M12 19.8 14 12H10Z" },
];
export const home: GlyphDef = [
  { d: "M4 11 12 4l8 7v9.5H4Z" },
  { d: "M10 20.5v-5.5h4v5.5" },
];
/** A rider's level. */
export const level: GlyphDef = [
  { cx: 12, cy: 6, r: 2.3 },
  { d: "M6 21l3-6.5 3 2 4-7M5 12.5l4.5-2.5 3.5 1.5" },
];
export const external: GlyphDef = [{ d: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" }];
