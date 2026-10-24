// Star ratings for a wing-foiling session: how good an hour is, for this rider,
// at this spot. Pure functions over numbers the dock already has — one model's
// own wind, gust and direction for the hour, the model the rider picked
// (force5/src/lead.ts: HARMONIE unless they pick another, ECMWF past the end
// of its run) — so the map, the dock and the forecast server can all rate an
// hour the same way. The other models never move a star (the ruling of 19
// October 2026, docs/STAR_RATINGS.md).
//
// Two numbers per hour, both out of five:
//   potential  what the wind alone is worth to this rider (the faded stars)
//   stars      what is left once the spot has its say: how gusty the wind
//              is and the shore angle (solid)
// Both rate the steady wind, the mean: it is what holds you on the foil, and
// whether a session is on at all. Below the floor a gust is a chance to get
// up, so it can lift the hour to the floor and no further. Two curves, each a
// level's own or the rider's (a `CustomRating`), and one rider setting then
// set the stars:
//   wind       stars for the mean, on min / sweetLow / sweetHigh / max; `max`
//              is the most the rider can hold, gusts included, so a gust
//              over it leaves the hour no stars at all, not even faded ones
//   direction  stars off for each of the five ways the wind meets the beach
//   gusty      stars off for gusty wind, by gust ÷ mean, as much as the
//              rider says gusty wind bothers them (`Rider.gusty`)
// `stars` never exceeds `potential`, so the faded stars are always the upside a
// better direction or a steadier breeze would have delivered.

import type { StarsChoice } from "./lead.js";

export type Skill = "beginner" | "intermediate" | "advanced";
export const SKILLS: readonly Skill[] = [
  "beginner",
  "intermediate",
  "advanced",
];
/** Each level in the rider's own words, as Display options write them. */
export const SKILL_LABEL: Record<Skill, string> = {
  beginner: "Learning",
  intermediate: "Riding",
  advanced: "Advanced",
};

export interface WindBand {
  /** Below this the rider cannot stay on the foil for long. */
  min: number;
  sweetLow: number;
  sweetHigh: number;
  /** Above this the rider is overpowered on any sensible wing. */
  max: number;
}

/**
 * How much gusty wind bothers the rider, in their own words: "some" is the
 * default. It sets the stars gusty and very gusty hours lose (`GUSTY_OFF`).
 */
export type Gusty = "little" | "some" | "lots";
export const GUSTIES: readonly Gusty[] = ["little", "some", "lots"];
export const GUSTY_LABEL: Record<Gusty, string> = {
  little: "Not much",
  some: "Some",
  lots: "A lot",
};

/** The five ways the wind meets a beach, as the custom rating names them. */
export type DirectionKey =
  "onshore" | "crossOn" | "cross" | "crossOff" | "offshore";
export const DIRECTION_KEYS: readonly DirectionKey[] = [
  "onshore",
  "crossOn",
  "cross",
  "crossOff",
  "offshore",
];
/** Stars off, 0–5 in half stars, for each way the wind meets the beach. */
export type DirectionCosts = Record<DirectionKey, number>;

/**
 * The version of the stored `CustomRating` shape. Version 1 also had a gust
 * curve, which v6 of the stars dropped: it is read without it. Anything else
 * is dropped.
 */
export const CUSTOM_RATING_VERSION = 2;

/**
 * A rider's own star rating, all in knots and stars. When a rider has one it
 * replaces their level's band and direction costs, with no weight scaling;
 * `base` is the level it started from, which keeps the level's share of a
 * gust below the floor and its wing sizes.
 */
export interface CustomRating {
  version: typeof CUSTOM_RATING_VERSION;
  base: Skill;
  wind: WindBand;
  direction: DirectionCosts;
}

export interface Rider {
  /** Kilograms; null means the reader has not said, and the estimate is used. */
  weightKg: number | null;
  skill: Skill;
  /**
   * How far into the wind they ride, in degrees past straight across it,
   * 0–45 (./rideWedge `upwindOf`): the loupe's no-go and the light's wedge
   * move with it, the stars do not. Absent while it is their level's own.
   */
  upwind?: number;
  /** How much gusty wind bothers them; absent while it is "some". */
  gusty?: Gusty;
  /** Wing sizes the rider owns, in square metres; empty means "recommend one". */
  wings: number[];
  /** The rider's own star rating while it rates, in place of the level's; absent while a level rates. */
  custom?: CustomRating | null;
  /**
   * The rider's own star rating, kept while a level rates in its place, so
   * they can go back to it. Absent when they have none, and while it rates
   * (then it is `custom`): the two are never both set.
   */
  keptCustom?: CustomRating | null;
  /**
   * The one model the rider picked: the map draws it and the stars rate it,
   * ECMWF taking over past the end of its run (force5/src/lead.ts). Absent
   * while it is the default, HARMONIE.
   */
  starsFrom?: StarsChoice;
}

/** The rider's own star rating, whether it rates now or is kept: null when they have none. */
export const savedCustom = (rider: Rider): CustomRating | null =>
  rider.custom ?? rider.keptCustom ?? null;

/** What the stars are rated on: one of the levels, or the rider's own rating. */
export type StarsOn = Skill | "custom";

/** The level, or "custom" while the rider's own rating rates. */
export const starsOn = (rider: Rider): StarsOn =>
  rider.custom ? "custom" : rider.skill;

/**
 * The rider rated on a level, or on their own rating ("custom", when they
 * have one), their own rating kept either way: the level pill's four choices.
 */
export function rateOn(rider: Rider, on: StarsOn): Rider {
  const { custom: _custom, keptCustom: _kept, ...fields } = rider;
  const saved = savedCustom(rider);
  if (on === "custom")
    return saved ? { ...fields, custom: saved } : { ...fields };
  return saved
    ? { ...fields, skill: on, keptCustom: saved }
    : { ...fields, skill: on };
}

/**
 * The rider as a rating, or another server, reads one: the rating in use and
 * nothing kept beside it.
 */
export function ratedRider(rider: Rider): Rider {
  const { keptCustom: _kept, ...rated } = rider;
  return rated;
}

/** The rider every estimate assumes until the reader says otherwise. */
export const ESTIMATE_WEIGHT_KG = 80;
export const DEFAULT_RIDER: Rider = {
  weightKg: null,
  skill: "intermediate",
  wings: [],
};

export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 160;
export const MIN_WING_M2 = 1.5;
export const MAX_WING_M2 = 10;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * Mean-wind band, in knots, for an 80 kg rider of each level. The size guides
 * and the forums agree on the middle: about 12 kn before an average rider
 * stays up without pumping, 14–20 the comfortable range, 18–24 fully lit, and
 * most riders short of expert struggling from 25–28. The top is the most a
 * rider holds, gusts included: "nobody goes out in 40; 30 is about the max,
 * maybe 35 for very advanced" (the owner, 24 October 2026).
 */
const BANDS: Record<Skill, WindBand> = {
  beginner: { min: 13, sweetLow: 15, sweetHigh: 20, max: 24 },
  intermediate: { min: 11, sweetLow: 14, sweetHigh: 24, max: 30 },
  advanced: { min: 8, sweetLow: 13, sweetHigh: 28, max: 35 },
};

/**
 * How gusty an hour is, by its gust over its mean: under 1.5 steady, from 1.5
 * gusty, from 1.8 very gusty. The models' gust is the hour's strongest, so a
 * riding day's gust a third over the mean is ordinary.
 */
export type Gustiness = "steady" | "gusty" | "very-gusty";
export const GUSTY_FROM = 1.5;
export const VERY_GUSTY_FROM = 1.8;

/** Stars off for a gusty and a very gusty hour, by how much it bothers the rider. */
export const GUSTY_OFF: Record<Gusty, Record<Gustiness, number>> = {
  little: { steady: 0, gusty: 0, "very-gusty": 1 },
  some: { steady: 0, gusty: 1, "very-gusty": 2 },
  lots: { steady: 0, gusty: 2, "very-gusty": 3 },
};

/**
 * Stars off for each way the wind meets the beach. Onshore, cross-onshore and
 * cross-shore cost nothing: cross-shore is perfect, and onshore only slow to
 * get out through. Cross-offshore and offshore carry a rider who falls away
 * from the beach, most of all a learner.
 */
const DIRECTIONS: Record<Skill, DirectionCosts> = {
  beginner: { onshore: 0, crossOn: 0, cross: 0, crossOff: 3, offshore: 5 },
  intermediate: {
    onshore: 0,
    crossOn: 0,
    cross: 0,
    crossOff: 1.5,
    offshore: 4,
  },
  advanced: { onshore: 0, crossOn: 0, cross: 0, crossOff: 1, offshore: 4 },
};

/**
 * How much of the gap between mean and gust a rider can use below the floor:
 * a gust is a free pump, and a lull is glide once up. A beginner still falling
 * off in the lulls gets less of it.
 */
const GUST_SHARE: Record<Skill, number> = {
  beginner: 0.2,
  intermediate: 0.3,
  advanced: 0.35,
};

/** The level the rating's shares and wing sizes come from: the custom rating's base, else the rider's. */
export const ratingLevel = (rider: Rider): Skill =>
  rider.custom?.base ?? rider.skill;

/**
 * The wind an hour is rated on: the mean, except below the rider's floor,
 * where the gusts may lift it as far as the floor and no further. A light day
 * with big gusts is a chance to get up, worth a star; it is never rated as a
 * windier day than it is.
 */
export function rideableWind(
  windKn: number,
  gustKn: number | null,
  rider: Rider,
): number {
  if (gustKn === null || gustKn <= windKn) return windKn;
  const { min } = windBand(rider);
  if (windKn >= min) return windKn;
  return Math.min(
    min,
    windKn + GUST_SHARE[ratingLevel(rider)] * Math.min(gustKn - windKn, windKn),
  );
}

export const riderWeight = (rider: Rider) =>
  rider.weightKg ?? ESTIMATE_WEIGHT_KG;

/**
 * The rider's band: their own when they have a custom rating, else their
 * level's for their weight. A heavier rider needs more wind to get going — the
 * power a wing makes rises with the square of the wind, so the floor moves
 * with the square root of the weight — and can hold down a little more at the
 * top.
 */
export function windBand(rider: Rider): WindBand {
  if (rider.custom) return { ...rider.custom.wind };
  const base = BANDS[rider.skill];
  const ratio = riderWeight(rider) / ESTIMATE_WEIGHT_KG;
  const low = Math.sqrt(ratio);
  const high = ratio ** 0.25;
  return {
    min: base.min * low,
    sweetLow: base.sweetLow * low,
    sweetHigh: base.sweetHigh * high,
    max: base.max * high,
  };
}

/** Stars off for each way the wind meets the beach: the rider's own, else their level's. */
export function directionCosts(rider: Rider): DirectionCosts {
  return { ...(rider.custom?.direction ?? DIRECTIONS[rider.skill]) };
}

/**
 * Whether the hour's gust is over the most the rider can hold, the top of
 * their band: then the hour has no stars at all.
 */
export const gustsOverLimit = (gustKn: number | null, rider: Rider) =>
  gustKn !== null && gustKn > windBand(rider).max;

/**
 * How gusty an hour is, by its gust over its mean. Only an hour at or above
 * the rider's floor can be gusty: below it a gust is a chance to get up.
 */
export function gustiness(
  windKn: number,
  gustKn: number | null,
  rider: Rider,
): Gustiness {
  if (gustKn === null || windKn < windBand(rider).min) return "steady";
  const factor = gustKn / windKn;
  return factor >= VERY_GUSTY_FROM
    ? "very-gusty"
    : factor >= GUSTY_FROM
      ? "gusty"
      : "steady";
}

/**
 * Stars off for how gusty the hour is, by how much gusty wind bothers this
 * rider: "some" unless they have said, or said something it cannot read.
 */
export const gustyCost = (rider: Rider, kind: Gustiness): number =>
  (GUSTY_OFF[rider.gusty ?? "some"] ?? GUSTY_OFF.some)[kind];

/** The custom rating's name for each shore angle. */
export const DIRECTION_OF: Record<ShoreAngle, DirectionKey> = {
  onshore: "onshore",
  "cross-on": "crossOn",
  cross: "cross",
  "cross-off": "crossOff",
  offshore: "offshore",
};

/** Stars off for this shore angle, for this rider. */
export const directionCost = (rider: Rider, angle: ShoreAngle): number =>
  directionCosts(rider)[DIRECTION_OF[angle]];

/**
 * What a custom rating may hold, in knots: the end of the dialog's wind
 * scale, and the knot that keeps each handle apart from the next.
 */
export const CUSTOM_LIMITS = {
  windTopKn: 40,
  apartKn: 1,
} as const;

const tenth = (value: number) => Math.round(value * 10) / 10;
const halfStar = (value: number) => clamp(Math.round(value * 2) / 2, 0, 5);

/**
 * A level's own rating for this rider, as a custom rating: where "Start
 * from" begins, so a rider who saves it unchanged is rated as they were.
 */
export function standardRating(
  rider: Rider,
  skill: Skill = rider.skill,
): CustomRating {
  const standard: Rider = { ...rider, skill, custom: null, keptCustom: null };
  return normalCustomRating({
    version: CUSTOM_RATING_VERSION,
    base: skill,
    wind: windBand(standard),
    direction: directionCosts(standard),
  });
}

/**
 * The one place a custom rating is made safe, whoever wrote it — the dialog,
 * the device's storage, the account or a phone registering for alerts. Any
 * missing or non-numeric field, or another version, and it is dropped (null):
 * the rider is rated on their level. A version 1 rating is read as version 2,
 * its gust curve left behind, so nobody loses their wind and directions.
 * Numbers out of range are clamped: knots to a tenth, the wind handles in
 * order a knot apart within 2–40, and every star figure 0–5 in half stars.
 */
export function parseCustomRating(value: unknown): CustomRating | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== CUSTOM_RATING_VERSION && raw.version !== 1) return null;
  if (!SKILLS.includes(raw.base as Skill)) return null;
  const read = (group: unknown, keys: readonly string[]) => {
    if (!group || typeof group !== "object") return null;
    const out: Record<string, number> = {};
    for (const key of keys) {
      const v = (group as Record<string, unknown>)[key];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      out[key] = v;
    }
    return out;
  };
  const wind = read(raw.wind, ["min", "sweetLow", "sweetHigh", "max"]);
  const direction = read(raw.direction, DIRECTION_KEYS);
  if (!wind || !direction) return null;
  return normalCustomRating({
    version: CUSTOM_RATING_VERSION,
    base: raw.base as Skill,
    wind: wind as unknown as WindBand,
    direction: direction as unknown as DirectionCosts,
  });
}

function normalCustomRating(rating: CustomRating): CustomRating {
  const { windTopKn, apartKn } = CUSTOM_LIMITS;
  // Each handle no lower than a knot past the one before it, and low enough
  // to leave a knot for each one after it, so any four numbers come out in
  // order.
  const w = rating.wind;
  const min = tenth(clamp(w.min, 2, windTopKn - 3 * apartKn));
  const sweetLow = tenth(
    clamp(w.sweetLow, min + apartKn, windTopKn - 2 * apartKn),
  );
  const sweetHigh = tenth(
    clamp(w.sweetHigh, sweetLow + apartKn, windTopKn - apartKn),
  );
  const max = tenth(clamp(w.max, sweetHigh + apartKn, windTopKn));
  const direction = {} as DirectionCosts;
  for (const key of DIRECTION_KEYS)
    direction[key] = halfStar(rating.direction[key]);
  return {
    version: CUSTOM_RATING_VERSION,
    base: rating.base,
    wind: { min, sweetLow, sweetHigh, max },
    direction,
  };
}

/** Whether two custom ratings (or none) rate every hour the same. */
export const sameCustomRating = (
  a: CustomRating | null | undefined,
  b: CustomRating | null | undefined,
) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The wing a rider of this weight and level would pick for a mean wind, in
 * square metres to the half metre. Fitted to the published size charts: an
 * 80 kg intermediate on 5.5 m² at 15 knots, 4.5 m² at 20 and 3 m² at 30.
 * Beginners go a size up for the lulls; advanced riders pump a smaller wing.
 * A custom rating sizes wings as the level it started from.
 */
export function wingSize(rider: Rider, windKn: number): number {
  const level = ratingLevel(rider);
  const skill = level === "beginner" ? 1.1 : level === "advanced" ? 0.92 : 1;
  const raw =
    5.5 *
    (riderWeight(rider) / ESTIMATE_WEIGHT_KG) ** 0.8 *
    (15 / Math.max(windKn, 6)) ** 0.85 *
    skill;
  return Math.min(8, Math.max(2, Math.round(raw * 2) / 2));
}

export type QuiverFit = "fits" | "underpowered" | "overpowered";

export interface WingPick {
  /** What the curve recommends. */
  recommended: number;
  /** Which of the rider's own wings to take, when they have told us. */
  own: number | null;
  fit: QuiverFit;
}

/**
 * The rider's own wing for the hour: the smallest that is not much smaller than
 * the recommendation, because a wing that is a touch big is still rideable in
 * the lulls and one that is too small is not. With no quiver the recommendation
 * stands on its own.
 */
export function pickWing(rider: Rider, windKn: number): WingPick {
  const recommended = wingSize(rider, windKn);
  const wings = [...rider.wings].sort((a, b) => a - b);
  if (!wings.length) return { recommended, own: null, fit: "fits" };
  const own = wings.find((size) => size >= recommended * 0.9) ?? wings.at(-1)!;
  const fit: QuiverFit =
    own < recommended * 0.75
      ? "underpowered"
      : own > recommended * 1.35
        ? "overpowered"
        : "fits";
  return { recommended, own, fit };
}

export type ShoreAngle =
  "onshore" | "cross-on" | "cross" | "cross-off" | "offshore";

/**
 * How the wind meets the shore. `facing` is the bearing the shore looks out to
 * sea along; wind *from* that bearing is dead onshore, wind from the opposite
 * bearing is dead offshore.
 */
export function shoreAngle(windFrom: number, facing: number): ShoreAngle {
  const off = Math.abs(((((windFrom - facing) % 360) + 540) % 360) - 180);
  if (off < 30) return "onshore";
  if (off < 70) return "cross-on";
  if (off < 110) return "cross";
  if (off < 150) return "cross-off";
  return "offshore";
}

export const SHORE_LABEL: Record<ShoreAngle, string> = {
  onshore: "onshore",
  "cross-on": "cross-onshore",
  cross: "cross-shore",
  "cross-off": "cross-offshore",
  offshore: "offshore",
};

export interface SpotShore {
  /** Seaward bearing of the shore, or null where it is not known well enough. */
  facing: number | null;
}

export type Agreement = "high" | "moderate" | "low";

export interface HourInput {
  /** The mean wind, in knots, of the one model the hour is rated from. */
  windKn: number | null;
  /** That model's gust, in knots; null where it gives none. */
  gustKn: number | null;
  /** Where that model has the wind blowing from, in degrees. */
  from: number | null;
  /**
   * How far all the models agree. Context only: it is shown beside the stars
   * and never changes them.
   */
  agreement?: Agreement | null;
  /** False at night: nobody is rated for a session they cannot see. */
  daylight: boolean;
}

export type SessionKind =
  | "too-light"
  | "pump"
  | "drills"
  | "cruising"
  | "powered"
  | "overpowered"
  | "too-strong"
  | "too-gusty"
  | "offshore";

/**
 * Why an hour has no stars, where the wind or the shore says so: "too
 * light", "too strong", "gusts over your limit", or "offshore" when the
 * offshore wind is what cost the stars. The kinds in between are the rating's own business and
 * have no words on the page: a rider reads the stars and the figures.
 */
export function noStarsWhy(rating: Pick<HourRating, "session">): string | null {
  switch (rating.session) {
    case "too-light":
      return "too light";
    case "too-strong":
      return "too strong";
    case "too-gusty":
      return "gusts over your limit";
    case "offshore":
      return "offshore";
    default:
      return null;
  }
}

export interface HourRating {
  /** The rideable wind the hour was rated on, in knots. */
  rideKn: number;
  /** How much of that the gusts added to the mean. */
  liftKn: number;
  /** Whole stars, 0–5, after the spot and the forecast have their say. */
  stars: number;
  /** Whole stars, 0–5, for the wind alone. Never below `stars`. */
  potential: number;
  session: SessionKind;
  shore: ShoreAngle | null;
  wing: WingPick;
  /** Plain-language reasons for every star taken off, most important first. */
  reasons: string[];
}

const ramp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  y0 + ((clamp(x, x0, x1) - x0) / (x1 - x0)) * (y1 - y0);

/** 0–5 for the mean wind against the rider's band, before anything else. */
export function windScore(windKn: number, band: WindBand): number {
  const { min, sweetLow, sweetHigh, max } = band;
  if (windKn < min - 2) return 0;
  if (windKn < min) return ramp(windKn, min - 2, min, 0, 1);
  if (windKn < sweetLow) return ramp(windKn, min, sweetLow, 1, 4);
  if (windKn <= sweetHigh) {
    // Five in the middle half of the sweet spot, four at its edges.
    const quarter = (sweetHigh - sweetLow) / 4;
    if (windKn < sweetLow + quarter)
      return ramp(windKn, sweetLow, sweetLow + quarter, 4, 5);
    if (windKn > sweetHigh - quarter)
      return ramp(windKn, sweetHigh - quarter, sweetHigh, 5, 4);
    return 5;
  }
  if (windKn <= max) return ramp(windKn, sweetHigh, max, 4, 2);
  return ramp(windKn, max, max + 6, 2, 0);
}

function session(windKn: number, band: WindBand): SessionKind {
  if (windKn < band.min - 2) return "too-light";
  if (windKn < band.min) return "pump";
  if (windKn < band.sweetLow) return "drills";
  if (windKn <= (band.sweetLow + band.sweetHigh) / 2) return "cruising";
  if (windKn <= band.sweetHigh) return "powered";
  if (windKn <= band.max) return "overpowered";
  return "too-strong";
}

/** What a gusty hour is called, said when it costs a star. */
const GUSTY_REASON: Record<Gustiness, string> = {
  steady: "",
  gusty: "Gusty",
  "very-gusty": "Very gusty",
};

/** What each shore angle is like, said when it costs a star. */
const SHORE_REASON: Record<ShoreAngle, string> = {
  onshore: "Onshore: slow to get out through the chop.",
  "cross-on": "Cross-onshore: the wind brings you back to the beach.",
  cross: "Cross-shore: the wind runs along the beach.",
  "cross-off": "Cross-offshore: a drift downwind takes you out, not in.",
  offshore: "Offshore wind: it blows you away from the beach.",
};

/**
 * One hour, rated. Null when there is nothing to rate: no wind reading, or dark.
 *
 *   stars = round(wind − gusty − direction − wing), 0 to potential
 *
 * and none at all, potential too, when the gust is over the top of the
 * rider's band. The deductions are deliberately few and legible — each one is
 * a sentence in `reasons` when it costs a whole star — because a rider should
 * be able to argue with the stars.
 */
export function rateHour(
  hour: HourInput,
  shore: SpotShore,
  rider: Rider,
): HourRating | null {
  if (hour.windKn === null || !hour.daylight) return null;
  const band = windBand(rider);
  const rideKn = rideableWind(hour.windKn, hour.gustKn, rider);
  const base = windScore(rideKn, band);
  const wing = pickWing(rider, hour.windKn);

  const angle =
    shore.facing === null || hour.from === null
      ? null
      : shoreAngle(hour.from, shore.facing);
  const direction = angle ? directionCost(rider, angle) : 0;
  const gusty = gustiness(hour.windKn, hour.gustKn, rider);
  const gusts = gustyCost(rider, gusty);
  // How far the other models agree is context, never a cost: the stars are
  // the one model's (the ruling of 19 October 2026).
  const quiver = wing.fit === "fits" ? 0 : 1;
  const score = base - direction - gusts - quiver;

  // A gust over what the rider can hold: no stars, not even faded ones, for
  // a kinder direction would not make it rideable (the ruling of 24 October
  // 2026).
  if (gustsOverLimit(hour.gustKn, rider)) {
    const kind = session(rideKn, band);
    return {
      rideKn,
      liftKn: rideKn - hour.windKn,
      stars: 0,
      potential: 0,
      session: kind === "too-strong" ? kind : "too-gusty",
      shore: angle,
      wing,
      reasons: ["Gusts over your limit"],
    };
  }

  const potential = Math.round(base);
  const starsFrom = (x: number) => clamp(Math.round(x), 0, potential);
  const stars = starsFrom(score);
  // A cost is named when it costs a whole star: without it, more would show.
  const costs = (off: number) => off > 0 && stars < starsFrom(score + off);

  const reasons: string[] = [];
  if (angle && costs(direction)) reasons.push(SHORE_REASON[angle]);
  if (costs(gusts)) reasons.push(GUSTY_REASON[gusty]);
  if (wing.fit === "underpowered")
    reasons.push(
      `Your biggest wing is small for this: about ${wing.recommended} m² would suit.`,
    );
  else if (wing.fit === "overpowered")
    reasons.push(
      `Your smallest wing is big for this: about ${wing.recommended} m² would suit.`,
    );

  return {
    rideKn,
    liftKn: rideKn - hour.windKn,
    stars,
    potential,
    session:
      angle === "offshore" && costs(direction)
        ? "offshore"
        : session(rideKn, band),
    shore: angle,
    wing,
    reasons,
  };
}

export interface StarWindow {
  /** Index of the first and last column of the window, inclusive. */
  from: number;
  to: number;
  /** The lowest solid rating inside the window: what it can be relied on for. */
  stars: number;
}

/**
 * The best stretch in a list of rated columns: the longest run holding the
 * highest rating any run of `minColumns` reaches. Rated on its weakest column,
 * so a window is never sold on one good hour.
 */
export function bestWindow(
  ratings: readonly (HourRating | null)[],
  minColumns = 2,
): StarWindow | null {
  let best: StarWindow | null = null;
  for (let level = 5; level >= 1 && !best; level--) {
    let start = -1;
    for (let i = 0; i <= ratings.length; i++) {
      const good = i < ratings.length && (ratings[i]?.stars ?? -1) >= level;
      if (good && start < 0) start = i;
      if (!good && start >= 0) {
        const length = i - start;
        if (length >= minColumns && (!best || length > best.to - best.from + 1))
          best = { from: start, to: i - 1, stars: level };
        start = -1;
      }
    }
  }
  return best;
}

/** "3 of 5 stars, 4 possible" — the words a screen reader and a tooltip use. */
export function starsText(
  rating: Pick<HourRating, "stars" | "potential">,
): string {
  const solid = `${rating.stars} of 5 star${rating.stars === 1 ? "" : "s"}`;
  return rating.potential > rating.stars
    ? `${solid}, ${rating.potential} possible`
    : solid;
}
