/**
 * The wind's colours, alone: the map's ramp from calm to storm, and a speed's
 * place on it. No import, so whatever paints the wind can have it without the
 * rest of the map (force5/src/weather.ts gives it the map's way; the AI apps'
 * spot card, mcp/app/spotCard.ts, bundles it on its own).
 */
export type Rgb = [number, number, number];

/**
 * The wind scale, in knots: the same for every rider, as the common wind
 * forecast sites draw theirs. Pale blue in a calm, deepening toward 10 kn; greens
 * from 10 to 20; yellow by the high 20s; orange to red from 30 to 40; red to
 * purple by 50; dark purple to nearly black past 60. Speed bands, not safety
 * or ability ratings: the stars are the rider's, the colours are not.
 */
export const PALETTE: [number, Rgb][] = [
  [0, [170, 203, 234]],
  [5, [128, 174, 224]],
  [9, [79, 128, 200]],
  [10, [73, 168, 138]],
  [15, [76, 179, 90]],
  [20, [111, 191, 62]],
  [25, [181, 207, 58]],
  [30, [236, 210, 58]],
  [35, [242, 160, 58]],
  [40, [224, 90, 51]],
  [45, [200, 48, 74]],
  [50, [155, 47, 134]],
  [60, [90, 35, 104]],
  [65, [35, 22, 40]],
];
/** The colour at a speed on PALETTE, between its stops, held at either end. */
export function windColor(knots: number): Rgb {
  const k = Math.max(0, Math.min(65, knots));
  let i = 1;
  while (i < PALETTE.length - 1 && k > PALETTE[i][0]) i++;
  const [a, ca] = PALETTE[i - 1],
    [b, cb] = PALETTE[i];
  return ca.map((v, c) =>
    Math.round(v + ((cb[c] - v) * (k - a)) / (b - a)),
  ) as Rgb;
}

/** `windColor` as CSS writes it, for a fill or a background. */
export const windCss = (knots: number) => `rgb(${windColor(knots).join(" ")})`;
