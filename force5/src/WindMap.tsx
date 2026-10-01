import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { basemapColours } from "./basemap";
import { coverageCamera } from "./camera";
import SpotPopup from "./SpotPopup";
import {
  KNOTS,
  sample,
  windColor,
  speed,
  type Frame,
  type Point,
  type Spot,
  type Units,
  convert,
} from "./weather";

const INITIAL_CENTER: [number, number] = [-8.15, 53.42];
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);
const mercY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const inverseY = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

// Public vector basemap. Set VITE_BASEMAP_STYLE_URL to switch providers/self-host.
const BASEMAP =
  import.meta.env.VITE_BASEMAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/positron";

// Colour fields are sampled in Mercator so they align geographically with the map.
function heatImage(frame: Frame): string {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(512, 512),
    g = frame.grid;
  const top = mercY(g.north),
    bottom = mercY(g.south);
  for (let y = 0; y < 512; y++) {
    const lat = Math.max(
      g.south,
      Math.min(g.north, inverseY(top + ((bottom - top) * y) / 511)),
    );
    for (let x = 0; x < 512; x++) {
      const wind = sample(frame, g.west + ((g.east - g.west) * x) / 511, lat);
      const offset = (y * 512 + x) * 4;
      const rgb = windColor(wind ? speed(wind) * KNOTS : 0);
      image.data.set([...rgb, wind ? 255 : 0], offset);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

type Props = {
  frame: Frame | null;
  spots: Spot[];
  selected: Point;
  selectionOpen?: boolean;
  spotInfoOpen?: boolean;
  onCloseSpotInfo?: () => void;
  bottomInset?: number;
  units: Units;
  onSelect: (point: Point) => void;
  showWind: boolean;
  particles: boolean;
  showSpots: boolean;
  reducedMotion: boolean;
};

export default function WindMap({
  frame,
  spots,
  selected,
  units,
  onSelect,
  showWind,
  particles,
  showSpots,
  reducedMotion,
  selectionOpen = false,
  spotInfoOpen = false,
  onCloseSpotInfo,
  bottomInset = 170,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latest = useRef({
    frame,
    particles,
    showWind,
    reducedMotion,
    onSelect,
  });
  latest.current = { frame, particles, showWind, reducedMotion, onSelect };
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const hasFrame = frame !== null;
  const markers = useRef<maplibregl.Marker[]>([]);
  const pickMarker = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef(false);
  const lastLocatedPoint = useRef(
    `${selected.id}/${selected.lon}/${selected.lat}`,
  );

  useEffect(() => {
    if (!container.current) return;
    // Once, with the map: the theme cannot move under a map that is already up.
    const basemap = basemapColours(getComputedStyle(document.documentElement));
    // The dev server's mode, not the env's `DEV` flag: that one follows
    // NODE_ENV, so a shell exporting NODE_ENV=development ships this warning in
    // a built bundle (src/main.tsx makes the same distinction for the gallery).
    if (
      import.meta.env.MODE === "development" &&
      !(basemap.land && basemap.water)
    )
      console.warn(
        "The basemap keeps the provider's colours: ui/theme.css is not on the document.",
      );
    let map: maplibregl.Map;
    let pointClick: number | undefined;
    const cancelPointClick = () => window.clearTimeout(pointClick);
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: BASEMAP,
        center: INITIAL_CENTER,
        zoom: 6,
        minZoom: 4.5,
        maxZoom: 11,
        maxBounds: [
          [-16, 48],
          [0, 59],
        ],
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        doubleClickZoom: true,
        // The host renders the required linked credits beside the map controls.
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      setError(
        "The map needs WebGL. Enable hardware acceleration or try another browser.",
      );
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    const loadTimeout = window.setTimeout(
      () =>
        setError(
          "The basemap is taking too long to load. Check your internet connection and reload.",
        ),
      20000,
    );
    map.on("load", () => {
      clearTimeout(loadTimeout);
      setError("");
      const style = map.getStyle() as StyleSpecification;
      if (!import.meta.env.VITE_BASEMAP_STYLE_URL) {
        for (const layer of style.layers) {
          if (layer.type === "background" && basemap.land)
            map.setPaintProperty(layer.id, "background-color", basemap.land);
          if (layer.id === "water" && basemap.water)
            map.setPaintProperty(layer.id, "fill-color", basemap.water);
          if (layer.type === "symbol")
            map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
      map.addSource("towns", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            ["DUBLIN", -6.26, 53.35],
            ["GALWAY", -9.05, 53.27],
            ["CORK", -8.47, 51.9],
            ["BELFAST", -5.93, 54.6],
            ["LIMERICK", -8.63, 52.66],
            ["SLIGO", -8.48, 54.27],
            ["DERRY", -7.32, 55.0],
            ["WATERFORD", -7.11, 52.26],
          ].map(([name, lon, lat]) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [lon as number, lat as number],
            },
            properties: { name },
          })),
        },
      });
      map.addLayer({
        id: "town-labels",
        type: "symbol",
        source: "towns",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-letter-spacing": 0.14,
          "text-padding": 8,
        },
        paint: {
          "text-color": "#29463e",
          "text-halo-color": "rgba(245,249,237,0.75)",
          "text-halo-width": 1.5,
        },
      });
      const water = style.layers.find((layer) => layer.id === "water");
      if (water && water.type === "fill") {
        // Draw above the weather raster: a blurred, offset coast gives land
        // depth without tinting or obscuring the forecast values inland.
        map.addLayer(
          {
            id: "coast-shadow",
            type: "line",
            source: water.source,
            "source-layer": water["source-layer"],
            // OpenMapTiles distinguishes ocean from inland water. Keep lake
            // detail crisp instead of accumulating shadows around tiny islands.
            filter: import.meta.env.VITE_BASEMAP_STYLE_URL
              ? water.filter
              : ["==", "class", "ocean"],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#18383f",
              "line-width": 4,
              "line-blur": 2,
              "line-opacity": 0.1,
              "line-translate": [1, 2],
              "line-translate-anchor": "viewport",
            },
          },
          "town-labels",
        );
        map.addLayer(
          {
            id: "coast-outline",
            type: "line",
            source: water.source,
            "source-layer": water["source-layer"],
            filter: water.filter,
            layout: { "line-join": "round" },
            paint: {
              "line-color": "#24464c",
              "line-width": 0.9,
              "line-opacity": 0.65,
            },
          },
          "town-labels",
        );
      }
      setReady(true);
    });
    map.on("error", (event) => {
      // Tile errors do not erase a usable weather field. An unavailable style is fatal.
      if (!map.isStyleLoaded() && !map.getStyle()?.layers?.length)
        setError(
          `Basemap could not load. Check your internet connection and reload. ${event.error?.message || ""}`,
        );
    });
    map.on("click", (event) => {
      cancelPointClick();
      if (event.originalEvent.detail > 1) return;
      const g = latest.current.frame?.grid;
      if (
        g &&
        event.lngLat.lng >= g.west &&
        event.lngLat.lng <= g.east &&
        event.lngLat.lat >= g.south &&
        event.lngLat.lat <= g.north
      )
        // Wait briefly for a second click; MapLibre handles double-click zoom.
        pointClick = window.setTimeout(
          () =>
            latest.current.onSelect({
              name: "Selected location",
              lat: event.lngLat.lat,
              lon: event.lngLat.lng,
            }),
          350,
        );
    });
    map.on("dblclick", cancelPointClick);
    map.on("movestart", cancelPointClick);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => {
      clearTimeout(loadTimeout);
      cancelPointClick();
      resize.disconnect();
      setReady(false);
      map.remove();
      mapRef.current = null;
      fitted.current = false;
    };
  }, []);

  const fitCoverage = (duration = 0) => {
    const map = mapRef.current;
    if (!map || !frame) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const grid =
      frame.model === "harmonie"
        ? frame.grid
        : { west: -10.9, east: -5.1, south: 51, north: 55.7 };
    map.easeTo({
      ...coverageCamera(grid, width, height, bottomInset, [
        selected.lon,
        selected.lat,
      ]),
      padding: 0,
      duration,
    });
  };

  useEffect(() => {
    if (!ready || !frame || fitted.current) return;
    fitted.current = true;
    fitCoverage();
  }, [ready, frame, bottomInset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !frame) return;
    const g = frame.grid;
    const coordinates: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [g.west, g.north],
      [g.east, g.north],
      [g.east, g.south],
      [g.west, g.south],
    ];
    const url = heatImage(frame);
    const source = map.getSource("wind") as maplibregl.ImageSource | undefined;
    if (source) source.updateImage({ url, coordinates });
    else {
      map.addSource("wind", { type: "image", url, coordinates });
      map.addLayer(
        {
          id: "wind-colour",
          type: "raster",
          source: "wind",
          paint: {
            "raster-opacity": 0.86,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          },
        },
        map.getLayer("coast-shadow") ? "coast-shadow" : "town-labels",
      );
    }
    map.setLayoutProperty(
      "wind-colour",
      "visibility",
      showWind ? "visible" : "none",
    );
  }, [frame, ready, showWind]);

  // The markers are made once per set of spots and then written to in place:
  // rebuilding every one of them on each frame or selection stalled the camera
  // for a frame or two once the map held more than a hundred places.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    if (!showSpots) return;
    for (const spot of spots) {
      const button = document.createElement("button");
      // Before the marker is made: it adds classes of its own to the element.
      button.className = "spot-marker";
      button.dataset.spotId = spot.id;
      button.dataset.kind = spot.kind || "spot";
      button.onclick = (event) => {
        event.stopPropagation();
        latest.current.onSelect(spot);
      };
      markers.current.push(
        new maplibregl.Marker({ element: button, anchor: "center" })
          .setLngLat([spot.lon, spot.lat])
          .addTo(map),
      );
    }
    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
    };
  }, [ready, spots, showSpots]);

  useEffect(() => {
    if (!ready || !showSpots) return;
    spots.forEach((spot, index) => {
      const button = markers.current[index]?.getElement();
      if (!button) return;
      const wind = frame ? sample(frame, spot.lon, spot.lat) : null;
      button.classList.toggle("active", selected.id === spot.id);
      button.setAttribute(
        "aria-label",
        `${spot.name}${wind ? `, ${Math.round(convert(speed(wind), units))} ${units}` : ""}`,
      );
      const symbol = { operator: "⌂", club: "⚑", area: "◇" }[
        spot.kind as "operator" | "club" | "area"
      ];
      button.textContent =
        symbol || (wind ? `${Math.round(convert(speed(wind), units))}` : "•");
      button.title = `${spot.name}${spot.kind && spot.kind !== "spot" ? ` · ${spot.kind}` : ""}${wind ? ` · ${Math.round(convert(speed(wind), units))} ${units}` : ""}`;
      if (spot.kind && spot.kind !== "spot")
        button.setAttribute("aria-label", button.title);
    });
  }, [ready, spots, frame, selected, units, showSpots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selected.id) return;
    const key = `${selected.id}/${selected.lon}/${selected.lat}`;
    if (key === lastLocatedPoint.current) return;
    lastLocatedPoint.current = key;
    const p = map.project([selected.lon, selected.lat]);
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    if (
      p.x < 40 ||
      p.x > width - 40 ||
      p.y < 60 ||
      p.y > height - bottomInset - 50
    )
      map.easeTo({
        center: [selected.lon, selected.lat],
        offset: [0, -bottomInset / 2],
        duration: reducedMotion ? 0 : 350,
      });
  }, [selected.id, selected.lon, selected.lat, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    pickMarker.current?.remove();
    if (!selected.id) {
      const el = document.createElement("div");
      el.className = "point-marker";
      pickMarker.current = new maplibregl.Marker({ element: el })
        .setLngLat([selected.lon, selected.lat])
        .addTo(map);
    }
  }, [selected, ready]);

  useEffect(() => {
    const map = mapRef.current,
      canvas = overlay.current;
    if (!map || !ready || !canvas) return;
    const ctx = canvas.getContext("2d")!;
    // Disabled effects have no animation callback or map listeners to keep waking up.
    if (!hasFrame || !particles || !showWind || reducedMotion) return;
    type Particle = { x: number; y: number; age: number };
    let cloud: Particle[] = [],
      width = 0,
      height = 0,
      animation = 0,
      previousTime = 0;
    let fieldFrame: Frame | null = null,
      viewDirty = true;
    const fieldStep = 9;
    let fieldWidth = 0,
      fieldHeight = 0,
      field = new Float32Array();
    const invalidate = () => {
      if (!viewDirty) ctx.clearRect(0, 0, width, height);
      viewDirty = true;
    };
    const spawn = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      age: Math.random() * 80,
    });
    const updateField = (f: Frame) => {
      fieldWidth = Math.ceil(width / fieldStep) + 1;
      fieldHeight = Math.ceil(height / fieldStep) + 1;
      field = new Float32Array(fieldWidth * fieldHeight * 2);
      for (let y = 0; y < fieldHeight; y++)
        for (let x = 0; x < fieldWidth; x++) {
          const point = map.unproject([x * fieldStep, y * fieldStep]);
          const wind = sample(f, point.lng, point.lat),
            i = (y * fieldWidth + x) * 2;
          // Mercator scales east and north equally locally; y screen coordinates point down.
          field[i] = wind?.u ?? NaN;
          field[i + 1] = wind ? -wind.v : NaN;
        }
      cloud = Array.from(
        { length: Math.min(2600, Math.round((width * height) / 400)) },
        spawn,
      );
    };
    const draw = (now: number) => {
      animation = 0;
      const state = latest.current;
      // In particular, never reproject the wind grid during a map gesture.
      // moveend/visibilitychange restart the loop when it can do useful work.
      if (
        !state.frame ||
        !state.particles ||
        !state.showWind ||
        state.reducedMotion ||
        document.hidden ||
        map.isMoving()
      )
        return;
      animation = requestAnimationFrame(draw);
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (width !== w || height !== h) {
        width = w;
        height = h;
        const dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        viewDirty = true;
      }
      if (now - previousTime < 32) return;
      const dt = Math.min(60, now - previousTime) / 32;
      previousTime = now;
      if (state.frame !== fieldFrame || viewDirty) {
        updateField(state.frame);
        fieldFrame = state.frame;
        viewDirty = false;
        ctx.clearRect(0, 0, width, height);
      }
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0,0,0,0.92)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255,255,250,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < cloud.length; i++) {
        const p = cloud[i];
        const gx = p.x / fieldStep,
          gy = p.y / fieldStep,
          x0 = Math.floor(gx),
          y0 = Math.floor(gy);
        if (
          p.age > 90 ||
          x0 < 0 ||
          x0 >= fieldWidth - 1 ||
          y0 < 0 ||
          y0 >= fieldHeight - 1
        ) {
          cloud[i] = spawn();
          continue;
        }
        const j = (y0 * fieldWidth + x0) * 2,
          tx = gx - x0,
          ty = gy - y0;
        const interpolate = (offset: number) =>
          (field[j + offset] * (1 - tx) + field[j + 2 + offset] * tx) *
            (1 - ty) +
          (field[j + fieldWidth * 2 + offset] * (1 - tx) +
            field[j + fieldWidth * 2 + 2 + offset] * tx) *
            ty;
        const u = interpolate(0),
          v = interpolate(1);
        if (!Number.isFinite(u + v)) {
          cloud[i] = spawn();
          continue;
        }
        const nx = p.x + u * 0.22 * dt,
          ny = p.y + v * 0.22 * dt;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        p.x = nx;
        p.y = ny;
        p.age += dt;
      }
      ctx.stroke();
    };
    const stop = () => {
      cancelAnimationFrame(animation);
      animation = 0;
      previousTime = 0;
      invalidate();
    };
    const resume = () => {
      if (!animation && !document.hidden && !map.isMoving()) {
        previousTime = performance.now();
        animation = requestAnimationFrame(draw);
      }
    };
    const resize = () => {
      invalidate();
      resume();
    };
    const visibility = () => {
      if (document.hidden) stop();
      else resume();
    };
    map.on("movestart", stop);
    map.on("move", invalidate);
    map.on("moveend", resume);
    map.on("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    resume();
    return () => {
      cancelAnimationFrame(animation);
      map.off("movestart", stop);
      map.off("move", invalidate);
      map.off("moveend", resume);
      map.off("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      ctx.clearRect(0, 0, width, height);
    };
  }, [ready, hasFrame, particles, showWind, reducedMotion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !frame || !selectionOpen) return;
    const position = map.project([selected.lon, selected.lat]);
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    // Keep a picked location above the sheet without changing the user's zoom.
    if (
      position.x < 20 ||
      position.x > width - 50 ||
      position.y < 60 ||
      position.y > height - bottomInset - 25
    ) {
      map.easeTo({
        ...coverageCamera(
          frame.grid,
          width,
          height,
          bottomInset,
          [selected.lon, selected.lat],
          map.getZoom(),
        ),
        padding: 0,
        duration: reducedMotion ? 0 : 350,
      });
    }
  }, [
    ready,
    frame?.model,
    selected.lon,
    selected.lat,
    selectionOpen,
    bottomInset,
    reducedMotion,
  ]);

  const reset = () => fitCoverage(reducedMotion ? 0 : 750);
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label="Interactive Ireland wind forecast map"
      />
      <canvas ref={overlay} className="particle-canvas" aria-hidden="true" />
      {ready &&
        mapRef.current &&
        spotInfoOpen &&
        showSpots &&
        selected.id &&
        onCloseSpotInfo && (
          <SpotPopup
            map={mapRef.current}
            point={selected}
            bottomInset={bottomInset}
            onClose={onCloseSpotInfo}
          />
        )}
      {!ready && !error && (
        <div className="map-loading">
          <span className="spinner" /> Opening Ireland…
        </div>
      )}
      {error && (
        <div className="map-error" role="alert">
          {error}
          <button onClick={() => location.reload()}>Reload map</button>
        </div>
      )}
      <div className="map-navigation">
        <button
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus size={19} />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus size={19} />
        </button>
        <button
          aria-label="Reset Ireland view"
          title="Reset forecast view"
          onClick={reset}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      <span className="sea-label" aria-hidden="true">
        ATLANTIC
        <br />
        OCEAN
      </span>
    </>
  );
}
