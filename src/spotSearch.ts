/**
 * Finding a riding place by what a rider types: its name, any of its other
 * names, or the start of its county, with accents and case let go of. The
 * chart's "Find a spot…" (src/MapHead.tsx) and the spot finder's
 * (src/finder/SpotFinder.tsx) both ask it, so a name found on one is found
 * on the other.
 */
import type { Spot } from "../force5/src/weather";

/** Text as it is compared: no accents, lower case. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The places a query names, best first: a name that starts with it, then a
 * starred place, then by name. None for an empty query.
 */
export function findSpots<S extends Spot>(
  spots: readonly S[],
  query: string,
  starred: readonly string[],
): S[] {
  const q = fold(query.trim());
  if (!q) return [];
  return spots
    .filter(
      (s) =>
        fold(s.name).includes(q) ||
        fold(s.county ?? "").startsWith(q) ||
        (s.aliases ?? []).some((a) => fold(a).includes(q)),
    )
    .sort(
      (a, b) =>
        Number(fold(b.name).startsWith(q)) -
          Number(fold(a.name).startsWith(q)) ||
        Number(starred.includes(b.id)) - Number(starred.includes(a.id)) ||
        a.name.localeCompare(b.name),
    );
}
