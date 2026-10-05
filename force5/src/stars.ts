// Star ratings for a wing-foiling session: how good an hour is, for this rider,
// at this spot. Pure functions over numbers the dock already has — the blend's
// median wind and gust, its mean direction and agreement — so the map, the dock
// and the forecast server can all rate an hour the same way.
//
// Two numbers per hour, both out of five:
//   potential  what the wind alone is worth to this rider (the faded stars)
//   stars      what is left once the spot and the forecast have their say:
//              the shore angle, the gusts and whether the models agree (solid)
// Both read the rideable wind: the mean lifted part of the way to the gusts,
// because on a foil the gusts get you up and you glide through the lulls.
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
 * lift matters on a light day, when the gusts are what get you foiling; it
 * fades out toward the top of the sweet spot, where a gust is only more power.
 */
export function rideableWind(
  windKn: number,
  gustKn: number | null,
  rider: Rider,
): number {
  if (gustKn === null || gustKn <= windKn) return windKn;
  const { min, sweetHigh } = windBand(rider);
  const fade = clamp((sweetHigh - windKn) / (sweetHigh - min), 0, 1);
  return (
    windKn + GUST_SHARE[rider.skill] * fade * Math.min(gustKn - windKn, windKn)
  );
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
  /** Median mean wind across the models, in knots. */
  windKn: number | null;
  /** Median gust across the models, in knots, where any model publishes one. */
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

export const SESSION_LABEL: Record<SessionKind, string> = {
  "too-light": "Too light",
  pump: "Pump and glide",
  drills: "Light-wind drills",
  cruising: "Cruising",
  powered: "Powered up",
  overpowered: "Overpowered",
  "too-strong": "Too strong",
  offshore: "Offshore",
};

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

  if (hour.gustKn !== null && hour.windKn > 0) {
    const gust = Math.round(hour.gustKn);
    const mean = Math.round(hour.windKn);
    const factor = hour.gustKn / hour.windKn;
    if (hour.gustKn > band.max) {
      // Gusts past what any wing in the bag can hold down.
      score -= 1;
      reasons.push(`Gusts to ${gust} kn: more than you will want to hold.`);
    } else if (beginner) {
      // Still learning: every lull is a fall, so gustiness costs at any speed.
      const penalty =
        factor > 1.7 ? 1.5 : factor > 1.5 ? 1 : factor > 1.35 ? 0.5 : 0;
      if (penalty) {
        score -= penalty * 1.5;
        reasons.push(`Gusty: gusts ${gust} kn on a ${mean} kn mean.`);
      }
    } else if (factor > 1.7 && hour.windKn >= band.sweetLow) {
      // Already powered, and the gusts come in hard on top.
      score -= 0.5;
      reasons.push(`Gusty: gusts ${gust} kn on a ${mean} kn mean.`);
    }
  }

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
