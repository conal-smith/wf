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
 * particles have been.
 *
 * A line lives for between four and ten seconds, a different span for each,
 * so they never die together. It fades in as it is born and out as it ends,
 * and one that runs off the field coasts on its last heading while it fades,
 * rather than vanishing where it stood. The dead are born again somewhere in
 * the view, in the same slot: the cloud is a fixed set of typed arrays, its
 * trails one ring buffer, and a frame allocates nothing.
 *
 * The same lines live through pans, zooms and a change of forecast hour. As
 * the map moves they are carried with it, every point reprojected each frame,
 * and they keep drifting on the field they had, its direction and pace
 * rescaled for the camera, so a zoom neither stretches their trails nor
 * speeds them up. Once the camera stops the field is resampled for the new
 * view; lines left off-screen are reborn inside it, and the cloud grows or
 * thins to the new view's size.
 *
 * The wash is an image source covering the view and a margin round it, drawn
 * under the contours and the coast, and kept off the land through a mask made
 * from the basemap's own water polygons; where those have not loaded yet the
 * land gets a fainter wash rather than none. Zoomed right in, where the
 * depths take over, the wash fades out and the coloured arrows go to ink.
 */
import type { ImageSource, LngLat, Map as MapLibreMap } from "maplibre-gl";
import { rideColour, type RideStop } from "./chartStyle";
import { KNOTS } from "./units";
import { sample, type Frame } from "./weather";

export type WindStyle = "ink" | "arrows" | "wash";
export const WIND_STYLES: readonly WindStyle[] = ["ink", "arrows", "wash"];

const STEP = 10;
const BUCKETS = 4;
/** Trails this many steps long: the mockup's fade of 0.93 to 15%. */
const TRAIL = 24;
/** Points a trail holds: its head and the TRAIL steps behind it. */
const SLOTS = TRAIL + 1;
/**
 * Alpha levels a trail is drawn in. At full strength its four buckets use
 * every other one, as they always have; the levels between are for a line
 * fading in or out.
 */
const LEVELS = BUCKETS * 2;
/** A line's life, in steps of 30 ms: between about four and ten seconds. */
const LIFE_MIN = 140;
const LIFE_SPAN = 180;
/** Steps to fade in at birth and out at the end. */
const FADE_IN = 12;
const FADE_OUT = 16;
const BINS = 12;
/**
 * The zoom where the depths take over. Zoomed right in, a rider is reading
 * how deep the water is, and the depth tints are at full strength from here
 * (chartStyle): the wind's colours would clash with them, so the wash has
 * faded out by this zoom and the coloured arrows are drawn in ink. The
 * moving lines themselves stay at every zoom.
 */
const DEPTHS_ZOOM = 11;
/** The wash fades over the half zoom before it. */
const WASH_FADE = 0.5;
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

/** Pixels per step per m/s at this zoom, so lines move at a pace that reads. */
function paceOf(map: MapLibreMap) {
  const lat = map.getCenter().lat;
  const mpp =
    (40075016 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  return 18 / Math.max(mpp, 1) ** 0.35 / 30;
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
  let paused = false;
  let destroyed = false;
  let width = 0,
    height = 0,
    fw = 0,
    fh = 0;
  let field: Float32Array | null = null;
  /** The field wants resampling for the view, once the camera is still. */
  let stale = true;
  let raf = 0,
    last = 0,
    drawn = 0;

  /** Colours per speed bin (arrows) or strong/light pair (ink), per level. */
  let colours: string[][] = [];
  const inks = [0.3, 0.5].map((a) =>
    Array.from({ length: LEVELS + 1 }, (_, l) => rgba(ink, (a * l) / LEVELS)),
  );
  const paint = () => {
    colours = Array.from({ length: BINS }, (_, b) => {
      // Bins run 0–36 kn in 3 kn steps, the last one open-ended.
      const kn = b * 3 + 1.5;
      const rgb = stops.length ? rideColour(stops, kn) : ink;
      // Darkened a touch toward the ink, so a pale green still reads on paper.
      const toned = rgb.map((v, i) => Math.round(v * 0.8 + ink[i] * 0.2));
      return Array.from({ length: LEVELS + 1 }, (_, l) =>
        rgba(toned, (0.9 * l) / LEVELS),
      );
    });
  };
  paint();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Joined runs with round joins draw what round-capped segments did.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };
  /** Speed colours, but for ink where the depths take over. */
  const colouredNow = () => style === "arrows" && map.getZoom() < DEPTHS_ZOOM;

  /* ---- the cloud ---- */

  // One slot per particle in each array. Capacities are powers of two, so no
  // array here is ever the field's size (a multiple of three), which the e2e
  // probe counts field rebuilds by.
  let cap = 0,
    count = 0,
    target = 0;
  /** Each particle's points, oldest to newest round a ring of SLOTS. */
  let trail = new Float32Array(0);
  /** The ring slot of the newest point, and how many points are held. */
  let head = new Uint8Array(0);
  /** Points held; none while a particle waits for somewhere to be born. */
  let held = new Uint8Array(0);
  let age = new Uint16Array(0);
  let life = new Uint16Array(0);
  let bin = new Uint8Array(0);
  /** Off the field: drifting on its last step while it fades. */
  let coast = new Uint8Array(0);
  /** Born with the view, to be run a trail's length before it is drawn. */
  let fresh = new Uint8Array(0);
  /** The last step taken, x then y. */
  let vel = new Float32Array(0);
  /** The draw's runs, by bin and level: a particle's index times BUCKETS plus k. */
  let runs = new Uint32Array(0);
  let runKey = new Uint16Array(0);
  const keyCount = new Uint32Array(BINS * LEVELS + 1);

  const grow = (n: number) => {
    if (n <= cap) return;
    let next = Math.max(cap, 256);
    while (next < n) next *= 2;
    const more = <T extends Float32Array | Uint8Array | Uint16Array>(
      old: T,
      size: number,
      make: (n: number) => T,
    ) => {
      const out = make(next * size);
      out.set(old);
      return out;
    };
    trail = more(trail, SLOTS * 2, (n) => new Float32Array(n));
    head = more(head, 1, (n) => new Uint8Array(n));
    held = more(held, 1, (n) => new Uint8Array(n));
    age = more(age, 1, (n) => new Uint16Array(n));
    life = more(life, 1, (n) => new Uint16Array(n));
    bin = more(bin, 1, (n) => new Uint8Array(n));
    coast = more(coast, 1, (n) => new Uint8Array(n));
    fresh = more(fresh, 1, (n) => new Uint8Array(n));
    vel = more(vel, 2, (n) => new Float32Array(n));
    runs = new Uint32Array(next * BUCKETS);
    runKey = new Uint16Array(next * BUCKETS);
    cap = next;
  };

  /** The last particle moved into slot i, and the cloud one smaller. */
  const remove = (i: number) => {
    const j = --count;
    if (i === j) return;
    trail.copyWithin(i * SLOTS * 2, j * SLOTS * 2, (j + 1) * SLOTS * 2);
    head[i] = head[j];
    held[i] = held[j];
    age[i] = age[j];
    life[i] = life[j];
    bin[i] = bin[j];
    coast[i] = coast[j];
    fresh[i] = fresh[j];
    vel[i * 2] = vel[j * 2];
    vel[i * 2 + 1] = vel[j * 2 + 1];
  };

  // The view's field, as the camera has moved since it was sampled: screen
  // positions back to the field's own (an affine map, the camera never
  // rotating or tilting by much), and the field's steps forward, rescaled
  // for the pace at the camera's zoom.
  /** Where the field's corners were, and the size it was sampled at. */
  let corners: LngLat[] | null = null;
  let cornerW = 0,
    cornerH = 0;
  /** The screen's pixels back to the field's. */
  let ia = 1,
    ib = 0,
    ic = 0,
    id = 1,
    ie = 0,
    if_ = 0;
  /** A field step to a screen step. */
  let ga = 1,
    gb = 0,
    gc = 0,
    gd = 1;
  /** The pace the field was sampled at, and the camera's now. */
  let paceField = 1,
    paceNow = 1;

  /**
   * Carries the cloud with the camera: every point reprojected, and each
   * trail scaled about its head to the pace at the new zoom, so a line keeps
   * the length a line has there rather than stretching with the map.
   */
  const follow = () => {
    if (!corners) return;
    const p0 = map.project(corners[0]),
      p1 = map.project(corners[1]),
      p2 = map.project(corners[2]);
    const a = (p1.x - p0.x) / cornerW,
      b = (p1.y - p0.y) / cornerW,
      c = (p2.x - p0.x) / cornerH,
      d = (p2.y - p0.y) / cornerH,
      e = p0.x,
      f = p0.y;
    // The move since the last time: back to the field's pixels, then out.
    const ma = a * ia + c * ib,
      mc = a * ic + c * id,
      me = a * ie + c * if_ + e,
      mb = b * ia + d * ib,
      md = b * ic + d * id,
      mf = b * ie + d * if_ + f;
    const scale = Math.sqrt(Math.abs(ma * md - mb * mc)) || 1;
    const pace = paceOf(map);
    const r = pace / paceNow / scale;
    if (
      Math.abs(ma - 1) + Math.abs(mb) + Math.abs(mc) + Math.abs(md - 1) >
        1e-9 ||
      Math.abs(me) + Math.abs(mf) > 1e-6
    )
      for (let i = 0; i < count; i++) {
        const n = held[i];
        if (!n) continue;
        const base = i * SLOTS * 2;
        const h = base + head[i] * 2;
        const hx = trail[h],
          hy = trail[h + 1];
        const x = ma * hx + mc * hy + me,
          y = mb * hx + md * hy + mf;
        for (let s = 0; s < SLOTS; s++) {
          const o = base + s * 2;
          const px = ma * trail[o] + mc * trail[o + 1] + me,
            py = mb * trail[o] + md * trail[o + 1] + mf;
          trail[o] = x + (px - x) * r;
          trail[o + 1] = y + (py - y) * r;
        }
        const vx = vel[i * 2],
          vy = vel[i * 2 + 1];
        vel[i * 2] = (ma * vx + mc * vy) * r;
        vel[i * 2 + 1] = (mb * vx + md * vy) * r;
      }
    paceNow = pace;
    // The field's pixels to the screen's are x' = a x + c y + e and
    // y' = b x + d y + f; this is the way back.
    const det = a * d - b * c || 1;
    ia = d / det;
    ib = -b / det;
    ic = -c / det;
    id = a / det;
    ie = (c * f - d * e) / det;
    if_ = (b * e - a * f) / det;
    const sq = Math.sqrt(Math.abs(det)) || 1;
    const q = paceNow / paceField / sq;
    ga = a * q;
    gb = b * q;
    gc = c * q;
    gd = d * q;
  };

  /**
   * The wind at a screen point, as a step in screen pixels and a speed. The
   * point goes in and the wind comes out through typed arrays: a fraction
   * passed to a function or kept in a closure's variable is boxed on the
   * heap, and this runs for every particle every step.
   */
  const point = new Float64Array(2);
  const wind = new Float64Array(3);
  const at = () => {
    const f = field;
    if (!f) return false;
    const px = point[0],
      py = point[1];
    const gx = (ia * px + ic * py + ie) / STEP,
      gy = (ib * px + id * py + if_) / STEP;
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
    const u = f[i00] * w00 + f[i10] * w10 + f[i01] * w01 + f[i11] * w11,
      v =
        f[i00 + 1] * w00 +
        f[i10 + 1] * w10 +
        f[i01 + 1] * w01 +
        f[i11 + 1] * w11;
    wind[0] = ga * u + gc * v;
    wind[1] = gb * u + gd * v;
    wind[2] =
      f[i00 + 2] * w00 + f[i10 + 2] * w10 + f[i01 + 2] * w01 + f[i11 + 2] * w11;
    return true;
  };

  /**
   * A new life in slot i, somewhere in the view the field covers, and out of
   * the way of the lines already there if it is told where they are; if a few
   * tries find nowhere, it waits and tries again next step.
   */
  const spawn = (i: number, avoid?: (x: number, y: number) => boolean) => {
    held[i] = 0;
    for (let t = 0; t < 8; t++) {
      const x = (point[0] = Math.random() * width),
        y = (point[1] = Math.random() * height);
      if ((t < 6 && avoid?.(x, y)) || !at()) continue;
      const o = i * SLOTS * 2;
      trail[o] = x;
      trail[o + 1] = y;
      head[i] = 0;
      held[i] = 1;
      age[i] = 0;
      life[i] = LIFE_MIN + Math.floor(Math.random() * LIFE_SPAN);
      coast[i] = 0;
      vel[i * 2] = wind[0];
      vel[i * 2 + 1] = wind[1];
      return;
    }
  };

  /**
   * Every particle one step on, its trail with it. The dead are born again,
   * or let go while the cloud is larger than the view wants.
   */
  const advance = (coloured: boolean, freshOnly = false) => {
    for (let i = 0; i < count; i++) {
      if (freshOnly && !fresh[i]) continue;
      if (age[i] >= life[i] || !held[i]) {
        if (count > target) {
          remove(i--);
          continue;
        }
        spawn(i);
        continue;
      }
      const base = i * SLOTS * 2;
      let h = head[i];
      let x = trail[base + h * 2],
        y = trail[base + h * 2 + 1];
      if (!coast[i]) {
        point[0] = x;
        point[1] = y;
        if (at()) {
          vel[i * 2] = wind[0];
          vel[i * 2 + 1] = wind[1];
          bin[i] = coloured
            ? Math.min(BINS - 1, Math.floor((wind[2] * KNOTS) / 3))
            : wind[2] > 7
              ? 1
              : 0;
        } else {
          // Off the field: on the same heading, fading out.
          coast[i] = 1;
          life[i] = Math.min(life[i], age[i] + FADE_OUT);
        }
      }
      x += vel[i * 2];
      y += vel[i * 2 + 1];
      h = h + 1 === SLOTS ? 0 : h + 1;
      trail[base + h * 2] = x;
      trail[base + h * 2 + 1] = y;
      head[i] = h;
      if (held[i] < SLOTS) held[i]++;
      age[i]++;
    }
  };

  /** Strength of a line by its age: up from nothing, and back down at the end. */
  const strength = (i: number) =>
    Math.max(
      0,
      Math.min(1, (age[i] + 1) / FADE_IN, (life[i] - age[i]) / FADE_OUT),
    );

  /** The trails, one stroke per colour and alpha level in use. */
  const draw = (coloured: boolean) => {
    ctx.clearRect(0, 0, width, height);
    drawn = 0;
    const keys = (coloured ? BINS : 2) * LEVELS;
    keyCount.fill(0);
    // Each trail's buckets, keyed by colour and level, then sorted by key so
    // each stroke is one walk along its own runs.
    for (let i = 0; i < count; i++) {
      const n = held[i] - 1;
      const s = n > 0 ? strength(i) : 0;
      for (let k = 0; k < BUCKETS; k++) {
        const r = i * BUCKETS + k;
        const level = Math.round(((k + 1) * LEVELS * s) / BUCKETS);
        if (
          !level ||
          Math.floor(((k + 1) * n) / BUCKETS) <= Math.floor((k * n) / BUCKETS)
        ) {
          runKey[r] = keys;
          continue;
        }
        const key = Math.min(bin[i], keys / LEVELS - 1) * LEVELS + level - 1;
        runKey[r] = key;
        keyCount[key]++;
      }
    }
    let sum = 0;
    for (let key = 0; key <= keys; key++) {
      const c = keyCount[key];
      keyCount[key] = sum;
      sum += c;
    }
    for (let r = 0; r < count * BUCKETS; r++) runs[keyCount[runKey[r]]++] = r;
    // keyCount[key] is now where each key's runs end.
    let from = 0;
    for (let key = 0; key < keys; key++) {
      const to = keyCount[key];
      if (to === from) continue;
      const b = Math.floor(key / LEVELS),
        level = (key % LEVELS) + 1;
      ctx.lineWidth = coloured ? (b >= 3 ? 1.6 : 1.2) : b ? 1.4 : 1;
      ctx.strokeStyle = coloured ? colours[b][level] : inks[b][level];
      ctx.beginPath();
      for (let j = from; j < to; j++) {
        const r = runs[j];
        const i = (r / BUCKETS) | 0,
          k = r - i * BUCKETS;
        const n = held[i] - 1;
        const first = Math.floor((k * n) / BUCKETS),
          end = Math.floor(((k + 1) * n) / BUCKETS);
        // The oldest point's slot, and so point p's.
        const tail = head[i] + SLOTS - n;
        const base = i * SLOTS * 2;
        for (let p = first; p <= end; p++) {
          const o = base + ((tail + p) % SLOTS) * 2;
          if (p === first) ctx.moveTo(trail[o], trail[o + 1]);
          else ctx.lineTo(trail[o], trail[o + 1]);
        }
      }
      ctx.stroke();
      drawn++;
      from = to;
    }
  };

  /** Whether any of particle i's trail is in the view. */
  const inView = (i: number) => {
    const base = i * SLOTS * 2;
    for (let p = 0; p < held[i]; p++) {
      const o = base + ((head[i] + SLOTS - p) % SLOTS) * 2;
      const x = trail[o],
        y = trail[o + 1];
      if (x >= 0 && y >= 0 && x <= width && y <= height) return true;
    }
    return false;
  };

  /**
   * The forecast resampled for the view, px per step and the speed, and the
   * cloud carried into it: what the camera left behind is born again inside
   * the view, and the cloud sized to the view's area.
   */
  const build = () => {
    stale = false;
    follow();
    resize();
    field = null;
    if (!frame || !width || !height) return;
    fw = Math.ceil(width / STEP) + 1;
    fh = Math.ceil(height / STEP) + 1;
    const f = new Float32Array(fw * fh * 3);
    const k = paceOf(map);
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
    // Where the last view lies in this one, and how much smaller: zoomed
    // out, its lines are crowded into its footprint.
    const old = corners
      ? { a: ia, b: ib, c: ic, d: id, e: ie, f: if_, w: cornerW, h: cornerH }
      : null;
    const shrink = old
      ? Math.min(1, 1 / Math.abs(old.a * old.d - old.b * old.c))
      : 1;
    const inOld = (x: number, y: number) => {
      if (!old) return false;
      const fx = old.a * x + old.c * y + old.e,
        fy = old.b * x + old.d * y + old.f;
      return fx >= 0 && fy >= 0 && fx <= old.w && fy <= old.h;
    };
    corners = [
      map.unproject([0, 0]),
      map.unproject([width, 0]),
      map.unproject([0, height]),
    ];
    cornerW = width;
    cornerH = height;
    ia = id = ga = gd = 1;
    ib = ic = ie = if_ = gb = gc = 0;
    paceField = paceNow = k;

    // Lines the camera left out of view are born again where it has
    // uncovered paper, at once: nobody sees them go. Where it zoomed out, a
    // share of the crowded lines fades out and as many are born outside the
    // old view, so the density comes back even.
    target = Math.round(((width * height) / 1000) * density);
    fresh.fill(0, 0, count);
    let thinned = 0;
    for (let i = 0; i < count; i++) {
      if (!held[i]) continue;
      if (inView(i)) {
        if (Math.random() < shrink || age[i] + FADE_OUT >= life[i]) continue;
        life[i] = age[i] + FADE_OUT;
        thinned++;
      } else if (count > target) remove(i--);
      else {
        spawn(i, inOld);
        fresh[i] = 1;
      }
    }
    const want = Math.max(target, Math.min(count + thinned, target * 2));
    grow(want);
    for (; count < want; count++) {
      spawn(count, inOld);
      fresh[count] = 1;
    }
    // Run the newly born a trail's length before they are drawn, so a view
    // the camera has just arrived at fills with whole lines, fading in,
    // rather than dots growing their trails for most of a second.
    const coloured = colouredNow();
    for (let i = 0; i < TRAIL; i++) advance(coloured, true);
    for (let i = 0; i < count; i++) if (fresh[i]) age[i] = 0;
  };

  /* ---- the loop ---- */

  /** The cloud a step on when one is due, then drawn. */
  const tick = (now: number) => {
    const coloured = colouredNow();
    if (now - last >= 30) {
      last = now;
      advance(coloured);
    }
    draw(coloured);
  };
  const step = (now: number) => {
    raf = 0;
    if (destroyed || paused || !frame || document.hidden) return;
    raf = requestAnimationFrame(step);
    if (now - last < 30) return;
    // The field is resampled once the camera is still: per frame it is too
    // costly, and until then the cloud drifts on the one it had.
    if (stale && !map.isMoving()) build();
    if (field) tick(now);
  };

  const restart = () => {
    if (!raf && !destroyed && !paused) raf = requestAnimationFrame(step);
  };
  const resample = () => {
    stale = true;
    restart();
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
    // Where the depths take over the wash has faded out: no image to make.
    if (zoom >= DEPTHS_ZOOM) return;
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
            "raster-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              DEPTHS_ZOOM - WASH_FADE,
              1,
              DEPTHS_ZOOM,
              0,
            ],
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

  // The lines go with the map as it moves, drawn in the same frame as it.
  const onMove = () => {
    if (destroyed || paused || !frame || !field || document.hidden) return;
    follow();
    tick(performance.now());
  };
  const onMoveEnd = () => {
    resample();
    queueWash();
  };
  const onIdle = () => {
    if (style === "wash" && !washKey && retries < 3) queueWash(0);
  };
  const onVisible = () => restart();
  map.on("move", onMove);
  map.on("moveend", onMoveEnd);
  map.on("resize", onMoveEnd);
  map.on("idle", onIdle);
  document.addEventListener("visibilitychange", onVisible);

  return {
    setFrame(next) {
      frame = next;
      // A new hour, the same lines: they follow its field from here.
      resample();
      queueWash(0);
    },
    setStyle(next) {
      style = next;
      // Every style draws the arrows: only their colour changes.
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
      map.off("move", onMove);
      map.off("moveend", onMoveEnd);
      map.off("resize", onMoveEnd);
      map.off("idle", onIdle);
      document.removeEventListener("visibilitychange", onVisible);
      ctx.clearRect(0, 0, width, height);
    },
  };
}
