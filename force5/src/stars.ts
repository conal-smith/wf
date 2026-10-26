// Star ratings for a wing-foiling session: how good an hour is, for this rider,
// at this spot. Pure functions over numbers the dock already has — one model's
// own wind, gust and direction for the hour, the model the rider picked
// (force5/src/lead.ts: HARMONIE unless they pick another, ECMWF past the end
// of its run) — so the map, the dock, the app, the alerts and the forecast
// server all rate an hour the same way. The other models never move a star
// (the ruling of 19 October 2026, docs/STAR_RATINGS.md).
//
// One rating, ours, for everyone (the owner's ruling of 25 October 2026). A
// rider may make it their own in Settings by moving four numbers on the
// "What wind suits you?" slider and the stars each way of wind takes off;
// the rest is our model, the same for everyone:
//
//   wind       too light · sweet spot from · sweet spot to · too much (in
//              gusts), 11 · 15–22 · 35 kn unless the rider moves them. The
//              steady wind scores nothing below too light, one star at it
//              climbing a star a knot to four just short of the sweet spot,
//              five through the sweet spot, then down to one star at too
//              much − 5 and none from too much − 3 (`windStars`).
//   gusts      a gust past too much leaves the hour no stars. Otherwise the
//              gust is read GUST_EASE_KN lighter on the same scale and the
//              hour takes the lower of the two; stars lost so are outlined.
//   shore      stars off for the way the wind meets the beach, whole stars;
//              offshore is never, for everyone, and cannot be changed.
//
// Two numbers per hour, both out of five:
//   potential  what the steady wind alone is worth to this rider
//   stars      what is left once the gusts and the shore have their say
// `stars` never exceeds `potential`; the stars between them are drawn as
// outlines, and only ever stand for stars lost to the gusts or the shore.
// The rider's weight and wings never move a star.

import type { StarsChoice } from "./lead.js";

export interface WindBand {
  /** Too light below this: no stars. One star at it. */
  min: number;
  /** Five stars from here… */
  sweetLow: number;
  /** …to here. */
  sweetHigh: number;
  /** Too much, in gusts: a gust past this leaves the hour no stars. */
  max: number;
}

/** The five ways the wind meets a beach, as the rating names them. */
export type DirectionKey =
  "onshore" | "crossOn" | "cross" | "crossOff" | "offshore";
export const DIRECTION_KEYS: readonly DirectionKey[] = [
  "onshore",
  "crossOn",
  "cross",
  "crossOff",
  "offshore",
];
/** Whole stars off, 0–5, for each way the wind meets the beach. */
export type DirectionCosts = Record<DirectionKey, number>;

/** Five stars off: no stars in any wind. Offshore is always this. */
export const NEVER = 5;

/**
 * How much lighter a gust is read than it is, in knots: ours, never shown
 * nor set. 15 gusting 20 rides like 15; 20 gusting 30 like 25 at worst.
 */
export const GUST_EASE_KN = 5;

/**
 * The version of the stored `CustomRating` shape. Versions 1 and 2 belonged
 * to the levels (Learning, Riding, Advanced) and their gust settings, gone
 * since 25 October 2026: they are not read, and the rider is rated on ours.
 */
export const CUSTOM_RATING_VERSION = 3;

/**
 * A rider's own star rating: ours with their own four wind numbers and the
 * stars each way of wind takes off. All in knots and whole stars.
 */
export interface CustomRating {
  version: typeof CUSTOM_RATING_VERSION;
  wind: WindBand;
  direction: DirectionCosts;
}

/**
 * Ours: what everyone is rated on until they make it their own. Marked pure
 * so a bundle that never rates (the forecast worker's blend job) leaves it out.
 */
export const OURS: CustomRating = /* @__PURE__ */ Object.freeze({
  version: CUSTOM_RATING_VERSION,
  wind: /* @__PURE__ */ Object.freeze({
    min: 11,
    sweetLow: 15,
    sweetHigh: 22,
    max: 35,
  }),
  direction: /* @__PURE__ */ Object.freeze({
    onshore: 0,
    crossOn: 0,
    cross: 0,
    crossOff: 1,
    offshore: NEVER,
  }),
}) as CustomRating;

/** A fresh copy of ours, to edit. */
export const oursCopy = (): CustomRating => ({
  version: CUSTOM_RATING_VERSION,
  wind: { ...OURS.wind },
  direction: { ...OURS.direction },
});

export interface Rider {
  /** Kilograms; null means the reader has not said, and the estimate is used. Never moves a star. */
  weightKg: number | null;
  /**
   * How far into the wind they ride, in degrees past straight across it,
   * 0–45 (./rideWedge `upwindOf`): the loupe's no-go and the light's wedge
   * move with it, the stars do not. Absent while it is ours, 0.
   */
  upwind?: number;
  /**
   * How far below straight across the wind their course runs, in degrees,
   * 0–45 (./rideWedge `downwindOf`); past it they drift and lose ground.
   * Moves no star. Absent while it is ours, 10.
   */
  downwind?: number;
  /** Wing sizes the rider owns, in square metres; empty means "recommend one". Never moves a star. */
  wings: number[];
  /** The rider's own star rating; absent or null while ours rates. */
  custom?: CustomRating | null;
  /**
   * The one model the rider picked: the map draws it and the stars rate it,
   * ECMWF taking over past the end of its run (force5/src/lead.ts). Absent
   * while it is the default, HARMONIE.
   */
  starsFrom?: StarsChoice;
}

/** The rider every estimate assumes until the reader says otherwise. */
export const ESTIMATE_WEIGHT_KG = 80;
export const DEFAULT_RIDER: Rider = {
  weightKg: null,
  wings: [],
};

export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 160;
export const MIN_WING_M2 = 1.5;
export const MAX_WING_M2 = 10;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** The rating the rider is rated on: their own, else ours. */
export const ratingOf = (rider: Pick<Rider, "custom">): CustomRating =>
  rider.custom ?? OURS;

export const riderWeight = (rider: Rider) =>
  rider.weightKg ?? ESTIMATE_WEIGHT_KG;

/** The rider's four wind numbers: their own, else ours. Weight does not move them. */
export const windBand = (rider: Pick<Rider, "custom">): WindBand => ({
  ...ratingOf(rider).wind,
});

/** Stars off for each way the wind meets the beach: the rider's own, else ours. Offshore is always never. */
export const directionCosts = (
  rider: Pick<Rider, "custom">,
): DirectionCosts => ({
  ...ratingOf(rider).direction,
  offshore: NEVER,
});

/**
 * Whether the hour's gust is past too much, the top of the rider's band:
 * then the hour has no stars at all.
 */
export const gustsOverLimit = (
  gustKn: number | null,
  rider: Pick<Rider, "custom">,
) => gustKn !== null && gustKn > windBand(rider).max;

/** The rating's name for each shore angle. */
export const DIRECTION_OF: Record<ShoreAngle, DirectionKey> = {
  onshore: "onshore",
  "cross-on": "crossOn",
  cross: "cross",
  "cross-off": "crossOff",
  offshore: "offshore",
};

/** Stars off for this shore angle, for this rider. */
export const directionCost = (
  rider: Pick<Rider, "custom">,
  angle: ShoreAngle,
): number => directionCosts(rider)[DIRECTION_OF[angle]];

/**
 * What a rating may hold, in knots: the end of the slider's scale, and the
 * knot that keeps each handle apart from the next.
 */
export const CUSTOM_LIMITS = {
  windTopKn: 40,
  apartKn: 1,
} as const;

const tenth = (value: number) => Math.round(value * 10) / 10;
const wholeStar = (value: number) => clamp(Math.round(value), 0, NEVER);

/**
 * The one place a rating is made safe, whoever wrote it — the wizard, the
 * device's storage, the account or a phone registering for alerts. Anything
 * not version 3, or missing a number, is dropped (null), and the rider is
 * rated on ours: an old level's rating from before 25 October 2026 is never
 * read. Numbers out of range are clamped: knots to a tenth, the wind
 * handles in order a knot apart within 2–40, every direction 0–5 in whole
 * stars, and offshore never.
 */
export function parseCustomRating(value: unknown): CustomRating | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== CUSTOM_RATING_VERSION) return null;
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
  // Offshore is never whatever was sent: it need not be sent at all.
  const direction = read(
    raw.direction,
    DIRECTION_KEYS.filter((key) => key !== "offshore"),
  );
  if (!wind || !direction) return null;
  return normalCustomRating({
    version: CUSTOM_RATING_VERSION,
    wind: wind as unknown as WindBand,
    direction: { ...direction, offshore: NEVER } as unknown as DirectionCosts,
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
    direction[key] =
      key === "offshore" ? NEVER : wholeStar(rating.direction[key]);
  return {
    version: CUSTOM_RATING_VERSION,
    wind: { min, sweetLow, sweetHigh, max },
    direction,
  };
}

/** Whether two ratings (none being ours) rate every hour the same. */
export const sameCustomRating = (
  a: CustomRating | null | undefined,
  b: CustomRating | null | undefined,
) => JSON.stringify(a ?? OURS) === JSON.stringify(b ?? OURS);

/** Whether a rating is ours, as it stands: then the rider need keep none of their own. */
export const isOurs = (rating: CustomRating | null | undefined) =>
  sameCustomRating(rating, OURS);

/**
 * The wing a rider of this weight would pick for a mean wind, in square
 * metres to the half metre. Fitted to the published size charts: an 80 kg
 * rider on 5.5 m² at 15 knots, 4.5 m² at 20 and 3 m² at 30. Shown beside the
 * stars; it never moves one.
 */
export function wingSize(rider: Rider, windKn: number): number {
  const raw =
    5.5 *
    (riderWeight(rider) / ESTIMATE_WEIGHT_KG) ** 0.8 *
    (15 / Math.max(windKn, 6)) ** 0.85;
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
  | "drills"
  | "cruising"
  | "powered"
  | "overpowered"
  | "too-strong"
  | "too-gusty"
  | "offshore"
  | "never-shore";

/**
 * Why an hour has no stars, where the wind or the shore says so: "too
 * light", "too strong", "gusts over your limit", "offshore", or the way of
 * wind the rider never rides. The kinds in between are the rating's own
 * business and have no words on the page: a rider reads the stars and the
 * figures.
 */
export function noStarsWhy(
  rating: Pick<HourRating, "session"> & Partial<Pick<HourRating, "shore">>,
): string | null {
  switch (rating.session) {
    case "too-light":
      return "too light";
    case "too-strong":
      return "too strong";
    case "too-gusty":
      return "gusts over your limit";
    case "offshore":
      return "offshore";
    case "never-shore":
      return rating.shore ? SHORE_LABEL[rating.shore] : null;
    default:
      return null;
  }
}

export interface HourRating {
  /** The steady wind the hour was rated on, in knots. */
  rideKn: number;
  /** Whole stars, 0–5, after the gusts and the shore have their say. */
  stars: number;
  /** Whole stars, 0–5, for the steady wind alone. Never below `stars`. */
  potential: number;
  /** The outlined stars, by what took them: the gusts, then the shore. They add up to potential − stars. */
  lost: { gusts: number; shore: number };
  session: SessionKind;
  shore: ShoreAngle | null;
  /** The wing for the hour, shown beside the stars: it never moves one. */
  wing: WingPick;
  /** Plain-language reasons for every star taken off, most important first. */
  reasons: string[];
}

/**
 * Stars for a steady wind, unrounded, from the four numbers: none below too
 * light; one at it, climbing a star a knot (or evenly, on a wider gap) to
 * four just short of the sweet spot; five through it; then four for up to
 * three knots, down to one at too much − 5 and none from too much − 3.
 * Exactly the approved mock-up's function
 * (backlog/mockups/2026-10-25-own-star-rating.html).
 */
export function windStars(kn: number, w: WindBand): number {
  if (kn < w.min) return 0;
  if (kn < w.sweetLow)
    return Math.min(
      4,
      1 + (4 * (kn - w.min)) / Math.max(1, w.sweetLow - w.min),
    );
  if (kn <= w.sweetHigh) return 5;
  const one = w.max - 5;
  const zero = w.max - 3;
  let pts: [number, number][];
  if (one <= w.sweetHigh + 1)
    pts = [
      [w.sweetHigh, 5],
      [Math.max(zero, w.sweetHigh + 1), 0],
    ];
  else {
    const fourTo = Math.max(
      w.sweetHigh + 1,
      Math.min(w.sweetHigh + 3, one - 1),
    );
    pts = [
      [w.sweetHigh, 5],
      [w.sweetHigh + 1, 4],
      [fourTo, 4],
      [one, 1],
      [zero, 0],
    ];
  }
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (kn <= x1)
      return x1 === x0 ? y1 : y0 + ((kn - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 0;
}

/**
 * The stars a gust allows, unrounded: read GUST_EASE_KN lighter on the same
 * scale, and only ever a limit from the top (a gust under the sweet spot's
 * top costs nothing).
 */
export function gustStars(gustKn: number | null, w: WindBand): number {
  if (gustKn === null) return 5;
  const read = gustKn - GUST_EASE_KN;
  return read > w.sweetHigh ? windStars(read, w) : 5;
}

function session(windKn: number, band: WindBand): SessionKind {
  if (windKn < band.min) return "too-light";
  if (windKn < band.sweetLow) return "drills";
  if (windKn <= (band.sweetLow + band.sweetHigh) / 2) return "cruising";
  if (windKn <= band.sweetHigh) return "powered";
  if (Math.round(windStars(windKn, band)) >= 1) return "overpowered";
  return "too-strong";
}

/** What each shore angle is like, said when it costs a star. */
const SHORE_REASON: Record<ShoreAngle, string> = {
  onshore: "Onshore: slow to get out through the chop.",
  "cross-on": "Cross-onshore: the wind brings you back to the beach.",
  cross: "Cross-shore: the wind runs along the beach.",
  "cross-off": "Cross-offshore: a drift downwind takes you out, not in.",
  offshore: "Offshore wind: we don't recommend going out in it.",
};

const starWord = (n: number) => `${n} star${n === 1 ? "" : "s"}`;

/**
 * One hour, rated. Null when there is nothing to rate: no wind reading, or dark.
 *
 *   potential = round(windStars(mean))
 *   stars     = min(potential, round(min(windStars(mean), gustStars(gust))))
 *               − the shore's stars off, never below 0
 *
 * and none at all, potential too, for a gust past too much or a way of wind
 * the rider never rides (offshore, always). Each cost is a sentence in
 * `reasons` when it costs a star, because a rider should be able to argue
 * with the stars.
 */
export function rateHour(
  hour: HourInput,
  shore: SpotShore,
  rider: Rider,
): HourRating | null {
  if (hour.windKn === null || !hour.daylight) return null;
  const band = windBand(rider);
  const mean = hour.windKn;
  const wing = pickWing(rider, mean);
  const angle =
    shore.facing === null || hour.from === null
      ? null
      : shoreAngle(hour.from, shore.facing);
  const cost = angle ? directionCost(rider, angle) : 0;
  const none = (kind: SessionKind, reasons: string[]): HourRating => ({
    rideKn: mean,
    stars: 0,
    potential: 0,
    lost: { gusts: 0, shore: 0 },
    session: kind,
    shore: angle,
    wing,
    reasons,
  });

  // A way of wind the rider never rides: offshore always. No stars, not
  // even outlined ones: no wind makes it a session.
  if (angle && cost >= NEVER)
    return none(angle === "offshore" ? "offshore" : "never-shore", [
      SHORE_REASON[angle],
    ]);

  // A gust past too much: no stars, not even outlined ones.
  const kind = session(mean, band);
  if (gustsOverLimit(hour.gustKn, rider))
    return none(kind === "too-strong" ? kind : "too-gusty", [
      "Gusts over your limit",
    ]);

  const wind = windStars(mean, band);
  const potential = Math.round(wind);
  const gust = gustStars(hour.gustKn, band);
  if (gust < wind && Math.round(gust) === 0)
    return none(kind === "too-strong" ? kind : "too-gusty", [
      "Gusts over your limit",
    ]);
  const afterGust = clamp(Math.round(Math.min(wind, gust)), 0, potential);
  const stars = Math.max(0, afterGust - cost);
  const lost = { gusts: potential - afterGust, shore: afterGust - stars };

  const reasons: string[] = [];
  if (lost.gusts) reasons.push(`Gusts: ${starWord(lost.gusts)} off.`);
  if (angle && lost.shore) reasons.push(SHORE_REASON[angle]);

  return {
    rideKn: mean,
    stars,
    potential,
    lost,
    session: kind,
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
