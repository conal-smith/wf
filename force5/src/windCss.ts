/**
 * The wind's colour at a speed, as CSS: the PALETTE's (weather.ts), for a
 * page that paints a wind curve or a gradient (spot/web, src/finder) and may
 * not write a colour of its own (scripts/lint-ui.mjs).
 */
import { windColor } from "./weather";

export const windCss = (knots: number) => `rgb(${windColor(knots).join(",")})`;
