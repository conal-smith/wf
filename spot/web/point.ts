/**
 * A point on the open water as a page, /spot/@<lat>,<lon>: a tap on the chart
 * that is not a riding place, given the spot report (report/SpotReport.tsx)
 * in place of the chart's dock it once lived in.
 *
 * The published bundles carry a series per riding place, never one per
 * point, so a point's forecast is put together the way the dock put it
 * together. The wind is the point's own, read out of the map's frames at it:
 * the one native tile that holds it, each hour, from the rider's model and
 * past its run from the model after it (force5/src/lead.ts), as a riding
 * place's wind is. The waves, the weather, the sea and the tide are the
 * nearest riding place's, within `POINT_SOURCE_KM` (force5/src/pointSource.ts),
 * and the page says whose. A point has no shore, so it has no facing, and no
 * stars.
 */
import {
  DEFAULT_STARS_FROM,
  leadModels,
  type StarsFrom,
} from "../../force5/src/lead";
import { loadManifest } from "../../force5/src/manifests";
import { POINT_SOURCE_KM } from "../../force5/src/pointSource";
import { pointId, pointName } from "../../force5/src/siteNav";
import { samplePoint } from "../../force5/src/tiledField";
import type { FrameInfo, Manifest, Wind } from "../../force5/src/weather";
import {
  distanceKm,
  hourWind,
  spotForecast,
  type ForecastHour,
  type NearbySpot,
  type RidingSpot,
  type SpotForecast,
  type SpotWindLines,
  type Window,
} from "../../mcp/api/forecast";
import type { ForecastSource } from "../../mcp/api/httpSource";
import { dublinDate, dublinMidnight } from "./spot";

/** How many of the riding places nearest a point its page lists. */
export const POINT_NEARBY = 6;

/** A point on the water, and the riding places around it. */
export interface PointPlace {
  /** The point as a place: its id the address's, its name its coordinates. */
  spot: RidingSpot;
  /** The riding places nearest it, nearest first, the first however far. */
  nearby: NearbySpot[];
  /** The one lending it its waves, weather, sea and tide; null past the limit. */
  lender: RidingSpot | null;
}

/**
 * The point at `lat`, `lon` among the riding places `spots`: its own place
 * (in the nearest place's county, which is what a reader would call the
 * water), the places nearest it, and the one within `maxKm` it borrows from.
 * The point's id is written as its address writes it (`pointId`), so the page
 * never shows a point other than the one asked for.
 */
export function pointPlace(
  spots: readonly RidingSpot[],
  lat: number,
  lon: number,
  maxKm = POINT_SOURCE_KM,
): PointPlace {
  const here = { lat, lon };
  const near = spots
    .map((spot) => ({ spot, km: distanceKm(here, spot) }))
    .sort((a, b) => a.km - b.km || a.spot.id.localeCompare(b.spot.id));
  const nearest = near[0] ?? null;
  return {
    spot: {
      id: pointId(lat, lon),
      name: pointName(lat, lon),
      county: nearest?.spot.county ?? "",
      lat,
      lon,
    },
    // The nearest always, however far, so the page can name it; the rest
    // only within the limit, where they are the same water.
    nearby: near
      .filter((n, i) => i === 0 || n.km <= maxKm)
      .slice(0, POINT_NEARBY)
      .map((n) => ({
        id: n.spot.id,
        name: n.spot.name,
        distance_km: Math.round(n.km * 10) / 10,
      })),
    lender: nearest && nearest.km <= maxKm ? nearest.spot : null,
  };
}

/**
 * Which of a run's frames the point's page reads: those from a step before
 * `from` to a step after `to`, so every hour between has a frame either side
 * to be read between. A run that only follows another (ECMWF past HARMONIE)
 * passes `after`, the time the run before it ends: its frames before that
 * are never shown, and a bare point pays a file for each frame it reads.
 */
export function framesToRead(
  frames: readonly Pick<FrameInfo, "validTime">[],
  from: number,
  to: number,
  after = -Infinity,
): number[] {
  const times = frames.map((frame) => Date.parse(frame.validTime));
  const first = Math.max(from, after);
  // The frames either side of the stretch, so its ends can be read between.
  let start = 0;
  times.forEach((t, i) => {
    if (t <= first) start = i;
  });
  const past = times.findIndex((t) => t >= to);
  const end = past === -1 ? times.length - 1 : past;
  return times.flatMap((t, i) =>
    i >= start && i <= end && Number.isFinite(t) ? [i] : [],
  );
}

/** One run's wind at the point, as its frames read there. */
export interface PointRun {
  model: string;
  name: string;
  runTime: string;
  samples: { time: number; wind: Wind | null }[];
}

/**
 * The runs' readings as the lines mcp/api/forecast.ts reads a riding place's
 * series into, so an hour at a point is worked out by the very rule a riding
 * place's is (`hourWind`): the same model first, the same hand-over, the same
 * reading between two frames. A run with no reading at all is left out.
 */
export function pointLines(runs: readonly PointRun[]): SpotWindLines["lines"] {
  return runs.flatMap((run) => {
    const points = run.samples
      .filter(
        (s): s is { time: number; wind: Wind } =>
          !!s.wind && Number.isFinite(s.wind.u) && Number.isFinite(s.wind.v),
      )
      .map((s) => ({
        time: s.time,
        u: s.wind.u,
        v: s.wind.v,
        gust:
          s.wind.gust !== null && Number.isFinite(s.wind.gust)
            ? s.wind.gust
            : null,
      }))
      .sort((a, b) => a.time - b.time);
    if (!points.length) return [];
    const last = points[points.length - 1].time;
    return [
      {
        run: {
          id: run.model,
          name: run.name,
          provider: "",
          run_time: run.runTime,
          until: new Date(last).toISOString(),
          age_hours: 0,
          stale: false,
          attribution: "",
          license_url: "",
        },
        points,
        gap: gapOf(points),
        resolutionKm: null,
      },
    ];
  });
}

/** Twice the readings' middle spacing: bridges a 3 → 6 h tail, not a hole. */
function gapOf(points: readonly { time: number }[]): number {
  const steps = points
    .slice(1)
    .map((p, i) => p.time - points[i].time)
    .sort((a, b) => a - b);
  return steps.length ? 2 * steps[Math.floor((steps.length - 1) / 2)] : 0;
}

/**
 * The hours of a point: the lender's (its waves, its weather), each with the
 * point's own wind, worked out from `lines`, in place of the lender's. A
 * point has no shore and no bathing water, so the hours say nothing of
 * either, and no hour is rated.
 */
export function pointHours(
  hours: readonly ForecastHour[],
  lines: SpotWindLines["lines"],
  from: StarsFrom = DEFAULT_STARS_FROM,
): ForecastHour[] {
  return hours.map((hour) => {
    const {
      water: _water,
      rating: _rating,
      why_not_rated: _why,
      ensemble: _ensemble,
      ...rest
    } = hour;
    return {
      ...rest,
      wind: hourWind(lines, Date.parse(hour.time), false, from),
      shore: null,
    };
  });
}

/** How many frames are read at once: the dock read two, a page can take more. */
const AT_ONCE = 6;

/**
 * The runs of `models` read at the point over the hours from `from` to
 * `to`, each model past the end of the one before it. A model whose run
 * cannot be read is left out; an hour whose frame cannot be read has no
 * reading, as an hour no run reaches has none.
 */
async function readRuns(
  lat: number,
  lon: number,
  models: readonly string[],
  from: number,
  to: number,
  signal?: AbortSignal,
): Promise<PointRun[]> {
  const runs: { manifest: Manifest; frames: number[] }[] = [];
  let after = -Infinity;
  for (const model of models) {
    let manifest: Manifest;
    try {
      manifest = await loadManifest(model, signal);
    } catch {
      continue;
    }
    if (!manifest.tiles || !manifest.frames.length) continue;
    runs.push({
      manifest,
      frames: framesToRead(manifest.frames, from, to, after),
    });
    const end = Date.parse(
      manifest.frames[manifest.frames.length - 1].validTime,
    );
    if (Number.isFinite(end)) after = Math.max(after, end);
  }
  const jobs = runs.flatMap(({ manifest, frames }, r) =>
    frames.map((index) => ({ r, manifest, index })),
  );
  const read: (Wind | null)[][] = runs.map(({ manifest }) =>
    manifest.frames.map(() => null),
  );
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !signal?.aborted) {
      const { r, manifest, index } = jobs[next++];
      try {
        read[r][index] = await samplePoint(manifest, index, lat, lon, {
          keep: false,
        });
      } catch {
        read[r][index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return runs.map(({ manifest, frames }, r) => ({
    model: manifest.model,
    name: manifest.modelName,
    runTime: manifest.runTime,
    samples: frames.map((index) => ({
      time: Date.parse(manifest.frames[index].validTime),
      wind: read[r][index],
    })),
  }));
}

/**
 * A point's forecast, in the shape a riding place's comes in, so the one
 * report draws both: the lender's forecast (or, with none near, what the
 * point's own place gives: its warnings), with the point's own wind, its own
 * name and place, the riding places around it as its nearby, and nothing of
 * a shore.
 */
export async function pointForecast(
  source: ForecastSource,
  place: PointPlace,
  window: Window,
  options: { now: number; from?: StarsFrom; signal?: AbortSignal },
): Promise<SpotForecast> {
  const from = options.from ?? DEFAULT_STARS_FROM;
  const { lat, lon } = place.spot;
  const [base, runs] = await Promise.all([
    spotForecast(source, place.lender ?? place.spot, window, {
      now: options.now,
      from,
    }),
    // Only the hours the page draws: from today's Irish midnight on.
    readRuns(
      lat,
      lon,
      leadModels(from),
      Math.max(window.from, dublinMidnight(dublinDate(options.now))),
      window.to,
      options.signal,
    ),
  ]);
  const lines = pointLines(runs);
  const { shore_note: _note, ...rest } = base;
  return {
    ...rest,
    spot: place.spot,
    shore_facing_deg: null,
    best_directions: null,
    nearby: place.nearby,
    hours: pointHours(base.hours, lines, from),
    water_quality: {
      ...base.water_quality,
      status: "not-monitored",
      items: [],
      rule: undefined,
      note: undefined,
    },
    sources: {
      ...base.sources,
      wind: lines.map((line) => line.run),
      wind_outside_domain: [],
    },
  };
}
