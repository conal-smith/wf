/**
 * One hour's stars worked through line by line, for "How the stars work": the
 * rideable wind, what it is worth on its own, and each thing the spot and the
 * wind take off, down to the solid stars. It restates rateHour's
 * arithmetic (force5/src/stars.ts) so every step can be shown with its
 * figures; ledger.test.ts holds the two to the same answer for every level,
 * shore, gust and agreement, so they cannot drift apart unnoticed. The
 * models' agreement is a line of its own, and takes nothing off.
 */
import {
  SHORE_LABEL,
  SKILL_LABEL,
  directionCost,
  gustCurve,
  gustLoss,
  rateHour,
  rideableWind,
  shoreAngle,
  windBand,
  windScore,
  type Agreement,
  type HourRating,
  type Rider,
} from "../../force5/src/stars";

export interface LedgerLine {
  what: string;
  /** The figure, as the page sets it: "−1.5", "4.06 → 4★ faded". */
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

const minus = (value: number) =>
  value === 0 ? "none" : `−${Number(value.toFixed(2))}`;
const one = (value: number) => value.toFixed(1);

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
  const lines: LedgerLine[] = [];

  if (rider.custom)
    lines.push({
      what: `Your own star rating, started from ${SKILL_LABEL[rider.custom.base]}`,
      figure: "custom",
    });

  const ride = rideableWind(windKn, gustKn, rider);
  if (gustKn !== null && gustKn > windKn) {
    lines.push({
      what: `${one(windKn)} kn gusting ${one(gustKn)} is rated as`,
      figure: `${one(ride)} kn`,
    });
  } else
    lines.push({
      what: `${one(windKn)} kn with no gusts is rated as`,
      figure: `${one(ride)} kn`,
    });

  const base = windScore(ride, band);
  const potential = Math.round(base);
  lines.push({
    what: "Stars for that wind",
    figure: `${base.toFixed(1)}, so ${potential} outlined`,
  });

  const curve = gustCurve(rider);
  const gusts = gustLoss(gustKn, curve);
  const fine = Math.round(curve.fine);
  lines.push({
    what:
      gustKn === null
        ? "No gusts forecast"
        : gustKn <= curve.fine
          ? `Gusts to ${one(gustKn)} kn, no more than the ${fine} kn that costs nothing`
          : `Gusts to ${one(gustKn)} kn, past the ${fine} kn that costs nothing`,
    figure: minus(gusts),
  });

  const angle = facing === null ? null : shoreAngle(hour.from, facing);
  const direction = angle ? directionCost(rider, angle) : 0;
  if (angle) {
    const off = Math.round(
      Math.abs(((((hour.from - facing!) % 360) + 540) % 360) - 180),
    );
    lines.push({
      what: `Wind ${SHORE_LABEL[angle].toLowerCase()}, ${off}° from straight onshore`,
      figure: minus(direction),
    });
  } else
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

  const quiver = rating.wing.fit === "fits" ? 0 : 1;
  if (quiver)
    lines.push({
      what: `None of your wings suits it: about ${rating.wing.recommended} m² would`,
      figure: "−1",
    });

  // Taken off in rateHour's order, so the two round alike.
  const score = base - direction - gusts - quiver;
  const stars = Math.min(potential, Math.max(0, Math.round(score)));
  lines.push({
    what: "Rating",
    figure: `${Math.max(0, score).toFixed(1)}, so ${stars} solid`,
    total: true,
  });
  lines.push({
    what: "Wing",
    figure: `${rating.wing.own ?? rating.wing.recommended} m²`,
  });
  return { lines, stars, potential, rating };
}
