// Sunrise, sunset and civil twilight from the NOAA solar-position equations
// (Meeus, low-precision form: a minute or better for Irish latitudes). No
// dependency, no network. Everything returned is UTC; format for display with
// formatLocal, which uses Europe/Dublin.
const DAY = 86400000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/** Apparent sunrise/sunset, including refraction and the solar disc radius. */
export const SUN_ZENITH = 90.833;
/** Civil twilight: the sun 6° below the horizon. */
export const CIVIL_ZENITH = 96;

const julianDay = (utcMillis: number) => utcMillis / DAY + 2440587.5;
const startOfUtcDay = (date: Date) =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

interface SolarPosition {
  declination: number;
  equationOfTime: number;
}
/** Sun declination (degrees) and equation of time (minutes) at a Julian day. */
function solarPosition(julian: number): SolarPosition {
  const t = (julian - 2451545) / 36525;
  const meanLong =
    (280.46646 + t * (36000.76983 + t * 0.0003032) + 360000) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnomaly)) * 0.000289;
  const trueLong = meanLong + centre;
  const apparentLong =
    trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
  const meanObliquity =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity =
    meanObliquity + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
  const declination = deg(
    Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLong))),
  );
  const y = Math.tan(rad(obliquity / 2)) ** 2;
  const equationOfTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccentricity * Math.sin(rad(meanAnomaly)) +
        4 *
          eccentricity *
          y *
          Math.sin(rad(meanAnomaly)) *
          Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * rad(meanAnomaly)),
    );
  return { declination, equationOfTime };
}

/** Hour angle at a zenith, or null when the sun never reaches it that day. */
function hourAngle(
  latitude: number,
  declination: number,
  zenith: number,
): number | null {
  const cosH =
    Math.cos(rad(zenith)) /
      (Math.cos(rad(latitude)) * Math.cos(rad(declination))) -
    Math.tan(rad(latitude)) * Math.tan(rad(declination));
  if (cosH > 1 || cosH < -1) return null;
  return deg(Math.acos(cosH));
}

export interface SunTimes {
  /** UTC calendar day the times belong to. */
  date: string;
  solarNoon: Date;
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  /** Set when the sun stays up or down all day; null at Irish latitudes. */
  polar: "day" | "night" | null;
}

/** Event times for the UTC day containing `date`, at the given position. */
export function sunTimes(
  latitude: number,
  longitude: number,
  date: Date,
): SunTimes {
  const dayStart = startOfUtcDay(date);
  // Evaluate the sun's position near local solar noon, which is where the
  // low-precision series is most accurate for both edges of the day.
  const julianNoon = julianDay(dayStart) + 0.5 - longitude / 360;
  const { declination, equationOfTime } = solarPosition(julianNoon);
  const noonMinutes = 720 - 4 * longitude - equationOfTime;
  const solarNoon = new Date(dayStart + noonMinutes * 60000);
  const at = (minutes: number) => new Date(dayStart + minutes * 60000);
  const sunAngle = hourAngle(latitude, declination, SUN_ZENITH);
  const civilAngle = hourAngle(latitude, declination, CIVIL_ZENITH);
  return {
    date: new Date(dayStart).toISOString().slice(0, 10),
    solarNoon,
    sunrise: sunAngle === null ? null : at(noonMinutes - 4 * sunAngle),
    sunset: sunAngle === null ? null : at(noonMinutes + 4 * sunAngle),
    civilDawn: civilAngle === null ? null : at(noonMinutes - 4 * civilAngle),
    civilDusk: civilAngle === null ? null : at(noonMinutes + 4 * civilAngle),
    polar:
      sunAngle !== null ? null : declination * latitude > 0 ? "day" : "night",
  };
}

export interface NightInterval {
  from: Date;
  to: Date;
}

/**
 * Night intervals covering [from, to] for chart shading, clipped to the range
 * and merged. `boundary: "civil"` shades only true darkness (after civil dusk).
 */
export function dayNights(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  options: { boundary?: "sun" | "civil" } = {},
): NightInterval[] {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) return [];
  const civil = options.boundary === "civil";
  const nights: NightInterval[] = [];
  for (let day = startOfUtcDay(from) - DAY; day <= end + DAY; day += DAY) {
    const today = sunTimes(latitude, longitude, new Date(day));
    const tomorrow = sunTimes(latitude, longitude, new Date(day + DAY));
    const dusk = civil ? today.civilDusk : today.sunset;
    const dawn = civil ? tomorrow.civilDawn : tomorrow.sunrise;
    if (!dusk || !dawn) {
      // Polar night: the whole day is dark, polar day contributes nothing.
      if (today.polar === "night")
        nights.push({ from: new Date(day), to: new Date(day + DAY) });
      continue;
    }
    const nightStart = Math.max(dusk.getTime(), start);
    const nightEnd = Math.min(dawn.getTime(), end);
    if (nightEnd > nightStart)
      nights.push({ from: new Date(nightStart), to: new Date(nightEnd) });
  }
  return nights.reduce<NightInterval[]>((merged, night) => {
    const last = merged[merged.length - 1];
    if (last && night.from.getTime() <= last.to.getTime()) {
      if (night.to > last.to) last.to = night.to;
      return merged;
    }
    merged.push(night);
    return merged;
  }, []);
}

/** Irish local time for a UTC instant; the site never shows raw UTC clocks. */
export function formatLocal(
  date: Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(date);
}
