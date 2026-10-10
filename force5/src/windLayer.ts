/**
 * The wind on the chart, three ways, and the moving arrows in all of them:
 *
 *   ink      the arrows in ink, light air thin and pale, a breeze bolder
 *   arrows   the same arrows tinted by speed, on the rider's own scale
 *   wash     the rider's scale as a wash over the sea, with the ink arrows on it
 *
 * The arrows are particles drifting with the forecast on a canvas over the
 * map. Each keeps its last few positions and its trail is drawn fresh every
 * frame, older segments fainter (design/chart/chart-kit.js): fading the canvas
 * instead never quite reaches zero in 8-bit alpha and leaves a haze wherever
 * particles have been. They pause while the map moves, and the field is
 * resampled for the new view once it stops.
 *
 * The wash is an image source covering the view and a margin round it, drawn
 * under the contours and the coast, and kept off the land through a mask made
 * from the basemap's own water polygons; where those have not loaded yet the
 * land gets a fainter wash rather than none.
 */
import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { rideColour, type RideStop } from "./chartStyle";
import { KNOTS } from "./units";
import { sample, type Frame } from "./weather";

export type WindStyle = "ink" | "arrows" | "wash";
export const WIND_STYLES: readonly WindStyle[] = ["ink", "arrows", "wash"];

interface Particle {
  x: number;
  y: number;
  age: number;
  trail: number[] | null;
  /** The colour bucket (arrows) or the strong/light pair (ink) it draws in. */
  bin: number;
}

const STEP = 10;
const BUCKETS = 4;
/** Trails this many steps long: the mockup's fade of 0.93 to 15%. */
const TRAIL = 24;
const MAX_AGE = 70;
const BINS = 12;
/**
 * Opacity of the wash over the sea, over land, and where the mask has not
 * reached yet. Strong enough to read the wind by: at a half and a tenth the
 * sea was pale and the land all but blank.
 */
const WASH_SEA = 0.72;
const WASH_LAND = 0.42;
const WASH_UNKNOWN = 0.55;

export interface WindLayerOptions {
  ink: string;
  /** Particles per thousand square pixels. */
  density?: number;
  /** Where to put the wash: the first layer it goes under. */
  washBefore: string;
}

export interface WindLayer {
  setFrame(frame: Frame | null): void;
  setStyle(style: WindStyle): void;
  setStops(stops: readonly RideStop[]): void;
  setPaused(paused: boolean): void;
  /** Particles drawn in the last frame, for tests and the perf probe. */
  readonly drawn: number;
  destroy(): void;
}

const rgba = (rgb: readonly number[], a: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;

/** An ink's rgb from a CSS colour the theme gives as hex. */
function rgbOf(colour: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(colour.trim());
  if (!m) return [26, 29, 33];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createWindLayer(
  map: MapLibreMap,
  canvas: HTMLCanvasElement,
  options: WindLayerOptions,
): WindLayer {
  const ctx = canvas.getContext("2d")!;
  const ink = rgbOf(options.ink);
  const density = options.density ?? 0.4;
  let frame: Frame | null = null;
  let style: WindStyle = "ink";
  let stops: readonly RideStop[] = [];
  let colours: string[][] = [];
  let paused = false;
  let destroyed = false;
  let width = 0,
    height = 0,
    fw = 0,
    fh = 0;
  let field: Float32Array | null = null;
  let cloud: Particle[] = [];
  let raf = 0,
    last = 0,
    drawn = 0;

  /** The arrows' colours: per speed bin, per trail bucket. */
  const paint = () => {
    colours = Array.from({ length: BINS }, (_, b) => {
      // Bins run 0–36 kn in 3 kn steps, the last one open-ended.
      const kn = b * 3 + 1.5;
      const rgb = stops.length ? rideColour(stops, kn) : ink;
      // Darkened a touch toward the ink, so a pale green still reads on paper.
      const toned = rgb.map((v, i) => Math.round(v * 0.8 + ink[i] * 0.2));
      return Array.from({ length: BUCKETS }, (_, k) =>
        rgba(toned, 0.9 * ((k + 1) / BUCKETS)),
      );
    });
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const spawn = (p?: Particle): Particle => {
    const q = p ?? ({} as Particle);
    q.x = Math.random() * width;
    q.y = Math.random() * height;
    q.age = Math.random() * 60;
    q.trail = null;
    q.bin = 0;
    return q;
  };

  /** The forecast resampled for the view: px per step, and the speed. */
  const build = () => {
    resize();
    field = null;
    if (!frame || !width || !height) return;
    fw = Math.ceil(width / STEP) + 1;
    fh = Math.ceil(height / STEP) + 1;
    const f = new Float32Array(fw * fh * 3);
    // Pixels per frame per m/s at this zoom, so lines move at a pace that reads.
    const lat = map.getCenter().lat;
    const mpp =
      (40075016 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const k = 18 / Math.max(mpp, 1) ** 0.35 / 30;
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const ll = map.unproject([x * STEP, y * STEP]);
        const w = sample(frame, ll.lng, ll.lat);
        const i = (y * fw + x) * 3;
        if (!w || !Number.isFinite(w.u + w.v)) {
          f[i] = NaN;
          continue;
        }
        f[i] = w.u * k;
        f[i + 1] = -w.v * k;
        f[i + 2] = Math.hypot(w.u, w.v);
      }
    field = f;
    const n = Math.round(((width * height) / 1000) * density);
    cloud = Array.from({ length: n }, () => spawn());
    // Run the new cloud a trail's length before the first frame is drawn, so
    // the arrows come back whole when the camera stops instead of growing
    // their trails for most of a second. A few milliseconds, once per view.
    const coloured = style === "arrows";
    for (let i = 0; i < TRAIL; i++) advance(coloured);
    ctx.clearRect(0, 0, width, height);
  };

  const at = (px: number, py: number, out: number[]) => {
    const f = field!;
    const gx = px / STEP,
      gy = py / STEP;
    const x0 = Math.floor(gx),
      y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= fw - 1 || y0 >= fh - 1) return false;
    const ax = gx - x0,
      ay = gy - y0;
    const i00 = (y0 * fw + x0) * 3,
      i10 = i00 + 3,
      i01 = i00 + fw * 3,
      i11 = i01 + 3;
    if (
      Number.isNaN(f[i00]) ||
      Number.isNaN(f[i10]) ||
      Number.isNaN(f[i01]) ||
      Number.isNaN(f[i11])
    )
      return false;
    const w00 = (1 - ax) * (1 - ay),
      w10 = ax * (1 - ay),
      w01 = (1 - ax) * ay,
      w11 = ax * ay;
    for (let k = 0; k < 3; k++)
      out[k] =
        f[i00 + k] * w00 + f[i10 + k] * w10 + f[i01 + k] * w01 + f[i11 + k] * w11;
    return true;
  };

  const s = [0, 0, 0];
  /** Every particle one step on, its trail with it; out of the field, respawned. */
  const advance = (coloured: boolean) => {
    for (const p of cloud) {
      if (p.age > MAX_AGE || !at(p.x, p.y, s)) {
        spawn(p);
        p.age = 0;
        continue;
      }
      if (!p.trail) p.trail = [p.x, p.y];
      p.x += s[0];
      p.y += s[1];
      p.age++;
      p.bin = coloured
        ? Math.min(BINS - 1, Math.floor((s[2] * KNOTS) / 3))
        : s[2] > 7
          ? 1
          : 0;
      p.trail.push(p.x, p.y);
      if (p.trail.length > (TRAIL + 1) * 2) p.trail.splice(0, 2);
    }
  };
  const step = (now: number) => {
    raf = 0;
    if (destroyed || paused || !frame || document.hidden || map.isMoving())
      return;
    raf = requestAnimationFrame(step);
    if (now - last < 30) return;
    last = now;
    if (!field) build();
    if (!field) return;
    const coloured = style === "arrows";
    advance(coloured);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    drawn = 0;
    const bins = coloured ? BINS : 2;
    for (let bin = 0; bin < bins; bin++) {
      ctx.lineWidth = coloured ? (bin >= 3 ? 1.6 : 1.2) : bin ? 1.4 : 1;
      for (let k = 0; k < BUCKETS; k++) {
        ctx.beginPath();
        let any = false;
        for (const p of cloud) {
          const t = p.trail;
          if (!t || p.bin !== bin) continue;
          const n = t.length / 2 - 1;
          const from = Math.floor((k * n) / BUCKETS);
          const to = Math.floor(((k + 1) * n) / BUCKETS);
          for (let i = from; i < to; i++) {
            ctx.moveTo(t[i * 2], t[i * 2 + 1]);
            ctx.lineTo(t[i * 2 + 2], t[i * 2 + 3]);
            any = true;
          }
        }
        if (!any) continue;
        ctx.strokeStyle = coloured
          ? colours[bin][k]
          : rgba(ink, (bin ? 0.5 : 0.3) * ((k + 1) / BUCKETS));
        ctx.stroke();
        drawn++;
      }
    }
  };

  const restart = () => {
    field = null;
    if (!raf && !destroyed && !paused) raf = requestAnimationFrame(step);
  };
  const clear = () => {
    ctx.clearRect(0, 0, width, height);
    for (const p of cloud) p.trail = null;
  };

  /* ---- the wash ---- */

  const mask = document.createElement("canvas");
  const image = document.createElement("canvas");
  let washKey = "";
  /** The view last painted without a mask, and how often it has been retried. */
  let unmasked = "";
  let retries = 0;
  let washTimer = 0;
  const washSource = () => map.getSource("wind-wash") as ImageSource | undefined;

  /** The sea, as the basemap's water polygons drawn into the image's pixels. */
  const seaMask = (
    w: number,
    h: number,
    toPixel: (lng: number, lat: number) => [number, number],
  ): Uint8ClampedArray | null => {
    let features: ReturnType<MapLibreMap["querySourceFeatures"]> = [];
    try {
      features = map.querySourceFeatures("omt", { sourceLayer: "water" });
    } catch {
      return null;
    }
    if (!features.length) return null;
    mask.width = w;
    mask.height = h;
    const m = mask.getContext("2d", { willReadFrequently: true })!;
    m.clearRect(0, 0, w, h);
    m.fillStyle = "#000";
    m.beginPath();
    const ring = (coords: number[][]) => {
      coords.forEach(([lng, lat], i) => {
        const [x, y] = toPixel(lng, lat);
        if (i) m.lineTo(x, y);
        else m.moveTo(x, y);
      });
      m.closePath();
    };
    for (const f of features) {
      const g = f.geometry;
      if (g.type === "Polygon") g.coordinates.forEach(ring);
      else if (g.type === "MultiPolygon")
        g.coordinates.forEach((poly) => poly.forEach(ring));
    }
    // Non-zero, not even-odd: neighbouring tiles overlap by their buffers.
    m.fill("nonzero");
    return m.getImageData(0, 0, w, h).data;
  };

  const paintWash = () => {
    washTimer = 0;
    if (destroyed) return;
    const on = style === "wash" && !!frame && !!stops.length;
    if (map.getLayer("wind-wash"))
      map.setLayoutProperty("wind-wash", "visibility", on ? "visible" : "none");
    if (!on || !frame) return;
    const rect = map.getContainer().getBoundingClientRect();
    const zoom = map.getZoom();
    const centre = map.getCenter();
    const key = `${frame.model}|${frame.validTime}|${zoom.toFixed(3)}|${centre.lng.toFixed(4)}|${centre.lat.toFixed(4)}|${rect.width}x${rect.height}|${stops.map((s) => s.kn.toFixed(1)).join(",")}`;
    if (key === washKey) return;
    // A margin a third of the view each way, so a pan shows wash, not paper.
    const mx = rect.width / 3,
      my = rect.height / 3;
    const nw = map.unproject([-mx, -my]);
    const se = map.unproject([rect.width + mx, rect.height + my]);
    const px = 5;
    const w = Math.max(2, Math.round((rect.width + 2 * mx) / px));
    const h = Math.max(2, Math.round((rect.height + 2 * my) / px));
    const merc = (lat: number) =>
      Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const yN = merc(nw.lat),
      yS = merc(se.lat);
    const toPixel = (lng: number, lat: number): [number, number] => [
      ((lng - nw.lng) / (se.lng - nw.lng)) * w,
      ((yN - merc(lat)) / (yN - yS)) * h,
    ];
    const sea = seaMask(w, h, toPixel);
    image.width = w;
    image.height = h;
    const c = image.getContext("2d")!;
    const data = c.createImageData(w, h);
    const lut = Array.from({ length: 81 }, (_, i) => rideColour(stops, i / 2));
    // The model's own edge fades out rather than stopping in a straight line.
    const g = frame.grid;
    const feather = Math.max(g.dx, g.dy) * 6;
    const edge = (lng: number, lat: number) =>
      Math.max(
        0,
        Math.min(
          1,
          (lng - g.west) / feather,
          (g.east - lng) / feather,
          (lat - g.south) / feather,
          (g.north - lat) / feather,
        ),
      );
    for (let y = 0; y < h; y++) {
      const lat =
        (2 * Math.atan(Math.exp(yN + ((yS - yN) * (y + 0.5)) / h)) - Math.PI / 2) *
        (180 / Math.PI);
      for (let x = 0; x < w; x++) {
        const lng = nw.lng + ((se.lng - nw.lng) * (x + 0.5)) / w;
        const wind = sample(frame, lng, lat);
        if (!wind) continue;
        const kn = Math.hypot(wind.u, wind.v) * KNOTS;
        const rgb = lut[Math.min(80, Math.max(0, Math.round(kn * 2)))];
        const i = (y * w + x) * 4;
        const alpha =
          (sea ? (sea[i + 3] > 127 ? WASH_SEA : WASH_LAND) : WASH_UNKNOWN) *
          edge(lng, lat);
        data.data[i] = rgb[0];
        data.data[i + 1] = rgb[1];
        data.data[i + 2] = rgb[2];
        data.data[i + 3] = Math.round(alpha * 255);
      }
    }
    c.putImageData(data, 0, 0);
    const url = image.toDataURL();
    const coordinates: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [nw.lng, nw.lat],
      [se.lng, nw.lat],
      [se.lng, se.lat],
      [nw.lng, se.lat],
    ];
    // A mask drawn before the coast's tiles had loaded is redrawn when they
    // have, a few times at most: each redraw is itself a render and an idle.
    washKey = sea ? key : "";
    if (!sea) {
      retries = unmasked === key ? retries + 1 : 0;
      unmasked = key;
    }
    const source = washSource();
    if (source) source.updateImage({ url, coordinates });
    else {
      map.addSource("wind-wash", { type: "image", url, coordinates });
      map.addLayer(
        {
          id: "wind-wash",
          type: "raster",
          source: "wind-wash",
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          },
        },
        map.getLayer(options.washBefore) ? options.washBefore : undefined,
      );
    }
  };
  const queueWash = (delay = 60) => {
    if (style !== "wash") {
      paintWash();
      return;
    }
    window.clearTimeout(washTimer);
    washTimer = window.setTimeout(paintWash, delay);
  };

  /* ---- wiring ---- */

  const onMoveStart = () => clear();
  const onMoveEnd = () => {
    restart();
    queueWash();
  };
  const onIdle = () => {
    if (style === "wash" && !washKey && retries < 3) queueWash(0);
  };
  const onVisible = () => restart();
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);
  map.on("resize", onMoveEnd);
  map.on("idle", onIdle);
  document.addEventListener("visibilitychange", onVisible);

  return {
    setFrame(next) {
      frame = next;
      restart();
      queueWash(0);
    },
    setStyle(next) {
      style = next;
      // Every style draws the arrows: only their colour changes.
      for (const p of cloud) p.trail = null;
      restart();
      washKey = "";
      queueWash(0);
    },
    setStops(next) {
      stops = next;
      paint();
      washKey = "";
      queueWash(0);
    },
    setPaused(next) {
      paused = next;
      if (paused) {
        cancelAnimationFrame(raf);
        raf = 0;
        ctx.clearRect(0, 0, width, height);
      } else restart();
    },
    get drawn() {
      return drawn;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(washTimer);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("resize", onMoveEnd);
      map.off("idle", onIdle);
      document.removeEventListener("visibilitychange", onVisible);
      ctx.clearRect(0, 0, width, height);
    },
  };
}
