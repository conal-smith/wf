// The risk of thunder and lightning in an hour, from what a weather model
// already publishes for it: its present-weather code (`ww`, WMO 4677) and its
// CAPE, the energy a rising parcel of air can draw on (J/kg). A rider on open
// water under a wing and a carbon mast is the tallest thing for a long way, so
// this is a safety flag, worded as one, never a forecast that it will be dry.
//
//   high      the model's code is a thunderstorm: lightning, thunderstorm now
//             or in the past hour (13, 17, 29, 91–99), the codes the sky glyph
//             draws as thunder (./presentWeather)
//   possible  CAPE of THUNDER_CAPE_WET or more with precipitation in the code
//             (50–99: showers or rain are forming, and there is energy to
//             grow them into storms), or THUNDER_CAPE_DRY or more whatever
//             the code
//   low       neither
//   null      the model publishes neither a code nor a CAPE for the hour
//
// ICON-EU's code is DWD's own, which forecasts thunderstorms. GFS's code is
// built from its precipitation type and never says thunder, so past ICON-EU's
// run only CAPE speaks. ICON-EU's CAPE is a mean-layer parcel's, GFS's a
// surface parcel's, which runs higher. Dependency-free apart from the code
// table.
import { presentWeather } from "./presentWeather.js";

export type ThunderRisk = "high" | "possible" | "low";

/** CAPE, J/kg, at which precipitation in the code makes thunder possible. */
export const THUNDER_CAPE_WET = 300;
/** CAPE, J/kg, at which thunder is possible whatever the code says. */
export const THUNDER_CAPE_DRY = 1000;

export interface Thunder {
  risk: ThunderRisk;
  /** Why, in a few words, where the risk is not low. */
  why: string | null;
}

/** The hour's thunder risk, or null where the model says nothing it could rest on. */
export function thunderRisk(
  code: number | null | undefined,
  capeJKg: number | null | undefined,
): Thunder | null {
  const ww = typeof code === "number" && Number.isFinite(code) ? code : null;
  const cape =
    typeof capeJKg === "number" && Number.isFinite(capeJKg) ? capeJKg : null;
  if (ww === null && cape === null) return null;
  const present = presentWeather(ww);
  if (present?.icon === "thunder")
    return {
      risk: "high",
      why: `the model forecasts thunder: ${present.description.toLowerCase()} (code ${ww})`,
    };
  const wet = ww !== null && ww >= 50;
  if (cape !== null && wet && cape >= THUNDER_CAPE_WET)
    return {
      risk: "possible",
      why: `CAPE ${Math.round(cape)} J/kg with ${present ? present.description.toLowerCase() : "precipitation"} forecast`,
    };
  if (cape !== null && cape >= THUNDER_CAPE_DRY)
    return {
      risk: "possible",
      why: `CAPE ${Math.round(cape)} J/kg: energy for storms if showers form`,
    };
  return { risk: "low", why: null };
}
