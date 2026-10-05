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
import { DEFAULT_RIDER } from "../../force5/src/stars";
import {
  SpotCard,
  SpotCardView,
  WIND_STOPS,
  clock,
  mapSpotHref,
  readingLine,
  readingNow,
  spotCardStyles,
  spotOutlook,
  windStop,
  type SpotOutlook,
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
  lat: 53.365,
  lon: -6.135,
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
    // The name in the display face's italic, the county in the mono label.
    expect(markup).toMatch(
      /<span class="[^"]*font-display[^"]*italic[^"]*">Dollymount<\/span>/,
    );
    expect(markup).toMatch(
      /<span class="[^"]*uppercase[^"]*">Co. Dublin<\/span>/,
    );
    expect(markup).toContain("Chart");
    expect(markup).toContain("Forecast on the wind map");
  });

  it("is a tap target, and says where it goes once the wind has the line", () => {
    const markup = html(
      createElement(SpotCardView, { spot: dollymount, reading: reading() }),
    );
    expect(/<a [^>]*>/.exec(markup)?.[0]).toContain("min-h-touch");
    // The wind in figures, the gust raised over it, and the same in words.
    expect(markup).toMatch(
      /aria-label="19 knots now, WSW · gusting 26 kn">.*?>19<\/span>.*?>26<\/span>.*?>kn<\/span>/,
    );
    expect(markup).toMatch(/>WSW<\/span>/);
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
    expect(markup).not.toContain(">Now<");
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
    expect(markup).toMatch(
      /tabular-nums" role="img"[^>]*><span class="text-figure">19</,
    );
    expect(markup).not.toContain("style=");
  });
});

describe("S4: the stars, as the dock and the spot page rate an hour", () => {
  // Dublin, 19 September: light from about 06:00 to 19:30 UTC.
  const DAY0 = Date.parse("2026-09-19T00:00:00Z");
  /** A day of hours from midnight UTC, each a westerly of the given knots. */
  const day = (knots: (number | null)[], gust = 1.3) =>
    knots.map((kn, hour) => ({
      u: kn === null ? NaN : ms(kn),
      v: 0,
      gust: kn === null ? null : ms(kn * gust),
      hour,
      validTime: iso(DAY0 + hour * HOUR),
    }));
  // Dollymount's shore looks east: a westerly is offshore there, so the
  // outlooks below are rated as if it faced west, onshore-ish, or not at all.
  const outlook = (
    knots: (number | null)[],
    at: number,
    facing: number | null = null,
  ) => spotOutlook(day(knots), dollymount, at, DEFAULT_RIDER, facing);

  it("rates the hour now, and leaves the dark unrated", () => {
    const steady = Array(24).fill(16);
    const noon = outlook(steady, DAY0 + 12 * HOUR);
    expect(noon.now?.stars).toBeGreaterThanOrEqual(4);
    expect(noon.now!.potential).toBeGreaterThanOrEqual(noon.now!.stars);
    expect(outlook(steady, DAY0 + 2 * HOUR).now).toBeNull();
  });

  it("takes the shore into account: an offshore wind is capped", () => {
    const steady = Array(24).fill(16);
    // Faces east, the wind is from the west: offshore.
    const off = outlook(steady, DAY0 + 12 * HOUR, 90);
    expect(off.now?.stars).toBeLessThanOrEqual(1);
    expect(off.now?.potential).toBeGreaterThanOrEqual(4);
  });

  it("finds the best run of what is left of today, on its weakest hour", () => {
    // Light all day but for 13:00 to 15:59 UTC, which is 14:00 to 17:00 Irish.
    const knots = Array(24).fill(6);
    for (const h of [13, 14, 15]) knots[h] = 17;
    const best = outlook(knots, DAY0 + 9 * HOUR).best;
    expect(best).not.toBeNull();
    expect(clock(best!.from)).toBe("14:00");
    expect(clock(best!.to)).toBe("17:00");
    expect(best!.stars).toBeGreaterThanOrEqual(4);
    expect(best!.wing).toBeGreaterThan(0);
    // Once it has gone by, it is not sold.
    expect(outlook(knots, DAY0 + 17 * HOUR).best).toBeNull();
  });

  it("is nothing without a run to rate", () => {
    expect(spotOutlook([], dollymount, DAY0, DEFAULT_RIDER, null)).toEqual({
      now: null,
      best: null,
    });
  });

  it("draws the stars now and the best of today, and calls the dark dark", () => {
    const view = (outlook: SpotOutlook) =>
      html(
        createElement(SpotCardView, {
          spot: dollymount,
          reading: reading(),
          outlook,
        }),
      );
    const markup = view({
      now: { stars: 3, potential: 4 },
      best: {
        stars: 4,
        from: Date.parse("2026-09-19T12:00:00Z"),
        to: Date.parse("2026-09-19T15:00:00Z"),
        wing: 5.5,
      },
    });
    expect(markup).toContain('aria-label="3 of 5 stars, 4 on the wind alone"');
    expect(markup).toContain('aria-label="4 of 5 stars"');
    expect(markup).toContain(">Best today<");
    expect(markup).toContain(">13:00–16:00<");
    expect(markup).toContain('aria-label="on a 5.5 square metre wing"');
    const dark = view({ now: null, best: null });
    expect(dark).toContain(">dark<");
    expect(dark).not.toContain("Best today");
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
