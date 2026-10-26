/**
 * One hour's stars worked through line by line, for "How the stars work":
 * whose four numbers rate it, what the steady wind is worth on them, what the
 * gusts and the shore take off, down to the solid stars, or none at all for a
 * gust past too much or a wind the rider never rides. It restates rateHour's
 * arithmetic (force5/src/stars.ts) so every step can be shown with its
 * figures; ledger.test.ts holds the two to the same answer for every wind,
 * gust, shore and agreement, ours and a rider's own, so they cannot drift
 * apart unnoticed. The models' agreement is a line of its own, and takes
 * nothing off; so is the wing, which never moves a star.
 */
import {
  GUST_EASE_KN,
  NEVER,
  SHORE_LABEL,
  directionCost,
  gustStars,
  gustsOverLimit,
  rateHour,
  shoreAngle,
  windBand,
  windStars,
  type Agreement,
  type HourRating,
  type Rider,
  type WindBand,
} from "../../force5/src/stars";

export interface LedgerLine {
  what: string;
  /** The figure, as the page sets it: "−1", "4.6, so 5", "4 solid, 1 outlined". */
  figure: string;
  /** The running total after this line, where it moves. */
  total?: boolean;
}

export interface Ledger {
  lines: LedgerLine[];
  /** The stars the ledger comes to, which rateHour must agree with. */
  stars: number;
  potential: number;
  rating: HourRating;
}

export interface LedgerHour {
  windKn: number;
  gustKn: number | null;
  from: number;
  agreement: Agreement | null;
}

const minus = (value: number) => (value === 0 ? "none" : `−${value}`);
const one = (value: number) => value.toFixed(1);
const knots = (value: number) => String(Number(value.toFixed(1)));

/** "11 · 15–22 · 35 kn": the four numbers, as Customise's slider has them. */
export const fourNumbers = (band: WindBand) =>
  `${knots(band.min)} · ${knots(band.sweetLow)}–${knots(band.sweetHigh)} · ${knots(band.max)} kn`;

/** The stars an hour comes to, as the ledger's total says them. */
const totalText = (stars: number, potential: number) =>
  potential > stars
    ? `${stars} solid, ${potential - stars} outlined`
    : `${stars} solid`;

/** Null in the dark or without wind, as rateHour is. */
export function ledger(
  hour: LedgerHour,
  facing: number | null,
  rider: Rider,
): Ledger | null {
  const rating = rateHour({ ...hour, daylight: true }, { facing }, rider);
  if (!rating) return null;
  const band = windBand(rider);
  const { windKn, gustKn } = hour;
  const wing = {
    what: "Wing, which never moves a star",
    figure: `${rating.wing.own ?? rating.wing.recommended} m²`,
  };
  const lines: LedgerLine[] = [
    {
      what: rider.custom ? "Your own stars" : "Ours",
      figure: fourNumbers(band),
    },
  ];
  const none = (line: LedgerLine): Ledger => {
    lines.push(line, { what: "Rating", figure: "no stars", total: true }, wing);
    return { lines, stars: 0, potential: 0, rating };
  };

  const angle = facing === null ? null : shoreAngle(hour.from, facing);
  const cost = angle ? directionCost(rider, angle) : 0;
  const shoreLine = (figure: string): LedgerLine => {
    const off = Math.round(
      Math.abs(((((hour.from - facing!) % 360) + 540) % 360) - 180),
    );
    return {
      what: `Wind ${SHORE_LABEL[angle!]}, ${off}° from straight onshore`,
      figure,
    };
  };

  // A wind the rider never rides, offshore always: no stars, not even
  // outlined ones, whatever the wind.
  if (angle && cost >= NEVER) return none(shoreLine("never"));

  // A gust past too much: no stars, not even outlined ones.
  if (gustsOverLimit(gustKn, rider))
    return none({
      what: `Gusts to ${one(gustKn!)} kn, past too much (${knots(band.max)} kn)`,
      figure: "no stars",
    });

  const wind = windStars(windKn, band);
  const potential = Math.round(wind);
  lines.push({
    what: `Steady wind ${one(windKn)} kn`,
    figure: `${wind.toFixed(1)}, so ${potential}`,
  });

  const gust = gustStars(gustKn, band);
  // A gust so strong it leaves nothing, read lighter or not: no stars.
  if (gust < wind && Math.round(gust) === 0)
    return none({
      what: `Gusts to ${one(gustKn!)} kn: nothing left`,
      figure: "no stars",
    });
  const afterGust = Math.min(
    potential,
    Math.max(0, Math.round(Math.min(wind, gust))),
  );
  lines.push({
    what:
      gustKn === null
        ? "No gusts forecast"
        : `Gusts to ${one(gustKn)} kn, read ${GUST_EASE_KN} kn lighter: ${one(gustKn - GUST_EASE_KN)} kn`,
    figure: minus(potential - afterGust),
  });

  if (angle) lines.push(shoreLine(minus(cost)));
  else
    lines.push({
      what: "We don't know which way this beach faces",
      figure: "none",
    });

  // Context, not a cost: the stars are the one model's own.
  if (hour.agreement === "low")
    lines.push({
      what: "The models disagree: shown, never counted",
      figure: "none",
    });
  else if (hour.agreement === "moderate")
    lines.push({
      what: "The models differ a little: shown, never counted",
      figure: "none",
    });

  // Taken off in rateHour's order: the gusts, then the shore.
  const stars = Math.max(0, afterGust - cost);
  lines.push({
    what: "Rating",
    figure: totalText(stars, potential),
    total: true,
  });
  lines.push(wing);
  return { lines, stars, potential, rating };
}
