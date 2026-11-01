/**
 * Finding a riding place by what a rider types: its name, any of its other
 * names, or the start of its county, with accents and case let go of. The
 * top bar's search (ui/SpotSearch.tsx) asks it on every page, so a name found
 * on one is found on all of them. Synchronous: there are about 150 places.
 */

/** As much of a riding place as finding it by name needs. */
export interface Findable {
  id: string;
  name: string;
  county?: string;
  aliases?: readonly string[];
}

/** Text as it is compared: no accents, lower case. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The places a query names, best first: a name that starts with it, then a
 * starred place, then by name. None for an empty query.
 */
export function findSpots<S extends Findable>(
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

/**
 * Where the query falls in a name, as [start, end) in the name's own
 * characters, accents and case let go of; null where it is not in it.
 */
export function matchIn(name: string, query: string): [number, number] | null {
  const q = fold(query.trim());
  if (!q) return null;
  // Fold one character at a time, so a position in the folded name maps
  // back to the character it came from.
  let folded = "";
  const from: number[] = [];
  Array.from(name).reduce((at, ch) => {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) from.push(at);
    folded += f;
    return at + ch.length;
  }, 0);
  const i = folded.indexOf(q);
  if (i < 0) return null;
  const end = i + q.length < from.length ? from[i + q.length] : name.length;
  return [from[i], end];
}
