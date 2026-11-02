import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain script, with no types of its own.
import { spotCardModule } from "../../scripts/mcp-card/build.mjs";
import {
  cardPicture,
  isSpotCardData,
  parsePictureList,
  spotCardData,
  type CardSource,
  type SpotPictureList,
} from "./card";

const LIST: SpotPictureList & { kind: string; schemaVersion: number } = {
  schemaVersion: 1,
  kind: "satellite-spots",
  base: "satellite/v0123456789ab/",
  zoom: 14.5,
  width: 1200,
  height: 600,
  attribution: "Contains modified Copernicus Sentinel data; tides from elsewhere",
  spots: [
    { id: "brandon", lonLat: [-10.024, 52.276], high: "brandon-high.webp" },
  ],
};

const SPOT = {
  id: "brandon",
  name: "Brandon Bay",
  county: "Kerry",
  lat: 52.276,
  lon: -10.024,
};

const hour = (
  time: string,
  light: "day" | "dark",
  kn: number | null,
  stars: number | null,
): CardSource["hours"][number] => ({
  time,
  local: time,
  daylight: light === "day",
  light,
  wind:
    kn === null
      ? null
      : { wind_kn: kn, gust_kn: kn + 6, direction_deg: 225, direction: "SW" },
  rating: stars === null ? null : { stars },
});

describe("the spot card's data", () => {
  const forecast: CardSource = {
    spot: SPOT,
    hours: [
      hour("2026-11-07T06:00:00Z", "dark", 9.4, 0),
      hour("2026-11-07T09:00:00Z", "day", 14.6, 3),
      hour("2026-11-07T12:00:00Z", "day", 19.2, 5),
      hour("2026-11-07T15:00:00Z", "day", null, null),
    ],
    best_windows: [
      { window: null },
      { window: { from: "2026-11-07T12:00:00Z" } },
    ],
  };

  it("carries every hour, the wind to the knot, and opens on the best window", () => {
    const card = spotCardData(forecast, { site: "https://wingfoil.ie" });
    expect(isSpotCardData(card)).toBe(true);
    expect(card.page).toBe("https://wingfoil.ie/spot/brandon");
    expect(card.hours.map((h) => [h.wind_kn, h.gust_kn, h.stars])).toEqual([
      [9, 15, 0],
      [15, 21, 3],
      [19, 25, 5],
      [null, null, null],
    ]);
    expect(card.focus).toBe("2026-11-07T12:00:00Z");
    expect(card.picture).toBeNull();
  });

  it("opens on the first light with wind where no window has stars", () => {
    const card = spotCardData(
      { ...forecast, best_windows: [{ window: null }] },
      { site: "https://wingfoil.ie" },
    );
    expect(card.focus).toBe("2026-11-07T09:00:00Z");
  });

  it("puts the place on its picture, from the data host", () => {
    const picture = cardPicture(
      parsePictureList(LIST),
      SPOT,
      "https://data.example/",
    )!;
    expect(picture.url).toBe(
      "https://data.example/satellite/v0123456789ab/brandon-high.webp",
    );
    expect(picture.x).toBeCloseTo(0.5, 3);
    expect(picture.y).toBeCloseTo(0.5, 3);
    expect(picture.aspect).toBe(2);
    expect(picture.credit).toBe("Contains modified Copernicus Sentinel data");
  });

  it("has no picture for a place near its edge, or with none published", () => {
    const list = parsePictureList(LIST);
    expect(
      cardPicture(list, { ...SPOT, lon: SPOT.lon + 0.03 }, "https://d.example/"),
    ).toBeNull();
    expect(cardPicture(list, { ...SPOT, id: "keel" }, "https://d.example/")).toBeNull();
    expect(cardPicture(list, SPOT, undefined)).toBeNull();
    expect(parsePictureList({ ...LIST, base: "../elsewhere/" })).toBeNull();
    expect(parsePictureList(null)).toBeNull();
  });
});

describe("the spot card's page", () => {
  it("is built from its sources as they are now (npm run mcp:card)", async () => {
    const written = readFileSync(
      new URL("./spotCard.generated.ts", import.meta.url),
      "utf8",
    );
    expect(written === (await spotCardModule())).toBe(true);
  });
});
