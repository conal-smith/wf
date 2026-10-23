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
  type VariablesManifest,
} from "./variables";
import {
  TIDAL_STREAM_SITES,
  tidalStreamAt,
  type TidalStreamAt,
  type TidalStreamSite,
} from "./tidalStreams";
import { KNOTS, convert, unitLabel, type Units } from "./units";
import type { Grid } from "./weather";

export const CURRENTS_URL = "weather/currents.json";
/** A frame further than this from the hour shown is not that hour's current. */
export const CURRENTS_MATCH_MS = 30 * 60000;
/** Slower than this (about 0.1 kn) and an arrow says nothing worth drawing. */
export const MIN_ARROW_MS = 0.05;
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

/** A speed held in m/s, in the rider's units, to a tenth: currents are slow. */
export const currentText = (metresPerSecond: number, units: Units) =>
  `${convert(metresPerSecond, units).toFixed(1)} ${unitLabel(units)}`;

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
