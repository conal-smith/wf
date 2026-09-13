// Force5's provider-neutral forecast contract and sampling utilities.
export type Units = "kn" | "m/s";
export interface Grid {
  width: number;
  height: number;
  west: number;
  east: number;
  north: number;
  south: number;
  dx: number;
  dy: number;
}
export interface Wind {
  u: number;
  v: number;
  gust: number | null;
}
export interface FrameInfo {
  hour: number;
  validTime: string;
  url: string;
  gustIntervalHours: [number, number] | null;
}
export interface Frame extends WindArrays {
  model: string;
  run: string;
  hour: number;
  validTime: string;
  grid: Grid;
}
interface WindArrays {
  u: number[];
  v: number[];
  gust: number[] | null;
}
export interface Spot {
  id: string;
  name: string;
  county: string;
  lat: number;
  lon: number;
  note: string;
}
export interface Point {
  name: string;
  county?: string;
  lat: number;
  lon: number;
  id?: string;
  note?: string;
}
export interface Manifest {
  schemaVersion: number;
  model: string;
  modelName: string;
  provider: string;
  run: string;
  runTime: string;
  generatedAt: string;
  resolutionKm: number;
  stepHours: number;
  grid: Grid;
  frames: FrameInfo[];
  spotForecasts: Record<string, (Wind & { hour: number; validTime: string })[]>;
  sourceUrl: string;
  attribution: string;
  licenseUrl: string;
  gustAvailable?: boolean;
  gustDescription?: string;
  modelDetail?: string;
  processing?: string;
}
export const KNOTS = 1.94384449;
export const convert = (speed: number, units: Units) =>
  speed * (units === "kn" ? KNOTS : 1);
export const speed = (wind: Pick<Wind, "u" | "v">) =>
  Math.hypot(wind.u, wind.v);
export const direction = (u: number, v: number) =>
  ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
export const compass = (degrees: number) =>
  [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ][Math.round(degrees / 22.5) % 16];

export function sample(frame: Frame, lon: number, lat: number): Wind | null {
  const g = frame.grid;
  const x = (lon - g.west) / g.dx,
    y = (g.north - lat) / g.dy;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > g.width - 1 ||
    y > g.height - 1
  )
    return null;
  const x0 = Math.min(Math.floor(x), g.width - 2),
    y0 = Math.min(Math.floor(y), g.height - 2);
  const tx = x - x0,
    ty = y - y0,
    i = y0 * g.width + x0;
  const bilinear = (a: number[]) =>
    (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) +
    (a[i + g.width] * (1 - tx) + a[i + g.width + 1] * tx) * ty;
  return {
    u: bilinear(frame.u),
    v: bilinear(frame.v),
    gust: frame.gust === null ? null : bilinear(frame.gust),
  };
}

export const PALETTE: [number, [number, number, number]][] = [
  [0, [67, 105, 151]],
  [8, [65, 142, 166]],
  [14, [67, 174, 172]],
  [20, [114, 185, 151]],
  [26, [185, 201, 127]],
  [32, [220, 197, 113]],
  [40, [220, 155, 104]],
  [50, [190, 108, 111]],
  [65, [158, 107, 165]],
];
export function windColor(knots: number): [number, number, number] {
  const k = Math.max(0, Math.min(65, knots));
  let i = 1;
  while (i < PALETTE.length - 1 && k > PALETTE[i][0]) i++;
  const [a, ca] = PALETTE[i - 1],
    [b, cb] = PALETTE[i];
  return ca.map((v, c) =>
    Math.round(v + ((cb[c] - v) * (k - a)) / (b - a)),
  ) as [number, number, number];
}

export function validateGrid(g: Grid): void {
  if (
    !g ||
    !Number.isInteger(g.width) ||
    !Number.isInteger(g.height) ||
    g.width < 2 ||
    g.height < 2 ||
    g.width * g.height > 2_000_000 ||
    ![g.west, g.east, g.north, g.south, g.dx, g.dy].every(Number.isFinite) ||
    g.dx <= 0 ||
    g.dy <= 0 ||
    g.north > 85 ||
    g.south < -85 ||
    g.west < -180 ||
    g.east > 180 ||
    Math.abs(g.east - g.west - (g.width - 1) * g.dx) > 0.00001 ||
    Math.abs(g.north - g.south - (g.height - 1) * g.dy) > 0.00001
  )
    throw new Error("Invalid forecast grid. Refresh the weather snapshot.");
}
export function validateManifest(m: Manifest): Manifest {
  if (
    !m ||
    m.schemaVersion !== 1 ||
    !Array.isArray(m.frames) ||
    !m.frames.length ||
    !Number.isFinite(Date.parse(m.runTime))
  )
    throw new Error("Invalid forecast manifest. Run npm run weather:refresh.");
  validateGrid(m.grid);
  let previous = -1;
  for (const f of m.frames) {
    if (
      !Number.isFinite(f.hour) ||
      f.hour <= previous ||
      !Number.isFinite(Date.parse(f.validTime)) ||
      Date.parse(f.validTime) !== Date.parse(m.runTime) + f.hour * 3600000 ||
      typeof f.url !== "string" ||
      !f.url.startsWith("weather/") ||
      f.url.includes("..")
    )
      throw new Error("Forecast timeline is invalid.");
    if (m.gustAvailable === false) {
      if (f.gustIntervalHours !== null)
        throw new Error("Unavailable gusts must not declare an interval.");
    } else if (
      !Array.isArray(f.gustIntervalHours) ||
      f.gustIntervalHours.length !== 2 ||
      !f.gustIntervalHours.every(Number.isFinite) ||
      f.gustIntervalHours[0] < 0 ||
      f.gustIntervalHours[0] > f.gustIntervalHours[1] ||
      f.gustIntervalHours[1] !== f.hour
    ) {
      throw new Error("Invalid gust forecast interval.");
    }
    previous = f.hour;
  }
  return m;
}
export function validateFrame(
  f: Frame,
  manifest: Manifest,
  info: FrameInfo,
): Frame {
  if (
    !f ||
    f.run !== manifest.run ||
    f.model !== manifest.model ||
    f.hour !== info.hour ||
    f.validTime !== info.validTime
  )
    throw new Error(
      "Forecast file does not match the selected model run. Refresh the page.",
    );
  validateGrid(f.grid);
  for (const key of [
    "width",
    "height",
    "west",
    "east",
    "north",
    "south",
    "dx",
    "dy",
  ] as const) {
    if (f.grid[key] !== manifest.grid[key])
      throw new Error("Forecast grids do not match.");
  }
  for (const field of ["u", "v", "gust"] as const) {
    if (field === "gust" && manifest.gustAvailable === false) {
      if (f.gust !== null)
        throw new Error("Unavailable gust data must be null.");
      continue;
    }
    if (
      !Array.isArray(f[field]) ||
      f[field].length !== f.grid.width * f.grid.height ||
      !f[field].every(
        (v) =>
          Number.isFinite(v) &&
          Math.abs(v) <= 150 &&
          (field !== "gust" || v >= 0),
      )
    )
      throw new Error(`Invalid ${field} wind data.`);
  }
  return f;
}

const cache = new Map<string, Frame>();
const pending = new Map<string, Promise<Frame>>();
export function loadFrame(manifest: Manifest, index: number): Promise<Frame> {
  const info = manifest.frames[index],
    url = `${import.meta.env.BASE_URL}${info.url}`;
  const found = cache.get(url);
  if (found) {
    cache.delete(url);
    cache.set(url, found);
    return Promise.resolve(validateFrame(found, manifest, info));
  }
  const inflight = pending.get(url);
  if (inflight)
    return inflight.then((frame) => validateFrame(frame, manifest, info));
  const request = fetch(url, { signal: AbortSignal.timeout(20000) })
    .then(async (r) => {
      if (!r.ok)
        throw new Error("This forecast frame could not be loaded. Try again.");
      const frame = validateFrame(await r.json(), manifest, info);
      cache.set(url, frame);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
      return frame;
    })
    .finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}
export function nearestFrame(frames: FrameInfo[], now = Date.now()): number {
  return frames.reduce(
    (best, f, i) =>
      Math.abs(Date.parse(f.validTime) - now) <
      Math.abs(Date.parse(frames[best].validTime) - now)
        ? i
        : best,
    0,
  );
}
export function freshness(
  m: Manifest,
  now = Date.now(),
): "expired" | "stale" | "fresh" {
  if (Date.parse(m.frames[m.frames.length - 1].validTime) < now)
    return "expired";
  if (now - Date.parse(m.runTime) > 18 * 3600000) return "stale";
  return "fresh";
}
export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IE", {
    timeZone: "Europe/Dublin",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
