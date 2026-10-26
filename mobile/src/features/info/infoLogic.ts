/**
 * "How the stars work": the hours the rating was agreed on, and which hour of
 * the live forecast to work through. One
 * that lost a star to something, so there is something to show; else the
 * best; from the open spot first, then the rider's starred ones
 * (spot/web/StarsPage.tsx `pickHour`, over the app's one forecast).
 */
import type { Rider } from "../../../../force5/src/stars";
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import type { StripColumn } from "../../../../src/strip";
import { ledger, type Ledger, type LedgerHour } from "../../../../spot/web/ledger";

/**
 * The hours ours was agreed on (25 October 2026), [wind, gust] in knots, a
 * gust the same as the wind for a steady hour. Rated on ours, cross-shore:
 * 15g25 5, 20g25 5, 20g30 4 and one outlined, 25g30 4, a steady 30 one,
 * 22g35 one and four outlined, a steady 32 none, 10 kn none.
 */
export const AGREED_HOURS: readonly (readonly [number, number])[] = [
  [15, 25],
  [20, 25],
  [20, 30],
  [25, 30],
  [30, 30],
  [22, 35],
  [32, 32],
  [10, 10],
];

/** "15 gusting 25", or "30 steady". */
export const hourName = (wind: number, gust: number) =>
  gust > wind ? `${wind} gusting ${gust}` : `${wind} steady`;

export interface WorkedHour {
  place: Spot;
  time: number;
  hour: LedgerHour;
  result: Ledger;
}

/** How far ahead an example is taken from. */
const AHEAD_MS = 48 * 3600000;

export function workedHour(
  ids: readonly string[],
  hours: ReadonlyMap<string, readonly PlaceHour[]>,
  strip: readonly Pick<StripColumn, "time">[],
  rider: Rider,
  byId: (id: string) => Spot | undefined,
  now: number,
): WorkedHour | null {
  for (const id of new Set(ids)) {
    const place = byId(id);
    const row = hours.get(id);
    if (!place || !row) continue;
    const worked = row.flatMap((h, i): WorkedHour[] => {
      const time = strip[i]?.time;
      if (time === undefined || time + 3600000 <= now || time > now + AHEAD_MS) return [];
      if (!h.daylight || h.windKn === null || h.from === null) return [];
      const hour = { windKn: h.windKn, gustKn: h.gustKn, from: h.from, agreement: h.agreement };
      const result = ledger(hour, place.facing ?? null, rider);
      return result ? [{ place, time, hour, result }] : [];
    });
    const cut = worked.filter(({ result }) => result.stars > 0 && result.stars < result.potential);
    const pool = cut.length ? cut : worked;
    const best = pool.reduce<WorkedHour | null>(
      (top, x) => (!top || x.result.stars > top.result.stars ? x : top),
      null,
    );
    if (best) return best;
  }
  return null;
}
