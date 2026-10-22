import { describe, expect, it } from "vitest";
import { colors } from "../../theme/tokens";
import {
  boundsOf,
  DEFAULT_LAYERS,
  degrees,
  flightMs,
  focusFeatures,
  focusRadius,
  IRELAND_BOUNDS,
  mapViewOf,
  modelLabel,
  parseLayers,
  project,
  sameView,
  scaleLabel,
  seaward,
  unproject,
  viewFromBounds,
  type Camera,
} from "./mapLogic";
import { appChartColours, appChartStyle, appFoilColours, bathySource } from "./mapStyle";

const ireland: Camera = { center: [-8.1, 53.4], zoom: 6, width: 390, height: 760 };

describe("the camera", () => {
  it("puts the centre in the middle and round-trips a place", () => {
    expect(project(ireland, -8.1, 53.4)).toEqual([195, 380]);
    const [x, y] = project(ireland, -10, 52);
    const [lon, lat] = unproject(ireland, x, y);
    expect(lon).toBeCloseTo(-10, 9);
    expect(lat).toBeCloseTo(52, 9);
    // North is up, east is right.
    expect(project(ireland, -8.1, 54)[1]).toBeLessThan(380);
    expect(project(ireland, -7, 53.4)[0]).toBeGreaterThan(195);
  });

  it("doubles the scale with each zoom", () => {
    const a = project(ireland, -7.1, 53.4)[0] - 195;
    const b = project({ ...ireland, zoom: 7 }, -7.1, 53.4)[0] - 195;
    expect(b / a).toBeCloseTo(2, 9);
  });

  it("says what the view shows, and the wash's wider box", () => {
    const b = boundsOf(ireland);
    expect(b.west).toBeLessThan(-8.1);
    expect(b.east).toBeGreaterThan(-8.1);
    expect(b.north).toBeGreaterThan(53.4);
    const v = mapViewOf(ireland);
    expect(v.west).toBeLessThan(b.west);
    expect(v.north).toBeGreaterThan(b.north);
    // 512 × 2^6 points round the world.
    expect(v.pxPerLon).toBeCloseTo((512 * 64) / 360, 6);
    expect(v.pxPerLat).toBeGreaterThan(v.pxPerLon);
  });

  it("reads MapLibre's bounds, and refuses nonsense", () => {
    expect(viewFromBounds([-10, 51, -6, 55])).toEqual({ west: -10, south: 51, east: -6, north: 55 });
    expect(viewFromBounds([-10, 51, -12, 55])).toBeNull();
    expect(viewFromBounds([NaN, 51, -6, 55])).toBeNull();
    expect(viewFromBounds(null)).toBeNull();
    expect(sameView({ west: 1, south: 2, east: 3, north: 4 }, { west: 1, south: 2, east: 3.00001, north: 4 })).toBe(true);
    expect(sameView(null, { west: 1, south: 2, east: 3, north: 4 })).toBe(false);
  });

  it("gives the scale as the site's key does", () => {
    expect(scaleLabel(53.4, 6)).toMatch(/^SCALE 1 : \d{1,3}( \d{3})*$/);
    // Zoomed in one step, the figure halves.
    const n = (z: number) => Number(scaleLabel(53.4, z).slice(10).replace(/ /g, ""));
    expect(n(10) / n(11)).toBeCloseTo(2, 1);
  });

  it("stands a little out to sea from a spot", () => {
    const [lon, lat] = seaward({ lon: -10, lat: 52, facing: 0 });
    expect(lon).toBeCloseTo(-10, 9);
    expect(lat).toBeGreaterThan(52);
    expect(seaward({ lon: -10, lat: 52, facing: null })).toEqual([-10, 52]);
  });

  it("flies further for longer, never more than 1.6 s", () => {
    const near = flightMs(ireland, { center: [-8, 53.4], zoom: 6 });
    const far = flightMs(ireland, { center: [-6, 55], zoom: 10.4 });
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThanOrEqual(1600);
    expect(IRELAND_BOUNDS).toEqual([-10.75, 51.38, -5.42, 55.42]);
  });

  it("cuts the focus's rings out of the world, wound against it", () => {
    const fc = focusFeatures(-10, 52.2, 3000);
    expect(fc.features).toHaveLength(3);
    const [outer, hole] = fc.features[0].geometry.coordinates;
    const area = (ring: number[][]) =>
      ring.slice(1).reduce((sum, [x, y], i) => sum + (ring[i][0] * y - x * ring[i][1]), 0);
    expect(Math.sign(area(outer))).toBe(-Math.sign(area(hole)));
    expect(focusRadius(ireland, 52.2, 150)).toBeGreaterThan(0);
  });

  it("names a bare point by its degrees", () => {
    expect(degrees(52.123, -10.05)).toBe("52.12° N, 10.05° W");
  });
});

describe("the stored layers", () => {
  it("reads the site's JSON, and the defaults from anything else", () => {
    expect(parseLayers(null)).toEqual(DEFAULT_LAYERS);
    expect(parseLayers("not json")).toEqual(DEFAULT_LAYERS);
    expect(parseLayers("[1,2]")).toEqual(DEFAULT_LAYERS);
    expect(parseLayers(JSON.stringify({ tints: false, satellite: "high" }))).toEqual({
      ...DEFAULT_LAYERS,
      tints: false,
      satellite: "high",
    });
    expect(parseLayers(JSON.stringify({ foil: "yes", satellite: "mid" }))).toEqual(DEFAULT_LAYERS);
  });
});

describe("the model on the chart", () => {
  const harmonie = { name: "HARMONIE", run: "06:00 UTC", staleness: "fresh" } as const;
  // Sat 24 Oct 2026, 09:00 in Ireland (still summer time: 08:00 UTC).
  const seam = Date.parse("2026-10-24T08:00:00Z");

  it("names the rider's model and run inside the run", () => {
    expect(modelLabel(harmonie, null)).toEqual({
      text: "HARMONIE · 06:00 UTC",
      spoken: "HARMONIE on the map, 06:00 UTC run. Opens Layers.",
      warn: false,
    });
    expect(modelLabel({ ...harmonie, staleness: "stale" }, null).text).toBe("HARMONIE · 06:00 UTC · older run");
  });

  it("names the model handed over to past the end of the rider's run, and from when", () => {
    const ecmwf = { name: "ECMWF", side: "after", at: seam, staleness: "fresh" } as const;
    expect(modelLabel(harmonie, ecmwf)).toEqual({
      text: "ECMWF from Sat 09:00",
      spoken: "ECMWF on the map from Sat 09:00, past the end of HARMONIE’s run. Opens Layers.",
      warn: false,
    });
    // Before the rider's run starts, until it does.
    expect(modelLabel(harmonie, { ...ecmwf, side: "before" }).text).toBe("ECMWF until Sat 09:00");
    // The run drawn is the one whose age is said: here ECMWF's, not HARMONIE's.
    const older = modelLabel(harmonie, { ...ecmwf, staleness: "stale" });
    expect(older.text).toBe("ECMWF from Sat 09:00 · older run");
    expect(older.warn).toBe(true);
    // While the column it starts at is not known, the model alone.
    expect(modelLabel(harmonie, { ...ecmwf, at: null }).text).toBe("ECMWF");
  });
});

describe("the chart's style, from the app's tokens", () => {
  it("is the site's chart with every colour filled", () => {
    const c = appChartColours();
    expect(c.paper).toBe(colors.paper);
    expect(c.ink).toBe(colors.ink);
    expect(c.tints).toHaveLength(11);
    expect(c.tints.every(Boolean)).toBe(true);
    expect([c.land, c.depth, c.relief, c.sand, c.wetland, c.halo].every(Boolean)).toBe(true);
    const style = appChartStyle();
    expect(style.sources.bathy).toMatchObject({ type: "vector", url: bathySource() });
    expect(bathySource()).toMatch(/^pmtiles:\/\/https:\/\/data\.wingfoil\.ie\/bathy\/.+\.pmtiles$/);
    expect(style.layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(["water", "bands", "relief", "rivers", "coast", "water-names", "places", "places-near"]),
    );
  });

  it("reads the foil layer's colours", () => {
    const foil = appFoilColours();
    expect(
      [foil.edge, foil.shallow, foil.enough, foil.deep, foil.deeper, foil.line, foil.dry, foil.unsurveyed].every(Boolean),
    ).toBe(true);
  });
});
