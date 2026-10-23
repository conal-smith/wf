/**
 * The app's design tokens: the site's (ui/theme.css, via css.generated.ts)
 * under the names the app's components use. docs/BRAND.md is the brief: an
 * Admiralty chart crossed with a broadsheet weather report. Paper and ink;
 * chart magenta marks the best of something; the pen marks one thing a view;
 * boxes are square, pressed things are capsules; very little text.
 *
 * No React or React Native here, so the logic tests can import it.
 */
import { css, type CssToken } from "./css.generated";

const c = (name: CssToken) => css[name];

export const colors = {
  paper: c("color-ground"),
  sunken: c("color-sunken"),
  inverse: c("color-inverse"),
  // The site's scrim blurs the page under a wash of paper. The app blurs
  // nothing, so it takes the wash the site falls back to where nothing blurs.
  scrim: c("color-scrim-solid"),
  ink: c("color-ink"),
  ink2: c("color-ink-2"),
  muted: c("color-ink-muted"),
  disabled: c("color-ink-disabled"),
  inkInverse: c("color-ink-inverse"),
  line: c("color-line"),
  lineStrong: c("color-line-strong"),
  magenta: c("color-chart-magenta"),
  pen: c("color-pen"),
  penInk: c("color-pen-ink"),
  buoy: c("color-buoy"),
  ok: c("color-ok"),
  warn: c("color-warn"),
  warnGround: c("color-warn-ground"),
  now: c("color-now"),
  gust: c("color-gust"),
  sea: c("color-sea"),
  depth: c("color-depth"),
  land: c("color-land"),
  relief: c("color-relief"),
  basemapWater: c("color-basemap-water"),
} as const;

export type ColorName = keyof typeof colors;

/** The wind scale, knots → ink, for wind speed and nothing else. */
export const windScale: readonly [number, string][] = [
  [0, c("color-wind-k00")],
  [5, c("color-wind-k05")],
  [9, c("color-wind-k09")],
  [10, c("color-wind-k10")],
  [15, c("color-wind-k15")],
  [20, c("color-wind-k20")],
  [25, c("color-wind-k25")],
  [30, c("color-wind-k30")],
  [35, c("color-wind-k35")],
  [40, c("color-wind-k40")],
  [45, c("color-wind-k45")],
  [50, c("color-wind-k50")],
  [60, c("color-wind-k60")],
  [65, c("color-wind-k65")],
];

/** A 4-point grid, as the site's --spacing. */
export const space = {
  "2xs": 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 44,
} as const;

/** Boxes are square; a field has 2; a pressed thing is a capsule. */
export const radius = { box: 0, control: 2, pill: 999 } as const;

/** Apple's and Material's floor, and the site's --spacing-touch. */
export const hitTarget = 44;
export const controlHeight = { sm: 30, md: 40, lg: 46 } as const;

/**
 * Font families as embedded by expo-font (app.config.ts). iOS finds a font by
 * its PostScript name, Android by its file name; babel-preset-expo inlines
 * EXPO_OS for each platform's bundle (and it is unset in the Node tests).
 */
const ios = process.env.EXPO_OS === "ios";
const face = (postScript: string, file: string) => (ios ? postScript : file);

export const fonts = {
  display: face("Fraunces-Regular", "Fraunces_400Regular"),
  displayItalic: face("Fraunces-Italic", "Fraunces_400Regular_Italic"),
  displayBold: face("Fraunces-SemiBold", "Fraunces_600SemiBold"),
  body: face("Newsreader-Regular", "Newsreader_400Regular"),
  bodyItalic: face("Newsreader-Italic", "Newsreader_400Regular_Italic"),
  mono: face("IBMPlexMono-Regular", "IBMPlexMono_400Regular"),
  monoMedium: face("IBMPlexMono-Medium", "IBMPlexMono_500Medium"),
  monoBold: face("IBMPlexMono-SemiBold", "IBMPlexMono_600SemiBold"),
  hand: face("Kalam-Regular", "Kalam_400Regular"),
} as const;

/**
 * The site's type scale (ui/theme.css --text-*), as React Native styles.
 * Letter spacing is in points: em × size.
 */
export const type = {
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 13, letterSpacing: 1.4 },
  label: { fontFamily: fonts.monoMedium, fontSize: 11, lineHeight: 14, letterSpacing: 1 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  figureSm: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 17 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  prose: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25 },
  figure: { fontFamily: fonts.monoBold, fontSize: 19, lineHeight: 21, letterSpacing: -0.4 },
  lead: { fontFamily: fonts.displayBold, fontSize: 19, lineHeight: 23 },
  title: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, letterSpacing: -0.6 },
  headline: { fontFamily: fonts.displayBold, fontSize: 44, lineHeight: 44, letterSpacing: -1.5 },
  spot: { fontFamily: fonts.displayItalic, fontSize: 17, lineHeight: 21 },
  pen: { fontFamily: fonts.hand, fontSize: 16, lineHeight: 20 },
} as const;

export type TypeName = keyof typeof type;

export const motion = { fast: 150, base: 250 } as const;

/** Small, warm shadows (ui/theme.css --shadow-*), as React Native boxShadow. */
export const shadow = {
  control: "0px 1px 0px #1a1d210f",
  marker: "0px 4px 10px -6px #3c2d1466",
  surface: "0px 1px 0px #0000000a, 0px 6px 18px -10px #3c2d1459",
  dock: "0px -8px 22px -16px #3c2d1473",
} as const;

/** `#rrggbb` at an alpha, for the few places a tint is drawn over the chart. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

/** The CSS custom properties, for the site modules that read them by name. */
export const cssVariables = {
  getPropertyValue: (name: string) =>
    (css as Record<string, string>)[name.replace(/^--/, "")] ?? "",
};
