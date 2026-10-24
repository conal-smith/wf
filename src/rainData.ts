// What the Rain layer draws at one hour, read on demand: imported by
// src/useRain.ts only once the layer is on, so none of it is in the page a
// rider who just wants the wind loads. It reads ICON-EU weather's pointer
// (kept for five minutes, as the forecast manifests are) and the frames the
// hour shown needs, then the hours either side of it; every frame read is
// kept for the run, so going back through the hours reads nothing. A frame is
// some 10–25 KB on the wire, an hour's rain over the whole ICON-EU crop.
import {
  RAIN_URL,
  RAIN_VARIABLE,
  rainFrameUrl,
  rainFramesFor,
  rainIntervals,
  rainRates,
  validateRainFrame,
  type RainFrame,
  type RainView,
} from "../force5/src/rain";
import {
  validateWeatherManifest,
  type WeatherManifest,
} from "../force5/src/surface";
import type { BundleFrame } from "../force5/src/variables";
import { forecastUrl } from "../force5/src/urls";
import { clock, dayShort } from "./strip";

const MANIFEST_MS = 5 * 60000;
/** How many hours after the one shown are read behind it, and before it. */
const AHEAD = 3;
const BEHIND = 1;

let pointer: { at: number; manifest: Promise<WeatherManifest | null> } | null =
  null;
/** The frames of the run being shown, by url; another run starts afresh. */
let frames: { base: string; read: Map<string, Promise<RainFrame>> } = {
  base: "",
  read: new Map(),
};

async function json(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The pointer, when it publishes rain frames; null when none (or unreadable). */
function rainManifest(): Promise<WeatherManifest | null> {
  if (pointer && Date.now() - pointer.at < MANIFEST_MS) return pointer.manifest;
  const manifest = json(forecastUrl(RAIN_URL))
    .then((m) => validateWeatherManifest(m as WeatherManifest))
    .then((m) =>
      m.grid &&
      m.frames.length &&
      (m.frameVariables ?? Object.keys(m.variables)).includes(RAIN_VARIABLE)
        ? m
        : null,
    )
    .catch(() => null);
  pointer = { at: Date.now(), manifest };
  return manifest;
}

function read(manifest: WeatherManifest, info: BundleFrame) {
  if (frames.base !== manifest.base)
    frames = { base: manifest.base, read: new Map() };
  const url = rainFrameUrl(manifest.base, info);
  let frame = frames.read.get(url);
  if (!frame) {
    const kept = frames;
    frame = json(url).then((f) =>
      validateRainFrame(f as RainFrame, manifest, info),
    );
    frame.catch(() => kept.read.delete(url));
    kept.read.set(url, frame);
  }
  return frame;
}

/** The hours either side of the one shown, so a step through them is quick. */
function prefetch(manifest: WeatherManifest, shown: readonly BundleFrame[]) {
  const at = manifest.frames.indexOf(shown[shown.length - 1]);
  const first = manifest.frames.indexOf(shown[0]);
  if (at < 0 || first < 0) return;
  for (const info of [
    ...manifest.frames.slice(at + 1, at + 1 + AHEAD),
    ...manifest.frames.slice(Math.max(0, first - BEHIND), first),
  ])
    void read(manifest, info).catch(() => undefined);
}

const when = (time: number) => `${dayShort(time)} ${clock(time)}`;

export interface RainAt {
  /** What the map draws, or null where there is nothing to draw. */
  view: RainView | null;
  /** Why nothing is drawn, said in the map's information; null when it is. */
  note: string | null;
  /** The last hour the rain map reaches, once the run is known. */
  reach: number | null;
}

/**
 * The rain the map shows for a column at `to` whose hours start at `from`:
 * the mean mm/h of the steps inside it (one, for an hourly column).
 */
export async function rainAt(from: number, to: number): Promise<RainAt> {
  const manifest = await rainManifest();
  if (!manifest)
    return {
      view: null,
      note: "No rain forecast is published just now.",
      reach: null,
    };
  const intervals = rainIntervals(manifest.frames);
  const wet = intervals.filter(({ start, end }) => end > start);
  const reach = wet.length ? wet[wet.length - 1].end : null;
  const shown = rainFramesFor(manifest.frames, from, to);
  if (!shown.length)
    return {
      view: null,
      note:
        wet.length && to < wet[0].end
          ? `The rain map starts at ${when(wet[0].end)}.`
          : `The rain map reaches ${reach === null ? "no hour" : when(reach)}; not this hour.`,
      reach,
    };
  try {
    const read_ = await Promise.all(shown.map((info) => read(manifest, info)));
    prefetch(manifest, shown);
    const spans = rainIntervals(shown);
    return {
      view: {
        key: `${manifest.base}|${shown.map((info) => info.hour).join(",")}`,
        grid: manifest.grid!,
        rates: rainRates(read_),
        from: spans[0].start,
        to: spans[spans.length - 1].end,
      },
      note: null,
      reach,
    };
  } catch {
    return {
      view: null,
      note: "This hour's rain could not be read.",
      reach,
    };
  }
}
