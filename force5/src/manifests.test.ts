import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANIFEST_REVALIDATE_MS,
  MODEL_CATALOG,
  ManifestUnavailableError,
  availableModels,
  clearManifestCache,
  liveModels,
  modelEntry,
  modelHue,
  requireModel,
  waveModels,
  weatherModels,
  windModels,
} from "./manifests";
import { loadManifest } from "./manifests";
import { MODELS } from "./models";
import { pointerOf, squareReader, windManifest, waveManifest } from "./testing";
import {
  SPOT_SETS_PER_RUN,
  clearMovedRuns,
  loadSpots,
  loadSpotsSettled,
  readForecastJson,
  withSpots,
} from "./manifests";
import { clearSpotSquares } from "./spotData";

/** A wind run's pointer, as published: no spot data inline. */
const pointer = (options: Parameters<typeof windManifest>[0]) =>
  pointerOf(windManifest(options));

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const missing = () => new Response("not found", { status: 404 });

beforeEach(() => clearManifestCache());
afterEach(() => vi.unstubAllGlobals());

describe("model registry", () => {
  it("lists live and planned models with distinct ids and hues", () => {
    const ids = MODEL_CATALOG.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "harmonie",
      "icon-eu",
      "ecmwf",
      "gfs",
      "ecmwf-ens",
      "harmonie-eps",
      "gefs",
      "arpege",
      "arome",
      "icon",
      "ukv",
      "aifs",
      "gfs-wave",
      "mi-swan",
      "icon-eu-weather",
      "ecmwf-wave",
    ])
      expect(ids).toContain(id);
    const hues = MODEL_CATALOG.map((model) => model.hue.wind);
    expect(new Set(hues).size).toBe(hues.length);
    for (const model of MODEL_CATALOG) {
      expect(model.hue.wind).toMatch(/^#[0-9a-f]{6}$/);
      expect(model.hue.gust).toMatch(/^#[0-9a-f]{6}$/);
      expect(model.manifestUrl.startsWith("weather/")).toBe(true);
    }
  });
  it("flags planned and retired models and marks the ensembles", () => {
    expect(liveModels().map((model) => model.id)).toEqual([
      "harmonie",
      "icon-eu",
      "ecmwf",
      "gfs-wave",
      "mi-swan",
      "icon-eu-weather",
    ]);
    expect(windModels().every((model) => model.kind === "wind")).toBe(true);
    expect(waveModels().map((model) => model.id)).toEqual([
      "gfs-wave",
      "mi-swan",
    ]);
    expect(weatherModels().map((model) => model.id)).toEqual([
      "icon-eu-weather",
    ]);
    // The surface bundle is a live model, and not one the map can draw.
    expect(requireModel("icon-eu-weather").mapCapable).toBe(false);
    expect(requireModel("icon-eu-weather").planned).toBeUndefined();
    expect(requireModel("harmonie-eps").planned).toBe(true);
    // Retired, to save downloads or as not useful: still known, never fetched
    // nor listed, and distinct from a planned model, which the display options
    // grey out. GFS-Wave is NOAA's wave model, a job of its own, and still live.
    for (const id of [
      "gfs",
      "ecmwf-ens",
      "gefs",
      "arpege",
      "arome",
      "aifs",
      "ecmwf-wave",
    ]) {
      expect(requireModel(id).retired).toBe(true);
      expect(requireModel(id).planned).toBeUndefined();
    }
    expect(requireModel("ecmwf-ens").ensemble).toBe(true);
    expect(requireModel("gefs").ensemble).toBe(true);
    expect(requireModel("ecmwf-wave").kind).toBe("wave");
    for (const id of ["harmonie", "icon-eu", "ecmwf", "gfs-wave"])
      expect(requireModel(id).retired).toBeUndefined();
    expect(modelEntry("nope")).toBeUndefined();
    expect(() => requireModel("nope")).toThrow(/Unknown forecast model/);
    expect(modelHue("nope").wind).toMatch(/^#/);
  });
  it("keeps the map models the picker shows, in order", () => {
    expect(MODELS.map((model) => [model.id, model.name, model.detail])).toEqual(
      [
        ["harmonie", "HARMONIE", "2 km"],
        ["icon-eu", "ICON-EU", "6.5 km"],
        ["ecmwf", "ECMWF", "25 km · 15 days"],
      ],
    );
  });
});

describe("manifest cache", () => {
  it("validates once, then serves the cache until it goes stale", async () => {
    const fetcher = vi.fn(async () => ok(pointer({ model: "gfs" })));
    vi.stubGlobal("fetch", fetcher);
    const first = await loadManifest("gfs");
    expect(first.model).toBe("gfs");
    expect(await loadManifest("gfs")).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await loadManifest(
      "gfs",
      undefined,
      Date.now() + MANIFEST_REVALIDATE_MS + 1,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("dedupes concurrent requests for the same URL", async () => {
    const fetcher = vi.fn(async () => ok(pointer({ model: "gfs" })));
    vi.stubGlobal("fetch", fetcher);
    const [a, b] = await Promise.all([
      loadManifest("gfs"),
      loadManifest("gfs"),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
  it("reports a missing manifest as unavailable with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => missing()),
    );
    const error = await loadManifest("gfs").catch((e) => e);
    expect(error).toBeInstanceOf(ManifestUnavailableError);
    expect(error.status).toBe(404);
    expect(error.id).toBe("gfs");
    expect(error.message).toContain("GFS forecast is unavailable");
  });
  it("refuses a manifest whose model does not match the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(pointer({ model: "icon-eu" }))),
    );
    await expect(loadManifest("gfs")).rejects.toThrow(/does not match/);
  });
  it("rejects promptly when the caller aborts, without poisoning the cache", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(() => resolve(ok(pointer({ model: "gfs" }))), 50),
          ),
      ),
    );
    const pending = loadManifest("gfs", controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect((await loadManifest("gfs")).model).toBe("gfs");
  });
  it("does not parse a revalidated manifest again when its ETag has not moved", async () => {
    const tagged = (body: string, etag: string) =>
      new Response(body, { status: 200, headers: { ETag: etag } });
    const json = JSON.stringify(pointer({ model: "gfs" }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tagged(json, '"a"'))
      // Unchanged: the same validator, and a body that would not even parse.
      .mockResolvedValueOnce(tagged("not json", '"a"'))
      // A new run: a new validator, and its body is read.
      .mockResolvedValueOnce(
        tagged(
          JSON.stringify(
            pointer({ model: "gfs", runTime: "2026-09-14T06:00:00Z" }),
          ),
          '"b"',
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const stale = () => Date.now() + MANIFEST_REVALIDATE_MS + 1;
    const first = await loadManifest("gfs");
    expect(await loadManifest("gfs", undefined, stale())).toBe(first);
    const next = await loadManifest("gfs", undefined, stale() * 2);
    expect(next).not.toBe(first);
    expect(next.runTime).toBe("2026-09-14T06:00:00Z");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("revalidates rather than trusting a cached copy", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      ok(pointer({ model: "gefs" })),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadManifest("gefs");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-cache" });
  });
  it("takes the response the page's head already asked for, once", async () => {
    const early = Promise.resolve(ok(pointer({ model: "harmonie" })));
    vi.stubGlobal("window", {
      __f5early: { "/weather/harmonie.json": early },
    });
    const fetcher = vi.fn(async () => ok(pointer({ model: "harmonie" })));
    vi.stubGlobal("fetch", fetcher);
    expect((await loadManifest("harmonie")).model).toBe("harmonie");
    expect(fetcher).not.toHaveBeenCalled();
    clearManifestCache();
    await loadManifest("harmonie");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("loads a planned model as soon as its adapter publishes one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(pointer({ model: "ukv" }))),
    );
    expect((await loadManifest("ukv")).model).toBe("ukv");
  });
});

describe("availability sweep", () => {
  it("tries every live model concurrently and treats 404 as unavailable", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const id = url.includes("latest")
          ? "icon-eu"
          : url.replace(/^.*weather\//, "").replace(/\.json$/, "");
        if (id === "icon-eu") return missing();
        return ok(pointer({ model: id }));
      }),
    );
    const availability = await availableModels();
    expect(availability.map((model) => model.id)).toEqual(
      liveModels().map((model) => model.id),
    );
    expect(
      availability.filter((model) => model.available).map((model) => model.id),
      // The wave ids answer with a wind bundle here, which is a fault, not a
      // conversion: the registry decides the contract, so they come back unavailable.
    ).toEqual(["harmonie", "ecmwf"]);
    for (const id of [
      "gfs",
      "gefs",
      "arpege",
      "arome",
      "aifs",
      "ecmwf-ens",
      "ecmwf-wave",
    ])
      expect(urls.some((url) => url.endsWith(`/${id}.json`))).toBe(false);
    const absent = availability.find((model) => model.id === "icon-eu")!;
    expect(absent.manifest).toBeNull();
    expect(absent.error).toContain("unavailable");
    expect(urls).toHaveLength(liveModels().length);
    expect(urls.some((url) => url.includes("ukv"))).toBe(false);
  });
  it("reports a broken manifest as unavailable instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ schemaVersion: 1, frames: [] })),
    );
    const availability = await availableModels();
    expect(availability.every((model) => !model.available)).toBe(true);
    expect(availability[0].error).toMatch(/Invalid forecast manifest/);
  });
  it("reports a version 1 pointer left from before an upgrade as unavailable, and only that model", async () => {
    // A persistent volume keeps each model's old pointer until its next run.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = url.includes("latest")
          ? "icon-eu"
          : url.replace(/^.*weather\//, "").replace(/\.json$/, "");
        if (id !== "ecmwf") return ok(pointer({ model: id }));
        const { base: _base, spots: _spots, tiles: _tiles, ...old } = pointer({
          model: "ecmwf",
        });
        return ok({ ...old, schemaVersion: 1, spotForecasts: {} });
      }),
    );
    const availability = await availableModels();
    const old = availability.find((model) => model.id === "ecmwf")!;
    expect(old.available).toBe(false);
    expect(old.error).toMatch(/old format/);
    expect(
      availability
        .filter((model) => model.wind && model.available)
        .map((model) => model.id),
    ).toEqual(["harmonie", "icon-eu"]);
    // The lights' square loader leaves it alone rather than failing the rest.
    const loaded = await withSpots(availability, []);
    expect(loaded.find((model) => model.id === "ecmwf")).toBe(old);
  });
});

describe("spot squares", () => {
  afterEach(() => {
    clearSpotSquares(readForecastJson);
    clearMovedRuns();
  });
  /** A fetch serving the squares of these runs and recording every path asked. */
  const serve = (...runs: Parameters<typeof squareReader>) => {
    const read = squareReader(...runs);
    const fetcher = vi.fn(async (url: string) => {
      const body = await read(url.replace(/^.*?\/weather\//, "weather/"));
      return body === null ? missing() : ok(body);
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };
  const whole = windManifest({
    model: "harmonie",
    extra: {
      spotForecasts: {
        brandon: windManifest().spotForecasts!.brandon,
        dollymount: windManifest().spotForecasts!.brandon,
      },
    },
  });

  it("reads only the squares asked for, once, and checks what it merges", async () => {
    const fetcher = serve(whole);
    const run = pointerOf({ ...whole, spots: { ...whole.spots } });
    expect(run.spots.squares).toEqual(["n52w008", "n52w012"]);
    const one = await loadSpots(run, ["n52w012"]);
    expect(Object.keys(one.spotForecasts!)).toEqual(["brandon"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatch(
      /weather\/harmonie-2026091400-test-v1-0a0b0c0d\/spots\/n52w012\.json$/,
    );
    const all = await loadSpots(run);
    expect(all.spotForecasts).toEqual(whole.spotForecasts);
    // The square already read is not fetched again.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await loadSpots(run)).toBe(all);
  });
  it("marks a model whose squares cannot be read unavailable, and only that one", async () => {
    const wave = waveManifest();
    serve(wave);
    const models = await withSpots([
      {
        id: "harmonie",
        entry: requireModel("harmonie"),
        manifest: pointerOf(whole),
        wind: pointerOf(whole),
        wave: null,
        weather: null,
        available: true,
        error: null,
      },
      {
        id: "gfs-wave",
        entry: requireModel("gfs-wave"),
        manifest: pointerOf(wave),
        wind: null,
        wave: pointerOf(wave),
        weather: null,
        available: true,
        error: null,
      },
    ]);
    expect(models[0].available).toBe(false);
    expect(models[0].error).toMatch(/answered 404/);
    expect(models[1].wave?.spotSeries).toEqual(wave.spotSeries);
  });
  it("reads a model's pointer again when its squares are gone, and the run it names now", async () => {
    // The run on screen was superseded and its directory deleted: its squares
    // answer 404, and the pointer now names a newer run whose squares are there.
    const newer = windManifest({
      model: "harmonie",
      runTime: "2026-09-14T03:00:00Z",
      extra: { spotForecasts: whole.spotForecasts },
    });
    const read = squareReader(newer);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("weather/harmonie.json")) return ok(pointerOf(newer));
      const body = await read(url.replace(/^.*?\/weather\//, "weather/"));
      return body === null ? missing() : ok(body);
    });
    vi.stubGlobal("fetch", fetcher);
    const shown = pointerOf(whole);
    const [model] = await withSpots(
      [
        {
          id: "harmonie",
          entry: requireModel("harmonie"),
          manifest: shown,
          wind: shown,
          wave: null,
          weather: null,
          available: true,
          error: null,
        },
      ],
      ["n52w012"],
    );
    expect(model.available).toBe(true);
    expect(model.wind?.run).toBe(newer.run);
    expect(model.wind?.base).toBe(newer.base);
    expect(model.wind?.spotForecasts?.brandon).toEqual(
      newer.spotForecasts!.brandon,
    );
    // One pointer read, and one square from each run.
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("harmonie.json")),
    ).toHaveLength(1);
  });
  it("keeps the squares it could read when one of them fails", async () => {
    // A far square that will not load must not take the model out of every
    // place: the squares that did load are merged, and the other is named.
    const read = squareReader(whole);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("weather/harmonie.json")) return ok(pointerOf(whole));
      if (url.endsWith("/spots/n52w008.json")) return missing();
      const body = await read(url.replace(/^.*?\/weather\//, "weather/"));
      return body === null ? missing() : ok(body);
    });
    vi.stubGlobal("fetch", fetcher);
    const shown = pointerOf(whole);
    const [model] = await withSpots(
      [
        {
          id: "harmonie",
          entry: requireModel("harmonie"),
          manifest: shown,
          wind: shown,
          wave: null,
          weather: null,
          available: true,
          error: null,
        },
      ],
      ["n52w008", "n52w012"],
    );
    expect(model.available).toBe(true);
    expect(model.unread).toEqual(["n52w008"]);
    expect(Object.keys(model.wind!.spotForecasts!)).toEqual(["brandon"]);
    // Not kept: the next ask reads the failed square again, and only it.
    fetcher.mockClear();
    const again = await loadSpotsSettled(shown, ["n52w008", "n52w012"]);
    expect(again.unread).toEqual(["n52w008"]);
    expect(
      fetcher.mock.calls.map(([url]) => url.replace(/^.*\/spots\//, "")),
    ).toEqual(["n52w008.json"]);
  });
  it("keeps only the last few sets of squares merged per run", async () => {
    serve(whole);
    const run = pointerOf(whole);
    const sets = Array.from({ length: SPOT_SETS_PER_RUN + 1 }, (_, i) => [
      "n52w012",
      ...Array.from({ length: i }, () => "n52w008"),
      `n6${i}e000`,
    ]);
    const first = await loadSpotsSettled(run, sets[0]);
    expect(await loadSpotsSettled(run, sets[0])).toBe(first);
    for (const set of sets.slice(1)) await loadSpotsSettled(run, set);
    // The oldest set went to make room; reading it again merges it afresh.
    expect(await loadSpotsSettled(run, sets[0])).not.toBe(first);
  });
  it("goes straight to the run that replaced a deleted one, after the first time", async () => {
    const newer = windManifest({
      model: "harmonie",
      runTime: "2026-09-14T03:00:00Z",
      extra: { spotForecasts: whole.spotForecasts },
    });
    const read = squareReader(newer);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("weather/harmonie.json")) return ok(pointerOf(newer));
      const body = await read(url.replace(/^.*?\/weather\//, "weather/"));
      return body === null ? missing() : ok(body);
    });
    vi.stubGlobal("fetch", fetcher);
    const shown = pointerOf(whole);
    const model = {
      id: "harmonie",
      entry: requireModel("harmonie"),
      manifest: shown,
      wind: shown,
      wave: null,
      weather: null,
      available: true,
      error: null,
    };
    expect((await withSpots([model], ["n52w012"]))[0].wind?.base).toBe(
      newer.base,
    );
    fetcher.mockClear();
    // The caller still holds the old pointer: another spot's square is read
    // from the new run at once, with no 404 and no pointer read first.
    const [next] = await withSpots([model], ["n52w008"]);
    expect(next.wind?.base).toBe(newer.base);
    expect(next.wind?.spotForecasts?.dollymount).toEqual(
      newer.spotForecasts!.dollymount,
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      expect.stringMatching(
        new RegExp(`weather/${newer.base}spots/n52w008\\.json$`),
      ),
    ]);
  });
  it("still reports a model unavailable when its pointer names the same run", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("weather/harmonie.json") ? ok(pointerOf(whole)) : missing(),
    );
    vi.stubGlobal("fetch", fetcher);
    const [model] = await withSpots([
      {
        id: "harmonie",
        entry: requireModel("harmonie"),
        manifest: pointerOf(whole),
        wind: pointerOf(whole),
        wave: null,
        weather: null,
        available: true,
        error: null,
      },
    ]);
    expect(model.available).toBe(false);
    expect(model.error).toMatch(/answered 404/);
  });
  it("refuses a square whose series break the bundle's own contract", async () => {
    const broken = waveManifest({ hours: [0, 3, 6] });
    const shifted = {
      ...broken,
      spotSeries: {
        brandon: broken.spotSeries!.brandon.map((step, index) =>
          index === 1 ? { ...step, hour: 4 } : step,
        ),
      },
    };
    serve(shifted);
    await expect(loadSpots(pointerOf(shifted))).rejects.toThrow(
      /Invalid wave forecast manifest/,
    );
  });
});

