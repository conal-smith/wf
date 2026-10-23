// What the Currents layer draws at one hour, read on demand: imported by
// useCurrents.ts only once the layer is on, so none of it is in the page a
// rider who just wants the wind loads. It reads the currents pointer (kept for
// five minutes, as the forecast manifests are), the tide curves of the
// stations the tidal stream sites are timed from, and the run's frames: the
// hour shown first, then the rest of the run behind it, outward from that
// hour a few at a time, and all of them kept, as the foilable-depth layer
// keeps its index and curves. A frame is some 16 kB on the wire, the run
// about 1.2 MB, so once it is in, moving through the hours reads nothing.
import {
  CURRENTS_URL,
  currentsFrameAt,
  currentsFrameUrl,
  modelArrows,
  streamFeatures,
  validateCurrentsFrame,
  validateCurrentsManifest,
  type CurrentFeature,
  type CurrentsFrame,
  type CurrentsManifest,
} from "../force5/src/currents";
import type { BundleFrame } from "../force5/src/variables";
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
