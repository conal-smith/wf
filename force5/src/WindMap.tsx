import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { loopPath } from "../../ui/penPaths";
import {
  BATHY_PATH,
  CHART_LAYERS,
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
  metresPerPixel,
  loupeRadius,
  rangeLabel,
  rangeRing,
  washHoles,
  type FocusStyle,
} from "./focus";
import { drawNeatline } from "./neatline";
import { setMapView } from "./tiledField";
import {
  createWindLayer,
  viewOf,
  type WindLayer,
  type WindStyle,
} from "./windLayer";
import type { Frame, Spot } from "./weather";

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
  /** Where the pen rings: the chosen spot or point. */
  mark: { lon: number; lat: number } | null;
  /** A point tapped on the open map, marked where it was tapped. */
  picked: { lon: number; lat: number } | null;
  windStyle: WindStyle;
  layers: ChartLayers;
  /** The foilable-depth areas to draw, or null to draw none. */
  foil: readonly FoilView[] | null;
  /** The satellite image to draw under the chart's lines, or null for none. */
  satellite?: SatelliteImage | null;
  reducedMotion: boolean;
  /** The dock's height: what a camera move keeps the spot above. */
  bottomInset: number;
  phone: boolean;
  onSelect: (spot: Spot) => void;
  /** A tap on the open map, not a light: the point, and the nearest place's name. */
  onPick: (point: { lon: number; lat: number; place: string | null }) => void;
  onReady: (controls: MapControls | null) => void;
  /** A tile the frame on screen needs could not be read (windLayer.ts). */
  onTilesFailed?: (frame: Frame) => void;
};

const WORLD = [
  [-40, 35],
  [25, 35],
  [25, 72],
  [-40, 72],
  [-40, 35],
];

const SVG = "http://www.w3.org/2000/svg";

/** An SVG element, its attributes set, added to a parent. */
function svgEl(
  parent: Element,
  tag: string,
  attrs: Record<string, string | number> = {},
) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, typeof value === "number" ? value.toFixed(1) : value);
  parent.appendChild(el);
  return el;
}

/**
 * The loupe at the origin, `r` pixels to the inside of its rim: drawn as the
 * chart draws a box, ink, a band of paper and ink, with a compass bezel's
 * ticks in the paper and N at the top. No handle and no magnifying: the chart
 * runs straight on through the glass.
 */
function drawLoupe(g: SVGGElement, r: number) {
  g.replaceChildren();
  const rim = svgEl(g, "g", { class: "map-loupe-rim" });
  svgEl(rim, "circle", { class: "map-loupe-band", r: r + LOUPE_BAND / 2 });
  svgEl(rim, "circle", { class: "map-loupe-edge is-inner", r });
  svgEl(rim, "circle", { class: "map-loupe-edge", r: r + LOUPE_BAND });
  for (const t of bezelTicks(r))
    svgEl(g, "line", {
      class: t.long ? "map-loupe-tick is-long" : "map-loupe-tick",
      x1: t.x1,
      y1: t.y1,
      x2: t.x2,
      y2: t.y2,
    });
  svgEl(g, "text", {
    class: "map-loupe-north",
    y: -r - 2.5,
    "text-anchor": "middle",
  }).textContent = "N";
  // A glint on the glass, top left.
  const g0 = r - 16;
  svgEl(g, "path", {
    class: "map-loupe-glint",
    d: `M${(Math.cos(3.55) * g0).toFixed(1)} ${(Math.sin(3.55) * g0).toFixed(1)} A${g0} ${g0} 0 0 1 ${(Math.cos(4.25) * g0).toFixed(1)} ${(Math.sin(4.25) * g0).toFixed(1)}`,
  });
}

/** The range ring at the origin, `r` pixels out, with its distance written up and to the right. */
function drawRange(g: SVGGElement, r: number, label: string) {
  g.replaceChildren();
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
  svgEl(g, "text", {
    class: "map-range-label",
    x: Math.cos(-0.95) * r + 8,
    y: Math.sin(-0.95) * r - 6,
  }).textContent = label;
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
      (metres * Math.sin(a)) /
        (111320 * Math.cos((spot.lat * Math.PI) / 180)),
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
      if (!["city", "town", "village", "hamlet", "suburb"].includes(cls)) continue;
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

export default function WindMap(props: Props) {
  const {
    frame,
    spots,
    lights,
    named,
    selectedId,
    focus,
    focusStyle,
    mark,
    picked,
    windStyle,
    layers,
    foil,
    satellite = null,
    reducedMotion,
    bottomInset,
    phone,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const particles = useRef<HTMLCanvasElement | null>(null);
  const neat = useRef<SVGSVGElement>(null);
  const pen = useRef<SVGSVGElement | null>(null);
  const glass = useRef<SVGSVGElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const windRef = useRef<WindLayer | null>(null);
  const lightsRef = useRef<Lights | null>(null);
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
        minZoom: 4.5,
        maxZoom: 14,
        maxBounds: [
          [-18, 47],
          [2, 60],
        ],
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
    // The wind's canvas, the loupe's sheet and the pen's go inside the map,
    // over its canvas and, by z-index (src/map.css), the first two under the
    // lights and the pen over them.
    const canvasBox = map.getCanvasContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "particle-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const lens = document.createElementNS(SVG, "svg");
    lens.setAttribute("class", "map-focus");
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
      if (event.sourceId === "omt" && event.isSourceLoaded) basemapLoaded = true;
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
      map.addLayer(
        {
          id: "focus",
          type: "fill",
          source: "focus",
          layout: { visibility: "none" },
          paint: {
            "fill-color": colours.paper,
            "fill-opacity": 0,
            "fill-opacity-transition": { duration: 450 },
          },
        },
        "water-names",
      );
      if (particles.current) {
        windRef.current = createWindLayer(map, particles.current, {
          ink: colours.ink,
          washBefore: "relief",
          onTilesFailed: (failed) => latest.current.onTilesFailed?.(failed),
        });
      }
      // A tap on the open map reads that point's forecast, after a moment's
      // wait for a second tap: a double tap zooms and picks nothing.
      let pending = 0;
      const cancelPick = () => window.clearTimeout(pending);
      map.on("click", (event) => {
        cancelPick();
        const target = event.originalEvent.target as HTMLElement | null;
        if (target?.closest(".spot-marker")) return;
        if (event.originalEvent.detail > 1) return;
        const { lng, lat } = event.lngLat;
        pending = window.setTimeout(() => {
          latest.current.onPick({ lon: lng, lat, place: nearestPlace(map, lng, lat) });
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
          const zoom = Math.max(map.getZoom(), 10.4);
          const center = seaward(spot);
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
            padding: padding(),
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
      });
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      clearTimeout(loadTimeout);
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

  // The wind: its frame, its style, the rider's colours, and motion.
  useEffect(() => {
    windRef.current?.setFrame(frame);
  }, [ready, frame]);
  useEffect(() => {
    windRef.current?.setStyle(windStyle);
    particles.current?.setAttribute("data-wind-style", windStyle);
    // The wind stays at full strength round a focused spot: under the wash,
    // the focus quietens the depths it is drawn over and leaves the wash be.
    const map = mapRef.current;
    if (!ready || !map?.getLayer("focus")) return;
    const settle = () => {
      if (!map.getLayer("focus")) return;
      const under =
        windStyle === "wash" && map.getLayer("wind-wash")
          ? "wind-wash"
          : "water-names";
      const order = map.getLayersOrder();
      // Moving a layer is itself a style change: only when it is out of place.
      if (order[order.indexOf("focus") + 1] !== under)
        map.moveLayer("focus", under);
    };
    settle();
    // The wash's layer is added once its first image is ready.
    map.on("styledata", settle);
    return () => {
      map.off("styledata", settle);
    };
  }, [ready, windStyle]);
  useEffect(() => {
    windRef.current?.setPaused(reducedMotion);
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
            minzoom: Math.max(0, area.minzoom - 0.5),
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

  // The satellite image: one raster source and layer per area and tide, made
  // the first time it is wanted and kept, hidden when another tide is chosen
  // or its area leaves the view. Over the land and the sea's fills and the
  // depth tints, which it covers, and under the relief, the contours, the
  // foilable depth, the rivers, the coast's ink and every name, so the
  // chart's lines still read over it. Read by range only: an archive is a
  // quarter of a gigabyte, and a host that answered with all of it would be
  // refused rather than downloaded (archives.ts).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const shown = new Set<string>();
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
      if (!map.getLayer(id))
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            // MapLibre rounds a raster's zoom: half a zoom under the archive's
            // first is where its tiles start.
            minzoom: Math.max(0, area.minzoom - 0.5),
            paint: { "raster-opacity": 0.92, "raster-fade-duration": 150 },
          },
          map.getLayer("relief") ? "relief" : undefined,
        );
      map.setLayoutProperty(id, "visibility", "visible");
    }
    for (const id of map.getLayersOrder())
      if (id.startsWith("satellite-") && !shown.has(id))
        map.setLayoutProperty(id, "visibility", "none");
    map.getContainer().dataset.satellite = satellite?.option ?? "off";
  }, [ready, satellite]);

  // The lights: made once per set of places, then written to in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !spots.length) return;
    lightsRef.current = createLights(map, spots, (spot) =>
      latest.current.onSelect(spot),
    );
    return () => {
      lightsRef.current?.destroy();
      lightsRef.current = null;
    };
  }, [ready, spots]);
  useEffect(() => {
    lightsRef.current?.update(lights, selectedId, named, props.lightLabel);
  }, [ready, spots, lights, selectedId, named]);

  // Focus: a loupe laid on the chart round the chosen spot, or a range ring,
  // with a light wash of paper beyond it; or, as the rider chooses, nothing.
  // Neither shrinks as the rider zooms in, as the old spotlight did: the
  // loupe is a size on the screen, and the ring a round distance on the
  // chart, chosen again whenever the camera rests. The wind and the lights
  // are never washed.
  const remeasure = useRef(() => {});
  useEffect(() => {
    const map = mapRef.current;
    const svg = glass.current;
    if (!ready || !map || !svg) return;
    const spot = focus;
    const style: FocusStyle = spot ? focusStyle : "off";
    map.getContainer().classList.toggle("is-focus", !!spot);
    svg.dataset.focus = style;
    svg.replaceChildren();
    const g =
      spot && style !== "off"
        ? (svgEl(svg, "g", {
            class: style === "loupe" ? "map-loupe" : "map-range",
          }) as SVGGElement)
        : null;
    /** The mark's radius on screen, and the ring's distance in nautical miles. */
    let r = 0;
    let nm = 0;
    let washedAt = -1;
    let raf = 0;
    const mpp = () => (spot ? metresPerPixel(map.getZoom(), spot.lat) : 0);
    /** The wash beyond the mark, in metres round the spot at this zoom. */
    const wash = () => {
      const source = map.getSource("focus") as GeoJSONSource | undefined;
      if (!source) return;
      washedAt = map.getZoom();
      const m = mpp();
      source.setData({
        type: "FeatureCollection",
        features: spot
          ? washHoles(style, r).holes.map((px) => ({
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "Polygon" as const,
                coordinates: [
                  WORLD,
                  ring(spot.lon, spot.lat, px * m).reverse(),
                ],
              },
            }))
          : [],
      });
    };
    /** The places named at full strength: those the wash leaves clear. */
    const names = () => {
      const [clear] = washHoles(style, r).holes;
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
    /** Over the spot, wherever the camera has it; the ring at its distance. */
    const place = () => {
      raf = 0;
      if (!spot || !g) return;
      const q = map.project([spot.lon, spot.lat]);
      g.setAttribute(
        "transform",
        `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`,
      );
      if (style === "ring") {
        const next = (nm * 1852) / mpp();
        if (Math.abs(next - r) > 0.05) drawRange(g, (r = next), rangeLabel(nm));
      } else if (map.getZoom() !== washedAt)
        // A glass stays the same size through a zoom, so the hole in the
        // wash under its rim is cut again on every frame of one.
        wash();
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
      if (style === "loupe") {
        const next = loupeRadius(width, visible);
        if (next !== r) drawLoupe(g, (r = next));
      } else nm = rangeRing(mpp(), Math.min(width, visible)).nm;
      place();
      wash();
      names();
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    measure();
    remeasure.current = measure;
    const { opacity } = washHoles(style, 0);
    let hide = 0;
    if (opacity) {
      map.setLayoutProperty("focus", "visibility", "visible");
      map.setPaintProperty("focus", "fill-opacity", opacity);
    } else {
      map.setPaintProperty("focus", "fill-opacity", 0);
      // Drawn only while there is a wash: an empty layer still costs a pass.
      hide = window.setTimeout(() => {
        if (map.getLayer("focus"))
          map.setLayoutProperty("focus", "visibility", "none");
      }, 500);
    }
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
    map.on("move", queue);
    map.on("zoomend", measure);
    map.on("resize", measure);
    return () => {
      clearTimeout(hide);
      cancelAnimationFrame(raf);
      remeasure.current = () => {};
      map.off("move", queue);
      map.off("zoomend", measure);
      map.off("resize", measure);
    };
  }, [ready, focus?.lon, focus?.lat, focusStyle]);
  // The dock's height is the map's visible height: the glass is sized to it.
  useEffect(() => remeasure.current(), [bottomInset]);

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
    const place = () => {
      raf = 0;
      if (neat.current)
        drawNeatline(neat.current, map, {
          // The frame runs down to the dock: on a phone the strip of the
          // rider's spots sits inside it, as the mockup draws it.
          bottom:
            map.getContainer().clientHeight - bottomInset + (phone ? 54 : 0),
          phone,
          // The small print's "i" sits in the frame's foot on the left, over
          // the latitudes there (src/map.css .map-print): on a phone it
          // stands above the strip of the rider's spots.
          clearBottom: phone ? 84 : 36,
        });
      if (spot && path) {
        const q = map.project([spot.lon, spot.lat]);
        path.setAttribute("d", loopPath(q.x, q.y, 24, 18, 7));
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    map.on("move", queue);
    map.on("resize", queue);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", queue);
      map.off("resize", queue);
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
