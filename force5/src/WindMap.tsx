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
  type RideStop,
} from "./chartStyle";
import { archiveUrl, pmtilesTile } from "./archives";
import { releaseReplacedColorRamps } from "./colorRelief";
import { forecastUrl } from "./urls";
import { createLights, type LightState, type Lights } from "./lights";
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
  /** Where everything else goes quiet around (a spot or a tapped point), or null. */
  focus: { lon: number; lat: number } | null;
  /** Where the pen rings and writes: the chosen spot or point. */
  mark: { lon: number; lat: number } | null;
  /** A point tapped on the open map, marked where it was tapped. */
  picked: { lon: number; lat: number } | null;
  windStyle: WindStyle;
  rideStops: readonly RideStop[];
  layers: ChartLayers;
  /** The foilable-depth areas to draw, or null to draw none. */
  foil: readonly FoilView[] | null;
  /** The satellite image to draw under the chart's lines, or null for none. */
  satellite?: SatelliteImage | null;
  reducedMotion: boolean;
  /** The dock's height: what a camera move keeps the spot above. */
  bottomInset: number;
  phone: boolean;
  /** The pen's verdict beside the selected light, or null for none. */
  penNote: string | null;
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
    mark,
    picked,
    windStyle,
    rideStops,
    layers,
    foil,
    satellite = null,
    reducedMotion,
    bottomInset,
    phone,
    penNote,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const particles = useRef<HTMLCanvasElement | null>(null);
  const neat = useRef<SVGSVGElement>(null);
  const pen = useRef<SVGSVGElement | null>(null);
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
    // The wind's canvas and the pen's sheet go inside the map, over its canvas
    // and, by z-index (src/map.css), under the lights and over them.
    const canvasBox = map.getCanvasContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "particle-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const sheet = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sheet.setAttribute("class", "map-pen");
    sheet.setAttribute("aria-hidden", "true");
    canvasBox.after(canvas, sheet);
    particles.current = canvas;
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
      // The quiet round a focused spot: paper over the depths, the contours and
      // the coast, under the wind and the lights.
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
    windRef.current?.setStops(rideStops);
  }, [ready, rideStops]);
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

  // Focus: everything away from the chosen spot goes quiet; the wind does not.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const spot = focus;
    map.getContainer().classList.toggle("is-focus", !!spot);
    const radius = () => {
      if (!spot) return 0;
      const box = map.getContainer().getBoundingClientRect();
      const visible = box.height - bottomInset - 70;
      const px = Math.max(90, 0.3 * Math.min(box.width, visible));
      return (
        (px * 40075016.686 * Math.cos((spot.lat * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom())
      );
    };
    const paint = () => {
      const source = map.getSource("focus") as GeoJSONSource | undefined;
      if (!source) return;
      const m = radius();
      source.setData({
        type: "FeatureCollection",
        features: spot
          ? [1, 1.4, 1.85].map((k) => ({
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "Polygon" as const,
                coordinates: [WORLD, ring(spot.lon, spot.lat, m * k).reverse()],
              },
            }))
          : [],
      });
      if (spot && map.getLayer("places-near"))
        map.setFilter("places-near", [
          "all",
          PLACE_CLASSES,
          [
            "within",
            {
              type: "Polygon",
              coordinates: [ring(spot.lon, spot.lat, m * 1.4)],
            },
          ],
        ]);
    };
    paint();
    let hide = 0;
    if (spot) {
      map.setLayoutProperty("focus", "visibility", "visible");
      map.setPaintProperty("focus", "fill-opacity", 0.26);
    } else {
      map.setPaintProperty("focus", "fill-opacity", 0);
      // Drawn only while there is a focus: an empty layer still costs a pass.
      hide = window.setTimeout(() => {
        if (map.getLayer("focus"))
          map.setLayoutProperty("focus", "visibility", "none");
      }, 500);
    }
    map.setPaintProperty("places", "text-opacity", spot ? 0.3 : 0.8);
    map.setPaintProperty("water-names", "text-opacity", spot ? 0.35 : 1);
    map.setLayoutProperty("places-near", "visibility", spot ? "visible" : "none");
    map.on("zoomend", paint);
    return () => {
      clearTimeout(hide);
      map.off("zoomend", paint);
    };
  }, [ready, focus?.lon, focus?.lat]);

  // The neatline, and the pen's loop and note, follow the map as it moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const spot = mark;
    const svg = pen.current;
    let path: SVGPathElement | null = null;
    let note: SVGTextElement | null = null;
    if (svg) {
      svg.innerHTML = "";
      if (spot && penNote !== null) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "map-pen-loop");
        path.setAttribute("pathLength", "1");
        svg.appendChild(path);
        if (penNote) {
          note = document.createElementNS("http://www.w3.org/2000/svg", "text");
          note.setAttribute("class", "map-pen-note");
          note.setAttribute("text-anchor", "middle");
          note.textContent = penNote;
          svg.appendChild(note);
        }
      }
    }
    let raf = 0;
    /**
     * Where the note stands from its light. Under the loop by default; but a
     * town's name is often just there (Castlegregory, under Brandon Bay), and
     * the pen wrote over it. Once the camera rests, the first of a few places
     * round the loop where neither a base-map name nor another light is in
     * the way; while it moves, the note keeps the place it has.
     */
    const SPOTS: { dx: number; dy: number; anchor: string }[] = [
      { dx: 0, dy: 44, anchor: "middle" },
      { dx: 30, dy: 40, anchor: "start" },
      { dx: -30, dy: 40, anchor: "end" },
      { dx: 32, dy: 6, anchor: "start" },
      { dx: -32, dy: 6, anchor: "end" },
      { dx: 0, dy: 64, anchor: "middle" },
    ];
    let at = SPOTS[0];
    const write = (q: { x: number; y: number }, to: (typeof SPOTS)[number]) => {
      if (!note) return;
      const x = (q.x + to.dx).toFixed(1);
      const y = (q.y + to.dy).toFixed(1);
      note.setAttribute("x", x);
      note.setAttribute("y", y);
      note.setAttribute("text-anchor", to.anchor);
      note.setAttribute("transform", `rotate(-2 ${x} ${y})`);
    };
    const settle = () => {
      if (!spot || !note) return;
      const q = map.project([spot.lon, spot.lat]);
      const frame = map.getContainer().getBoundingClientRect();
      const layers = ["places", "places-near", "water-names"].filter((id) =>
        map.getLayer(id),
      );
      const lights = Array.from(
        map.getContainer().querySelectorAll<HTMLElement>(".lt:not(.sel)"),
      ).map((el) => el.getBoundingClientRect());
      at =
        SPOTS.find((to) => {
          write(q, to);
          const b = note!.getBBox();
          const box = {
            left: b.x - 2,
            top: b.y - 2,
            right: b.x + b.width + 2,
            bottom: b.y + b.height + 2,
          };
          if (box.left < 0 || box.right > frame.width) return false;
          if (
            layers.length &&
            map.queryRenderedFeatures(
              [
                [box.left, box.top],
                [box.right, box.bottom],
              ],
              { layers },
            ).length
          )
            return false;
          return !lights.some(
            (r) =>
              r.right - frame.left > box.left &&
              r.left - frame.left < box.right &&
              r.bottom - frame.top > box.top &&
              r.top - frame.top < box.bottom,
          );
        }) ?? SPOTS[0];
      write(q, at);
    };
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
        write(q, at);
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    settle();
    map.on("move", queue);
    map.on("resize", queue);
    map.on("moveend", settle);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", queue);
      map.off("resize", queue);
      map.off("moveend", settle);
    };
  }, [ready, mark?.lon, mark?.lat, penNote, bottomInset, phone]);

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
