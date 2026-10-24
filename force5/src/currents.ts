// Surface currents: the Marine Institute's NE Atlantic ROMS model, as
// force5/ingest/fetch_currents.py publishes it (weather/currents.json), and the
// tidal stream curves of the channels it cannot resolve (tidalStreams.ts),
// turned into what the map's Currents layer draws for one hour.
//
// Nothing here is read until a rider turns the layer on: src/useCurrents.ts
// imports this module on demand, so the default page never fetches it, and
// it then reads the pointer and the one frame of the hour shown.
import { compass } from "./weather";
import { forecastUrl } from "./urls";
import { runPath } from "./spotData";
import {
  validateVariablesManifest,
  type BundleFrame,
  type VariableStep,
  type VariablesManifest,
} from "./variables";
import {
  TIDAL_STREAM_SITES,
  tidalStreamAt,
  type TidalStreamAt,
  type TidalStreamSite,
} from "./tidalStreams";
import { KNOTS, type Units } from "./units";
import type { Grid } from "./weather";
import {
  MIN_ARROW_MS,
  currentText,
  type CurrentReading,
} from "./currentReading";

export { MIN_ARROW_MS, currentText, type CurrentReading };

export const CURRENTS_URL = "weather/currents.json";
/** A frame further than this from the hour shown is not that hour's current. */
export const CURRENTS_MATCH_MS = 30 * 60000;
/** The credit and caveat the layer is shown with, wherever it is shown. */
export const CURRENTS_CREDIT =
  "Currents: the Marine Institute's NE Atlantic ROMS model (CC BY 4.0), and tidal stream curves from published pilotage guides";
export const CURRENTS_CAVEAT =
  "A rough guide, not for safety: the model cannot see a narrow channel, where the stream runs much faster than it says.";

export interface CurrentsManifest extends VariablesManifest {
  kind: "current";
  grid: Grid;
  caveat?: string;
  frameStride?: number;
}

export interface CurrentsFrame {
  model: string;
  run: string;
  hour: number;
  validTime: string;
  grid: Grid;
  u: (number | null)[];
  v: (number | null)[];
}

export const validateCurrentsManifest = (
  m: CurrentsManifest,
): CurrentsManifest => {
  validateVariablesManifest<CurrentsManifest>("current")(m);
  if (
    !m.grid ||
    !m.frames.length ||
    !("u" in m.variables) ||
    !("v" in m.variables)
  )
    throw new Error(
      "Invalid current forecast manifest. Refresh the current forecast.",
    );
  return m;
};

/** The frame published nearest `time`, or null when none is within half an hour. */
export function currentsFrameAt(
  manifest: Pick<CurrentsManifest, "frames">,
  time: number,
): BundleFrame | null {
  let best: BundleFrame | null = null;
  let gap = Infinity;
  for (const frame of manifest.frames) {
    const distance = Math.abs(Date.parse(frame.validTime) - time);
    if (distance < gap) {
      gap = distance;
      best = frame;
    }
  }
  return best && gap <= CURRENTS_MATCH_MS ? best : null;
}

/** A frame's URL, beside its pointer. */
export const currentsFrameUrl = (
  manifest: Pick<CurrentsManifest, "base">,
  frame: BundleFrame,
) => forecastUrl(runPath(CURRENTS_URL, manifest.base, frame.url));

export function validateCurrentsFrame(
  frame: CurrentsFrame,
  manifest: CurrentsManifest,
  info: BundleFrame,
): CurrentsFrame {
  const count = manifest.grid.width * manifest.grid.height;
  const usable = (value: unknown) =>
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 10);
  if (
    !frame ||
    frame.run !== manifest.run ||
    frame.hour !== info.hour ||
    !Array.isArray(frame.u) ||
    !Array.isArray(frame.v) ||
    frame.u.length !== count ||
    frame.v.length !== count ||
    !frame.u.every(usable) ||
    !frame.v.every(usable)
  )
    throw new Error(
      "Invalid current forecast frame. Refresh the current forecast.",
    );
  return frame;
}

/** The bearing water moving with (u, v) runs towards, degrees true. */
export const towards = (u: number, v: number) =>
  ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

/** One arrow on the map: GeoJSON point features, so one layer draws them all. */
export interface CurrentFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    /** "model", or a tidal stream site's "flood", "ebb" or "slack". */
    kind: "model" | "flood" | "ebb" | "slack";
    /** Where the water runs to, degrees true (MapLibre rotates the icon by it). */
    towards: number;
    /** Metres per second, for the arrow's size. */
    speed: number;
    /** The figure printed by it, in the rider's units. */
    label: string;
    /** Draw order: the channels first, then the strongest arrows. */
    rank: number;
  };
}

/** Every wet cell of a frame faster than MIN_ARROW_MS, as features. */
export function modelArrows(
  frame: Pick<CurrentsFrame, "u" | "v">,
  grid: Grid,
  units: Units,
): CurrentFeature[] {
  const out: CurrentFeature[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const u = frame.u[i];
      const v = frame.v[i];
      if (u === null || v === null) continue;
      const speed = Math.hypot(u, v);
      if (speed < MIN_ARROW_MS) continue;
      out.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            +(grid.west + x * grid.dx).toFixed(5),
            +(grid.north - y * grid.dy).toFixed(5),
          ],
        },
        properties: {
          kind: "model",
          towards: Math.round(towards(u, v)),
          speed: +speed.toFixed(2),
          label: currentText(speed, units),
          rank: -speed,
        },
      });
    }
  return out;
}

/** A tidal stream site's stream at the hour, as the map draws it. */
export function streamFeature(
  site: TidalStreamSite,
  at: TidalStreamAt,
  units: Units,
): CurrentFeature {
  const speed = at.knots / KNOTS;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [site.lon, site.lat] },
    properties: {
      kind: at.slack ? "slack" : at.stream,
      towards: at.towards,
      speed: +speed.toFixed(2),
      label: at.slack
        ? "slack"
        : `${at.stream === "flood" ? "Flood" : "Ebb"} ${currentText(speed, units)}`,
      rank: -1000,
    },
  };
}

/** The tidal stream sites' features at `time`, from their stations' curves. */
export function streamFeatures(
  curves: Readonly<
    Record<
      string,
      { events: { time: string; kind: "high" | "low"; height: number }[] }
    >
  >,
  time: number,
  units: Units,
  sites: readonly TidalStreamSite[] = TIDAL_STREAM_SITES,
): CurrentFeature[] {
  const out: CurrentFeature[] = [];
  for (const site of sites) {
    const curve = curves[site.station];
    const at = curve ? tidalStreamAt(site, curve, time) : null;
    if (at) out.push(streamFeature(site, at, units));
  }
  return out;
}

/** "Flood 4.2 kn towards NNW" as a screen reader hears a site's stream. */
export const streamLine = (at: TidalStreamAt, units: Units) =>
  at.slack
    ? "Slack water"
    : `${at.stream === "flood" ? "Flood" : "Ebb"} ${currentText(at.knots / KNOTS, units)} towards ${compass(at.towards)}`;

/* ---- the dock's row: one place's current, hour by hour ---- */

/**
 * How far from a tapped point the dock will read the water of a frame's cell:
 * the ingest's own reach for a spot's cell (SEARCH_KM in
 * force5/ingest/fetch_currents.py). Where the frame's cells stand further
 * apart than that, as they do (every fourth of the model's, about 3.3 km by
 * 5.6 km), the reach is one cell's diagonal instead, so a point by the shore
 * whose own cell is land reads the water one cell on.
 */
export const CURRENT_POINT_KM = 5;
const KM_PER_DEGREE = 111.195;

/** A frame's cell with water in it, and how far it is from the point asked about. */
export interface CurrentCell {
  /** Its index in the frame's u and v: rows north to south, west to east. */
  index: number;
  lat: number;
  lon: number;
  km: number;
}

/**
 * The cell with water nearest a point, indexed as `modelArrows` reads the
 * frame, or null when none is within reach (`CURRENT_POINT_KM`): off the
 * grid, or inland of the model's coast. Land is null in a frame, never zero.
 */
export function nearestWetCell(
  frame: Pick<CurrentsFrame, "u" | "v">,
  grid: Grid,
  lat: number,
  lon: number,
): CurrentCell | null {
  const kmX = grid.dx * KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const kmY = grid.dy * KM_PER_DEGREE;
  if (!(kmX > 0 && kmY > 0)) return null;
  const reach = Math.max(CURRENT_POINT_KM, Math.hypot(kmX, kmY));
  const fx = (lon - grid.west) / grid.dx;
  const fy = (grid.north - lat) / grid.dy;
  const x0 = Math.max(0, Math.floor(fx - reach / kmX));
  const x1 = Math.min(grid.width - 1, Math.ceil(fx + reach / kmX));
  const y0 = Math.max(0, Math.floor(fy - reach / kmY));
  const y1 = Math.min(grid.height - 1, Math.ceil(fy + reach / kmY));
  let best: CurrentCell | null = null;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const index = y * grid.width + x;
      if (frame.u[index] == null || frame.v[index] == null) continue;
      const km = Math.hypot((x - fx) * kmX, (y - fy) * kmY);
      // A hair over the reach: a cell exactly one diagonal off is in it.
      if (km <= reach + 1e-6 && (!best || km < best.km))
        best = {
          index,
          lat: grid.north - y * grid.dy,
          lon: grid.west + x * grid.dx,
          km,
        };
    }
  return best;
}

/** The current in one cell of a frame, or null where the frame has none. */
export function currentAt(
  frame: Pick<CurrentsFrame, "u" | "v">,
  index: number,
): CurrentReading | null {
  const u = frame.u[index];
  const v = frame.v[index];
  if (u == null || v == null) return null;
  return { speed: Math.hypot(u, v), towards: towards(u, v) };
}

const usableComponent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10;

/**
 * A spot's published series (`spotSeries`) on the dock's columns: for each,
 * the step nearest it, if one is within `CURRENTS_MATCH_MS`, as a reading.
 * Past the run's end, before its start, and at a step with no water, null.
 */
export function currentsAtAxis(
  series: readonly Pick<VariableStep, "validTime" | "values">[],
  axis: readonly string[],
): (CurrentReading | null)[] {
  const steps = series
    .map((step) => ({ time: Date.parse(step.validTime), step }))
    .filter(({ time }) => Number.isFinite(time));
  return axis.map((validTime) => {
    const time = Date.parse(validTime);
    let near: (typeof steps)[number] | null = null;
    for (const step of steps)
      if (!near || Math.abs(step.time - time) < Math.abs(near.time - time))
        near = step;
    if (!near || Math.abs(near.time - time) > CURRENTS_MATCH_MS) return null;
    const { u, v } = near.step.values;
    return usableComponent(u) && usableComponent(v)
      ? { speed: Math.hypot(u, v), towards: towards(u, v) }
      : null;
  });
}
