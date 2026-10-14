/**
 * The ink lines drifting with the forecast (force5/src/windLayer.ts), as
 * worklets: the cloud lives on the UI thread, in a fixed set of typed arrays,
 * and a step allocates nothing. Each line keeps its last few positions and
 * its trail is drawn fresh every frame, older segments fainter; it lives
 * four to ten seconds, fades in as it is born and out as it ends, and one
 * that runs off the field coasts on its last heading while it fades.
 *
 * The lines live in screen points. The chart's camera does not move them:
 * the overlay hides while the map moves and the field is resampled where it
 * comes to rest (WindParticles.tsx), so nothing here ever reprojects.
 *
 * Pure: the functions are marked as worklets for Reanimated, and are plain
 * functions anywhere else, so Node tests them.
 */

export const TRAIL = 24;
export const SLOTS = TRAIL + 1;
export const BUCKETS = 4;
/** Alpha levels a trail is drawn in: its four buckets use every other one at full strength. */
export const LEVELS = BUCKETS * 2;
/** Strong and light ink: a breeze over 7 m/s draws bolder. */
export const BINS = 2;
const LIFE_MIN = 140;
const LIFE_SPAN = 180;
const FADE_IN = 12;
const FADE_OUT = 16;
/** Steps are 30 ms apart, as the site's. */
export const STEP_MS = 30;

/** The field the cloud drifts on, as WindParticles sends it to the UI thread. */
export interface FieldMessage {
  /** Bumped for every new field. */
  id: number;
  /** Which camera it was sampled for: a new hour on the same camera keeps the cloud. */
  camera: string;
  width: number;
  height: number;
  w: number;
  h: number;
  step: number;
  /** u, v (points a step), speed (m/s) per node. */
  data: number[];
  /** Lines per thousand square points. */
  density: number;
}

export interface Sim {
  cap: number;
  count: number;
  target: number;
  trail: Float32Array;
  head: Uint8Array;
  held: Uint8Array;
  age: Uint16Array;
  life: Uint16Array;
  bin: Uint8Array;
  coast: Uint8Array;
  vel: Float32Array;
  field: Float32Array;
  fw: number;
  fh: number;
  step: number;
  width: number;
  height: number;
  fieldId: number;
  camera: string;
  /** The wind at the last point asked: u, v, speed. */
  wind: Float32Array;
}

export function createSim(cap: number): Sim {
  "worklet";
  return {
    cap,
    count: 0,
    target: 0,
    trail: new Float32Array(cap * SLOTS * 2),
    head: new Uint8Array(cap),
    held: new Uint8Array(cap),
    age: new Uint16Array(cap),
    life: new Uint16Array(cap),
    bin: new Uint8Array(cap),
    coast: new Uint8Array(cap),
    vel: new Float32Array(cap * 2),
    field: new Float32Array(0),
    fw: 0,
    fh: 0,
    step: 10,
    width: 0,
    height: 0,
    fieldId: -1,
    camera: "",
    wind: new Float32Array(3),
  };
}

/** The wind at a screen point, bilinear, into `sim.wind`; false off the field. */
export function windAt(sim: Sim, px: number, py: number): boolean {
  "worklet";
  const f = sim.field;
  const gx = px / sim.step;
  const gy = py / sim.step;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  if (x0 < 0 || y0 < 0 || x0 >= sim.fw - 1 || y0 >= sim.fh - 1) return false;
  const ax = gx - x0;
  const ay = gy - y0;
  const i00 = (y0 * sim.fw + x0) * 3;
  const i10 = i00 + 3;
  const i01 = i00 + sim.fw * 3;
  const i11 = i01 + 3;
  if (Number.isNaN(f[i00]) || Number.isNaN(f[i10]) || Number.isNaN(f[i01]) || Number.isNaN(f[i11])) return false;
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  sim.wind[0] = f[i00] * w00 + f[i10] * w10 + f[i01] * w01 + f[i11] * w11;
  sim.wind[1] = f[i00 + 1] * w00 + f[i10 + 1] * w10 + f[i01 + 1] * w01 + f[i11 + 1] * w11;
  sim.wind[2] = f[i00 + 2] * w00 + f[i10 + 2] * w10 + f[i01 + 2] * w01 + f[i11 + 2] * w11;
  return true;
}

/** A new life in slot i somewhere on the field; if a few tries find nowhere, it waits. */
export function spawn(sim: Sim, i: number, random: () => number): void {
  "worklet";
  sim.held[i] = 0;
  for (let t = 0; t < 8; t++) {
    const x = random() * sim.width;
    const y = random() * sim.height;
    if (!windAt(sim, x, y)) continue;
    const o = i * SLOTS * 2;
    sim.trail[o] = x;
    sim.trail[o + 1] = y;
    sim.head[i] = 0;
    sim.held[i] = 1;
    sim.age[i] = 0;
    sim.life[i] = LIFE_MIN + Math.floor(random() * LIFE_SPAN);
    sim.coast[i] = 0;
    sim.vel[i * 2] = sim.wind[0];
    sim.vel[i * 2 + 1] = sim.wind[1];
    sim.bin[i] = sim.wind[2] > 7 ? 1 : 0;
    return;
  }
}

/** The last line moved into slot i, and the cloud one smaller. */
function remove(sim: Sim, i: number): void {
  "worklet";
  const j = --sim.count;
  if (i === j) return;
  sim.trail.copyWithin(i * SLOTS * 2, j * SLOTS * 2, (j + 1) * SLOTS * 2);
  sim.head[i] = sim.head[j];
  sim.held[i] = sim.held[j];
  sim.age[i] = sim.age[j];
  sim.life[i] = sim.life[j];
  sim.bin[i] = sim.bin[j];
  sim.coast[i] = sim.coast[j];
  sim.vel[i * 2] = sim.vel[j * 2];
  sim.vel[i * 2 + 1] = sim.vel[j * 2 + 1];
}

/** Every line a step on. The dead are born again, or let go while the cloud is too big. */
export function advance(sim: Sim, random: () => number): void {
  "worklet";
  for (let i = 0; i < sim.count; i++) {
    if (sim.age[i] >= sim.life[i] || !sim.held[i]) {
      if (sim.count > sim.target) {
        remove(sim, i--);
        continue;
      }
      spawn(sim, i, random);
      continue;
    }
    const base = i * SLOTS * 2;
    let h = sim.head[i];
    let x = sim.trail[base + h * 2];
    let y = sim.trail[base + h * 2 + 1];
    if (!sim.coast[i]) {
      if (windAt(sim, x, y)) {
        sim.vel[i * 2] = sim.wind[0];
        sim.vel[i * 2 + 1] = sim.wind[1];
        sim.bin[i] = sim.wind[2] > 7 ? 1 : 0;
      } else {
        sim.coast[i] = 1;
        sim.life[i] = Math.min(sim.life[i], sim.age[i] + FADE_OUT);
      }
    }
    x += sim.vel[i * 2];
    y += sim.vel[i * 2 + 1];
    h = h + 1 === SLOTS ? 0 : h + 1;
    sim.trail[base + h * 2] = x;
    sim.trail[base + h * 2 + 1] = y;
    sim.head[i] = h;
    if (sim.held[i] < SLOTS) sim.held[i]++;
    sim.age[i]++;
  }
}

/**
 * A new field. On the camera the cloud already has (a new hour), the lines
 * stay and follow it from here; anywhere else they are all born again over
 * the new view and run a trail's length first, so the view fills with whole
 * lines fading in rather than dots growing their trails.
 */
export function loadField(sim: Sim, message: FieldMessage, random: () => number): void {
  "worklet";
  const same = message.camera === sim.camera && sim.width === message.width && sim.height === message.height;
  sim.fieldId = message.id;
  sim.camera = message.camera;
  sim.width = message.width;
  sim.height = message.height;
  sim.fw = message.w;
  sim.fh = message.h;
  sim.step = message.step;
  if (sim.field.length !== message.data.length) sim.field = new Float32Array(message.data.length);
  for (let i = 0; i < message.data.length; i++) sim.field[i] = message.data[i];
  sim.target = Math.min(sim.cap, Math.round(((message.width * message.height) / 1000) * message.density));
  if (same && sim.count) return;
  sim.count = sim.target;
  for (let i = 0; i < sim.count; i++) spawn(sim, i, random);
  for (let s = 0; s < TRAIL; s++) advance(sim, random);
  for (let i = 0; i < sim.count; i++) sim.age[i] = 0;
}

/** Strength of a line by its age: up from nothing, and back down at the end. */
export function strength(sim: Sim, i: number): number {
  "worklet";
  return Math.max(0, Math.min(1, (sim.age[i] + 1) / FADE_IN, (sim.life[i] - sim.age[i]) / FADE_OUT));
}

/**
 * The trails as runs to stroke: each line's points in four buckets, older
 * fainter, each bucket under a key (bin × LEVELS + level − 1) that names its
 * ink and alpha. `emit` is called with the key and each point in turn,
 * `start` true on a run's first point.
 */
export function traceRuns(
  sim: Sim,
  emit: (key: number, x: number, y: number, start: boolean) => void,
): number {
  "worklet";
  let runs = 0;
  for (let i = 0; i < sim.count; i++) {
    const n = sim.held[i] - 1;
    if (n <= 0) continue;
    const s = strength(sim, i);
    const tail = sim.head[i] + SLOTS - n;
    const base = i * SLOTS * 2;
    for (let k = 0; k < BUCKETS; k++) {
      const level = Math.round(((k + 1) * LEVELS * s) / BUCKETS);
      const first = Math.floor((k * n) / BUCKETS);
      const end = Math.floor(((k + 1) * n) / BUCKETS);
      if (!level || end <= first) continue;
      const key = Math.min(sim.bin[i], BINS - 1) * LEVELS + level - 1;
      for (let p = first; p <= end; p++) {
        const o = base + ((tail + p) % SLOTS) * 2;
        emit(key, sim.trail[o], sim.trail[o + 1], p === first);
      }
      runs++;
    }
  }
  return runs;
}

/** The two inks' alpha at each level: light air at 0.3, a breeze at 0.5 (windLayer.ts). */
export function inkAlpha(key: number): number {
  "worklet";
  const b = Math.floor(key / LEVELS);
  const level = (key % LEVELS) + 1;
  return ((b ? 0.5 : 0.3) * level) / LEVELS;
}

export const inkWidth = (key: number): number => {
  "worklet";
  return Math.floor(key / LEVELS) ? 1.4 : 1;
};
