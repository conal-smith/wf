/**
 * The stars, as the forecast server gives them: wingfoil.ie's own rating of an
 * hour (force5/src/stars.ts `rateHour`, stars v6), called on the same numbers
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
  DEFAULT_RIDER,
  ESTIMATE_WEIGHT_KG,
  SKILL_LABEL,
  gustiness,
  noStarsWhy,
  rateHour,
  windBand,
  type Gustiness,
  type Gusty,
  type HourRating,
  type Rider,
  type SessionKind,
  type Skill,
} from "../../force5/src/stars.js";
import { arcText, goodWindArcs } from "../../force5/src/windArcs.js";
import type { HourWind } from "./forecast.js";

/** Who an agent says the rider is; anything left out is the site's default. */
export interface RiderChoice {
  /** beginner ("Learning"), intermediate ("Riding", the default) or advanced. */
  level?: Skill;
  /** Kilograms; left out, the site's estimate of 80 kg. */
  weight_kg?: number;
  /** How much gusty wind bothers them: little, some (the default) or lots. */
  gusty?: Gusty;
  /** Wing sizes they own, m²; left out, the rating recommends a size. */
  wings_m2?: readonly number[];
}

/** The rider as the stars read them: the site's default rider unless told. */
export function riderOf(choice: RiderChoice = {}): Rider {
  return {
    weightKg:
      choice.weight_kg === undefined ? null : Math.round(choice.weight_kg),
    skill: choice.level ?? DEFAULT_RIDER.skill,
    wings: [...new Set(choice.wings_m2 ?? [])].sort((a, b) => a - b),
    ...(choice.gusty && choice.gusty !== "some" && { gusty: choice.gusty }),
  };
}

export interface RiderUsed {
  /** Who the stars are for, as the spot page says it: "Riding · ~80 kg". */
  label: string;
  level: Skill;
  /** The level in the site's words: Learning, Riding or Advanced. */
  level_label: string;
  weight_kg: number;
  /** The site's estimate, not a weight the rider gave. */
  weight_assumed: boolean;
  gusty: Gusty;
  wings_m2: number[];
  /** The mean wind the stars want, for this level and weight, knots. */
  wind_band_kn: {
    min: number;
    sweet_low: number;
    sweet_high: number;
    max: number;
  };
  /** A gust over this leaves the hour no stars at all: the top of the band. */
  gust_limit_kn: number;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

export function riderUsed(rider: Rider): RiderUsed {
  const band = windBand(rider);
  const weight = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  const assumed = rider.weightKg === null;
  return {
    label: `${SKILL_LABEL[rider.skill]} · ${assumed ? "~" : ""}${weight} kg`,
    level: rider.skill,
    level_label: SKILL_LABEL[rider.skill],
    weight_kg: weight,
    weight_assumed: assumed,
    gusty: rider.gusty ?? "some",
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
  /** By gust ÷ mean, as the stars judge it (steady, gusty, very-gusty). */
  gustiness: Gustiness;
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

export function hourStars(
  rating: HourRating,
  wind: HourWind,
  rider: Rider,
): HourStars {
  return {
    stars: rating.stars,
    potential: rating.potential,
    why_no_stars: rating.stars === 0 ? whyNone(rating) : null,
    reasons: rating.reasons,
    session: rating.session,
    gustiness: gustiness(wind.wind_kn, wind.gust_kn, rider),
    wing_m2: rating.wing.recommended,
    ...(rating.wing.own !== null && { own_wing_m2: rating.wing.own }),
  };
}

/** Why an hour the site does not rate has no stars. */
export const NOT_RATED = {
  dark: "not rated: wingfoil.ie rates the hours from sunrise to sunset",
  noWind: "not rated: no forecast of this hour's wind",
  warning: "not rated: a Met Éireann orange or red warning covers this hour",
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
