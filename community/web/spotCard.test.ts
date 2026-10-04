import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  KNOTS,
  PALETTE,
  type Manifest,
  type Wind,
} from "../../force5/src/weather";
import { ridingLocations, spotFromSearch } from "../../src/locations";
import { Message } from "./components/Message";
import type { Spot } from "./components/NewThreadDialog";
import {
  SpotCard,
  SpotCardView,
  WIND_STOPS,
  mapSpotHref,
  readingLine,
  readingNow,
  spotCardStyles,
  windStop,
  type SpotReading,
} from "./components/SpotCard";

/**
 * The spot card, rendered to markup, and the arithmetic behind its reading.
 * There is no DOM under these tests and nothing is fetched: what the card does
 * with the map's files once a browser has them is e2e/community-spot-card.
 */

const html = (element: ReactElement) => renderToStaticMarkup(element);

const dollymount: Spot = {
  id: "dollymount",
  name: "Dollymount",
  county: "Dublin",
};

const reading = (extra: Partial<SpotReading> = {}): SpotReading => ({
  knots: 19,
  gustKnots: 26,
  from: "WSW",
  validTime: "2026-09-19T09:00:00Z",
  ...extra,
});

const HOUR = 3600000;
const T0 = Date.parse("2026-09-19T09:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/** A run of hourly winds for one spot, in metres per second, from T0. */
const run = (hours: (Wind | null)[]): Pick<Manifest, "spotForecasts"> => ({
  spotForecasts: {
    dollymount: hours.map((wind, hour) => ({
      ...(wind ?? { u: null as unknown as number, v: NaN, gust: null }),
      hour,
      validTime: iso(T0 + hour * HOUR),
    })),
  },
});

const ms = (knots: number) => knots / KNOTS;

describe("S1: the name, the county and the way to the map", () => {
  it("is one link to the map, opened on the spot", () => {
    const markup = html(
      createElement(SpotCardView, { spot: dollymount, reading: null }),
    );
    expect(markup).toMatch(/^<a [^>]*href="\/\?spot=dollymount"/);
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain("Dollymount, Co. Dublin");
    expect(markup).toContain("Forecast on the wind map");
  });

  it("is a tap target, and says where it goes once the wind has the line", () => {
    const markup = html(
      createElement(SpotCardView, { spot: dollymount, reading: reading() }),
    );
    expect(/<a [^>]*>/.exec(markup)?.[0]).toContain("min-h-touch");
    expect(markup).toContain("WSW · gusting 26 kn");
    expect(markup).toMatch(/sr-only[^>]*>\. Forecast on the wind map/);
  });

  it("writes an id into the link so that it survives the trip", () => {
    expect(mapSpotHref("fi-fanore-beach")).toBe("/?spot=fi-fanore-beach");
    expect(mapSpotHref("a b&c")).toBe("/?spot=a%20b%26c");
  });

  it("the map reads the link back to the same place, for every riding location", () => {
    const places = ridingLocations(
      JSON.parse(readFileSync("public/spots.json", "utf8")),
    );
    const listed: Spot[] = JSON.parse(
      readFileSync("public/riding-locations.json", "utf8"),
    );
    expect(listed).toHaveLength(146);
    for (const spot of listed) {
      const search = new URL(mapSpotHref(spot.id), "https://wingfoil.ie")
        .search;
      expect(spotFromSearch(search, places)?.id, spot.id).toBe(spot.id);
    }
  });
});

describe("S2: the wind now, from the series the map already publishes", () => {
  it("is the hour nearest the clock: speed, where from, and the gust", () => {
    // A westerly blows towards the east: u positive, v nothing.
    const manifest = run([
      { u: ms(10), v: 0, gust: ms(14) },
      { u: ms(19), v: 0, gust: ms(26) },
      { u: ms(30), v: 0, gust: ms(40) },
    ]);
    expect(readingNow(manifest, "dollymount", T0 + 1.4 * HOUR)).toEqual({
      knots: 19,
      gustKnots: 26,
      from: "W",
      validTime: iso(T0 + HOUR),
    });
    expect(readingNow(manifest, "dollymount", T0 + 1.6 * HOUR)?.knots).toBe(30);
  });

  it("goes without a gust the model does not give", () => {
    const now = readingNow(
      run([{ u: 0, v: ms(-12), gust: null }]),
      "dollymount",
      T0,
    );
    expect(now).toMatchObject({ knots: 12, gustKnots: null, from: "N" });
    expect(readingLine(now!)).toBe("N");
  });

  it("calls a calm a calm, and gives it no direction", () => {
    const now = readingNow(
      run([{ u: 0.1, v: 0.1, gust: null }]),
      "dollymount",
      T0,
    );
    expect(now).toMatchObject({ knots: 0, from: null });
    expect(readingLine(now!)).toBe("Calm");
  });

  it("is nothing once the run has stopped covering the present", () => {
    const manifest = run([{ u: ms(19), v: 0, gust: null }]);
    expect(readingNow(manifest, "dollymount", T0 + 1.5 * HOUR)).not.toBeNull();
    expect(readingNow(manifest, "dollymount", T0 + 1.6 * HOUR)).toBeNull();
    expect(readingNow(manifest, "dollymount", T0 - 2 * HOUR)).toBeNull();
  });

  it("is nothing for a spot the run does not list, or does not reach", () => {
    expect(readingNow(run([]), "dollymount", T0)).toBeNull();
    expect(readingNow(run([null]), "dollymount", T0)).toBeNull();
    expect(
      readingNow(run([{ u: 1, v: 1, gust: null }]), "keel", T0),
    ).toBeNull();
    expect(
      readingNow({} as Pick<Manifest, "spotForecasts">, "keel", T0),
    ).toBeNull();
  });

  it("reads a manifest as the ingest writes one, for every riding location", () => {
    const manifest: Manifest = JSON.parse(
      readFileSync("tests/fixtures/weather/harmonie.json", "utf8"),
    );
    const listed: Spot[] = JSON.parse(
      readFileSync("public/riding-locations.json", "utf8"),
    );
    const at = Date.parse(manifest.frames[3].validTime);
    for (const spot of listed) {
      const now = readingNow(manifest, spot.id, at);
      expect(now?.validTime, spot.id).toBe(manifest.frames[3].validTime);
      expect(Number.isInteger(now?.knots), spot.id).toBe(true);
    }
  });

  it("without a reading the card is the name and the link, and no number", () => {
    const markup = html(
      createElement(SpotCardView, { spot: dollymount, reading: null }),
    );
    expect(markup).not.toContain("bg-wind-");
    expect(markup).not.toContain(" now");
  });
});

describe("S3: the swatch takes the ramp, the number stays in ink", () => {
  it("has a stop for every stop of the map's ramp, under the theme's name", () => {
    expect(WIND_STOPS.map(([knots]) => knots)).toEqual(
      PALETTE.map(([knots]) => knots),
    );
    for (const [knots, name] of WIND_STOPS) {
      expect(name).toBe(`k${String(knots).padStart(2, "0")}`);
      expect(spotCardStyles({ wind: name }).swatch()).toContain(
        `bg-wind-${name}`,
      );
    }
  });

  it("draws a speed at the stop it has reached", () => {
    expect(windStop(0)).toBe("k00");
    expect(windStop(9)).toBe("k09");
    expect(windStop(14)).toBe("k10");
    expect(windStop(19)).toBe("k15");
    expect(windStop(20)).toBe("k20");
    expect(windStop(64)).toBe("k60");
    expect(windStop(90)).toBe("k65");
  });

  it("colours the swatch and nothing else: the number is ink, and the swatch says nothing", () => {
    const markup = html(
      createElement(SpotCardView, { spot: dollymount, reading: reading() }),
    );
    expect(markup.match(/bg-wind-/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<span class="[^"]*bg-wind-k15[^"]*" aria-hidden="true"><\/span>/,
    );
    expect(markup).not.toMatch(/text-wind-/);
    expect(/<a [^>]*>/.exec(markup)?.[0]).toContain("text-ink");
    expect(markup).toMatch(/tabular-nums[^>]*>19 </);
    expect(markup).not.toContain("style=");
  });
});

describe("a thread with a spot shows the card; one without shows nothing", () => {
  it("draws nothing without a spot, and nothing before the spot is known", () => {
    const now = new Date(T0);
    expect(html(createElement(SpotCard, { spotId: null, now }))).toBe("");
    expect(html(createElement(SpotCard, { spotId: "dollymount", now }))).toBe(
      "",
    );
  });

  const opening = (
    attached: ReactElement | undefined,
    seq = 0,
    status: "visible" | "removed" = "visible",
  ) =>
    html(
      createElement(Message, {
        message: {
          id: "m000000000000001",
          threadId: "t000000000000001",
          seq,
          author: {
            id: "dev_aoife",
            handle: "aoife",
            displayName: "Aoife K",
            avatarUrl: null,
            role: "member",
          },
          body: "Most of my days are 14 to 22 knots.",
          replyTo: null,
          reactions: {},
          status,
          editedAt: null,
          createdAt: "2026-09-19T08:00:00Z",
          photos: [],
          mentions: [],
        },
        opening: seq === 0,
        startedBy: "dev_aoife",
        viewer: { id: null, staff: false },
        now: new Date(T0),
        attached,
        onReact: () => {},
        onReport: () => {},
        onEdit: async () => {},
        onDelete: () => {},
        onJump: () => {},
      }),
    );

  it("sits in the opening post, under its words and over its reactions", () => {
    const card = createElement(SpotCardView, {
      spot: dollymount,
      reading: reading(),
    });
    const markup = opening(card);
    const words = markup.indexOf("14 to 22 knots");
    const link = markup.indexOf('href="/?spot=dollymount"');
    const reactions = markup.indexOf("Add a reaction");
    expect(words).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(words);
    expect(reactions).toBeGreaterThan(link);
  });

  it("is the opening post's alone: a reply is handed nothing to hang", () => {
    const card = createElement(SpotCardView, {
      spot: dollymount,
      reading: null,
    });
    expect(opening(card, 3)).not.toContain("?spot=");
    expect(opening(undefined)).not.toContain("?spot=");
  });

  it("goes with a removed opening post, as its reactions do", () => {
    const card = createElement(SpotCardView, {
      spot: dollymount,
      reading: null,
    });
    const markup = opening(card, 0, "removed");
    expect(markup).toContain("This message was removed.");
    expect(markup).not.toContain("?spot=");
  });
});
