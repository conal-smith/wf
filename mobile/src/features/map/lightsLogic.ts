/**
 * The spots as a chart's lights (force5/src/lights.ts, src/map.css), encoded
 * for the GPU: one GeoJSON point per place whose properties say what its
 * light is, and native layers that draw the ring, the figure, the downwind
 * arrow, the pen's strike and loop, and the name from those properties. A
 * hundred and fifty places pan at the map's own frame rate, and an hour's
 * change is one new FeatureCollection, not a hundred and fifty views.
 *
 *   ink ring, ink fill    three and four stars
 *   magenta               five
 *   plain ring            one and two
 *   dashed                none; dotted while the place is still being rated
 *   faint                 the dark
 *   struck in the pen     a true offshore hour (and a cross-offshore one for a learner)
 *   red arrow             cross-offshore
 */
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { Wedge } from "../../../../force5/src/rideWedge";
import { rideWedge } from "../../../../force5/src/rideWedge";
import type { Rider } from "../../../../force5/src/stars";
import { compass, type Spot } from "../../../../force5/src/weather";
import { offshoreMark, type PlaceHour } from "../../../../src/ratings";
import { colors } from "../../theme/tokens";
import { metresPerPoint } from "./mapLogic";

/** One light at the selected hour (force5/src/lights.ts `LightState`). */
export interface LightState {
  /** Solid stars at the hour, or null where it is dark or not rated yet. */
  stars: number | null;
  /** True until the place's ratings have been worked out. */
  pending: boolean;
  dark: boolean;
  /** Where the wind blows from, in degrees, or null with no reading. */
  from: number | null;
  windKn: number | null;
  compass: string | null;
  mark: "struck" | "cross-off" | null;
  /** The headings the rider can hold out to sea: the open spot's only. */
  wedge: Wedge | null;
}

/**
 * Every place's light at the selected hour, as the site's map works it out
 * (src/App.tsx `lights`): the open spot alone gets the riding wedge.
 */
export function lightStates(
  spots: readonly Spot[],
  hours: ReadonlyMap<string, readonly PlaceHour[]>,
  selected: number,
  rider: Rider,
  openId: string | null,
): Map<string, LightState> {
  const out = new Map<string, LightState>();
  for (const spot of spots) {
    const row = hours.get(spot.id);
    const hour = row?.[selected];
    out.set(spot.id, {
      pending: !row,
      stars: hour?.rating ? hour.rating.stars : null,
      dark: !!hour && !hour.daylight,
      from: hour?.from ?? null,
      windKn: hour?.windKn ?? null,
      compass: hour?.from != null ? compass(hour.from) : null,
      mark: offshoreMark(hour?.rating ?? null, rider),
      wedge:
        spot.id === openId && hour?.rating
          ? rideWedge(rider, hour.windKn, hour.gustKn, hour.from, spot.facing ?? null)
          : null,
    });
  }
  return out;
}

export type LightLevel = "pending" | "dark" | "s0" | "s1" | "s2" | "s3" | "s4" | "s5";

export const lightLevel = (s: LightState | undefined): LightLevel =>
  !s || s.pending ? "pending" : s.dark || s.stars === null ? "dark" : (`s${Math.max(0, Math.min(5, s.stars))}` as LightLevel);

/**
 * What a screen reader says for a light (src/App.tsx `lightLabel`):
 * "Brandon Bay, Kerry: 14:00 4 stars, WSW 18 knots, cross-offshore".
 */
export function lightLabel(spot: Spot, s: LightState | undefined, clock: string): string {
  const where = `${spot.name}${spot.county ? `, ${spot.county}` : ""}`;
  if (!s || s.pending) return where;
  const stars = s.dark || s.stars === null ? "dark" : `${s.stars} star${s.stars === 1 ? "" : "s"}`;
  const wind = s.compass && s.windKn !== null ? `, ${s.compass} ${Math.round(s.windKn)} knots` : "";
  const mark = s.mark === "struck" ? ", offshore" : s.mark === "cross-off" ? ", cross-offshore" : "";
  return `${where}: ${clock ? `${clock} ` : ""}${stars}${wind}${mark}`;
}

/** The wind and the shore under a light's name (lights.ts): "WSW 18 · offshore". */
export function lightSub(s: LightState | undefined): string {
  if (!s || s.pending || s.compass === null || s.windKn === null) return "";
  const mark = s.mark ? ` · ${s.mark === "struck" ? "offshore" : "cross-off"}` : "";
  return `${s.compass} ${Math.round(s.windKn)}${mark}`;
}

/** Ranks a name for placement: the open spot, then the starred, then by stars (lights.ts). */
export function labelRank(level: LightLevel, selected: boolean, named: boolean): number {
  if (selected) return 100;
  const stars = level.startsWith("s") ? Number(level.slice(1)) : -1;
  return (named ? 50 : 0) + stars;
}

export interface LightProps {
  id: string;
  level: LightLevel;
  /** The ring's figure, or "" with none. */
  n: string;
  /** Whether the arrow is drawn, and its bearing (downwind). */
  arrow: boolean;
  rot: number;
  mark: "off" | "xoff" | "";
  sel: boolean;
  named: boolean;
  name: string;
  sub: string;
  /** Lower first: MapLibre places lower sort keys before higher ones. */
  sort: number;
}

/** The lights as one FeatureCollection, the open spot last so it is drawn on top. */
export function lightFeatures(
  spots: readonly Spot[],
  states: ReadonlyMap<string, LightState>,
  selectedId: string | null,
  named: ReadonlySet<string>,
): FeatureCollection<Point, LightProps> {
  const features: Feature<Point, LightProps>[] = spots.map((spot) => {
    const s = states.get(spot.id);
    const level = lightLevel(s);
    const sel = spot.id === selectedId;
    const star = named.has(spot.id);
    return {
      type: "Feature",
      id: spot.id,
      geometry: { type: "Point", coordinates: [spot.lon, spot.lat] },
      properties: {
        id: spot.id,
        level,
        n: s && !s.pending && !s.dark && s.stars !== null ? String(s.stars) : "",
        arrow: !!s && s.from !== null,
        rot: s && s.from !== null ? Math.round(s.from + 180) % 360 : 0,
        mark: s?.mark === "struck" ? "off" : s?.mark === "cross-off" ? "xoff" : "",
        sel,
        named: star,
        name: spot.name,
        sub: lightSub(s),
        sort: 200 - labelRank(level, sel, star),
      },
    };
  });
  // Drawn in order: the open spot over its neighbours, the starred over the rest.
  features.sort((a, b) => b.properties.sort - a.properties.sort);
  return { type: "FeatureCollection", features };
}

/* ---- the riding wedge ----------------------------------------------------- */

/** The wedge's radius in points: just foiling to fully powered (lights.ts). */
const WEDGE_SHORT = 11;
const WEDGE_LONG = 32;

/**
 * The open spot's wedge as a polygon on the chart, sized in points for a zoom:
 * redrawn when the camera settles, so it keeps its size on the screen.
 */
export function wedgePolygon(
  lon: number,
  lat: number,
  wedge: Wedge,
  zoom: number,
  level: LightLevel,
  mark: LightProps["mark"],
): Feature<Polygon, { tone: string; strength: number; over: boolean }> {
  const points = (WEDGE_SHORT + (WEDGE_LONG - WEDGE_SHORT) * wedge.power) * metresPerPoint(lat, zoom);
  const ring: [number, number][] = [[lon, lat]];
  const span = ((wedge.to - wedge.from + 360) % 360) || 360;
  const steps = Math.max(4, Math.ceil(span / 6));
  for (let k = 0; k <= steps; k++) {
    const bearing = ((wedge.from + (span * k) / steps) * Math.PI) / 180;
    ring.push([
      lon + (points * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180)),
      lat + (points * Math.cos(bearing)) / 110574,
    ]);
  }
  ring.push([lon, lat]);
  const stars = level.startsWith("s") ? Number(level.slice(1)) : 0;
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      tone: mark ? colors.pen : stars >= 5 ? colors.magenta : colors.ink,
      // src/map.css --wedge-op: quiet at none or one, deeper the more stars.
      strength: mark ? 0.6 : stars >= 5 ? 0.6 : stars >= 3 ? 0.55 : stars === 2 ? 0.35 : 0.2,
      over: wedge.state === "over",
    },
  };
}

/* ---- the layers ----------------------------------------------------------- */

const get = (key: keyof LightProps) => ["get", key];
const isLevel = (...levels: LightLevel[]) => ["in", get("level"), ["literal", levels]];
/** The light drawn at three quarters size zoomed out (src/map.css `.z-lo`). */
const small = (full: number) => ["step", ["zoom"], full * 0.74, 7.3, full];

/**
 * The lights' layers, bottom to top, as `<Layer>` props: the ring, the dashed
 * and dotted rings, the strike, the arrow, the figure, the starred mark and
 * the pen's loop round the open spot. Colours from the theme's tokens.
 */
export function lightLayers(source: string) {
  const ring = {
    id: "lt-ring",
    type: "circle" as const,
    source,
    paint: {
      "circle-radius": small(7.6),
      "circle-color": [
        "case",
        ["==", get("mark"), "off"],
        colors.paper,
        ["match", get("level"), ["s3", "s4", "dark"], colors.ink, "s5", colors.magenta, colors.paper],
      ],
      "circle-opacity": ["match", get("level"), "dark", 0.12, 1],
      "circle-stroke-color": [
        "case",
        ["==", get("mark"), "off"],
        colors.pen,
        ["match", get("level"), "s5", colors.magenta, colors.ink],
      ],
      "circle-stroke-width": ["case", ["all", isLevel("s0", "pending"), ["!=", get("mark"), "off"]], 0, 1.1],
      "circle-stroke-opacity": ["match", get("level"), "dark", 0.35, 1],
      "circle-pitch-alignment": "map",
    },
  };
  const dashed = {
    id: "lt-dashed",
    type: "symbol" as const,
    source,
    filter: ["all", isLevel("s0", "pending"), ["!=", get("mark"), "off"]],
    layout: {
      "icon-image": ["match", get("level"), "pending", "lt-dot", "lt-dash"],
      "icon-size": small(1),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-color": colors.ink, "icon-opacity": 0.5 },
  };
  const strike = {
    id: "lt-strike",
    type: "symbol" as const,
    source,
    filter: ["==", get("mark"), "off"],
    layout: {
      "icon-image": "lt-strike",
      "icon-size": small(1),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-color": colors.pen },
  };
  const arrow = {
    id: "lt-arrow",
    type: "symbol" as const,
    source,
    filter: ["==", get("arrow"), true],
    layout: {
      "icon-image": "lt-arrow",
      "icon-rotate": get("rot"),
      "icon-rotation-alignment": "map",
      "icon-size": small(1),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": ["case", ["!=", get("mark"), ""], colors.pen, colors.ink],
      "icon-opacity": ["match", get("level"), ["dark", "pending"], 0.35, 1],
    },
  };
  const figure = {
    id: "lt-n",
    type: "symbol" as const,
    source,
    filter: ["!=", get("n"), ""],
    layout: {
      "text-field": get("n"),
      "text-font": ["literal", ["Noto Sans Bold"]],
      "text-size": small(9.5),
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-anchor": "center",
    },
    paint: {
      "text-color": [
        "case",
        ["==", get("mark"), "off"],
        colors.pen,
        ["match", get("level"), ["s3", "s4", "s5"], colors.paper, colors.ink],
      ],
      "text-opacity": ["match", get("level"), "s0", 0.5, 1],
    },
  };
  const star = {
    id: "lt-star",
    type: "symbol" as const,
    source,
    filter: ["==", get("named"), true],
    layout: {
      "icon-image": "lt-star",
      "icon-size": small(0.85),
      "icon-offset": [9.5, -9.5],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": colors.ink,
      "icon-halo-color": colors.paper,
      "icon-halo-width": 1.5,
    },
  };
  const loop = {
    id: "lt-loop",
    type: "symbol" as const,
    source,
    filter: ["==", get("sel"), true],
    layout: {
      "icon-image": "pen-loop",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-color": colors.pen, "icon-opacity": 0.88 },
  };
  return [ring, dashed, strike, arrow, figure, star, loop];
}

/**
 * The names beside the lights, placed by MapLibre's own collision pass (the
 * site lays them out by hand once the camera rests): the open spot's always,
 * the starred ones' always, the rest from zoom 8.6, each on the side with
 * room. `names` off leaves only the open spot's; a focused spot quietens the
 * others.
 */
export function labelLayers(source: string, opts: { names: boolean; focused: boolean }) {
  const quiet = !opts.names || opts.focused;
  const pinned = ["any", ["==", get("sel"), true], ["==", get("named"), true]];
  return [
    {
      ...labelStyle(source),
      id: "lt-lab",
      minzoom: 8.6,
      filter: ["!", pinned],
      layout: { ...labelStyle(source).layout, visibility: quiet ? "none" : "visible" },
    },
    {
      ...labelStyle(source),
      id: "lt-lab-pin",
      filter: quiet ? ["==", get("sel"), true] : pinned,
    },
  ];
}

function labelStyle(source: string) {
  return {
    type: "symbol" as const,
    source,
    layout: {
      "text-field": [
        "format",
        get("name"),
        { "text-font": ["literal", ["Noto Sans Italic"]], "font-scale": 1 },
        "\n",
        {},
        get("sub"),
        {
          "text-font": ["literal", ["Noto Sans Regular"]],
          "font-scale": 0.82,
          "text-color": [
            "match",
            get("mark"),
            "off",
            colors.penInk,
            "xoff",
            colors.muted,
            colors.magenta,
          ],
        },
      ],
      // The layer's own font too: a `format` section that names none (the
      // line break) falls back to it, and MapLibre's default stack is not on
      // OpenFreeMap's glyph server.
      "text-font": ["literal", ["Noto Sans Regular"]],
      "text-size": ["step", ["zoom"], 11, 7.3, 12],
      "text-variable-anchor": ["left", "right"],
      "text-radial-offset": 1.05,
      "text-justify": "auto",
      "text-line-height": 1.15,
      "symbol-sort-key": get("sort"),
      "text-padding": 2,
      visibility: "visible",
    },
    paint: {
      "text-color": colors.ink,
      "text-halo-color": colors.paper,
      "text-halo-width": 1.6,
    },
  };
}

/** The open spot's wedge under its light. */
export function wedgeLayer(source: string) {
  return {
    id: "lt-wedge",
    type: "fill" as const,
    source,
    paint: {
      "fill-color": ["get", "tone"],
      "fill-opacity": ["case", ["get", "over"], 0.12, ["get", "strength"]],
      "fill-antialias": true,
    },
  };
}
