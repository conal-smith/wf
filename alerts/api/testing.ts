/**
 * A published blend for tests: a pointer and its spot squares, served by a
 * ForecastSource at the paths the service reads, with series written hour by
 * hour. Not compiled into the service (market/api/tsconfig.json excludes it).
 */
import { spotSquare } from "../../force5/src/spotData.js";
import type { ForecastSource } from "../../mcp/api/source.js";
import { BLEND_PATH, PLACES } from "./forecast.js";

export interface HourWind {
  /** Knots. */
  wind: number | null;
  gust?: number | null;
  from?: number | null;
  agreement?: "h" | "m" | "l" | "-";
  /** The model the hour is: HARMONIE unless said, null for none. */
  model?: "harmonie" | "ecmwf" | null;
}

export interface BlendFixtureOptions {
  /** The first time, on the hour. */
  start: string;
  hours: number;
  /** Hours apart; 1 by default. */
  step?: number;
  generatedAt?: string;
  run?: string;
  /** Each spot's wind at each time. */
  spots: Record<string, (time: number, index: number) => HourWind>;
  /** Leave out the models the hours are, as a blend built before 19 October 2026 did. */
  ruleBefore?: boolean;
}

/** The two models a test blend's hours are, in its sources' order. */
const SOURCES = ["harmonie", "ecmwf"] as const;

export function blendFiles(options: BlendFixtureOptions) {
  const step = (options.step ?? 1) * 3_600_000;
  const first = Date.parse(options.start);
  const times = Array.from({ length: options.hours }, (_, i) =>
    new Date(first + i * step).toISOString().replace(".000Z", "Z"),
  );
  const run = options.run ?? options.start.replace(/\D/g, "").slice(0, 10);
  const base = `blend-${run}-${options.hours}h-v2-0a0b0c0d/`;
  const bySquare = new Map<string, Record<string, unknown>>();
  for (const [id, wind] of Object.entries(options.spots)) {
    const place = PLACES.get(id);
    const square = place ? spotSquare(place.lat, place.lon) : "n52w010";
    const series = times.map((t, i) => wind(Date.parse(t), i));
    const tenths = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10));
    const spots = bySquare.get(square) ?? {};
    spots[id] = {
      wind: series.map((h) => tenths(h.wind)),
      gust: series.map((h) => tenths(h.gust)),
      from: series.map((h) => h.from ?? null),
      agreement: series.map((h) => h.agreement ?? "h").join(""),
      ...(options.ruleBefore
        ? {}
        : {
            lead: series
              .map((h) => {
                const model = h.model === undefined ? "harmonie" : h.model;
                return model === null ? "-" : String(SOURCES.indexOf(model));
              })
              .join(""),
          }),
    };
    bySquare.set(square, spots);
  }
  const squares = [...bySquare.keys()].sort();
  const pointer = {
    schemaVersion: 2,
    kind: "blend",
    model: "blend",
    run,
    runTime: options.start,
    generatedAt: options.generatedAt ?? options.start,
    coverage: { from: times[0], to: times[times.length - 1] },
    times,
    sources: SOURCES.map((id) => ({
      id,
      name: id.toUpperCase(),
      run,
      runTime: options.start,
      resolutionKm: null,
      ensemble: false,
      weight: 1,
      columns: [],
    })),
    ...(options.ruleBefore ? {} : { lead: { model: "harmonie", then: "ecmwf" } }),
    base,
    spots: { squareDegrees: 2, url: "spots/{square}.json", squares, keys: ["spotBlend"] },
  };
  const files = new Map<string, unknown>([[BLEND_PATH, pointer]]);
  for (const square of squares)
    files.set(`weather/${base}spots/${square}.json`, {
      schemaVersion: 2,
      model: "blend",
      run,
      square,
      spotBlend: bySquare.get(square),
    });
  return { pointer, files, times };
}

/** A source over a blend that a test may replace, recording what was read. */
export function blendSource(options: BlendFixtureOptions): ForecastSource & {
  replace(next: BlendFixtureOptions): void;
  asked: string[];
} {
  let files = blendFiles(options).files;
  const asked: string[] = [];
  return {
    async json(path) {
      asked.push(path);
      return files.has(path) ? structuredClone(files.get(path)) : null;
    },
    replace(next) {
      files = blendFiles(next).files;
    },
    asked,
  };
}
