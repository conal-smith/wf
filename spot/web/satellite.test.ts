import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inFrame,
  loadSpotPictures,
  metresPerPixel,
  parseSpotPictures,
  pictureCredit,
  resetSpotPictures,
  scaleBar,
  spotPicture,
  worldPixel,
  type SpotPictures,
} from "./satellite";

const pictures: SpotPictures = {
  schemaVersion: 1,
  kind: "satellite-spots",
  base: "satellite/v0123456789ab/",
  zoom: 14.5,
  width: 1200,
  height: 600,
  attribution:
    "Contains modified Copernicus Sentinel data 2017–2026, composited for wingfoil.ie; tide levels from the Marine Institute (CC BY 4.0)",
  spots: [
    {
      id: "portrane",
      lonLat: [-6.109482, 53.495188],
      high: "portrane-high.webp",
      low: "portrane-low.webp",
    },
  ],
};
const portrane = { id: "portrane", lat: 53.495188, lon: -6.109482 };

describe("the list of spot pictures", () => {
  it("takes the list publish.py writes", () => {
    expect(parseSpotPictures(pictures)).toBe(pictures);
  });

  it("refuses anything else: Pages' fallback, another kind, a name off the set's folder", () => {
    expect(parseSpotPictures(null)).toBeNull();
    expect(parseSpotPictures("<!doctype html>")).toBeNull();
    expect(parseSpotPictures({ ...pictures, kind: "satellite" })).toBeNull();
    expect(
      parseSpotPictures({ ...pictures, base: "https://elsewhere/" }),
    ).toBeNull();
    expect(
      parseSpotPictures({
        ...pictures,
        spots: [{ ...pictures.spots[0], low: "../index.json" }],
      }),
    ).toBeNull();
    expect(parseSpotPictures({ ...pictures, width: 0 })).toBeNull();
  });
});

describe("loading the list", () => {
  afterEach(() => resetSpotPictures());

  it("reads it once a page", async () => {
    const load = vi.fn(async () => Response.json(pictures));
    expect(await loadSpotPictures(load)).toEqual(pictures);
    expect(await loadSpotPictures(load)).toEqual(pictures);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("/satellite/spots.json");
  });

  it("comes to nothing with no list published, a page in its place, or no network", async () => {
    expect(
      await loadSpotPictures(async () => new Response("", { status: 404 })),
    ).toBeNull();
    resetSpotPictures();
    expect(
      await loadSpotPictures(
        async () => new Response("<!doctype html><html></html>"),
      ),
    ).toBeNull();
    resetSpotPictures();
    expect(
      await loadSpotPictures(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).toBeNull();
  });
});

describe("a place's picture", () => {
  it("is the set's, on the data host, with the place at its centre", () => {
    const picture = spotPicture(pictures, portrane)!;
    expect(picture.urls).toEqual({
      high: "/satellite/v0123456789ab/portrane-high.webp",
      low: "/satellite/v0123456789ab/portrane-low.webp",
    });
    expect(picture.at.x).toBeCloseTo(0.5, 9);
    expect(picture.at.y).toBeCloseTo(0.5, 9);
    // 4 m a pixel at 53.5°N: the 1200 pixels are 4.8 km.
    expect(picture.metresPerPixel).toBeCloseTo(4.02, 2);
  });

  it("marks a place moved since it was cut where it is now", () => {
    // About 400 m east and 200 m north: 100 pixels right, 50 up.
    const moved = { ...portrane, lon: -6.1035, lat: 53.497 };
    const picture = spotPicture(pictures, moved)!;
    expect(picture.at.x).toBeGreaterThan(0.57);
    expect(picture.at.x).toBeLessThan(0.6);
    expect(picture.at.y).toBeGreaterThan(0.4);
    expect(picture.at.y).toBeLessThan(0.43);
  });

  it("has none when the place is not in the set, or has moved off its picture", () => {
    expect(spotPicture(pictures, { ...portrane, id: "brandon" })).toBeNull();
    expect(spotPicture(pictures, { ...portrane, lon: -6.08 })).toBeNull();
  });
});

describe("the picture's geometry", () => {
  it("is Web Mercator at a 256-pixel tile's zoom", () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(worldPixel(-180, 0, 1).x).toBe(0);
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });

  it("fills a frame of its own shape, and cuts a phone's taller one at the sides", () => {
    const picture = spotPicture(pictures, portrane)!;
    const wide = inFrame(picture, 760, 380);
    expect(wide.x).toBeCloseTo(380);
    expect(wide.y).toBeCloseTo(190);
    expect(wide.metresPerScreenPixel).toBeCloseTo(
      (picture.metresPerPixel * 1200) / 760,
    );
    // 3:2 at 358 across: the picture is drawn 477 across, its sides cut off.
    const phone = inFrame(picture, 358, 239);
    expect(phone.metresPerScreenPixel).toBeCloseTo(
      (picture.metresPerPixel * 600) / 239,
    );
    const moved = inFrame({ ...picture, at: { x: 0.6, y: 0.5 } }, 358, 239);
    expect(moved.x - 179).toBeCloseTo(0.1 * 1200 * (239 / 600));
  });

  it("draws the longest round distance that fits as its scale", () => {
    expect(scaleBar(4, 120)).toEqual({
      metres: 250,
      pixels: 62.5,
      label: "250 m",
    });
    expect(scaleBar(10, 228)).toEqual({
      metres: 2000,
      pixels: 200,
      label: "2 km",
    });
    expect(scaleBar(10, 49).label).toBe("250 m");
  });

  it("credits the imagery under the picture in its own clause", () => {
    expect(pictureCredit(pictures.attribution)).toBe(
      "Contains modified Copernicus Sentinel data 2017–2026, composited for wingfoil.ie",
    );
  });
});
