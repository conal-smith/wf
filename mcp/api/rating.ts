/**
 * The stars, as the forecast server gives them: wingfoil.ie's own rating of an
 * hour (force5/src/stars.ts `rateHour`, the one rating of 25 October 2026), called on the same numbers
 * the spot page rates (spot/web/spot.ts `rateForecastHour`): the one model's
 * mean wind, gust and direction of the hour, sunrise to sunset, against the
 * spot's shore. Nothing here rates anything itself; it says who the stars are
 * for and puts the rating into words an agent can pass on.
 *
 * An hour's stars are a plain object with `stars`, `potential` and `reasons`,
 * the fields of force5's HourRating, so a step that lowers a rating (an
 * official warning, #173) can take it as it is; windows and sessions are read
 * from the ratings after any such step.
 */
import {
  ESTIMATE_WEIGHT_KG,
  noStarsWhy,
  rateHour,
  windBand,
  type HourRating,
  type Rider,
  type SessionKind,
} from "../../force5/src/stars.js";
import { arcText, goodWindArcs } from "../../force5/src/windArcs.js";
import type { HourWind } from "./forecast.js";

/**
 * Who an agent says the rider is; anything left out is the site's default.
 * Neither moves a star: everyone is rated on ours, and the weight and wings
 * only pick the wing shown beside the stars. The level and gust setting an
 * agent may still send from before 25 October 2026 (`level`, `gusty`) are
 * not read.
 */
export interface RiderChoice {
  /** Kilograms; left out, the site's estimate of 80 kg. */
  weight_kg?: number;
  /** Wing sizes they own, m²; left out, the rating recommends a size. */
  wings_m2?: readonly number[];
}

/** The rider as the stars read them: ours, with the weight and wings told. */
export function riderOf(choice: RiderChoice = {}): Rider {
  return {
    weightKg:
      choice.weight_kg === undefined ? null : Math.round(choice.weight_kg),
    wings: [...new Set(choice.wings_m2 ?? [])].sort((a, b) => a - b),
  };
}

/** Whose stars an hour is rated on, in the site's words. */
export const ratingName = (rider: Pick<Rider, "custom">) =>
  rider.custom ? "Your own stars" : "Ours";

export interface RiderUsed {
  /** Who the stars are for, as the site says it: "Ours · ~80 kg". */
  label: string;
  /** "ours" for wingfoil.ie's rating, "own" for a rider's own stars. */
  rating: "ours" | "own";
  weight_kg: number;
  /** The site's estimate, not a weight the rider gave. */
  weight_assumed: boolean;
  wings_m2: number[];
  /**
   * The four numbers the stars come from, knots: too light (one star),
   * the sweet spot's two ends (five stars) and too much, in gusts.
   */
  wind_band_kn: {
    min: number;
    sweet_low: number;
    sweet_high: number;
    max: number;
  };
  /** A gust over this leaves the hour no stars at all: too much, the top of the band. */
  gust_limit_kn: number;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

export function riderUsed(rider: Rider): RiderUsed {
  const band = windBand(rider);
  const weight = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  const assumed = rider.weightKg === null;
  return {
    label: `${ratingName(rider)} · ${assumed ? "~" : ""}${weight} kg`,
    rating: rider.custom ? "own" : "ours",
    weight_kg: weight,
    weight_assumed: assumed,
    wings_m2: [...rider.wings],
    wind_band_kn: {
      min: tenth(band.min),
      sweet_low: tenth(band.sweetLow),
      sweet_high: tenth(band.sweetHigh),
      max: tenth(band.max),
    },
    gust_limit_kn: tenth(band.max),
  };
}

/**
 * The hour rated as the spot page rates it: null in the dark (`daylight`
 * false: sunrise to sunset is rated, as on the site) or with no wind. A search
 * that asks for dark hours passes `daylight` true to rate them as if light.
 */
export function rateWind(
  wind: HourWind | null,
  daylight: boolean,
  facing: number | null,
  rider: Rider,
): HourRating | null {
  if (!wind) return null;
  return rateHour(
    {
      windKn: wind.wind_kn,
      gustKn: wind.gust_kn,
      from: wind.direction_deg,
      daylight,
    },
    { facing },
    rider,
  );
}

export interface HourStars {
  /** Whole stars, 0–5: what the site shows solid. */
  stars: number;
  /** The stars the wind alone is worth, 0–5: the site's faded stars. */
  potential: number;
  /** Where `stars` is 0, why, in the site's words; else null. */
  why_no_stars: string | null;
  /** Every star taken off, in the site's words, most important first. */
  reasons: string[];
  /** What kind of session the wind makes for this rider. */
  session: SessionKind;
  /** The wing size the rating recommends, m². */
  wing_m2: number;
  /** Which of the rider's own wings to take, where they gave their wings. */
  own_wing_m2?: number;
}

/** Why an hour has no stars, from its rating. */
function whyNone(rating: HourRating): string {
  return (
    noStarsWhy(rating) ??
    (rating.potential === 0
      ? "too light"
      : rating.reasons.join(" ") || "not enough wind for a star")
  );
}

export function hourStars(rating: HourRating): HourStars {
  return {
    stars: rating.stars,
    potential: rating.potential,
    why_no_stars: rating.stars === 0 ? whyNone(rating) : null,
    reasons: rating.reasons,
    session: rating.session,
    wing_m2: rating.wing.recommended,
    ...(rating.wing.own !== null && { own_wing_m2: rating.wing.own }),
  };
}

/** Why an hour the site does not rate has no stars. */
export const NOT_RATED = {
  dark: "not rated: wingfoil.ie rates the hours from sunrise to sunset",
  noWind: "not rated: no forecast of this hour's wind",
  warning: "not rated: a Met Éireann orange or red warning covers this hour",
  water: "not rated: a bathing water prohibition or advice against bathing covers this hour",
} as const;

/**
 * The winds the spot's shore wants, as the spot page's header gives them
 * ("best ENE–ESE, SSW–W"): cross-onshore and cross-shore, the angles that
 * cost no stars and bring a rider back. Null where the shore's facing is not
 * known.
 */
export function bestDirections(facing: number | null): string[] | null {
  return facing === null ? null : goodWindArcs(facing).map(arcText);
}
