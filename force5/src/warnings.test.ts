import { describe, expect, it } from "vitest";
import feed from "../ingest/fixtures/met-eireann-warnings-20261025.json" with { type: "json" };
import areas from "../../data/locations/warning-areas.json" with { type: "json" };
import spots from "../../public/riding-locations.json" with { type: "json" };
import {
  WARNINGS_MAX_AGE_HOURS,
  applyWarnings,
  areaName,
  descriptionText,
  levelOf,
  nearestStretches,
  placeAreas,
  placeWarnings,
  readWarningsManifest,
  replacesStars,
  validityText,
  warningKind,
  warningsDuring,
  warningsStatus,
  type MetWarning,
  type WarningPlace,
  type WarningsManifest,
} from "./warnings";

const HOUR = 3600000;
/** Sun 25 Oct 2026 10:30 UTC: the feed fixture was read at 10:00. */
const NOW = Date.parse("2026-10-25T10:30:00Z");

const manifest = (
  warnings: MetWarning[] = feed as MetWarning[],
  runTime = "2026-10-25T10:00:00Z",
): WarningsManifest => ({
  schemaVersion: 1,
  kind: "warnings",
  model: "warnings",
  run: runTime.slice(0, 13).replace(/[-T]/g, ""),
  runTime,
  generatedAt: runTime.replace(":00:00Z", ":02:11Z"),
  warnings,
});

const spot = (id: string): WarningPlace => {
  const found = (spots as WarningPlace[]).find((s) => s.id === id);
  if (!found) throw new Error(`No spot ${id}`);
  return found;
};

/** A warning as the feed writes one; orange and red are not in today's feed. */
const warning = (over: Partial<MetWarning>): MetWarning => ({
  id: 99,
  capId: "2.49.0.1.372.0.test",
  type: "Wind",
  severity: "Severe",
  certainty: "Likely",
  level: "orange",
  issued: "2026-10-24T09:00:00+01:00",
  updated: "2026-10-24T09:00:00+01:00",
  onset: "2026-10-25T12:00:00+00:00",
  expiry: "2026-10-25T18:00:00+00:00",
  headline: "Status Orange - Wind warning for Dublin",
  description: "<p>Severe gusts.</p>",
  status: "Warning",
  regions: ["EI07"],
  ...over,
});

describe("reading the published file", () => {
  it("takes the job's file and refuses anything else", () => {
    expect(readWarningsManifest(manifest())).not.toBeNull();
    expect(readWarningsManifest(null)).toBeNull();
    expect(
      readWarningsManifest({ ...manifest(), kind: "observation" }),
    ).toBeNull();
    expect(
      readWarningsManifest({ ...manifest(), warnings: "none" }),
    ).toBeNull();
    // One warning the site cannot read makes the whole file untrusted, rather
    // than quietly leaving that warning out.
    expect(
      readWarningsManifest(
        manifest([...(feed as MetWarning[]), warning({ expiry: "soon" })]),
      ),
    ).toBeNull();
  });

  it("reads the level the feed gives, and nothing outside yellow, orange and red", () => {
    expect(levelOf({ level: "yellow" })).toBe("yellow");
    expect(levelOf({ level: "Orange" })).toBe("orange");
    expect(levelOf({ level: "red" })).toBe("red");
    expect(levelOf({ level: "green" })).toBeNull();
  });

  it("calls a file more than three hours old stale, and none unavailable", () => {
    expect(WARNINGS_MAX_AGE_HOURS).toBe(3);
    expect(warningsStatus(manifest(), NOW)).toBe("current");
    expect(warningsStatus(manifest(), Date.parse("2026-10-25T13:00:00Z"))).toBe(
      "current",
    );
    expect(warningsStatus(manifest(), Date.parse("2026-10-25T13:00:01Z"))).toBe(
      "stale",
    );
    expect(warningsStatus(null, NOW)).toBe("unavailable");
  });
});

describe("where a warning applies", () => {
  it("maps every riding place, and only to areas that exist", () => {
    const places = (areas as { places: Record<string, unknown> }).places;
    const ids = (spots as WarningPlace[]).map((s) => s.id).sort();
    expect(Object.keys(places).sort()).toEqual(ids);
    const counties = new Set(Object.values(areas.counties));
    for (const s of spots as WarningPlace[]) {
      const { sea, counties: mine } = placeAreas(s);
      for (const code of sea) expect(areas.seaAreas).toHaveProperty(code);
      for (const code of mine) expect(counties.has(code)).toBe(true);
    }
  });

  it("gives every place in the Republic its own county", () => {
    for (const s of spots as WarningPlace[]) {
      const { counties, northernIreland } = placeAreas(s);
      if (northernIreland) continue;
      expect(counties[0], s.id).toBe(areas.counties[s.county as "Dublin"]);
    }
  });

  it("keeps each place's stretches among the three nearest by straight lines", () => {
    // The hand-checked table may differ from the straight lines between
    // headlands in a deep bay, but never by more than a stretch or so: Strangford Lough opens onto two.
    for (const s of spots as WarningPlace[]) {
      const { sea } = placeAreas(s);
      if (!sea.length) continue;
      const near = nearestStretches(s.lat, s.lon)
        .slice(0, 3)
        .map((n) => n.code);
      for (const code of sea) expect(near, s.id).toContain(code);
    }
  });

  it("places spots on their stretches of coast", () => {
    const sea = (id: string) => placeAreas(spot(id)).sea;
    expect(sea("kilcrea")).toEqual(["EI809"]); // Carlingford Lough to Howth Head
    expect(sea("dollymount")).toEqual(["EI810"]); // Dublin Bay: Howth to Wicklow
    expect(sea("bantry-bay")).toEqual(["EI816"]); // north of Mizen Head
    expect(sea("schull")).toEqual(["EI815"]); // east of it
    expect(sea("rossnowlagh")).toEqual(["EI820"]); // Donegal Bay, south of Rossan Point
    expect(sea("dooey")).toEqual(["EI821"]); // north of Rossan Point
    expect(sea("glin")).toEqual(["EI817"]); // the Shannon Estuary, inside Loop Head
    expect(sea("portrush")).toEqual(["EI805"]);
    expect(sea("brandon")).toEqual(["EI817"]);
    expect(sea("rosslare")).toEqual(["EI811"]);
  });

  it("gives a place on a stretch's boundary both stretches", () => {
    expect(placeAreas(spot("cobh")).sea).toEqual(["EI814", "EI815"]);
    expect(placeAreas(spot("carlingford")).sea).toEqual(["EI808", "EI809"]);
    expect(placeAreas(spot("bloody-foreland")).sea).toEqual(["EI821", "EI822"]);
  });

  it("gives an inland lake no sea area, and its shores' counties", () => {
    const derg = placeAreas(spot("fi-mountshannon-lough-derg"));
    expect(derg.sea).toEqual([]);
    expect(derg.counties).toEqual(["EI03", "EI26", "EI10"]);
    expect(placeAreas(spot("blessington")).sea).toEqual([]);
    // A lagoon by the open sea takes the sea's warnings.
    expect(placeAreas(spot("keel-lake")).sea).toEqual(["EI819"]);
  });

  it("knows Northern Ireland has no Met Éireann county", () => {
    const larne = placeAreas(spot("browns-bay"));
    expect(larne).toEqual({
      counties: [],
      sea: ["EI806"],
      northernIreland: true,
    });
    // Across Carlingford Lough from Louth, so Louth's warnings reach it.
    expect(placeAreas(spot("warrenpoint")).counties).toEqual(["EI19"]);
  });

  it("falls back to the nearest stretch for a place not in the table yet", () => {
    const pier = { id: "new-pier", county: "Clare", lat: 52.94, lon: -9.37 };
    expect(placeAreas(pier)).toEqual({
      counties: ["EI03"],
      sea: ["EI818"],
      northernIreland: false,
    });
    const inland = {
      id: "athlone",
      county: "Westmeath",
      lat: 53.42,
      lon: -7.94,
    };
    expect(placeAreas(inland).sea).toEqual([]);
  });

  it("names areas", () => {
    expect(areaName("EI809")).toBe("Carlingford Lough to Howth Head");
    expect(areaName("EI07")).toBe("Dublin");
    expect(areaName("EI99")).toBe("EI99");
  });
});

describe("which warnings a place has", () => {
  it("matches today's feed to Kilcrea: the Irish Sea gale and the small craft warnings", () => {
    const found = placeWarnings(manifest(), spot("kilcrea"), NOW);
    expect(found.status).toBe("current");
    expect(
      found.warnings.map((w) => [w.warning.type, w.marine, w.areas]),
    ).toEqual([
      ["small-craft", true, ["EI809"]],
      ["Gale", true, ["EI809"]],
      ["small-craft", true, ["EI809"]],
      ["Gale", true, ["EI809"]],
    ]);
  });

  it("matches a county's land warning, and leaves a place outside it alone", () => {
    const mayo = placeWarnings(
      manifest(),
      spot("keel"),
      Date.parse("2026-10-25T09:30:00Z"),
    );
    expect(
      mayo.warnings.some((w) => w.warning.type === "Wind" && !w.marine),
    ).toBe(true);
    const donegal = placeWarnings(manifest(), spot("rossnowlagh"), NOW);
    expect(
      donegal.warnings.filter((w) => !w.marine).map((w) => w.warning.headline),
    ).toEqual(["Status Yellow - Wind warning for Donegal"]);
    const kerry = placeWarnings(manifest(), spot("brandon"), NOW);
    expect(kerry.warnings.filter((w) => !w.marine)).toEqual([]);
  });

  it("drops a warning at its expiry, whatever the file says", () => {
    const before = placeWarnings(
      manifest(),
      spot("keel"),
      Date.parse("2026-10-25T09:59:00Z"),
    );
    const after = placeWarnings(
      manifest(),
      spot("keel"),
      Date.parse("2026-10-25T10:00:00Z"),
    );
    const wind = (list: typeof before) =>
      list.warnings.filter((w) => w.warning.type === "Wind").length;
    expect(wind(before)).toBe(1); // Connacht's, to 10:00 UTC
    expect(wind(after)).toBe(0);
  });

  it("gives no warnings from a stale file, and says it is stale", () => {
    const late = Date.parse("2026-10-25T14:00:00Z");
    expect(placeWarnings(manifest(), spot("kilcrea"), late)).toEqual({
      status: "stale",
      checkedAt: "2026-10-25T10:02:11Z",
      warnings: [],
    });
    expect(placeWarnings(null, spot("kilcrea"), NOW).status).toBe(
      "unavailable",
    );
  });

  it("puts the highest level first", () => {
    const list = [
      warning({ level: "yellow", capId: "y" }),
      warning({ level: "red", capId: "r" }),
    ];
    const found = placeWarnings(manifest(list), spot("dollymount"), NOW);
    expect(found.warnings.map((w) => w.warning.capId)).toEqual(["r", "y"]);
  });

  it("keeps the warning exactly as Met Éireann published it", () => {
    const found = placeWarnings(manifest(), spot("kilcrea"), NOW);
    const original = (feed as MetWarning[]).find(
      (w) => w.capId === found.warnings[0].warning.capId,
    );
    expect(found.warnings[0].warning).toBe(original);
  });
});

describe("the rule", () => {
  const orange = warning({ level: "orange" });
  const at = (iso: string) => Date.parse(iso);
  const dublin = () =>
    placeWarnings(manifest([orange]), spot("dollymount"), NOW).warnings;

  it("covers the hours a warning overlaps, and not the hour it expires on", () => {
    const list = dublin();
    expect(warningsDuring(list, at("2026-10-25T11:00:00Z"))).toEqual([]);
    expect(warningsDuring(list, at("2026-10-25T12:00:00Z"))).toHaveLength(1);
    expect(warningsDuring(list, at("2026-10-25T17:00:00Z"))).toHaveLength(1);
    expect(warningsDuring(list, at("2026-10-25T18:00:00Z"))).toEqual([]);
    // A three-hour row that starts before the onset still meets it.
    expect(
      warningsDuring(
        list,
        at("2026-10-25T10:00:00Z"),
        at("2026-10-25T13:00:00Z"),
      ),
    ).toHaveLength(1);
  });

  it("takes the stars away under orange and red", () => {
    expect(replacesStars("orange")).toBe(true);
    expect(replacesStars("red")).toBe(true);
    const stars = { stars: 4 };
    const underOrange = applyWarnings(stars, [{ level: "orange" as const }]);
    expect(underOrange).toMatchObject({
      rating: null,
      level: "orange",
      withheld: true,
    });
    expect(applyWarnings(stars, [{ level: "red" as const }]).rating).toBeNull();
  });

  it("keeps the stars beside a yellow warning", () => {
    expect(replacesStars("yellow")).toBe(false);
    const stars = { stars: 4 };
    expect(applyWarnings(stars, [{ level: "yellow" as const }])).toEqual({
      rating: stars,
      warnings: [{ level: "yellow" }],
      level: "yellow",
      withheld: false,
    });
  });

  it("goes by the highest level when warnings overlap", () => {
    const both = applyWarnings({ stars: 3 }, [
      { level: "yellow" as const },
      { level: "red" as const },
    ]);
    expect(both.level).toBe("red");
    expect(both.warnings.map((w) => w.level)).toEqual(["red", "yellow"]);
    expect(both.rating).toBeNull();
  });

  it("leaves an hour with no warning as it was", () => {
    expect(applyWarnings({ stars: 5 }, [])).toEqual({
      rating: { stars: 5 },
      warnings: [],
      level: null,
      withheld: false,
    });
    expect(applyWarnings(null, []).rating).toBeNull();
  });

  it("applies to the hours an orange warning covers and no others", () => {
    const list = dublin();
    const rated = [11, 12, 17, 18].map(
      (h) =>
        applyWarnings(
          { stars: 3 },
          warningsDuring(
            list,
            at(`2026-10-25T${String(h).padStart(2, "0")}:00:00Z`),
          ),
        ).rating,
    );
    expect(rated).toEqual([{ stars: 3 }, null, null, { stars: 3 }]);
  });
});

describe("in words", () => {
  it("reads the description's HTML as text, keeping every word", () => {
    const html = (feed as MetWarning[])[2].description;
    expect(descriptionText(html)).toBe(
      [
        "Storm Boelo: Very strong southwest winds will veer westerly with severe gusts and coastal gales.",
        "Be aware of potential impacts:",
        "• Debris, loose objects displaced",
        "• Difficult driving and cycling conditions",
        "• Large coastal waves",
        "• Some fallen trees, branches",
        "• Outdoor events impacted",
      ].join("\n"),
    );
    expect(descriptionText("a &amp; b &lt;c&gt; &#8211; &#x2014;&nbsp;d")).toBe(
      "a & b <c> – — d",
    );
    expect(descriptionText("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("names the kind of warning", () => {
    expect(warningKind({ type: "small-craft" })).toBe("Small craft");
    expect(warningKind({ type: "Gale" })).toBe("Gale");
    expect(warningKind({ type: "Wind" })).toBe("Wind");
    expect(warningKind({ type: "snow-ice" })).toBe("Snow and ice");
    expect(warningKind({ type: "Violent Storm" })).toBe("Violent storm");
    expect(warningKind({ type: "something-new" })).toBe("Something new");
  });

  it("says the validity in Irish time, across the clocks going back", () => {
    expect(
      validityText({
        onset: Date.parse("2026-10-24T14:00:00+01:00"),
        expiry: Date.parse("2026-10-25T09:00:00+00:00"),
      }),
    ).toBe("Sat 24 Oct 14:00 – Sun 25 Oct 09:00");
    expect(HOUR).toBe(3600000);
  });
});
