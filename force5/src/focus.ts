// The mark round the chosen spot: a loupe laid on the chart, a range ring, or
// nothing. Pure geometry, so the sizes can be tested without a map; WindMap.tsx
// draws them.

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

/**
 * The loupe's radius on screen. 200 px, 400 across, as the mock-up drew it on
 * a desktop's chart; on a smaller map four tenths of its shorter side, so a
 * phone keeps the coast either side of the glass, and never under 110 px. It
 * does not follow the zoom: closer in, the glass shows less ground, never less
 * of the screen.
 */
export function loupeRadius(width: number, visibleHeight: number): number {
  const short = Math.min(width, visibleHeight);
  return Math.round(Math.min(200, Math.max(110, 0.4 * short)));
}

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

/** The round distances a range ring is drawn at, in nautical miles. */
export const RANGE_STEPS_NM = [0.25, 0.5, 1, 2, 3, 5, 10, 20, 50, 100];
const NM = 1852;

/**
 * The range ring: the longest round distance that sits inside 42% of the
 * map's shorter side, and its radius on screen. Chosen again whenever the
 * camera rests, so it steps through the distances as the rider zooms; in
 * between it is a distance on the chart and moves with it.
 */
export function rangeRing(metresPerPx: number, short: number) {
  const max = 0.42 * short;
  const nm =
    [...RANGE_STEPS_NM].reverse().find((n) => (n * NM) / metresPerPx <= max) ??
    RANGE_STEPS_NM[0];
  return { nm, px: (nm * NM) / metresPerPx };
}

/** "2 NM": the ring's distance, as it is written beside it. */
export const rangeLabel = (nm: number) => `${nm} NM`;

/**
 * The light paper wash beyond the mark, as holes round the spot in pixels
 * and the opacity each layer of it is drawn at: stacked, the layers add up.
 * The loupe's is one flat 18%, its edge under the rim's paper band. The
 * ring's is barely there and only well beyond it, feathered out to 10% in
 * five steps too slight to see.
 */
export function washHoles(
  style: FocusStyle,
  px: number,
): { holes: number[]; opacity: number } {
  if (style === "loupe") return { holes: [px + LOUPE_BAND / 2], opacity: 0.18 };
  if (style === "ring") {
    const steps = 5;
    const start = px * 1.45;
    return {
      holes: Array.from(
        { length: steps },
        (_, i) => start + (i * 160) / (steps - 1),
      ),
      opacity: 1 - (1 - 0.1) ** (1 / steps),
    };
  }
  return { holes: [], opacity: 0 };
}
