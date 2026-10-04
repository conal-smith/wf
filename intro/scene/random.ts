/**
 * Seeded randomness, so the island, the coast and the fleet come out the same
 * on every visit: a first impression that changed on reload would be a
 * different film each time, and a screenshot could never be compared.
 */

/** mulberry32: a small, fast 32-bit generator with a good spread. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lattice hash in [0, 1) for integer coordinates and a seed. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed * 1442695;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [-1, 1], smooth (quintic) between lattice points. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal sum of `octaves` layers of value noise, about [-1, 1]. */
export function fbm2(x: number, y: number, octaves = 5, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x, y, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 11.7;
    y = y * 2.03 - 5.3;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: sharp crests, for rock and cliff tops. */
export function ridged2(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x, y, seed + i * 31));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    x *= 2.1;
    y *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
