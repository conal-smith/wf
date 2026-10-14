import { describe, expect, it } from "vitest";
import { DEFAULT_RIDER, rateHour, type Rider } from "../../../../force5/src/stars";
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { colors } from "../../theme/tokens";
import {
  labelLayers,
  labelRank,
  lightFeatures,
  lightLabel,
  lightLayers,
  lightLevel,
  lightStates,
  lightSub,
  wedgePolygon,
  type LightState,
} from "./lightsLogic";

const spot = (id: string, facing: number | null = 270): Spot => ({
  id,
  name: id.toUpperCase(),
  county: "Kerry",
  lat: 52.2,
  lon: -10,
  note: "",
  facing,
});

const hour = (windKn: number, from: number, facing: number | null, rider: Rider = DEFAULT_RIDER, daylight = true): PlaceHour => ({
  windKn,
  gustKn: windKn * 1.2,
  from,
  agreement: "high",
  daylight,
  rating: rateHour({ windKn, gustKn: windKn * 1.2, from, agreement: "high", daylight }, { facing }, rider),
});

describe("the lights' states", () => {
  const spots = [spot("onshore"), spot("offshore"), spot("night"), spot("unread")];
  const hours = new Map<string, PlaceHour[]>([
    ["onshore", [hour(18, 270, 270), hour(18, 250, 270)]],
    ["offshore", [hour(18, 90, 270), hour(18, 90, 270)]],
    ["night", [hour(18, 270, 270, DEFAULT_RIDER, false), hour(18, 270, 270, DEFAULT_RIDER, false)]],
  ]);
  const states = lightStates(spots, hours, 1, DEFAULT_RIDER, "onshore");

  it("reads each place's hour, as the site's map does", () => {
    const on = states.get("onshore")!;
    expect(on.pending).toBe(false);
    expect(on.stars).toBe(hours.get("onshore")![1].rating!.stars);
    expect(on.compass).toBe("WSW");
    expect(on.from).toBe(250);
    expect(states.get("unread")!.pending).toBe(true);
    expect(states.get("night")!.dark).toBe(true);
    expect(states.get("offshore")!.mark).toBe("struck");
  });

  it("gives the riding wedge to the open spot alone", () => {
    expect(states.get("offshore")!.wedge).toBeNull();
    const open = lightStates(spots, hours, 1, DEFAULT_RIDER, "offshore");
    expect(states.get("onshore")!.wedge === null || typeof states.get("onshore")!.wedge?.from === "number").toBe(true);
    expect(open.get("onshore")!.wedge).toBeNull();
  });

  it("encodes a level the layers draw from", () => {
    expect(lightLevel(undefined)).toBe("pending");
    expect(lightLevel(states.get("unread"))).toBe("pending");
    expect(lightLevel(states.get("night"))).toBe("dark");
    expect(lightLevel({ ...states.get("onshore")!, stars: 5 })).toBe("s5");
  });

  it("says each light aloud", () => {
    const s: LightState = { stars: 4, pending: false, dark: false, from: 250, windKn: 18.4, compass: "WSW", mark: "cross-off", wedge: null };
    expect(lightLabel(spot("inch"), s, "14:00")).toBe("INCH, Kerry: 14:00 4 stars, WSW 18 knots, cross-offshore");
    expect(lightLabel(spot("inch"), { ...s, stars: 1, mark: null }, "")).toBe("INCH, Kerry: 1 star, WSW 18 knots");
    expect(lightLabel(spot("inch"), undefined, "14:00")).toBe("INCH, Kerry");
    expect(lightSub(s)).toBe("WSW 18 · cross-off");
    expect(lightSub({ ...s, mark: "struck" })).toBe("WSW 18 · offshore");
  });
});

describe("the lights' features", () => {
  const spots = [spot("a"), spot("b"), spot("c")];
  const states = new Map<string, LightState>([
    ["a", { stars: 3, pending: false, dark: false, from: 270, windKn: 15, compass: "W", mark: null, wedge: null }],
    ["b", { stars: 1, pending: false, dark: false, from: 90, windKn: 15, compass: "E", mark: "struck", wedge: null }],
  ]);
  const fc = lightFeatures(spots, states, "c", new Set(["b"]));

  it("carries what each light is, the open one drawn last", () => {
    // The plain lights first, then the starred, then the open spot on top.
    expect(fc.features.map((f) => f.properties.id)).toEqual(["a", "b", "c"]);
    expect(fc.features[fc.features.length - 1].properties.sel).toBe(true);
    const a = fc.features.find((f) => f.properties.id === "a")!.properties;
    expect(a).toMatchObject({ level: "s3", n: "3", arrow: true, rot: 90, mark: "", named: false, sub: "W 15" });
    const b = fc.features.find((f) => f.properties.id === "b")!.properties;
    expect(b).toMatchObject({ mark: "off", named: true, rot: 270 });
    const c = fc.features.find((f) => f.properties.id === "c")!.properties;
    expect(c).toMatchObject({ level: "pending", n: "", arrow: false });
    expect(fc.features[0].geometry.coordinates).toEqual([-10, 52.2]);
  });

  it("ranks the names: the open spot, then the starred, then by stars", () => {
    expect(labelRank("s0", true, false)).toBe(100);
    expect(labelRank("s1", false, true)).toBeGreaterThan(labelRank("s5", false, false));
    expect(labelRank("s4", false, false)).toBeGreaterThan(labelRank("s2", false, false));
    expect(labelRank("dark", false, false)).toBe(-1);
  });

  it("draws in the theme's colours only", () => {
    const json = JSON.stringify(lightLayers("lights"));
    const hexes = json.match(/#[0-9a-f]{6}/gi) ?? [];
    const allowed = new Set(Object.values(colors).map((c) => c.toLowerCase()));
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.every((h) => allowed.has(h.toLowerCase()))).toBe(true);
  });

  it("shows the names it should, and only the open one's when quiet", () => {
    const [rest, pinned] = labelLayers("lights", { names: true, focused: false });
    expect(rest.layout.visibility).toBe("visible");
    expect(rest.minzoom).toBe(8.6);
    expect(JSON.stringify(pinned.filter)).toContain("named");
    const [quietRest, quietPinned] = labelLayers("lights", { names: false, focused: false });
    expect(quietRest.layout.visibility).toBe("none");
    expect(JSON.stringify(quietPinned.filter)).not.toContain("named");
  });
});

describe("the wedge", () => {
  it("spans its headings, longer for more power, the same size on the screen at any zoom", () => {
    const wedge = { from: 300, to: 380, power: 1, state: "sweet" as const };
    const f = wedgePolygon(-10, 52, wedge, 10, "s4", "");
    const ring = f.geometry.coordinates[0];
    expect(ring[0]).toEqual([-10, 52]);
    expect(ring[ring.length - 1]).toEqual([-10, 52]);
    // It starts north-west of the light and ends north-east of it.
    expect(ring[1][0]).toBeLessThan(-10);
    expect(ring[ring.length - 2][0]).toBeGreaterThan(-10);
    const reach = (z: number, power: number) =>
      Math.max(...wedgePolygon(-10, 52, { ...wedge, power }, z, "s4", "").geometry.coordinates[0].map((p) => p[1] - 52));
    expect(reach(10, 1) / reach(11, 1)).toBeCloseTo(2, 1);
    expect(reach(10, 0.45)).toBeLessThan(reach(10, 1));
    expect(f.properties.tone).toBe(colors.ink);
    expect(wedgePolygon(-10, 52, wedge, 10, "s5", "").properties.tone).toBe(colors.magenta);
    expect(wedgePolygon(-10, 52, wedge, 10, "s3", "xoff").properties.tone).toBe(colors.pen);
  });
});
