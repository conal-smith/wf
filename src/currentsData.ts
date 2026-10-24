// What the Currents layer draws at one hour, and the dock's Current row, read
// on demand: imported by useCurrents.ts only once the layer is on, and by
// useSpotCurrents.ts only once the dock's rows below the fold are open, so
// none of it is in the page a rider who just wants the wind loads. It reads the currents pointer (kept for
// five minutes, as the forecast manifests are), the tide curves of the
// stations the tidal stream sites are timed from, and the run's frames: the
// hour shown first, then the rest of the run behind it, outward from that
// hour a few at a time, and all of them kept, as the foilable-depth layer
// keeps its index and curves. A frame is some 16 kB on the wire, the run
// about 1.2 MB, so once it is in, moving through the hours reads nothing.
import {
  CURRENTS_URL,
  currentAt,
  currentsAtAxis,
  currentsFrameAt,
  currentsFrameUrl,
  modelArrows,
  nearestWetCell,
  streamFeatures,
  validateCurrentsFrame,
  validateCurrentsManifest,
  type CurrentFeature,
  type CurrentReading,
  type CurrentsFrame,
  type CurrentsManifest,
} from "../force5/src/currents";
import { readForecastJson } from "../force5/src/manifests";
import { loadSpotSquares, spotSquare } from "../force5/src/spotData";
import type { BundleFrame, VariableStep } from "../force5/src/variables";
import { TIDAL_STREAM_SITES } from "../force5/src/tidalStreams";
import { tideForStation, type TideCurve } from "../force5/src/tides";
import type { Units } from "../force5/src/units";
import { forecastUrl } from "../force5/src/urls";
import { tideManifest } from "./useBlend";

const MANIFEST_MS = 5 * 60000;
/** How many frames are read at once behind the hour shown. */
const PREFETCH = 4;

let pointer: { at: number; manifest: Promise<CurrentsManifest | null> } | null =
  null;
/** The frames of the run being shown, by url; another run starts afresh. */
let frames: { base: string; read: Map<string, Promise<CurrentsFrame>> } = {
  base: "",
  read: new Map(),
};
let prefetching = "";
let curves: Promise<Record<string, TideCurve>> | null = null;

async function json(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The pointer, or null when no current forecast is published (or readable). */
function currentsManifest(): Promise<CurrentsManifest | null> {
  if (pointer && Date.now() - pointer.at < MANIFEST_MS) return pointer.manifest;
  const manifest = json(forecastUrl(CURRENTS_URL))
    .then((m) => validateCurrentsManifest(m as CurrentsManifest))
    .catch(() => null);
  pointer = { at: Date.now(), manifest };
  return manifest;
}

function read(manifest: CurrentsManifest, info: BundleFrame) {
  if (frames.base !== manifest.base)
    frames = { base: manifest.base, read: new Map() };
  const url = currentsFrameUrl(manifest, info);
  let frame = frames.read.get(url);
  if (!frame) {
    const kept = frames;
    frame = json(url).then((f) =>
      validateCurrentsFrame(f as CurrentsFrame, manifest, info),
    );
    frame.catch(() => kept.read.delete(url));
    kept.read.set(url, frame);
  }
  return frame;
}

/** The rest of the run, nearest hours first, a few at a time, once a run. */
async function prefetch(manifest: CurrentsManifest, time: number) {
  if (prefetching === manifest.base) return;
  prefetching = manifest.base;
  const order = [...manifest.frames].sort(
    (a, b) =>
      Math.abs(Date.parse(a.validTime) - time) -
      Math.abs(Date.parse(b.validTime) - time),
  );
  for (let i = 0; i < order.length; i += PREFETCH) {
    if (frames.base && frames.base !== manifest.base) return;
    await Promise.allSettled(
      order.slice(i, i + PREFETCH).map((info) => read(manifest, info)),
    );
  }
}

/** The tidal stream sites' stations' curves, once a page; none if tides fail. */
function siteCurves(): Promise<Record<string, TideCurve>> {
  curves ??= (async () => {
    const manifest = await tideManifest();
    const out: Record<string, TideCurve> = {};
    for (const id of new Set(TIDAL_STREAM_SITES.map((site) => site.station))) {
      const tide = await tideForStation(manifest, id).catch(() => null);
      if (tide) out[id] = tide.curve;
    }
    return out;
  })().catch(() => {
    curves = null;
    return {};
  });
  return curves;
}

export interface CurrentsAt {
  features: CurrentFeature[];
  /** What is missing from the picture at this hour, said in the layers panel. */
  note: string | null;
}

export async function currentsAt(
  time: number,
  units: Units,
): Promise<CurrentsAt> {
  const [manifest, tides] = await Promise.all([
    currentsManifest(),
    siteCurves(),
  ]);
  const streams = streamFeatures(tides, time, units);
  if (!manifest)
    return {
      features: streams,
      note: "No current forecast is published just now.",
    };
  const info = currentsFrameAt(manifest, time);
  if (!info)
    return {
      features: streams,
      note: "The current forecast does not reach this hour.",
    };
  const frame = read(manifest, info);
  void frame.then(
    () => prefetch(manifest, time),
    () => undefined,
  );
  try {
    const arrows = modelArrows(await frame, manifest.grid, units);
    return { features: [...streams, ...arrows], note: null };
  } catch {
    return {
      features: streams,
      note: "This hour's current forecast could not be read.",
    };
  }
}

/* ---- the dock's row: one place's current, hour by hour ---- */

/** What the dock's Current row shows for one place. */
export interface CurrentRow {
  /** One reading per dock column; null where there is none. */
  columns: (CurrentReading | null)[];
  /** Said once, across the row, when there is nothing to show; else null. */
  note: string | null;
  /** The model the readings are from, for the cells' titles. */
  model: string | null;
}

const NOT_PUBLISHED = "No current forecast is published just now";
const NOT_THESE_HOURS = "The current forecast does not reach these hours";

const noted = (note: string): CurrentRow => ({
  columns: [],
  note,
  model: null,
});

/** The readings, or a note when not one column has any. */
const reached = (
  columns: (CurrentReading | null)[],
  manifest: CurrentsManifest,
): CurrentRow =>
  columns.some(Boolean)
    ? { columns, note: null, model: manifest.modelName }
    : noted(NOT_THESE_HOURS);

/**
 * A riding place's current, from the series the ingest publishes for it in
 * the run's spot squares (`spotSeries`: the nearest cell with water within
 * 5 km of the place, every hour), read as the waves and the weather are: the
 * one square holding the place, and nothing else.
 */
export async function spotCurrentRow(
  spot: { id: string; lat: number; lon: number },
  axis: readonly string[],
): Promise<CurrentRow> {
  const manifest = await currentsManifest();
  if (!manifest) return noted(NOT_PUBLISHED);
  let series: unknown;
  try {
    const data = await loadSpotSquares(
      readForecastJson,
      CURRENTS_URL,
      manifest,
      [spotSquare(spot.lat, spot.lon)],
    );
    series = (data.spotSeries as Record<string, unknown> | undefined)?.[
      spot.id
    ];
  } catch (error) {
    // The run may have been replaced since its pointer was read: the next
    // ask reads the pointer again.
    pointer = null;
    throw error;
  }
  const steps = Array.isArray(series) ? (series as VariableStep[]) : [];
  // A place with no water within reach of the model is published as nulls.
  if (!steps.some((step) => typeof step?.values?.u === "number"))
    return noted("No current model reaches this spot");
  return reached(currentsAtAxis(steps, axis), manifest);
}

/**
 * A tapped point's current: the nearest cell with water in the map's frames
 * (`nearestWetCell`), read from each hour's frame. The frames are the layer's
 * own, kept once read, so a point the layer has already drawn reads nothing
 * new; one the layer has not costs the run's frames, a few at a time.
 */
export async function pointCurrentRow(
  lat: number,
  lon: number,
  axis: readonly string[],
): Promise<CurrentRow> {
  const manifest = await currentsManifest();
  if (!manifest) return noted(NOT_PUBLISHED);
  const infos = axis.map((time) => currentsFrameAt(manifest, Date.parse(time)));
  const wanted = [
    ...new Map(
      infos.flatMap((info) => (info ? [[info.url, info] as const] : [])),
    ).values(),
  ];
  if (!wanted.length) return noted(NOT_THESE_HOURS);
  // The land is the same in every frame: the first says which cell is water.
  const cell = nearestWetCell(
    await read(manifest, wanted[0]),
    manifest.grid,
    lat,
    lon,
  );
  if (!cell) return noted("No current model reaches this point");
  const frames = new Map<string, CurrentsFrame | null>();
  for (let i = 0; i < wanted.length; i += PREFETCH)
    await Promise.all(
      wanted.slice(i, i + PREFETCH).map((info) =>
        read(manifest, info).then(
          (frame) => void frames.set(info.url, frame),
          () => void frames.set(info.url, null),
        ),
      ),
    );
  return reached(
    infos.map((info) => {
      const frame = info ? frames.get(info.url) : null;
      return frame ? currentAt(frame, cell.index) : null;
    }),
    manifest,
  );
}
