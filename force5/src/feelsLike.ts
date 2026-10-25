// How cold the air feels in the wind, from what the forecast publishes: the
// air temperature at 2 m and the mean wind at 10 m. No model publishes a
// feels-like figure, so it is worked out here, once, for the forecast server
// and for the site when it wants one. Dependency-free.
//
// The formula is the wind chill index of the Joint Action Group for
// Temperature Indices (JAG/TI, 2001), the one Environment Canada, the US
// National Weather Service and the UK Met Office use:
//
//   WCI = 13.12 + 0.6215 T − 11.37 V^0.16 + 0.3965 T V^0.16
//
// T the air in °C, V the mean wind at the standard 10 m height in km/h (the
// formula brings it down to face height itself). The mean, not the gust: the
// index is a steady wind's cooling, and a gust is seconds of it.
//
// It was designed for 10 °C and below. Above that it is used as it stands,
// never warmer than the air, where its cooling fades: about 2 °C off at
// 15 °C in 20 knots, and nothing from about 20–22 °C. A rider in Irish water is cold
// at 12 °C in 20 knots, and the alternatives jump at the seam: Steadman's
// apparent temperature reads some 4 °C colder than the wind chill at 10 °C
// in 20 knots, so switching formula there would make an hour at 10 °C feel
// warmer than one at 11 °C. Below 4.8 km/h (about 3 knots) the index does
// not apply and the air temperature stands.
//
// It is for dry skin out of the sun. A wet rider loses heat far faster, which
// no index here measures.

/** Knots in a kilometre an hour. */
const KMH_PER_KNOT = 1.852;

/** The wind below which the index does not apply, in km/h (3 mph). */
export const WIND_CHILL_MIN_KMH = 4.8;

/** The top of the index's design range, in °C: used above it, capped at the air. */
export const WIND_CHILL_DESIGN_MAX_C = 10;

/** The JAG/TI wind chill index, in °C, for an air temperature and a 10 m wind in km/h. */
export function windChillIndex(airC: number, windKmh: number): number {
  const v = windKmh ** 0.16;
  return 13.12 + 0.6215 * airC - 11.37 * v + 0.3965 * airC * v;
}

/**
 * How cold it feels, in °C to the tenth, from the air temperature and the
 * mean wind at 10 m in knots: the wind chill index, never above the air
 * temperature, and the air itself in light wind. Null without both.
 */
export function feelsLikeC(
  airC: number | null | undefined,
  windKn: number | null | undefined,
): number | null {
  if (typeof airC !== "number" || !Number.isFinite(airC)) return null;
  if (typeof windKn !== "number" || !Number.isFinite(windKn)) return null;
  const kmh = windKn * KMH_PER_KNOT;
  const felt =
    kmh < WIND_CHILL_MIN_KMH ? airC : Math.min(airC, windChillIndex(airC, kmh));
  return Math.round(felt * 10) / 10;
}
