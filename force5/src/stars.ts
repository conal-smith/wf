// Star ratings for a wing-foiling session: how good an hour is, for this rider,
// at this spot. Pure functions over numbers the dock already has — the headline
// wind and gust (HARMONIE's own while it reaches the hour, else the weighted
// median of the models), its direction and agreement — so the map, the dock
// and the forecast server can all rate an hour the same way.
//
// Two numbers per hour, both out of five:
//   potential  what the wind alone is worth to this rider (the faded stars)
//   stars      what is left once the spot and the forecast have their say:
//              the shore angle, the gusts and whether the models agree (solid)
// Both rate the steady wind, the mean: it is what holds you on the foil. Only
// on a light day do the gusts add to it, because then they are what get you up.
// Once the mean is enough, gusts only cost: the gustier the wind and the more
// powered the rider already is, the more they cost, and gusts past what the
// rider can hold cost most of all.
// `stars` never exceeds `potential`, so the faded stars are always the upside a
// better direction or a steadier breeze would have delivered.

export type Skill = "beginner" | "intermediate" | "advanced";
export const SKILLS: readonly Skill[] = [
  "beginner",
  "intermediate",
  "advanced",
];

export interface Rider {
  /** Kilograms; null means the reader has not said, and the estimate is used. */
  weightKg: number | null;
  skill: Skill;
  /** Wing sizes the rider owns, in square metres; empty means "recommend one". */
  wings: number[];
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

/** Mean-wind band, in knots, for an 80 kg rider of each level. */
const BANDS: Record<Skill, WindBand> = {
  beginner: { min: 12, sweetLow: 14, sweetHigh: 20, max: 24 },
  intermediate: { min: 10, sweetLow: 14, sweetHigh: 24, max: 30 },
  advanced: { min: 8, sweetLow: 13, sweetHigh: 28, max: 35 },
};

/**
 * How much of the gap between mean and gust a rider can use. Once up on the
 * foil, a gust is a free pump and a lull is glide, so a 10 kn mean gusting 18
 * rides nearer 13; a beginner still falling off in the lulls gets less of it.
 */
const GUST_SHARE: Record<Skill, number> = {
  beginner: 0.2,
  intermediate: 0.3,
  advanced: 0.35,
};

/**
 * The mean wind lifted toward the gusts by the share this rider can use. The
 * lift is for a light day, when the gusts are what get you foiling: it is whole
 * at the floor and gone by the sweet spot, so gusts can make a light day
 * rideable but never make a day better than its steady wind.
 */
export function rideableWind(
  windKn: number,
  gustKn: number | null,
  rider: Rider,
): number {
  if (gustKn === null || gustKn <= windKn) return windKn;
  const { min, sweetLow } = windBand(rider);
  const fade = clamp((sweetLow - windKn) / (sweetLow - min), 0, 1);
  return (
    windKn + GUST_SHARE[rider.skill] * fade * Math.min(gustKn - windKn, windKn)
  );
}

/**
 * Gust over mean that still reads as a steady wind. The models' gust is the
 * hour's strongest, so even a steady breeze comes with one about a third over
 * its mean: the steadiest quarter of the published daylight hours at 14–19 kn
 * sit under 1.35, the middle at 1.5.
 */
export const STEADY_GUST_FACTOR = 1.35;

/** Stars a gust factor costs per 1.0 over the steady one, fully powered. */
const GUSTINESS: Record<Skill, number> = {
  beginner: 6,
  intermediate: 5,
  advanced: 4,
};

/** What the gusts cost an hour, before rounding, and what they were read from. */
export interface GustCost {
  /** Gust over mean. */
  factor: number;
  /** How powered the steady wind already has the rider: 0 at the floor, 1 from the top of the sweet spot. */
  power: number;
  /** Stars off for a wind that comes and goes. */
  gustiness: number;
  /** Stars off for gusts past the sweet spot, harder past the ceiling. */
  strength: number;
}

/**
 * What the gusts take away. Two things, both read against the rider's band:
 *
 * - **Gustiness**, the gust factor past a steady wind's, weighed by how powered
 *   the mean already has the rider. Near the floor a gust is a lift, not a
 *   cost; at the top of the sweet spot every lull and every hit is felt. A
 *   learner, who falls off in the lulls, pays at least 0.6 of it at any speed.
 * - **Strength**, the gusts past the sweet spot's top: one and a half stars by
 *   the ceiling, as much again for every gap as wide past it, at most three.
 *   A strong wind with strong gusts is hard to ride on any wing.
 */
export function gustCost(
  windKn: number,
  gustKn: number | null,
  rider: Rider,
): GustCost | null {
  if (gustKn === null || windKn <= 0) return null;
  const { min, sweetHigh, max } = windBand(rider);
  const factor = gustKn / windKn;
  const power = Math.max(
    clamp((windKn - min) / (sweetHigh - min), 0, 1),
    rider.skill === "beginner" ? 0.6 : 0,
  );
  const gustiness =
    clamp(factor - STEADY_GUST_FACTOR, 0, 0.6) * GUSTINESS[rider.skill] * power;
  const strength = clamp(
    (1.5 * (gustKn - sweetHigh)) / (max - sweetHigh),
    0,
    3,
  );
  return { factor, power, gustiness, strength };
}

export interface WindBand {
  /** Below this the rider cannot stay on the foil for long. */
  min: number;
  sweetLow: number;
  sweetHigh: number;
  /** Above this the rider is overpowered on any sensible wing. */
  max: number;
}

export const riderWeight = (rider: Rider) =>
  rider.weightKg ?? ESTIMATE_WEIGHT_KG;

/**
 * The rider's band. A heavier rider needs more wind to get going — the power a
 * wing makes rises with the square of the wind, so the floor moves with the
 * square root of the weight — and can hold down a little more at the top.
 */
export function windBand(rider: Rider): WindBand {
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

/**
 * The wing a rider of this weight and level would pick for a mean wind, in
 * square metres to the half metre. Fitted to the published size charts: an
 * 80 kg intermediate on 5.5 m² at 15 knots, 4.5 m² at 20 and 3 m² at 30.
 * Beginners go a size up for the lulls; advanced riders pump a smaller wing.
 */
export function wingSize(rider: Rider, windKn: number): number {
  const skill =
    rider.skill === "beginner" ? 1.1 : rider.skill === "advanced" ? 0.92 : 1;
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
  /** The headline mean wind, in knots: HARMONIE's while it reaches the hour, else the weighted median. */
  windKn: number | null;
  /** The headline gust, in knots, chosen as the wind is, where any model publishes one. */
  gustKn: number | null;
  /** Mean bearing the wind blows from, in degrees. */
  from: number | null;
  agreement: Agreement | null;
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
  | "offshore";

/**
 * Why an hour has no stars, where the wind alone says so: "too light", "too
 * strong", "offshore". The kinds in between are the rating's own business and
 * have no words on the page: a rider reads the stars and the figures.
 */
export function noStarsWhy(rating: Pick<HourRating, "session">): string | null {
  switch (rating.session) {
    case "too-light":
      return "too light";
    case "too-strong":
      return "too strong";
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

/**
 * One hour, rated. Null when there is nothing to rate: no wind reading, or dark.
 * The deductions are deliberately few and legible — each one is a sentence in
 * `reasons` — because a rider should be able to argue with the stars.
 */
export function rateHour(
  hour: HourInput,
  shore: SpotShore,
  rider: Rider,
): HourRating | null {
  if (hour.windKn === null || !hour.daylight) return null;
  const band = windBand(rider);
  const beginner = rider.skill === "beginner";
  const rideKn = rideableWind(hour.windKn, hour.gustKn, rider);
  const base = windScore(rideKn, band);
  const wing = pickWing(rider, hour.windKn);
  const reasons: string[] = [];
  let score = base;
  let cap = 5;

  const angle =
    shore.facing === null || hour.from === null
      ? null
      : shoreAngle(hour.from, shore.facing);
  if (angle === "offshore") {
    cap = beginner ? 0 : 1;
    reasons.push("Offshore wind: it blows you away from the beach.");
  } else if (angle === "cross-off") {
    score -= beginner ? 3 : rider.skill === "advanced" ? 1 : 1.5;
    reasons.push("Cross-offshore: a drift downwind takes you out, not in.");
  } else if (angle === "onshore") {
    score -= 1;
    reasons.push("Onshore: slow to get out through the chop.");
  } else if (angle === "cross" && beginner) {
    score -= 0.5;
    reasons.push("Cross-shore: fine, but cross-onshore is kinder to learn in.");
  }

  // The gusts' reasons wait until the end, to go in here: they are given only
  // when the gusts cost a whole star, as the models' small spread is.
  const gustsAt = reasons.length;
  const gusts = gustCost(hour.windKn, hour.gustKn, rider);
  const gustTotal = gusts ? gusts.strength + gusts.gustiness : 0;
  score -= gustTotal;

  // Models that differ a little cost a quarter, which only shows when it tips
  // the hour below a whole star; it is a reason only then.
  let doubt = false;
  if (hour.agreement === "low") {
    score -= 1;
    reasons.push("The models disagree, so this hour is a guess.");
  } else if (hour.agreement === "moderate") {
    score -= 0.25;
    doubt = true;
  }

  if (wing.fit === "underpowered") {
    score -= 1;
    reasons.push(
      `Your biggest wing is small for this: about ${wing.recommended} m² would suit.`,
    );
  } else if (wing.fit === "overpowered") {
    score -= 1;
    reasons.push(
      `Your smallest wing is big for this: about ${wing.recommended} m² would suit.`,
    );
  }

  const potential = Math.round(base);
  const starsFrom = (x: number) =>
    clamp(Math.round(Math.min(x, cap)), 0, potential);
  const stars = starsFrom(score);
  if (gusts && stars < starsFrom(score + gustTotal)) {
    const gust = Math.round(hour.gustKn!);
    const mean = Math.round(hour.windKn);
    const told: string[] = [];
    if (gusts.strength >= 0.25)
      told.push(
        hour.gustKn! > band.max
          ? `Gusts to ${gust} kn: more than you will want to hold.`
          : `Gusts to ${gust} kn: a handful on top of the wind.`,
      );
    if (gusts.gustiness >= 0.25)
      told.push(
        `Gusty: gusts ${gust} kn on a ${mean} kn mean, so it comes and goes.`,
      );
    reasons.splice(gustsAt, 0, ...told);
  }
  if (doubt && stars < starsFrom(score + 0.25))
    reasons.push("The models differ a little, enough to hold back a star.");
  return {
    rideKn,
    liftKn: rideKn - hour.windKn,
    stars,
    potential,
    session: angle === "offshore" ? "offshore" : session(rideKn, band),
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
