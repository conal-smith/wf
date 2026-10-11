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
import { windManifest } from "./testing";

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
      "gfs",
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
    // Retired to save downloads: still known, never fetched nor listed, and
    // distinct from a planned model, which the display options grey out.
    for (const id of ["ecmwf-ens", "gefs", "arpege", "arome", "aifs", "ecmwf-wave"]) {
      expect(requireModel(id).retired).toBe(true);
      expect(requireModel(id).planned).toBeUndefined();
    }
    expect(requireModel("ecmwf-ens").ensemble).toBe(true);
    expect(requireModel("gefs").ensemble).toBe(true);
    expect(requireModel("ecmwf-wave").kind).toBe("wave");
    for (const id of ["harmonie", "icon-eu", "ecmwf", "gfs"])
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
        ["gfs", "GFS", "25 km · 16 days"],
      ],
    );
  });
});

describe("manifest cache", () => {
  it("validates once, then serves the cache until it goes stale", async () => {
    const fetcher = vi.fn(async () => ok(windManifest({ model: "gfs" })));
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
    const fetcher = vi.fn(async () => ok(windManifest({ model: "gfs" })));
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
      vi.fn(async () => ok(windManifest({ model: "icon-eu" }))),
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
            setTimeout(() => resolve(ok(windManifest({ model: "gfs" }))), 50),
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
    const json = JSON.stringify(windManifest({ model: "gfs" }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tagged(json, '"a"'))
      // Unchanged: the same validator, and a body that would not even parse.
      .mockResolvedValueOnce(tagged("not json", '"a"'))
      // A new run: a new validator, and its body is read.
      .mockResolvedValueOnce(
        tagged(
          JSON.stringify(
            windManifest({ model: "gfs", runTime: "2026-09-14T06:00:00Z" }),
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
      ok(windManifest({ model: "gefs" })),
    );
    vi.stubGlobal("fetch", fetcher);
    await loadManifest("gefs");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-cache" });
  });
  it("takes the response the page's head already asked for, once", async () => {
    const early = Promise.resolve(ok(windManifest({ model: "harmonie" })));
    vi.stubGlobal("window", {
      __f5early: { "/weather/harmonie.json": early },
    });
    const fetcher = vi.fn(async () => ok(windManifest({ model: "harmonie" })));
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
      vi.fn(async () => ok(windManifest({ model: "ukv" }))),
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
        if (id === "gfs") return missing();
        return ok(windManifest({ model: id }));
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
    ).toEqual(["harmonie", "icon-eu", "ecmwf"]);
    for (const id of ["gefs", "arpege", "arome", "aifs", "ecmwf-ens", "ecmwf-wave"])
      expect(urls.some((url) => url.endsWith(`/${id}.json`))).toBe(false);
    const absent = availability.find((model) => model.id === "gfs")!;
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
});
