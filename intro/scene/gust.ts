/**
 * The wind on the water, written once for the two places that need it: the
 * water's shader draws it (stronger air roughens the surface into darker
 * patches) and the fleet rides it (a rider in stronger air goes faster). The
 * same field in both, so a rider takes off exactly where the water darkens.
 *
 * Two parts. The patchwork: lanes of stronger and lighter air drifting
 * downwind, everywhere, all film long. And the squall: one big gust that
 * comes through the fleet from windward while the camera looks down on it,
 * planned around where the fleet will be (see planSquall).
 *
 * The CPU copy rounds to 32-bit floats at every step, as the GPU does, so the
 * hash lands on the same lattice values and the two fields agree.
 */
import { Vector2 } from "three";

/** The way the wind blows, on the water plane (x, z): from the left, a little from behind. */
export const WIND = new Vector2(1, 0.12).normalize();
/** How fast the patchwork drifts downwind, m/s. */
const DRIFT = 4.5;

export interface Squall {
  /** When its centre crosses (x, z), seconds, and how fast it moves downwind, m/s. */
  t: number;
  x: number;
  z: number;
  speed: number;
  /** Half-length along the wind and half-width across it, metres. */
  along: number;
  across: number;
  /** When it fills in and dies away, seconds. */
  from: number;
  to: number;
  /** How much stronger than the mean breeze its heart is (the mean is 1). */
  power: number;
}

/** No squall: the patchwork alone. */
export const CALM: Squall = {
  t: 0,
  x: 0,
  z: 0,
  speed: 0,
  along: 1,
  across: 1,
  from: 0,
  to: 0,
  power: 0,
};

/** The squall at time t: where its centre is and how strong it is just then. */
export function squallAt(squall: Squall, t: number, centre: Vector2): number {
  const run = (t - squall.t) * squall.speed;
  centre.set(squall.x + WIND.x * run, squall.z + WIND.y * run);
  const rise = smoothstep(squall.from, squall.from + 2.5, t);
  const fall = 1 - smoothstep(squall.to - 3, squall.to, t);
  return squall.power * rise * fall;
}

export const GUST_GLSL = /* glsl */ `
  uniform vec2 squallCentre;
  uniform vec2 squallSize;
  uniform float squallPower;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  vec2 gustCoords(vec2 p) {
    return (p - windDir * time * ${DRIFT.toFixed(1)}) * 0.012;
  }
  // The squall alone, ragged at its edges: 0 outside it.
  float squallField(vec2 p) {
    vec2 d = p - squallCentre;
    vec2 w = vec2(dot(d, windDir), dot(d, vec2(-windDir.y, windDir.x))) / squallSize;
    float ragged = 0.65 + 0.7 * vnoise(gustCoords(p) * 9.0 + 3.3);
    return squallPower * exp(-dot(w, w) * 2.2 * ragged);
  }
  // Stronger and lighter air: 1 is the mean breeze. Lanes drifting downwind,
  // and the squall on top.
  float gustField(vec2 p) {
    vec2 q = gustCoords(p);
    float n = vnoise(q) * 0.55 + vnoise(q * 2.3 + 7.1) * 0.3 + vnoise(q * 5.1 - 3.7) * 0.15;
    float g = mix(0.22, 1.35, smoothstep(0.32, 0.72, n));
    return g + squallField(p);
  }
`;

// ---- the same field on the CPU ---------------------------------------------

const f32 = Math.fround;
const fract = (x: number) => f32(x - Math.floor(x));

function hash(x: number, y: number): number {
  let px = fract(f32(x * f32(123.34)));
  let py = fract(f32(y * f32(456.21)));
  const d = f32(f32(px * f32(px + f32(45.32))) + f32(py * f32(py + f32(45.32))));
  px = f32(px + d);
  py = f32(py + d);
  return fract(f32(px * py));
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const centre = new Vector2();

/** The wind's strength at (x, z) at time t, where 1 is the mean breeze. */
export function gustAt(x: number, z: number, t: number, squall: Squall): number {
  const qx = (x - WIND.x * t * DRIFT) * 0.012;
  const qz = (z - WIND.y * t * DRIFT) * 0.012;
  const n =
    vnoise(qx, qz) * 0.55 +
    vnoise(qx * 2.3 + 7.1, qz * 2.3 + 7.1) * 0.3 +
    vnoise(qx * 5.1 - 3.7, qz * 5.1 - 3.7) * 0.15;
  const g = 0.22 + (1.35 - 0.22) * smoothstep(0.32, 0.72, n);
  const power = squallAt(squall, t, centre);
  if (power <= 0) return g;
  const dx = x - centre.x;
  const dz = z - centre.y;
  const u = (dx * WIND.x + dz * WIND.y) / squall.along;
  const v = (-dx * WIND.y + dz * WIND.x) / squall.across;
  const ragged = 0.65 + 0.7 * vnoise(qx * 9 + 3.3, qz * 9 + 3.3);
  return g + power * Math.exp(-(u * u + v * v) * 2.2 * ragged);
}
