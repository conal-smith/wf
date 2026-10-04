/**
 * The land: an island ahead with cliffs on its seaward side, a coast of
 * cliffs running away on the left like the Atlantic edge of Kerry or Clare,
 * and mountains behind it that the haze turns to paper. All generated from
 * seeded noise; vertices are packed where the shape changes fastest (the cliff
 * face) and spread thin where it hardly changes (the hills a mile inland).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { hazed } from "./haze";
import { fbm2, lerp, noise2, ridged2, smoothstep } from "./random";

const ROCK = new Color(0.2, 0.17, 0.14);
const PALE_ROCK = new Color(0.34, 0.3, 0.25);
const WET = new Color(0.045, 0.04, 0.035);
const GRASS = new Color(0.075, 0.12, 0.035);
const HEATH = new Color(0.12, 0.09, 0.06);

/**
 * Rock up close: horizontal strata, the way Old Red Sandstone weathers on the
 * Kerry cliffs, and grain at a couple of scales, as bump and as colour. It
 * fades out with distance, where it would only shimmer.
 */
function rocky(material: MeshStandardMaterial): MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    const noise = `
      float rh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float rn(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(rh(i), rh(i + vec3(1,0,0)), f.x), mix(rh(i + vec3(0,1,0)), rh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(rh(i + vec3(0,0,1)), rh(i + vec3(1,0,1)), f.x), mix(rh(i + vec3(0,1,1)), rh(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float rockHeight(vec3 p) {
        float strata = sin(p.y * 1.3 + rn(p * 0.02) * 9.0) * 0.5 + 0.5;
        return strata * 0.55 + rn(p * 0.3) * 0.3 + rn(p * 1.4) * 0.15;
      }`;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + noise)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float n = rn(vHazeWorld * 0.06) * 0.6 + rn(vHazeWorld * 0.5) * 0.4;
          diffuseColor.rgb *= 0.72 + 0.56 * n;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          float dist = length(vHazeWorld - cameraPosition);
          float scale = 0.9 * smoothstep(3500.0, 250.0, dist);
          if (scale > 0.0) {
            float hgt = rockHeight(vHazeWorld) * scale;
            vec3 dpx = dFdx(-vViewPosition);
            vec3 dpy = dFdy(-vViewPosition);
            vec3 r1 = cross(dpy, normal);
            vec3 r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec2 dh = vec2(dFdx(hgt), dFdy(hgt));
            vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
            normal = normalize(abs(det) * normal - grad);
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => "rocky";
  return material;
}

/** Colour by height above the sea, steepness and a little noise. */
function paint(out: Color, h: number, up: number, x: number, z: number) {
  const n = noise2(x * 0.02, z * 0.02, 5) * 0.5 + 0.5;
  const steep = smoothstep(0.82, 0.55, up);
  out.copy(GRASS).lerp(HEATH, smoothstep(140, 380, h) * 0.8 + n * 0.2);
  const rock = new Color().copy(ROCK).lerp(PALE_ROCK, n);
  out.lerp(rock, steep);
  out.lerp(WET, smoothstep(4, 0.5, h));
  out.multiplyScalar(0.85 + n * 0.3);
}

/** Builds an indexed grid of rows x cols from a vertex function. */
function grid(
  rows: number,
  cols: number,
  vertex: (row: number, col: number, out: number[]) => void,
): BufferGeometry {
  const positions = new Float32Array(rows * cols * 3);
  const p: number[] = [0, 0, 0];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      vertex(r, c, p);
      positions.set(p, (r * cols + c) * 3);
    }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function colourise(geometry: BufferGeometry) {
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    paint(c, pos.getY(i), nor.getY(i), pos.getX(i), pos.getZ(i));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

/** Inland distances (m) at which the coast strip places a column of vertices. */
const COAST_OFFSETS = [
  -120, -40, -12, -4, 0, 1.5, 3, 5, 7, 9, 11, 13, 16, 20, 26, 34, 46, 62, 85,
  120, 170, 240, 340, 480, 680, 950, 1300, 1800, 2400, 3100, 3900, 4800, 5800,
  7000,
];

/** Where the shoreline is, as x for a given z: a bay opening towards the sun. */
export function coastX(z: number): number {
  const away = Math.max(0, -z);
  return (
    -950 - away * 0.32 + 160 * fbm2(z * 0.0009, 3.3, 3, 2) + 40 * noise2(z * 0.006, 1, 4)
  );
}

function coastHeight(d: number, z: number): number {
  if (d < 0) return lerp(-14, 0.5, smoothstep(-80, 0, d));
  const top = 58 + 42 * fbm2(z * 0.0016, 0.7, 4, 9) + 18 * ridged2(z * 0.004, 2, 3, 3);
  // The face: nearly vertical, ragged with rock, then the clifftop's grass.
  const face = smoothstep(0.5, 9 + 6 * noise2(z * 0.03, 0, 6), d);
  const ragged = 4 * fbm2(z * 0.05, d * 0.2, 3, 8) * (1 - Math.abs(face - 0.5) * 2);
  const hills = 70 * smoothstep(40, 1400, d) * (0.5 + 0.5 * fbm2(z * 0.0012, d * 0.0012, 4, 12));
  const mountains =
    430 * smoothstep(1700, 4600, d) * (0.45 + 0.55 * ridged2(z * 0.0005, d * 0.0005, 5, 21));
  return 1.2 + top * face + ragged + hills + mountains;
}

function coast(): BufferGeometry {
  const zStart = 2500;
  const zEnd = -12000;
  const rows = 900;
  const geometry = grid(rows, COAST_OFFSETS.length, (r, c, out) => {
    const z = lerp(zStart, zEnd, r / (rows - 1));
    const d = COAST_OFFSETS[c];
    const cx = coastX(z);
    // Inland is towards -x, perpendicular enough to the coast for a strip.
    out[0] = cx - d;
    out[1] = coastHeight(d, z);
    out[2] = z;
  });
  colourise(geometry);
  return geometry;
}

/** The island: polar rings packed tight around its shoreline. */
const RING_FRACTIONS = [
  0, 0.25, 0.45, 0.6, 0.72, 0.8, 0.86, 0.9, 0.93, 0.955, 0.97, 0.98, 0.988,
  0.994, 1, 1.01, 1.03, 1.08, 1.18,
];

export const ISLAND = { x: -640, z: -2700, rx: 380, rz: 235 };

interface RockSpec {
  x: number;
  z: number;
  rx: number;
  rz: number;
  /** Height of the clifftop, and how many metres inland the face takes. */
  plateau: number;
  rise: number;
  /** Peaks in the rock's own unit coordinates: [u, v, height, spread]. */
  peaks: [number, number, number, number][];
  seed: number;
  spokes: number;
}

/**
 * An island as the Atlantic makes them: sheer on every side, a clifftop that
 * wanders, and peaks with ragged ridges. The main island is after the
 * Skelligs, two summits and a saddle; the same function makes the satellite
 * rock, the sea stacks and the islands on the horizon.
 */
function rock(spec: RockSpec): BufferGeometry {
  const geometry = grid(spec.spokes + 1, RING_FRACTIONS.length, (sIndex, j, out) => {
    const theta = (sIndex / spec.spokes) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const wobble = 1 + 0.18 * fbm2(ct * 1.4 + spec.seed, st * 1.4 + 4, 4, spec.seed);
    const rx = spec.rx * wobble;
    const rz = spec.rz * wobble;
    const f = RING_FRACTIONS[j];
    const shore = Math.hypot(ct * rx, st * rz);
    const d = (1 - f) * shore;
    let h: number;
    if (d < 0) h = lerp(-14, 0.4, smoothstep(-0.12 * shore - 10, 0, d));
    else {
      const u = ct * f;
      const v = st * f;
      const top = spec.plateau * (0.75 + 0.35 * fbm2(ct * 2.2, st * 2.2, 3, spec.seed + 5));
      let peaks = 0;
      for (const [pu, pv, ph, ps] of spec.peaks) {
        const dd = (u - pu) * (u - pu) + (v - pv) * (v - pv);
        peaks += ph * Math.exp(-dd / (2 * ps * ps));
      }
      const jag = 0.72 + 0.4 * ridged2(u * 4 + spec.seed, v * 4, 4, spec.seed + 9);
      const face = smoothstep(0, spec.rise * (0.7 + 0.6 * noise2(theta * 5, 1, spec.seed + 2)), d);
      h = 0.8 + top * face + peaks * jag * smoothstep(0, spec.rise * 3, d) +
        2.5 * fbm2(ct * 11, st * 11 + f * 5, 3, spec.seed + 3) * face;
    }
    out[0] = spec.x + ct * rx * f;
    out[1] = h;
    out[2] = spec.z + st * rz * f;
  });
  colourise(geometry);
  return geometry;
}

const MAIN_ISLAND: RockSpec = {
  ...ISLAND,
  plateau: 48,
  rise: 9,
  peaks: [
    [-0.34, 0.06, 150, 0.27],
    [0.36, -0.06, 112, 0.24],
  ],
  seed: 31,
  spokes: 260,
};

function satellites(): RockSpec[] {
  const rocks: RockSpec[] = [
    // The little rock beside the island, all cliff.
    { x: ISLAND.x + 860, z: ISLAND.z - 260, rx: 110, rz: 70, plateau: 40, rise: 5, peaks: [[0, 0, 70, 0.32]], seed: 51, spokes: 120 },
    // Islands on the horizon, each further and paler than the last.
    { x: -2700, z: -7600, rx: 950, rz: 380, plateau: 60, rise: 25, peaks: [[-0.2, 0, 230, 0.35], [0.45, 0.1, 150, 0.25]], seed: 61, spokes: 140 },
    { x: -500, z: -11800, rx: 1500, rz: 520, plateau: 50, rise: 40, peaks: [[0.1, 0, 210, 0.4]], seed: 71, spokes: 120 },
    { x: -4200, z: -14500, rx: 1800, rz: 600, plateau: 70, rise: 60, peaks: [[0, 0, 320, 0.45]], seed: 81, spokes: 120 },
  ];
  // Sea stacks standing off the cliffs.
  [-650, -1400, -1460, -2300].forEach((z, i) => {
    const off = [70, 120, 160, 90][i];
    rocks.push({
      x: coastX(z) + off,
      z,
      rx: 14 + i * 4,
      rz: 11 + i * 3,
      // Tapering, with a broken top: a flat one reads as a building.
      plateau: [34, 52, 28, 44][i] * 0.55,
      rise: 4,
      peaks: [[0.1, -0.1, [34, 52, 28, 44][i] * 0.5, 0.42]],
      seed: 91 + i,
      spokes: 48,
    });
  });
  return rocks;
}

/** A lighthouse on the island's seaward head, the way every Irish rock has one. */
function lighthouse(): Group {
  const group = new Group();
  const white = hazed(new MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6 }));
  const dark = hazed(new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
  const tower = new Mesh(new CylinderGeometry(2.2, 3, 22, 16), white);
  tower.position.y = 11;
  const lamp = new Mesh(new CylinderGeometry(1.8, 1.8, 3, 12), dark);
  lamp.position.y = 23.5;
  group.add(tower, lamp);
  return group;
}

export function createTerrain(): Group {
  const group = new Group();
  const material = hazed(
    rocky(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })),
  );
  const islandGeometry = rock(MAIN_ISLAND);
  group.add(new Mesh(coast(), material), new Mesh(islandGeometry, material));
  for (const spec of satellites()) group.add(new Mesh(rock(spec), material));

  // On the island's south-eastern head, the point nearest the camera.
  const light = lighthouse();
  const theta = Math.PI * 0.42;
  light.position.set(
    ISLAND.x + Math.cos(theta) * ISLAND.rx * 0.9,
    0,
    ISLAND.z + Math.sin(theta) * ISLAND.rz * 0.9,
  );
  const pos = islandGeometry.getAttribute("position");
  // Stand it on the ground: the highest point within a few metres of the spot.
  let ground = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - light.position.x;
    const dz = pos.getZ(i) - light.position.z;
    if (dx * dx + dz * dz < 400) ground = Math.max(ground, pos.getY(i));
  }
  light.position.y = ground - 1;
  group.add(light);
  return group;
}
