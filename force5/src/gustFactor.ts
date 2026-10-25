// The gust factor: an hour's gust over its mean wind. How much harder the
// strongest gust hits than the steady wind that holds a rider on the foil; the
// stars judge gusty wind by it (./stars `gustiness`: gusty from 1.5, very
// gusty from 1.8). Its own module so the forecast server and the map's data
// bar read the one definition. Dependency-free.

/**
 * Gust ÷ mean wind, both in the same units, or null without a gust or with no
 * wind to divide by. Not rounded: a reader rounds it for display.
 */
export function gustFactor(
  windKn: number | null | undefined,
  gustKn: number | null | undefined,
): number | null {
  if (typeof windKn !== "number" || typeof gustKn !== "number") return null;
  if (!Number.isFinite(windKn) || !Number.isFinite(gustKn) || windKn <= 0)
    return null;
  return gustKn / windKn;
}
