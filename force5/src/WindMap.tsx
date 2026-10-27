import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { beaufortPath } from "../../ui/beaufortPath";
import { loopPath } from "../../ui/penPaths";
import {
  BATHY_PATH,
  CHART_BOUNDS,
  CHART_LAYERS,
  CHART_MIN_ZOOM,
  COAST_INK,
  IRELAND,
  PLACE_CLASSES,
  TILES_URL,
  chartColours,
  chartStyle,
} from "./chartStyle";
import { archiveUrl, pmtilesTile } from "./archives";
import { releaseReplacedColorRamps } from "./colorRelief";
import { forecastUrl } from "./urls";
import { createLights, type LightState, type Lights } from "./lights";
import {
  LOUPE_BAND,
  bezelTicks,
  dialDrawing,
  footBox,
  metresPerPixel,
  rangeRing,
  roseDrawing,
  roseFitRadius,
  roseRadius,
  roseScale,
  washHoles,
  WASH_BANDS,
  zoomFor,
  type FocusStyle,
  type Line,
  type LoupeRose,
  type RoseScale,
} from "./focus";
import { FOIL_MIN_ZOOM } from "./foilDepth";
import { drawNeatline } from "./neatline";
import { isLakeWater } from "./pointSource";
import { setMapView } from "./tiledField";
import {
  createWindLayer,
  viewOf,
  type WindLayer,
  type WindLayers,
} from "./windLayer";
import type { Frame, Spot } from "./weather";
import type { CurrentFeature } from "./currents";
import type { RainView } from "./rain";
import type { Units } from "./units";

maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);

/** All of Ireland, as the map opens on it (chartStyle.ts, the app's too). */
export { IRELAND };

let registered = false;
/**
 * MapLibre reads `pmtiles://` URLs through the pmtiles package, once a page,
 * over the archives archives.ts opens (whether or not the host serves ranges).
 */
export function registerPmtiles() {
  if (registered) return;
  maplibregl.addProtocol("pmtiles", pmtilesTile);
  registered = true;
}

/** Which parts of the chart are drawn. */
export interface ChartLayers {
  tints: boolean;
  soundings: boolean;
  relief: boolean;
  names: boolean;
  /** Foilable depth at the selected tide, round the coast. */
  foil: boolean;
  /** Surface currents at the hour shown: a rough guide, off unless asked for. */
  currents: boolean;
  /** The rain in the hour shown (force5/src/rain.ts), off unless asked for. */
  rain: boolean;
}

/** One area's foilable-depth layer (a region or a pilot), as the map draws it. */
export interface FoilView {
  id: string;
  /** The archive's absolute URL. */
  url: string;
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  /** The `color-relief-color` for the selected tide (foilRamp). */
  color: ExpressionSpecification;
  attribution: string;
}

/**
 * The satellite image under the chart (force5/src/satelliteIndex.ts): which
 * tide's, and the archive of each area in view.
 */
export interface SatelliteImage {
  option: "high" | "low";
  layers: readonly {
    /** The area's id, e.g. "ireland". */
    id: string;
    /** The archive's absolute URL. */
    url: string;
    bounds: [number, number, number, number];
    minzoom: number;
    maxzoom: number;
    tileSize: number;
    attribution: string;
  }[];
}

/** What the page can ask of the camera. */
export interface MapControls {
  flyTo(spot: Spot): void;
  fitIreland(duration?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  /** One light lit (a card for its place under the pointer), or none. */
  light(id: string | null): void;
  /**
   * A light pressed, drawn as the open spot's at once, before the page has
   * drawn the dock for it (./lights `choose`).
   */
  choose(id: string): void;
  /**
   * Hold the wind's particles still for a while (true) or let them run again
   * (false): beside a list that is scrolling, the page's frames are the
   * list's. The rider's own ask for less motion holds them still whatever.
   */
  pauseWind(still: boolean): void;
  map: maplibregl.Map;
}

type Props = {
  frame: Frame | null;
  spots: readonly Spot[];
  lights: ReadonlyMap<string, LightState>;
  /** Places whose names stay up at any zoom: the starred ones. */
  named: ReadonlySet<string>;
  lightLabel: (spot: Spot, state: LightState | undefined) => string;
  selectedId: string | null;
  /** Where the loupe or the range ring is laid (a spot or a tapped point), or null. */
  focus: { lon: number; lat: number } | null;
  /** The rider's choice of mark round the focus: a loupe, a range ring, or none. */
  focusStyle: FocusStyle;
  /** The rider's speed units, which the range ring's and the rose's distances follow (NM with knots). */
  units: Units;
  /** The loupe's ride rose for the dock's hour at the focus, or null with no wind to show. */
  rose: LoupeRose | null;
  /** Where the pen rings: the chosen spot or point. */
  mark: { lon: number; lat: number } | null;
  /** A point tapped on the open map, marked where it was tapped. */
  picked: { lon: number; lat: number } | null;
  /** The wind's two layers, the coloured wind and the particles, each on or off. */
  wind: WindLayers;
  layers: ChartLayers;
  /** The foilable-depth areas to draw, or null to draw none. */
  foil: readonly FoilView[] | null;
  /**
   * The Currents layer's arrows at the hour shown, or null with the layer
   * off. Its drawing code is loaded the first time there are any.
   */
  currents?: readonly CurrentFeature[] | null;
  /**
   * The Rain layer's picture at the hour shown, or null with the layer off or
   * nothing to draw. Its drawing code is loaded the first time there is one.
   */
  rain?: RainView | null;
  /** The satellite image to draw under the chart's lines, or null for none. */
  satellite?: SatelliteImage | null;
  reducedMotion: boolean;
  /** The dock's height: what a camera move keeps the spot above. */
  bottomInset: number;
  phone: boolean;
  onSelect: (spot: Spot) => void;
  /** A mouse comes onto a light (its place), or leaves it (null). */
  onHoverSpot?: (spot: Spot | null) => void;
  /** Where the rider is, drawn as a blue dot, or null where it is not known. */
  you?: { lon: number; lat: number } | null;
  /**
   * Whether a panel or a menu is open over the chart, and shuts on a press
   * away from it: a press on the chart then only shuts it, and picks and
   * chooses nothing.
   */
  covered?: () => boolean;
  /**
   * A tap on the open map, not a light: the point, the nearest place's name,
   * and whether the basemap has it on a lake rather than the sea. With a
   * spot or point already chosen, the page lets go of it instead.
   */
  onPick: (point: {
    lon: number;
    lat: number;
    place: string | null;
    lake: boolean;
  }) => void;
  onReady: (controls: MapControls | null) => void;
  /**
   * The map is made and knows its view, before its style has loaded: a frame
   * asked for from now on is read for that view, not the whole grid.
   */
  onMade?: () => void;
  /** A tile the frame on screen needs could not be read (windLayer.ts). */
  onTilesFailed?: (frame: Frame) => void;
  /**
   * The satellite image chosen is still coming in (true), or is drawn
   * (false): the picture shows whole, not tile by tile, so until it does the
   * page can say it is loading.
   */
  onSatelliteLoading?: (loading: boolean) => void;
};

/** The satellite image's opacity, once its tiles are in. */
const SATELLITE_OPACITY = 0.92;
/** How long a newly loaded satellite image takes to fade in over the old. */
const SATELLITE_FADE_MS = 300;
/** The longest a newly chosen image is kept back for its tiles. */
const SATELLITE_WAIT_MS = 10000;

const WORLD = [
  [-40, 35],
  [25, 35],
  [25, 72],
  [-40, 72],
  [-40, 35],
];

const SVG = "http://www.w3.org/2000/svg";

/**
 * The wash's layers, a band of it apiece (focus.ts `washHoles`): the first,
 * "focus", the loupe's, the rest the ring's as it feathers out.
 */
const WASH_LAYERS = Array.from({ length: WASH_BANDS }, (_, i) =>
  i ? `focus-${i}` : "focus",
);

/**
 * How far the mark round a spot is stretched through a zoom before it is drawn
 * again at its new size: a third smaller or half again larger, and its lines
 * and print still read as the mark's.
 */
const STRETCH = [0.67, 1.5] as const;

/**
 * While `redraw` draws over a drawing: for each parent, how many of its
 * elements have been drawn again so far.
 */
let drawn: Map<Element, number> | null = null;

/**
 * An SVG element, its attributes set, added to a parent. In a redraw, the
 * element already in its place is kept when it is of the same kind and
 * class, and only what differs is set.
 */
function svgEl(
  parent: Element,
  tag: string,
  attrs: Record<string, string | number> = {},
) {
  let el: Element | null = null;
  if (drawn) {
    const i = drawn.get(parent) ?? 0;
    drawn.set(parent, i + 1);
    const old = parent.children[i];
    if (
      old?.localName === tag &&
      old.getAttribute("class") === (attrs.class ?? null)
    ) {
      el = old;
      drawn.set(el, 0);
      for (const name of el.getAttributeNames())
        if (!(name in attrs)) el.removeAttribute(name);
    } else {
      el = document.createElementNS(SVG, tag);
      parent.insertBefore(el, old ?? null);
    }
  } else {
    el = document.createElementNS(SVG, tag);
    parent.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) {
    const v = typeof value === "number" ? value.toFixed(1) : value;
    if (el.getAttribute(key) !== v) el.setAttribute(key, v);
  }
  return el;
}

/** An element's words, set only when they are not already. */
function write(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** An attribute, set only when it is not already. */
function setAttr(el: Element, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Draws into `g` over what is drawn there: a frame of a zoom moves the
 * elements already drawn rather than building them again. What the new
 * drawing does not use goes.
 */
function redraw(g: Element, draw: () => void) {
  drawn = new Map([[g, 0]]);
  try {
    draw();
    for (const [parent, n] of drawn)
      while (parent.children.length > n) parent.lastElementChild!.remove();
  } finally {
    drawn = null;
  }
}

/** A line from focus.ts's geometry, as an SVG line. */
const lineAttrs = (l: Line) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 });

/** The hatches the rose fills with: ink for the no-go, the pen's for offshore. */
function hatches(g: SVGGElement) {
  const defs = svgEl(g, "defs");
  for (const [id, size, angle] of [
    ["loupe-hatch", 6, 45],
    ["loupe-redhatch", 3.6, -45],
    ["loupe-redlight", 6, -45],
  ] as const) {
    const p = svgEl(defs, "pattern", {
      id,
      width: size,
      height: size,
      patternUnits: "userSpaceOnUse",
      patternTransform: `rotate(${angle})`,
    });
    svgEl(p, "line", { class: id, x1: 0, y1: 0, x2: 0, y2: size });
  }
}

/**
 * The loupe at the origin, `r` pixels to the inside of its rim: drawn as the
 * chart draws a box, ink, a band of paper and ink, with a compass bezel's
 * ticks in the paper and N at the top. No handle and no magnifying: the chart
 * runs straight on through the glass.
 *
 * Inside it, the ride rose for the dock's hour (focus.ts `roseDrawing`): the
 * no-go hatched, the tack out washed in paper, the tack home dashed, the slow
 * water downwind of them faint along the rim, the drift downwind, and the
 * half-way ring with its distance when it is to scale. On the bezel, the
 * offshore winds in the pen's red and the needle in the wind's colour. The
 * reading in a box at its foot is `drawFoot`'s.
 */
function drawLoupe(
  g: SVGGElement,
  r: number,
  /** The rose's distances while it is to scale, else null. */
  scale: RoseScale | null,
  loupe: LoupeRose | null,
) {
  hatches(g);
  // Held at its smallest, no longer to scale: a compass, with nothing inside.
  const rose = roseDrawing(scale ? (loupe?.rose ?? null) : null, r, scale);
  const glass = svgEl(g, "g", { class: "map-rose" });
  if (rose.nogo) {
    const nogo = svgEl(glass, "g", { class: "map-rose-nogo" });
    svgEl(nogo, "path", { class: "map-rose-nogo-fill", d: rose.nogo.fill });
    svgEl(nogo, "path", { class: "map-rose-nogo-hatch", d: rose.nogo.fill });
    for (const e of rose.nogo.edges)
      svgEl(nogo, "line", { class: "map-rose-nogo-edge", ...lineAttrs(e) });
  }
  for (const fan of rose.fans) {
    const fg = svgEl(glass, "g", { class: `map-rose-fan is-${fan.kind}` });
    if (fan.fill)
      svgEl(fg, "path", { class: "map-rose-fan-fill", d: fan.fill });
    for (const e of fan.edges)
      svgEl(fg, "line", { class: "map-rose-fan-edge", ...lineAttrs(e) });
    svgEl(fg, "path", { class: "map-rose-fan-arc", d: fan.arc });
    if (fan.head) svgEl(fg, "path", { class: "map-rose-head", d: fan.head });
  }
  if (rose.slow) svgEl(glass, "path", { class: "map-rose-slow", d: rose.slow });
  for (const ring of rose.rings)
    svgEl(glass, "circle", { class: "map-rose-ring", r: ring.r });
  if (rose.drift) {
    const dg = svgEl(glass, "g", {
      class: `map-rose-drift${rose.drift.out ? " is-out" : ""}`,
    });
    svgEl(dg, "line", {
      class: "map-rose-drift-halo",
      ...lineAttrs(rose.drift.line),
    });
    svgEl(dg, "line", {
      class: "map-rose-drift-line",
      ...lineAttrs(rose.drift.line),
    });
    svgEl(dg, "path", { class: "map-rose-drift-head", d: rose.drift.head });
  }
  for (const l of [...rose.rings.map((ring) => ring.label), ...rose.labels])
    write(
      svgEl(glass, "text", {
        class: `map-rose-label is-${l.kind}`,
        x: l.x,
        y: l.y,
        "text-anchor": "middle",
      }),
      l.text,
    );

  const rim = svgEl(g, "g", { class: "map-loupe-rim" });
  svgEl(rim, "circle", { class: "map-loupe-band", r: r + LOUPE_BAND / 2 });
  svgEl(rim, "circle", { class: "map-loupe-edge is-inner", r });
  svgEl(rim, "circle", { class: "map-loupe-edge", r: r + LOUPE_BAND });
  const dial = loupe ? dialDrawing(loupe.rose.windFrom, loupe.facing, r) : null;
  for (const d of dial?.crossOff ?? [])
    svgEl(g, "path", { class: "map-dial-crossoff", d });
  if (dial?.offshore)
    svgEl(g, "path", { class: "map-dial-offshore", d: dial.offshore.band });
  for (const t of bezelTicks(r))
    svgEl(g, "line", {
      class: t.long ? "map-loupe-tick is-long" : "map-loupe-tick",
      x1: t.x1,
      y1: t.y1,
      x2: t.x2,
      y2: t.y2,
    });
  write(
    svgEl(g, "text", {
      class: "map-loupe-north",
      y: -r - 2.5,
      "text-anchor": "middle",
    }),
    "N",
  );
  // A glint on the glass, top left.
  const g0 = r - 16;
  svgEl(g, "path", {
    class: "map-loupe-glint",
    d: `M${(Math.cos(3.55) * g0).toFixed(1)} ${(Math.sin(3.55) * g0).toFixed(1)} A${g0} ${g0} 0 0 1 ${(Math.cos(4.25) * g0).toFixed(1)} ${(Math.sin(4.25) * g0).toFixed(1)}`,
  });
  if (!loupe || !dial) return;
  if (dial.offshore) {
    svgEl(g, "path", { class: "map-dial-offshore-arc", d: dial.offshore.arc });
    svgEl(g, "path", {
      id: "loupe-offshore-words",
      class: "map-dial-words-path",
      d: dial.offshore.text,
    });
    const words = svgEl(g, "text", { class: "map-dial-words" });
    write(
      svgEl(words, "textPath", {
        href: "#loupe-offshore-words",
        startOffset: "50%",
        "text-anchor": "middle",
      }),
      "OFFSHORE",
    );
  }
  const needle = svgEl(g, "g", { class: "map-dial-needle" });
  svgEl(needle, "path", {
    d: dial.needle,
    fill: loupe.colour,
  });
  svgEl(needle, "circle", { cx: dial.pin[0], cy: dial.pin[1], r: 1.6 });
}

/**
 * The box at the bezel's foot: the reading, and the wind's relation to the
 * shore. It is drawn round the origin of a sheet of its own and moved there
 * (`place` in the focus effect), so a box held in view as the chart moves
 * under it costs no drawing at all.
 */
function drawFoot(foot: SVGGElement, loupe: LoupeRose | null) {
  redraw(foot, () => {
    if (!loupe) return;
    const box = footBox(loupe.reading, loupe.relation, 0);
    svgEl(foot, "rect", {
      class: "map-loupe-foot-box",
      x: -box.w / 2,
      y: -box.h / 2,
      width: box.w,
      height: box.h,
    });
    svgEl(foot, "rect", {
      class: "map-loupe-foot-rule",
      x: -box.w / 2 + 2.5,
      y: -box.h / 2 + 2.5,
      width: box.w - 5,
      height: box.h - 5,
    });
    if (loupe.forces)
      drawForces(foot, -box.w / 2 + 9, loupe.from, loupe.forces);
    else
      write(
        svgEl(foot, "text", {
          class: "map-loupe-reading",
          x: -box.w / 2 + 9,
          y: 4.5,
        }),
        loupe.reading,
      );
    write(
      svgEl(foot, "text", {
        class: `map-loupe-relation${loupe.warn ? " is-warn" : ""}`,
        x: box.w / 2 - 8,
        y: 4,
        "text-anchor": "end",
      }),
      loupe.relation,
    );
  });
}

/** The reading's mono advance: IBM Plex Mono at 13px is 0.6em a character. */
const READING_ADVANCE = 7.8;

/**
 * The reading in Force: "SW", the wind's glyph and force, and the gust's
 * small after a "g". The words are one line of text with room left in it
 * (`dx`) where each glyph stands, the glyphs placed by the mono advance.
 */
function drawForces(
  foot: SVGGElement,
  x: number,
  from: string,
  { wind, gust }: { wind: number; gust: number | null },
) {
  const big = beaufortPath(wind, 13);
  const small = gust === null ? null : beaufortPath(gust, 10);
  // A class of its own, so a redraw never reuses the plain reading's text,
  // whose words would stay beside the parts.
  const text = svgEl(foot, "text", {
    class: "map-loupe-reading is-force",
    x,
    y: 4.5,
  });
  write(svgEl(text, "tspan"), `${from} `);
  const bigX = x + (from.length + 1) * READING_ADVANCE;
  write(svgEl(text, "tspan", { dx: big.width + 1 }), String(wind));
  const glyph = (
    d: ReturnType<typeof beaufortPath>,
    at: number,
    top: number,
  ) => {
    const g = svgEl(foot, "g", {
      class: "map-loupe-glyph",
      transform: `translate(${at.toFixed(1)} ${top})`,
    });
    svgEl(g, "path", { d: d.stroke, "stroke-width": d.strokeWidth });
    if (d.fill)
      svgEl(g, "path", {
        class: "is-pennant",
        d: d.fill,
        "stroke-width": d.strokeWidth * 0.6,
      });
  };
  glyph(big, bigX, -8);
  if (small && gust !== null) {
    write(svgEl(text, "tspan"), " g");
    write(svgEl(text, "tspan", { dx: small.width + 1 }), String(gust));
    const smallX =
      bigX + big.width + 1 + (String(wind).length + 2) * READING_ADVANCE;
    glyph(small, smallX, -5);
  }
}

/** The range ring at the origin, `r` pixels out, with its distance written up and to the right. */
function drawRange(g: SVGGElement, r: number, label: string) {
  svgEl(g, "circle", { class: "map-range-halo", r });
  svgEl(g, "circle", { class: "map-range-line", r });
  for (const [x, y] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ])
    svgEl(g, "line", {
      class: "map-range-tick",
      x1: x * (r - 6),
      y1: y * (r - 6),
      x2: x * (r + 6),
      y2: y * (r + 6),
    });
  write(
    svgEl(g, "text", {
      class: "map-range-label",
      x: Math.cos(-0.95) * r + 8,
      y: Math.sin(-0.95) * r - 6,
    }),
    label,
  );
}

function ring(lon: number, lat: number, metres: number, n = 56) {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([
      lon + (metres * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)),
      lat + (metres * Math.cos(a)) / 110574,
    ]);
  }
  return out;
}

/** A point a little out to sea from a spot, so the shore sits off-centre. */
function seaward(spot: Spot, metres = 500): [number, number] {
  if (spot.facing === null || spot.facing === undefined)
    return [spot.lon, spot.lat];
  const a = (spot.facing * Math.PI) / 180;
  return [
    spot.lon +
      (metres * Math.sin(a)) / (111320 * Math.cos((spot.lat * Math.PI) / 180)),
    spot.lat + (metres * Math.cos(a)) / 111320,
  ];
}

/** The nearest town or village to a point, within a few kilometres, or null. */
function nearestPlace(map: maplibregl.Map, lon: number, lat: number) {
  let best: string | null = null;
  let distance = 6;
  try {
    for (const f of map.querySourceFeatures("omt", { sourceLayer: "place" })) {
      if (f.geometry.type !== "Point") continue;
      const cls = f.properties?.class;
      if (!["city", "town", "village", "hamlet", "suburb"].includes(cls))
        continue;
      const [x, y] = f.geometry.coordinates;
      const km = Math.hypot(
        (x - lon) * 111.32 * Math.cos((lat * Math.PI) / 180),
        (y - lat) * 110.57,
      );
      const name = f.properties?.["name:en"] ?? f.properties?.name;
      if (km < distance && typeof name === "string") {
        distance = km;
        best = name;
      }
    }
  } catch {
    return null;
  }
  return best;
}

/** Is a point on a lake, by the basemap's water drawn there (isLakeWater)? */
function onLake(map: maplibregl.Map, point: maplibregl.PointLike) {
  try {
    if (!map.getLayer("water")) return false;
    return isLakeWater(
      map
        .queryRenderedFeatures(point, { layers: ["water"] })
        .map((f) => f.properties?.class),
    );
  } catch {
    return false;
  }
}

export default function WindMap(props: Props) {
  const {
    frame,
    spots,
    lights,
    named,
    selectedId,
    focus,
    focusStyle,
    units,
    rose,
    mark,
    picked,
    wind,
    layers,
    foil,
    currents = null,
    rain = null,
    satellite = null,
    reducedMotion,
    bottomInset,
    phone,
    you = null,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const particles = useRef<HTMLCanvasElement | null>(null);
  const neat = useRef<SVGSVGElement>(null);
  const pen = useRef<SVGSVGElement | null>(null);
  const glass = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const windRef = useRef<WindLayer | null>(null);
  const lightsRef = useRef<Lights | null>(null);
  /** The light lit, kept for a new set of lights. */
  const lit = useRef<string | null>(null);
  /** The particles held still beside a scrolling list. */
  const still = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  /** Room the boxes take round the map: what a camera move keeps clear of. */
  const padding = () => {
    const p = latest.current;
    return p.phone
      ? { top: 74, bottom: p.bottomInset + 64, left: 16, right: 16 }
      : {
          top: 84,
          bottom: p.bottomInset + 24,
          left: 40,
          right: 60,
        };
  };

  useEffect(() => {
    if (!container.current) return;
    registerPmtiles();
    // Once, with the map: the theme cannot move under a map that is already up.
    const colours = chartColours(getComputedStyle(document.documentElement));
    // The dev server's mode, not the env's `DEV` flag: that one follows
    // NODE_ENV, so a shell exporting NODE_ENV=development would ship this
    // warning in a built bundle (src/main.tsx guards the gallery the same way).
    if (
      import.meta.env.MODE === "development" &&
      !(colours.land && colours.paper && colours.tints.every(Boolean))
    )
      console.warn(
        "The chart has no colours to draw in: ui/theme.css is not on the document.",
      );
    // On the data host, as the forecast is (urls.ts): a versioned, immutable
    // file read by range, not one the site serves whole.
    const bathy = new URL(forecastUrl(BATHY_PATH), window.location.href).href;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: chartStyle(colours, archiveUrl(bathy)),
        bounds: IRELAND,
        fitBoundsOptions: { padding: 20 },
        minZoom: CHART_MIN_ZOOM,
        maxZoom: 14,
        maxBounds: CHART_BOUNDS,
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        // The page renders the credits behind its "i".
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        // A phone's third device pixel costs more than twice the fill of its
        // second and is not seen on a chart of fine lines: two is enough.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      });
    } catch {
      setError(
        "The map needs WebGL. Enable hardware acceleration or try another browser.",
      );
      return;
    }
    mapRef.current = map;
    // What the map shows, before it has loaded: the first frame's tiles are
    // asked for while the basemap is still on its way.
    setMapView(viewOf(map));
    latest.current.onMade?.();
    // The wind's canvas, the loupe's sheet and the pen's go inside the map,
    // over its canvas and, by z-index (src/map.css), the first two under the
    // lights and the pen over them.
    const canvasBox = map.getCanvasContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "particle-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const lens = document.createElement("div");
    lens.className = "map-focus";
    lens.setAttribute("aria-hidden", "true");
    const sheet = document.createElementNS(SVG, "svg");
    sheet.setAttribute("class", "map-pen");
    sheet.setAttribute("aria-hidden", "true");
    canvasBox.after(canvas, lens, sheet);
    particles.current = canvas;
    glass.current = lens;
    pen.current = sheet;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const loadTimeout = window.setTimeout(
      () =>
        setError(
          "The chart is taking too long to load. Check your connection and reload.",
        ),
      20000,
    );
    // A tap on the chart waiting to become a picked point (below). Back or
    // Forward lets go of it: the tap was on the chart as it stood, and a
    // point picked after the step opened over an address that names no spot
    // and pushed the history on from there (#90).
    let pending = 0;
    const cancelPick = () => window.clearTimeout(pending);
    window.addEventListener("popstate", cancelPick);
    // A press on the chart while something is open over it only shuts that:
    // it picks no point and chooses no light. Each of those boxes shuts
    // itself on the press, before its click, so whether one was open is read
    // first, as the press sets out.
    const box = container.current;
    let shutting = false;
    const onPress = (event: PointerEvent) => {
      if (box.contains(event.target as Node))
        shutting = latest.current.covered?.() ?? false;
    };
    window.addEventListener("pointerdown", onPress, true);
    // A light clicked in a tap's wait lets go of the tap, even the open
    // spot's own light: its click stops at the light (./lights), so the
    // map's own never hears of it.
    const onLight = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest?.(".spot-marker")) return;
      cancelPick();
      // A key on a light chooses it whatever was pressed before.
      if (shutting && event.detail) event.stopPropagation();
    };
    box.addEventListener("click", onLight, true);
    const zoomClass = () => {
      const z = map.getZoom();
      const el = map.getContainer();
      el.classList.toggle("z-lo", z < 7.3);
      el.classList.toggle("z-hi", z >= 8.6);
    };
    map.on("zoom", zoomClass);
    zoomClass();
    let basemapLoaded = false;
    map.on("sourcedata", (event) => {
      if (event.sourceId === "omt" && event.isSourceLoaded)
        basemapLoaded = true;
    });
    map.on("error", (event) => {
      const source = (event as unknown as { sourceId?: string }).sourceId;
      const url = String(event.error?.message ?? "");
      // The coast is the chart: without OpenFreeMap's tiles there is no map to
      // read, though the dock's forecast still is.
      if (
        !basemapLoaded &&
        (source === "omt" || url.includes(TILES_URL.replace("https://", "")))
      )
        setError("The chart could not load. Check your connection and reload.");
    });
    map.on("load", () => {
      clearTimeout(loadTimeout);
      // The light wash beyond the loupe or the range ring: paper over the
      // depths, the contours and the coast, under the wind and the lights.
      map.addSource("focus", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      WASH_LAYERS.forEach((id, band) =>
        map.addLayer(
          {
            id,
            type: "fill",
            source: "focus",
            filter: ["==", ["get", "band"], band],
            layout: { visibility: "none" },
            paint: {
              "fill-color": colours.paper,
              "fill-opacity": 0,
              "fill-opacity-transition": { duration: 450 },
            },
          },
          "water-names",
        ),
      );
      if (particles.current) {
        windRef.current = createWindLayer(map, particles.current, {
          ink: colours.ink,
          washBefore: "relief",
          onTilesFailed: (failed) => latest.current.onTilesFailed?.(failed),
        });
      }
      // A tap on the open map reads that point's forecast, or lets go of the
      // spot or point chosen, after a moment's wait for a second tap: a
      // double tap zooms and does neither.
      map.on("click", (event) => {
        cancelPick();
        const target = event.originalEvent.target as HTMLElement | null;
        if (target?.closest(".spot-marker")) return;
        if (shutting || event.originalEvent.detail > 1) return;
        const { lng, lat } = event.lngLat;
        // Read now, while the water drawn under the finger is what was tapped.
        const lake = onLake(map, event.point);
        // A spot chosen in the wait, from the list, the search or a link,
        // is the rider's last word: the tap picks nothing over it.
        const chosen = latest.current.selectedId;
        pending = window.setTimeout(() => {
          if (latest.current.selectedId !== chosen) return;
          latest.current.onPick({
            lon: lng,
            lat,
            place: nearestPlace(map, lng, lat),
            lake,
          });
        }, 300);
      });
      map.on("dblclick", cancelPick);
      map.on("movestart", (event) => {
        // A drag cancels the tap; the camera's own flights do not.
        if ((event as { originalEvent?: Event }).originalEvent) cancelPick();
      });
      setReady(true);
      latest.current.onReady({
        map,
        flyTo(spot) {
          // As long as the trip: a spot a few kilometres along the same
          // coast is a short glide, the length of the country a longer
          // flight. A fixed 2.2 s kept the rider waiting that long even for
          // the next bay over.
          // With the loupe, at the zoom that fits its rose (half a nautical
          // mile, or a kilometre) comfortably in the map left clear, on the
          // spot itself; else a little out to sea, closer in if already so.
          const { focusStyle: style, units: u } = latest.current;
          const pad = padding();
          const { clientWidth: cw, clientHeight: ch } = map.getContainer();
          const zoom =
            style === "loupe"
              ? Math.min(
                  map.getMaxZoom(),
                  zoomFor(
                    roseScale(u).metres,
                    roseFitRadius(
                      cw - pad.left - pad.right,
                      ch - pad.top - pad.bottom,
                    ),
                    spot.lat,
                  ),
                )
              : Math.max(map.getZoom(), 10.4);
          const center: [number, number] =
            style === "loupe" ? [spot.lon, spot.lat] : seaward(spot);
          const from = map.project(map.getCenter());
          const to = map.project(center);
          const { clientWidth: w, clientHeight: h } = map.getContainer();
          const across =
            Math.hypot(to.x - from.x, to.y - from.y) / Math.hypot(w, h);
          const climb = Math.abs(zoom - map.getZoom());
          const duration = Math.min(
            1600,
            450 + 300 * Math.min(climb, 3) + 500 * Math.min(across, 1.5),
          );
          map.flyTo({
            center,
            zoom,
            padding: pad,
            duration: latest.current.reducedMotion ? 0 : duration,
            curve: 1.5,
            essential: true,
          });
        },
        fitIreland(duration = 1400) {
          map.fitBounds(IRELAND, {
            padding: padding(),
            duration: latest.current.reducedMotion ? 0 : duration,
          });
        },
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        light(id) {
          lit.current = id;
          lightsRef.current?.light(id);
        },
        choose: (id) => lightsRef.current?.choose(id),
        pauseWind(on) {
          still.current = on;
          windRef.current?.setPaused(latest.current.reducedMotion || on);
        },
      });
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      clearTimeout(loadTimeout);
      cancelPick();
      window.removeEventListener("popstate", cancelPick);
      window.removeEventListener("pointerdown", onPress, true);
      box.removeEventListener("click", onLight, true);
      resize.disconnect();
      windRef.current?.destroy();
      windRef.current = null;
      lightsRef.current?.destroy();
      lightsRef.current = null;
      latest.current.onReady(null);
      setReady(false);
      // Ours, not the map's: it leaves them in the container otherwise.
      canvas.remove();
      lens.remove();
      sheet.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The wind: its frame, its layers, the rider's colours, and motion.
  useEffect(() => {
    windRef.current?.setFrame(frame);
  }, [ready, frame]);
  const { wash, particles: lines } = wind;
  useEffect(() => {
    windRef.current?.setWind({ wash, particles: lines });
    // What is drawn, for the specs: "wash particles", either, or "".
    particles.current?.setAttribute(
      "data-wind",
      [wash && "wash", lines && "particles"].filter(Boolean).join(" "),
    );
  }, [ready, wash, lines]);
  useEffect(() => {
    const map = mapRef.current;
    // The coast heavier over the coloured wind, so the shore stays drawn.
    if (ready && map?.getLayer("coast")) {
      const coast = COAST_INK[wash ? "wash" : "chart"];
      map.setPaintProperty("coast", "line-opacity", coast["line-opacity"]);
      map.setPaintProperty("coast", "line-width", coast["line-width"]);
    }
    // The wind stays at full strength round a focused spot: under the wash,
    // the focus quietens the depths it is drawn over and leaves the wash be.
    if (!ready || !map?.getLayer("focus")) return;
    const settle = () => {
      if (!map.getLayer("focus")) return;
      const under =
        wash && map.getLayer("wind-wash") ? "wind-wash" : "water-names";
      const order = map.getLayersOrder();
      const at = order.indexOf("focus");
      // Moving a layer is itself a style change: only when it is out of place.
      if ([...WASH_LAYERS, under].some((id, i) => order[at + i] !== id))
        for (const id of WASH_LAYERS) map.moveLayer(id, under);
    };
    settle();
    // The wash's layer is added once its first image is ready.
    map.on("styledata", settle);
    return () => {
      map.off("styledata", settle);
    };
  }, [ready, wash]);
  useEffect(() => {
    windRef.current?.setPaused(reducedMotion || still.current);
  }, [ready, reducedMotion]);

  // The chart's own layers, from the layers panel.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [key, ids] of Object.entries(CHART_LAYERS))
      for (const id of ids)
        if (map.getLayer(id))
          map.setLayoutProperty(
            id,
            "visibility",
            layers[key as keyof typeof CHART_LAYERS] ? "visible" : "none",
          );
    map.getContainer().classList.toggle("no-names", !layers.names);
  }, [ready, layers]);

  // Foilable depth: one raster-dem source and color-relief layer per area
  // (a tide station's region, or a pilot), made the first time it comes into
  // view and kept, hidden when out of it; the tide moves only the ramp's
  // stops. Over the depth tints and the contours, under the rivers, the
  // coast's ink and every name. A layer shows from half a zoom under its
  // archive's min zoom: MapLibre rounds a raster's zoom, so that is where its
  // tiles start, and where a region's cut-out for a pilot's box starts too.
  // Never further out than FOIL_MIN_ZOOM: a zoom out past it hides the
  // layers at once, and their tiles are not read through the rest of it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const shown = new Set<string>();
    for (const area of foil ?? []) {
      const id = `foil-${area.id}`;
      shown.add(id);
      if (!map.getSource(id))
        map.addSource(id, {
          type: "raster-dem",
          url: archiveUrl(area.url),
          encoding: "terrarium",
          tileSize: area.tileSize,
          bounds: area.bounds,
          minzoom: area.minzoom,
          maxzoom: area.maxzoom,
          attribution: area.attribution,
        });
      if (!map.getLayer(id)) {
        map.addLayer(
          {
            id,
            type: "color-relief",
            source: id,
            minzoom: Math.max(FOIL_MIN_ZOOM, area.minzoom - 0.5),
            paint: {
              "color-relief-color": area.color,
              "color-relief-opacity": 1,
              // No fade: the ramp is not transitioned anyway, but any paint
              // change starts the style's 300 ms transition on the opacity,
              // and the whole map is drawn every frame until it ends. A new
              // hour drew 17 frames for one change (scripts/perf).
              "color-relief-opacity-transition": { duration: 0, delay: 0 },
              // Heights interpolated between pixels, so the edges and the
              // waterline are smooth. The build keeps reserved values from
              // meeting where that would sweep through the ramp: land beside
              // water is padded to just over the dry ceiling, and OSM's
              // coastline decides which is which (scripts/foildepth).
              resampling: "linear",
            },
          },
          map.getLayer("rivers") ? "rivers" : undefined,
        );
        // Each hour's ramp is two new textures: the old pair is deleted.
        releaseReplacedColorRamps(map.getLayer(id));
      } else
        // foilRamp's own stops: valid by construction, so not validated
        // again for every area at every hour.
        map.setPaintProperty(id, "color-relief-color", area.color, {
          validate: false,
        });
      map.setLayoutProperty(id, "visibility", "visible");
    }
    for (const id of map.getLayersOrder())
      if (id.startsWith("foil-") && !shown.has(id))
        map.setLayoutProperty(id, "visibility", "none");
  }, [ready, foil]);

  // Currents: one GeoJSON source and one symbol layer (currentsLayer.ts),
  // whose code is fetched the first time the layer is turned on.
  const currentsLayer = useRef<typeof import("./currentsLayer") | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!currents) {
      currentsLayer.current?.hideCurrents(map);
      return;
    }
    let live = true;
    import("./currentsLayer").then((layer) => {
      currentsLayer.current = layer;
      if (live && mapRef.current === map)
        layer.drawCurrents(map, [...currents]);
    });
    return () => {
      live = false;
    };
  }, [ready, currents]);

  // Rain: one image source and one raster layer under the chart's ink
  // (rainLayer.ts), whose code is fetched the first time there is rain to draw.
  const rainLayer = useRef<typeof import("./rainLayer") | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!rain) {
      rainLayer.current?.hideRain(map);
      return;
    }
    let live = true;
    import("./rainLayer").then((layer) => {
      rainLayer.current = layer;
      if (live && mapRef.current === map) layer.drawRain(map, rain);
    });
    return () => {
      live = false;
    };
  }, [ready, rain]);

  // The satellite image: one raster source and layer per area and tide, made
  // the first time it is wanted and kept, hidden when another tide is chosen
  // or its area leaves the view. Over the land and the sea's fills and the
  // depth tints, which it covers, and under the relief, the contours, the
  // foilable depth, the rivers, the coast's ink and every name, so the
  // chart's lines still read over it. Read by range only: an archive is a
  // quarter of a gigabyte, and a host that answered with all of it would be
  // refused rather than downloaded (archives.ts).
  //
  // A layer newly shown is drawn see-through until its tiles for the view
  // are in, and only then fades in, whole, over what was there; the image it
  // replaces (the other tide's) stays under it until then. Drawn as its tiles
  // came, the new tide would cover the view a rectangle at a time, with the
  // bare chart between (#39).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const shown = new Set<string>();
    const waiting: string[] = [];
    for (const area of satellite?.layers ?? []) {
      const id = `satellite-${area.id}-${satellite!.option}`;
      shown.add(id);
      if (!map.getSource(id))
        map.addSource(id, {
          type: "raster",
          url: archiveUrl(area.url, { rangesOnly: true }),
          tileSize: area.tileSize,
          bounds: area.bounds,
          minzoom: area.minzoom,
          maxzoom: area.maxzoom,
          attribution: area.attribution,
        });
      const hidden =
        !map.getLayer(id) || map.getLayoutProperty(id, "visibility") === "none";
      if (!map.getLayer(id))
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            // MapLibre rounds a raster's zoom: half a zoom under the archive's
            // first is where its tiles start.
            minzoom: Math.max(0, area.minzoom - 0.5),
            paint: { "raster-opacity": 0, "raster-fade-duration": 150 },
          },
          map.getLayer("relief") ? "relief" : undefined,
        );
      if (hidden) {
        map.setPaintProperty(id, "raster-opacity-transition", {
          duration: 0,
          delay: 0,
        });
        map.setPaintProperty(id, "raster-opacity", 0);
        map.setLayoutProperty(id, "visibility", "visible");
      }
      if (map.getPaintProperty(id, "raster-opacity") === 0) waiting.push(id);
    }
    const leaving = () =>
      map
        .getLayersOrder()
        .filter(
          (id) =>
            id.startsWith("satellite-") &&
            !shown.has(id) &&
            map.getLayoutProperty(id, "visibility") !== "none",
        );
    const hideLeaving = () => {
      for (const id of leaving())
        map.setLayoutProperty(id, "visibility", "none");
    };
    map.getContainer().dataset.satellite = satellite?.option ?? "off";
    const loading = (on: boolean) => {
      map.getContainer().dataset.satelliteLoading = String(on);
      latest.current.onSatelliteLoading?.(on);
    };
    if (!waiting.length) {
      hideLeaving();
      loading(false);
      return;
    }
    loading(true);
    let fading: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      map.off("sourcedata", check);
      clearTimeout(cap);
      const duration = latest.current.reducedMotion ? 0 : SATELLITE_FADE_MS;
      for (const id of waiting) {
        map.setPaintProperty(id, "raster-opacity-transition", {
          duration,
          delay: 0,
        });
        map.setPaintProperty(id, "raster-opacity", SATELLITE_OPACITY);
      }
      loading(false);
      fading = setTimeout(hideLeaving, duration);
    };
    const check = () => {
      if (waiting.every((id) => map.isSourceLoaded(id))) reveal();
    };
    // A host that never answers keeps nothing back for long.
    const cap = setTimeout(reveal, SATELLITE_WAIT_MS);
    map.on("sourcedata", check);
    check();
    return () => {
      map.off("sourcedata", check);
      clearTimeout(cap);
      clearTimeout(fading);
    };
  }, [ready, satellite]);

  // The lights: made once per set of places, then written to in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !spots.length) return;
    lightsRef.current = createLights(
      map,
      spots,
      (spot) => latest.current.onSelect(spot),
      (spot) => latest.current.onHoverSpot?.(spot),
    );
    lightsRef.current.light(lit.current);
    return () => {
      lightsRef.current?.destroy();
      lightsRef.current = null;
    };
  }, [ready, spots]);
  useEffect(() => {
    lightsRef.current?.update(
      lights,
      selectedId,
      named,
      props.lightLabel,
      units,
    );
  }, [ready, spots, lights, selectedId, named, units, props.lightLabel]);

  // The rider, where the browser has said they are: a blue dot, as maps
  // draw "you are here", with a slow ring round it.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !you) return;
    const el = document.createElement("div");
    el.className = "map-you";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "You are here");
    el.title = "You are here";
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([you.lon, you.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [ready, you?.lon, you?.lat]);

  // Focus: a loupe laid on the chart round the chosen spot, or a range ring,
  // with a light wash of paper beyond it; or, as the rider chooses, nothing.
  // Both are distances on the chart and scale with it through a zoom: the
  // loupe's rose reaches half a nautical mile or a kilometre (focus.ts
  // `roseScale`), the ring a round distance chosen again whenever the camera
  // rests. Zoomed far out the rose stops at ROSE_MIN_PX, a compass with the
  // wind and nothing inside; zoomed in past the screen its bezel runs off it,
  // and the box at its foot is held in view. A pan only moves the glass, and
  // a zoom stretches it, until the stretch would show or the camera rests
  // (`stale`); it is drawn again then, or for a new hour (`rose`). The wind
  // and the lights are never washed.
  //
  // It moves in the frame the map is drawn: MapLibre fires "move" as it
  // renders, and its own markers are moved there too. A frame later, the
  // mark trailed the chart on every pan.
  const remeasure = useRef(() => {});
  const redrawRose = useRef(() => {});
  useEffect(() => {
    const map = mapRef.current;
    const lens = glass.current;
    if (!ready || !map || !lens) return;
    const spot = focus;
    const style: FocusStyle = spot ? focusStyle : "off";
    map.getContainer().classList.toggle("is-focus", !!spot);
    lens.dataset.focus = style;
    lens.replaceChildren();
    // The mark on a sheet of its own, and the loupe's foot box on another:
    // each is moved as a layer (src/map.css), so neither is drawn again for
    // the other's sake.
    let sheet: SVGSVGElement | null = null;
    let g: SVGGElement | null = null;
    let footSheet: SVGSVGElement | null = null;
    let foot: SVGGElement | null = null;
    if (spot && style !== "off") {
      const mark = document.createElement("div");
      mark.className = style === "loupe" ? "map-loupe" : "map-range";
      sheet = document.createElementNS(SVG, "svg");
      sheet.setAttribute("class", "map-sheet");
      g = svgEl(sheet, "g") as SVGGElement;
      mark.append(sheet);
      if (style === "loupe") {
        footSheet = document.createElementNS(SVG, "svg");
        footSheet.setAttribute("class", "map-sheet is-foot");
        foot = svgEl(footSheet, "g", {
          class: "map-loupe-foot",
        }) as SVGGElement;
        mark.append(footSheet);
      }
      lens.append(mark);
    }
    /** The mark's radius on screen, and the ring's distance, written as the rider reads it. */
    let r = 0;
    /** The radius it stands at on the screen now, its sheet stretched to it through a zoom. */
    let shown = 0;
    let range = { metres: 0, label: "" };
    const scale = roseScale(units);
    /** Whether the rose is drawn to scale (not held at its smallest). */
    let toScale = false;
    const drawRose = () => {
      if (g)
        redraw(g, () =>
          drawLoupe(g!, r, toScale ? scale : null, latest.current.rose),
        );
    };
    /**
     * The foot box, below the bezel, or held in the map's clear area when the
     * bezel's foot is off it. While the camera moves it goes where it is
     * wanted in one move of its sheet, so holding it in view draws nothing.
     * At rest its sheet stands where the glass's does, on whole pixels, and
     * the box is set in from there, as it was when the two were one drawing.
     */
    const pinFoot = (
      q: { x: number; y: number },
      x: number,
      y: number,
      still: boolean,
    ) => {
      const loupe = latest.current.rose;
      if (!foot || !footSheet || !loupe) return;
      const el = map.getContainer();
      const p = latest.current;
      // Round the spot: above the dock, as padding() keeps.
      const at = footBox(loupe.reading, loupe.relation, shown, {
        left: -q.x,
        right: el.clientWidth - q.x,
        bottom: el.clientHeight - p.bottomInset - (p.phone ? 64 : 24) - q.y,
      });
      if (still) {
        footSheet.style.transform = `translate(${x}px, ${y}px)`;
        setAttr(
          foot,
          "transform",
          `translate(${(q.x - x).toFixed(2)} ${(q.y - y).toFixed(2)}) translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`,
        );
      } else {
        footSheet.style.transform = `translate(${q.x + at.x}px, ${q.y + at.y}px)`;
        if (foot.hasAttribute("transform")) foot.removeAttribute("transform");
      }
    };
    /** The radius of the hole in the wash under the rim, in metres. */
    let hole = 0;
    const mpp = () => (spot ? metresPerPixel(map.getZoom(), spot.lat) : 0);
    /** The wash beyond the mark, in metres round the spot at this zoom. */
    const wash = () => {
      const source = map.getSource("focus") as GeoJSONSource | undefined;
      if (!source) return;
      const m = mpp();
      const holes = washHoles(style, shown).holes.map((px) => px * m);
      hole = holes[0] ?? 0;
      source.setData({
        type: "FeatureCollection",
        features: spot
          ? holes.map((metres, band) => ({
              type: "Feature" as const,
              properties: { band },
              geometry: {
                type: "Polygon" as const,
                // Out to the next hole, or the edge of the world.
                coordinates: [
                  band + 1 < holes.length
                    ? ring(spot.lon, spot.lat, holes[band + 1])
                    : WORLD,
                  ring(spot.lon, spot.lat, metres).reverse(),
                ],
              },
            }))
          : [],
      });
    };
    /** The places named at full strength: those the wash leaves clear. */
    const names = () => {
      const [clear] = washHoles(style, shown).holes;
      if (spot && clear && map.getLayer("places-near"))
        map.setFilter("places-near", [
          "all",
          PLACE_CLASSES,
          [
            "within",
            {
              type: "Polygon",
              coordinates: [ring(spot.lon, spot.lat, clear * mpp())],
            },
          ],
        ]);
    };
    /**
     * Whether the mark is to be drawn again at a radius of `now` pixels. At
     * rest, whenever it is not drawn at that size. Through a zoom its sheet is
     * stretched instead, a change the compositor makes alone, until the
     * stretch would show in its lines and print: drawn again on every frame
     * of a pinch, the rose was painted and rastered again on every frame.
     */
    const stale = (now: number, still: boolean) =>
      !r ||
      (still
        ? Math.abs(now - r) > 0.05
        : now / r < STRETCH[0] || now / r > STRETCH[1]);
    /**
     * Over the spot, wherever the camera has it; the ring at its distance.
     * The sheet is moved as a layer of its own (src/map.css), so a pan
     * paints nothing again. At rest it stands on whole pixels, the rest
     * drawn in, as sharp as it was.
     */
    const place = () => {
      if (!spot || !g || !sheet) return;
      const q = map.project([spot.lon, spot.lat]);
      const still = !map.isMoving();
      const x = still ? Math.round(q.x) : q.x;
      const y = still ? Math.round(q.y) : q.y;
      setAttr(
        g,
        "transform",
        `translate(${(q.x - x).toFixed(2)} ${(q.y - y).toFixed(2)})`,
      );
      if (style === "ring") {
        shown = range.metres / mpp();
        if (stale(shown, still)) {
          r = shown;
          redraw(g, () => drawRange(g!, r, range.label));
        }
      } else {
        const next = roseRadius(scale.metres, mpp());
        shown = next.r;
        if (next.toScale !== toScale || stale(shown, still)) {
          r = shown;
          toScale = next.toScale;
          drawRose();
        }
      }
      const k = Math.abs(shown - r) > 0.05 ? shown / r : 1;
      sheet.style.transform =
        k === 1
          ? `translate(${x}px, ${y}px)`
          : `translate(${x}px, ${y}px) scale(${k.toFixed(4)})`;
      if (style === "loupe") {
        pinFoot(q, x, y, still);
        // The hole in the wash is a distance on the chart, under the rim's
        // band through most of a zoom: in one it is cut again only when its
        // edge would show, and once the camera rests (`measure`). Cut on
        // every frame, it kept MapLibre tiling it again, a step behind.
        const edge = hole / mpp();
        if (!still && (edge < shown || edge > shown + LOUPE_BAND * k)) wash();
      }
    };
    /** Sized for the map: the glass to its shorter side, the ring's distance to the zoom too. */
    const measure = () => {
      if (!spot || !g) {
        wash();
        return;
      }
      const box = map.getContainer();
      const width = box.clientWidth;
      const visible = box.clientHeight - latest.current.bottomInset - 70;
      if (style !== "loupe")
        range = rangeRing(mpp(), Math.min(width, visible), units);
      place();
      wash();
      names();
    };
    if (foot) drawFoot(foot, latest.current.rose);
    measure();
    remeasure.current = measure;
    redrawRose.current = () => {
      if (style !== "loupe" || !spot || !g || !r) return;
      drawRose();
      if (foot) drawFoot(foot, latest.current.rose);
      place();
    };
    const { opacity } = washHoles(style, 0);
    const hide: number[] = [];
    WASH_LAYERS.forEach((id, band) => {
      const o = opacity[band] ?? 0;
      if (o) {
        map.setLayoutProperty(id, "visibility", "visible");
        map.setPaintProperty(id, "fill-opacity", o);
      } else if (map.getLayoutProperty(id, "visibility") !== "none") {
        map.setPaintProperty(id, "fill-opacity", 0);
        // Drawn only while there is a wash: an empty layer still costs a pass.
        hide.push(
          window.setTimeout(() => {
            if (map.getLayer(id))
              map.setLayoutProperty(id, "visibility", "none");
          }, 500),
        );
      }
    });
    // The names away from the spot step back with the wash; with no mark,
    // they stay as they are.
    const quiet = style !== "off";
    map.setPaintProperty("places", "text-opacity", quiet ? 0.3 : 0.8);
    map.setPaintProperty("water-names", "text-opacity", quiet ? 0.35 : 1);
    map.setLayoutProperty(
      "places-near",
      "visibility",
      quiet ? "visible" : "none",
    );
    map.on("move", place);
    map.on("moveend", place);
    map.on("zoomend", measure);
    map.on("resize", measure);
    return () => {
      hide.forEach(clearTimeout);
      remeasure.current = () => {};
      redrawRose.current = () => {};
      map.off("move", place);
      map.off("moveend", place);
      map.off("zoomend", measure);
      map.off("resize", measure);
    };
  }, [ready, focus?.lon, focus?.lat, focusStyle, units]);
  // The dock's height is the map's visible height: the ring is sized to it,
  // and the rose's foot box kept above it.
  useEffect(() => remeasure.current(), [bottomInset]);
  // The dock's hour, or the rider, changed: the rose, and only the rose.
  const roseKey = rose ? JSON.stringify(rose) : "";
  useEffect(() => redrawRose.current(), [roseKey]);

  // The neatline, and the pen's loop, follow the map as it moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const spot = mark;
    const svg = pen.current;
    let path: SVGPathElement | null = null;
    if (svg) {
      svg.replaceChildren();
      if (spot)
        path = svgEl(svg, "path", {
          class: "map-pen-loop",
          pathLength: "1",
        }) as SVGPathElement;
    }
    let raf = 0;
    // The map's size, read when it changes: read on every frame of a move,
    // it laid the page out again under the lights just moved.
    let size = { width: 0, height: 0 };
    const measure = () => {
      const { width, height } = map.getContainer().getBoundingClientRect();
      size = { width, height };
    };
    const place = () => {
      raf = 0;
      if (neat.current)
        drawNeatline(neat.current, map, {
          ...size,
          // The frame runs down to the dock: on a phone the strip of the
          // rider's spots sits inside it, as the mockup draws it.
          bottom: size.height - bottomInset + (phone ? 54 : 0),
          phone,
          // The small print's "i" sits in the frame's foot on the left, over
          // the latitudes there (src/map.css .map-print): on a phone it
          // stands above the strip of the rider's spots.
          clearBottom: phone ? 84 : 36,
        });
    };
    // The loop rings the spot in the glass: moved in the same frame as the
    // chart, as the focus is.
    const loop = () => {
      if (!spot || !path) return;
      const q = map.project([spot.lon, spot.lat]);
      path.setAttribute("d", loopPath(q.x, q.y, 24, 18, 7));
    };
    const queue = () => {
      loop();
      if (!raf) raf = requestAnimationFrame(place);
    };
    const resized = () => {
      measure();
      queue();
    };
    measure();
    place();
    loop();
    map.on("move", queue);
    map.on("resize", resized);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", queue);
      map.off("resize", resized);
    };
  }, [ready, mark?.lon, mark?.lat, bottomInset, phone]);

  // The point tapped on the open map, marked where it was.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !picked) return;
    const el = document.createElement("div");
    el.className = "pick-mark";
    el.setAttribute("aria-hidden", "true");
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([picked.lon, picked.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [ready, picked?.lon, picked?.lat]);

  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label="Chart of Ireland's coast with the wing foil forecast"
      />
      <svg ref={neat} className="map-neat" aria-hidden="true" />
      {!ready && !error && (
        <div className="map-loading" role="status">
          Drawing the chart…
        </div>
      )}
      {error && (
        <div className="map-error" role="alert">
          <span>{error}</span>
          <button onClick={() => location.reload()}>Reload map</button>
        </div>
      )}
    </>
  );
}
