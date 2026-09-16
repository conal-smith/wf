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
  it("flags planned models and marks the ensembles", () => {
    expect(liveModels().map((model) => model.id)).toEqual([
      "harmonie",
      "icon-eu",
      "ecmwf",
      "gfs",
      "ecmwf-ens",
      "gefs",
    ]);
    expect(windModels().every((model) => model.kind === "wind")).toBe(true);
    expect(requireModel("harmonie-eps").planned).toBe(true);
    expect(requireModel("ecmwf-ens").ensemble).toBe(true);
    expect(requireModel("ecmwf-ens").mapCapable).toBe(false);
    // GEFS is the ensemble whose mean the map can draw.
    expect(requireModel("gefs").ensemble).toBe(true);
    expect(requireModel("gefs").mapCapable).toBe(true);
    expect(requireModel("gefs").planned).toBeUndefined();
    expect(modelEntry("nope")).toBeUndefined();
    expect(() => requireModel("nope")).toThrow(/Unknown forecast model/);
    expect(modelHue("nope").wind).toMatch(/^#/);
  });
  it("keeps the five map models the picker shows", () => {
    expect(MODELS.map((model) => [model.id, model.name, model.detail])).toEqual(
      [
        ["harmonie", "HARMONIE", "2 km"],
        ["icon-eu", "ICON-EU", "6.5 km"],
        ["ecmwf", "ECMWF", "15 days"],
        ["gfs", "GFS", "0.25° · 16 days"],
        ["gefs", "GEFS", "31 members"],
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
        if (id === "gfs" || id === "ecmwf-ens") return missing();
        return ok(windManifest({ model: id }));
      }),
    );
    const availability = await availableModels();
    expect(availability.map((model) => model.id)).toEqual(
      liveModels().map((model) => model.id),
    );
    expect(
      availability.filter((model) => model.available).map((model) => model.id),
    ).toEqual(["harmonie", "icon-eu", "ecmwf", "gefs"]);
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
