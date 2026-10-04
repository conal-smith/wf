/**
 * What a foil leaves on flat water: the board flies, so there is no bow wave,
 * only the mast slicing the surface. Behind it a bright streak of white water
 * that dies in a couple of seconds, a thin V of wake that lingers, and a
 * flicker of spray where the mast comes out of the water.
 *
 * Both are read straight off the precomputed tracks: a wake vertex k steps
 * back is simply where the mast was k steps ago, and a spray droplet is born
 * at the mast on a fixed cycle. Neither keeps any state between frames.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { sampleTrack, type Track } from "./fleet";
import { MAST_ENTRY } from "./rider";

const STEPS = 56;
const STEP_SECONDS = 0.075;

const wakeVertex = /* glsl */ `
  attribute float aAge;
  attribute float aSide;
  attribute float aSeed;
  varying float vAge;
  varying float vSide;
  varying vec2 vWorld;
  varying float vSeed;
  void main() {
    vAge = aAge;
    vSide = aSide;
    vSeed = aSeed;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const wakeFragment = /* glsl */ `
  uniform vec3 foam;
  uniform float time;
  varying float vAge;
  varying float vSide;
  varying vec2 vWorld;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    float side = abs(vSide);
    // The streak straight behind the mast, bright and quickly gone.
    float streak = exp(-side * side * 40.0) * pow(1.0 - vAge, 4.0);
    // The two arms of the V, thin, fading slower.
    float arm = (side - 0.86) * 14.0;
    float arms = exp(-arm * arm) * pow(1.0 - vAge, 1.6) * smoothstep(0.0, 0.08, vAge) * smoothstep(0.95, 0.35, vAge) * 0.22;
    float n = vnoise(vWorld * 7.0 + vSeed * 13.0) * 0.6 + vnoise(vWorld * 23.0 - time * 0.5) * 0.4;
    float a = (streak * (0.55 + 0.6 * n) + arms * (0.4 + 0.8 * n)) * 0.85;
    // Over-unity alpha would subtract light behind it, and a negative colour
    // turns to NaN in the bloom and tone mapping, blacking out the frame.
    gl_FragColor = vec4(foam, clamp(a, 0.0, 1.0));
  }
`;

const sprayVertex = /* glsl */ `
  attribute float aLife;
  uniform float pixelScale;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, pixelScale * 0.014 * (1.0 + aLife) / -mv.z);
  }
`;

const sprayFragment = /* glsl */ `
  uniform vec3 foam;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.0, d) * (1.0 - vLife) * 0.45;
    gl_FragColor = vec4(foam * 1.4, a);
  }
`;

export interface Wakes {
  wake: Mesh;
  spray: Points;
  update(time: number, foam: Color, pixelScale: number): void;
  dispose(): void;
}

const DROPS = 26;
const DROP_LIFE = 0.75;

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function createWakes(tracks: Track[]): Wakes {
  const riders = tracks.length;

  // ---- wake ribbons ----
  const verts = riders * STEPS * 2;
  const positions = new Float32Array(verts * 3);
  const age = new Float32Array(verts);
  const side = new Float32Array(verts);
  const seed = new Float32Array(verts);
  const index: number[] = [];
  for (let r = 0; r < riders; r++)
    for (let k = 0; k < STEPS; k++) {
      const v = (r * STEPS + k) * 2;
      age[v] = age[v + 1] = k / (STEPS - 1);
      side[v] = -1;
      side[v + 1] = 1;
      seed[v] = seed[v + 1] = r;
      if (k < STEPS - 1) index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  const wakeGeometry = new BufferGeometry();
  wakeGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  wakeGeometry.setAttribute("aAge", new BufferAttribute(age, 1));
  wakeGeometry.setAttribute("aSide", new BufferAttribute(side, 1));
  wakeGeometry.setAttribute("aSeed", new BufferAttribute(seed, 1));
  wakeGeometry.setIndex(index);
  const wakeMaterial = new ShaderMaterial({
    uniforms: { foam: { value: new Color(1, 0.8, 0.7) }, time: { value: 0 } },
    vertexShader: wakeVertex,
    fragmentShader: wakeFragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  });
  const wake = new Mesh(wakeGeometry, wakeMaterial);
  wake.frustumCulled = false;
  wake.renderOrder = 1;

  // ---- spray ----
  const drops = riders * DROPS;
  const sprayPositions = new Float32Array(drops * 3);
  const life = new Float32Array(drops);
  const sprayGeometry = new BufferGeometry();
  sprayGeometry.setAttribute("position", new BufferAttribute(sprayPositions, 3));
  sprayGeometry.setAttribute("aLife", new BufferAttribute(life, 1));
  const sprayMaterial = new ShaderMaterial({
    uniforms: { foam: { value: new Color(1, 0.8, 0.7) }, pixelScale: { value: 800 } },
    vertexShader: sprayVertex,
    fragmentShader: sprayFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const spray = new Points(sprayGeometry, sprayMaterial);
  spray.frustumCulled = false;
  spray.renderOrder = 2;

  const p = new Vector3();
  const q = new Vector3();
  const mast = new Vector3();

  const mastAt = (track: Track, t: number, out: Vector3) => {
    const h = sampleTrack(track, t, out);
    // The mast sits MAST_ENTRY.z behind the board's centre along the heading.
    out.x -= Math.sin(h) * MAST_ENTRY.z;
    out.z += Math.cos(h) * MAST_ENTRY.z;
    return h;
  };

  return {
    wake,
    spray,
    update(time, foam, pixelScale) {
      wakeMaterial.uniforms.time.value = time;
      wakeMaterial.uniforms.foam.value.copy(foam);
      sprayMaterial.uniforms.foam.value.copy(foam);
      sprayMaterial.uniforms.pixelScale.value = pixelScale;

      for (let r = 0; r < riders; r++) {
        const track = tracks[r];
        for (let k = 0; k < STEPS; k++) {
          const t = time - k * STEP_SECONDS;
          mastAt(track, Math.max(0, t), p);
          mastAt(track, Math.max(0, t - 0.05), q);
          // Across the path, widening as the wake spreads.
          let dx = p.x - q.x;
          let dz = p.z - q.z;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len;
          dz /= len;
          const a = k / (STEPS - 1);
          const width = 0.06 + 2.8 * Math.pow(a, 0.75);
          const v = ((r * STEPS + k) * 2) * 3;
          // Before the film started nothing had been drawn: fold those away.
          const fold = t < 0 ? 0 : 1;
          positions[v] = p.x - dz * width * fold;
          positions[v + 1] = 0.015;
          positions[v + 2] = p.z + dx * width * fold;
          positions[v + 3] = p.x + dz * width * fold;
          positions[v + 4] = 0.015;
          positions[v + 5] = p.z - dx * width * fold;
        }

        for (let d = 0; d < DROPS; d++) {
          const offset = (d / DROPS) * DROP_LIFE;
          const cycle = Math.floor((time + offset) / DROP_LIFE);
          const ageNow = (time + offset) % DROP_LIFE;
          const born = time - ageNow;
          const h = mastAt(track, Math.max(0, born), mast);
          const key = r * 1000 + d * 31 + cycle * 7;
          const up = 0.5 + hash(key) * 1.1;
          const out = (hash(key + 1) - 0.5) * 0.8;
          const back = 0.2 + hash(key + 2) * 0.5;
          // Thrown up and back off the mast, then falling.
          const sx = Math.cos(h) * out - Math.sin(h) * -back;
          const sz = Math.sin(h) * out + Math.cos(h) * back;
          const i = (r * DROPS + d) * 3;
          const y = Math.max(0.01, 0.02 + up * ageNow - 4.9 * ageNow * ageNow);
          sprayPositions[i] = mast.x + sx * ageNow;
          sprayPositions[i + 1] = y;
          sprayPositions[i + 2] = mast.z + sz * ageNow;
          life[r * DROPS + d] = ageNow / DROP_LIFE;
        }
      }
      wakeGeometry.getAttribute("position").needsUpdate = true;
      sprayGeometry.getAttribute("position").needsUpdate = true;
      sprayGeometry.getAttribute("aLife").needsUpdate = true;
    },
    dispose() {
      wakeGeometry.dispose();
      wakeMaterial.dispose();
      sprayGeometry.dispose();
      sprayMaterial.dispose();
    },
  };
}
