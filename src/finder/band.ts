/**
 * The wind band a card draws behind today's hours and under each of the next
 * days: the mean wind as an area, its height and its colour the wind's, in
 * the chart's own colours for knots (force5/src/weather.ts `windCss`), hour
 * by hour along a gradient; the gusts a paler layer from the mean up to the
 * gust, coloured by the gust's speed. Pure geometry: the card gives the
 * points where they stand across, and gets back the paths and the stops.
 */
import { windCss } from "../../force5/src/weather";

/** Where the band is held to: knots past this fill it. */
export const BAND_TOP_KN = 45;

/** One reading along the band: where it stands across, and its wind. */
export interface BandPoint {
  x: number;
  /** Mean wind, knots. */
  mean: number;
  /** Gust, knots; null where the model gives none (no gust layer there). */
  gust: number | null;
}

export interface Band {
  /** Where it runs across, which its gradient spans. */
  x0: number;
  x1: number;
  /** The mean's area, from the base up to the mean line. */
  area: string;
  /** The gusts' layer, from the mean up to the gust; null with no gusts. */
  gusts: string | null;
  /** The mean's line, along the top of its area. */
  line: string;
  /** The gusts' line, along the top of their layer. */
  gustLine: string | null;
  /** The gradient's stops, from x0 to x1: the mean's colour and the gust's. */
  stops: { offset: number; mean: string; gust: string }[];
}

const f = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * The band across [x0, x1], between `top` (BAND_TOP_KN) and `base` (calm).
 * The first and last readings are held out to either edge, so the band fills
 * its room. Null with no readings.
 */
export function windBand(
  points: readonly BandPoint[],
  { x0, x1, top, base }: { x0: number; x1: number; top: number; base: number },
): Band | null {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.mean))
    .sort((a, b) => a.x - b.x);
  if (!sorted.length || !(x1 > x0)) return null;
  const y = (kn: number) => bandY(kn, top, base);
  const held = [
    { ...sorted[0], x: Math.min(x0, sorted[0].x) },
    ...sorted,
    { ...sorted[sorted.length - 1], x: Math.max(x1, sorted.at(-1)!.x) },
  ];
  const run = (value: (p: BandPoint) => number) =>
    held.map((p) => `${f(p.x)} ${f(y(value(p)))}`);
  const mean = run((p) => p.mean);
  const hasGust = sorted.some((p) => p.gust !== null && p.gust > p.mean);
  const gust = run((p) => Math.max(p.mean, p.gust ?? p.mean));
  const left = f(held[0].x);
  const right = f(held.at(-1)!.x);
  return {
    x0,
    x1,
    area: `M${left} ${f(base)}L${mean.join("L")}L${right} ${f(base)}Z`,
    gusts: hasGust
      ? `M${gust.join("L")}L${[...mean].reverse().join("L")}Z`
      : null,
    line: `M${mean.join("L")}`,
    gustLine: hasGust ? `M${gust.join("L")}` : null,
    stops: sorted.map((p) => ({
      offset: Math.max(0, Math.min(1, (p.x - x0) / (x1 - x0))),
      mean: windCss(p.mean),
      gust: windCss(Math.max(p.mean, p.gust ?? p.mean)),
    })),
  };
}

/** Where a reading's mean stands up the band, for a label over it. */
export const bandY = (kn: number, top: number, base: number) =>
  base - (Math.max(0, Math.min(kn, BAND_TOP_KN)) / BAND_TOP_KN) * (base - top);
