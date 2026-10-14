/**
 * One hour's stars worked through line by line, for "How the stars work": the
 * rideable wind, what it is worth on its own, and each thing the spot and the
 * forecast take off, down to the solid stars. It restates rateHour's
 * arithmetic (force5/src/stars.ts) so every step can be shown with its
 * figures; ledger.test.ts holds the two to the same answer for every level,
 * shore, gust and agreement, so they cannot drift apart unnoticed.
 */
import {
  SHORE_LABEL,
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
const atMost = (cap: number) => (cap ? `${cap} star at most` : "no stars");
/** 1.62 → "62%". */
const over = (factor: number) => `${Math.round((factor - 1) * 100)}%`;
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
  const beginner = rider.skill === "beginner";
  const { windKn, gustKn } = hour;
  const lines: LedgerLine[] = [];

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

  let score = base;
  let cap = 5;
  const angle = facing === null ? null : shoreAngle(hour.from, facing);
  if (angle) {
    const off = Math.round(
      Math.abs(((((hour.from - facing!) % 360) + 540) % 360) - 180),
    );
    const what = `Wind ${SHORE_LABEL[angle].toLowerCase()}, ${off}° from straight onshore`;
    let cost = 0;
    if (angle === "offshore") cap = beginner ? 0 : 1;
    else if (angle === "cross-off")
      cost = beginner ? 3 : rider.skill === "advanced" ? 1 : 1.5;
    else if (angle === "onshore") cost = 1;
    else if (angle === "cross" && beginner) cost = 0.5;
    score -= cost;
    lines.push({
      what,
      figure: angle === "offshore" ? atMost(cap) : minus(cost),
    });
  } else
    lines.push({
      what: "We don't know which way this beach faces",
      figure: "none",
    });

  if (gustKn !== null && windKn > 0) {
    const factor = gustKn / windKn;
    if (gustKn > band.max) {
      score -= 1;
      lines.push({
        what: `Gusts over your ${Math.round(band.max)} kn maximum`,
        figure: "−1",
      });
    } else if (beginner) {
      const penalty =
        factor > 1.7 ? 1.5 : factor > 1.5 ? 1 : factor > 1.35 ? 0.5 : 0;
      if (penalty) {
        score -= penalty * 1.5;
        lines.push({
          what: `Gusty for a learner: gusts ${over(factor)} over the average`,
          figure: minus(penalty * 1.5),
        });
      }
    } else if (factor > 1.7 && windKn >= band.sweetLow) {
      score -= 0.5;
      lines.push({
        what: `Gusty when already powered: gusts ${over(factor)} over the average`,
        figure: "−0.5",
      });
    }
  }

  if (hour.agreement === "low") {
    score -= 1;
    lines.push({ what: "The forecast models disagree", figure: "−1" });
  } else if (hour.agreement === "moderate") {
    score -= 0.25;
    lines.push({ what: "The models differ a little", figure: "−0.25" });
  }

  if (rating.wing.fit !== "fits") {
    score -= 1;
    lines.push({
      what: `None of your wings suits it: about ${rating.wing.recommended} m² would`,
      figure: "−1",
    });
  }

  const stars = Math.min(
    potential,
    Math.max(0, Math.round(Math.min(score, cap))),
  );
  lines.push({
    what: "Rating",
    figure: `${Math.max(0, score).toFixed(1)}${cap < 5 ? `, ${atMost(cap)}` : ""}, so ${stars} solid`,
    total: true,
  });
  lines.push({
    what: "Wing",
    figure: `${rating.wing.own ?? rating.wing.recommended} m²`,
  });
  return { lines, stars, potential, rating };
}
