/**
 * Who is on the water, and where each of them is at every moment.
 *
 * Three hero riders overtake the camera one by one, left, right, left, in the
 * colours of the brief. Forty-seven more are already out ahead, a scatter of
 * wings towards the island that the camera rises over and then follows
 * towards the sunset. Every track is simulated up front at a fixed step, so
 * the film is the same on every machine and the camera can be aimed at where
 * the fleet will be, rather than chasing it.
 */
import { MathUtils, Vector3 } from "three";
import { seeded } from "./random";
import type { Pose, RiderLook } from "./rider";

export interface RiderSpec {
  look: RiderLook;
  pose: Pose;
  /** Position at t = 0, on the water (y unused). */
  start: Vector3;
  /** Cruising speed, m/s, and the speed it settles to once the fleet turns. */
  speed: number;
  settle: number;
  /** Heading in radians from -z, positive to the right (towards +x). */
  heading: number;
  /** How far this rider bears away towards the sun when the fleet turns. */
  turn: number;
  /** Phase offsets so no two riders bob in step. */
  phase: number;
  weave: number;
  hero: boolean;
}

/** The moments the three heroes draw level with the lens, and their offsets. */
export const HERO_PASSES = [
  { time: 2.6, x: -3.1 },
  { time: 5.5, x: 3.7 },
  { time: 8.4, x: -4.6 },
];

/** The camera's ground speed while it skims the water. */
export const SKIM_SPEED = 4;
const HERO_SPEED = 11;
/** When the whole fleet bears away towards the sun. */
const TURN_START = 13;
const TURN_END = 24;

const SKIN = [0xc58c6d, 0xe0ac8a, 0x8d5a3d, 0xf0c3a4, 0xb07856];
// Hoods: neoprene, so near-black like the suits, now and then a colour.
const HAIR = [0x111114, 0x0b0b0d, 0x1a1c22, 0x23262c, 0x14161a];
const VESTS = [0x1c1f26, 0x2c3440, 0x0e0e10, 0x3d4652, 0x7a2a2a, 0x22303f];
const SUITS = [0x0c0c0e, 0x101521, 0x16181c, 0x0b0f14];
const WINGS = [
  0xff2f7a, 0x2fd06a, 0xff7a1a, 0x1aa3ff, 0xffd21a, 0xe02525, 0x9b4dff,
  0x13c4b4, 0xffffff, 0xff5cc8, 0x4a6bff, 0xc8f02b,
];
const BOARDS = [0xf4f4f2, 0x111111, 0x2b3b52, 0xd9d2c3, 0x6a7a85];
const MASTS = [0x111111, 0x1d4fd8, 0x2a2a2a, 0xb8bcc2];

export function fleet(): RiderSpec[] {
  const rand = seeded(2026);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const pose = (): Pose => ({
    tilt: 0.45 + rand() * 0.35,
    pitch: 0.14 + rand() * 0.16,
    sheet: 0.5 + rand() * 0.3,
    lean: 0.05 + rand() * 0.12,
  });
  const riders: RiderSpec[] = [];

  // The brief: black foil, white board, pink wing; blue mast, black board,
  // green wing; and an orange wing on the left.
  const heroLooks: RiderLook[] = [
    { vest: 0x16171a, wing: 0xff2f86, board: 0xf6f6f4, mast: 0x0d0d0d, suit: 0x0c0c0e, skin: SKIN[1], hair: HAIR[1], pad: 0x1b1b1d },
    { vest: 0x24324a, wing: 0x27d35f, board: 0x0f0f10, mast: 0x1450e6, suit: 0x101521, skin: SKIN[0], hair: HAIR[2], pad: 0x3a3d42 },
    { vest: 0x2a2d33, wing: 0xff7410, board: 0xe9e4d8, mast: 0x161616, suit: 0x16181c, skin: SKIN[3], hair: HAIR[3], pad: 0x24262a },
  ];
  HERO_PASSES.forEach((pass, i) => {
    // Level with the camera at pass.time: work back to where it starts.
    const cameraZ = -SKIM_SPEED * pass.time;
    riders.push({
      look: heroLooks[i],
      pose: { tilt: 0.92, pitch: 0.3, sheet: 0.62, lean: 0.14 },
      start: new Vector3(pass.x, 0, cameraZ + HERO_SPEED * pass.time),
      speed: HERO_SPEED,
      settle: 6.2,
      heading: 0,
      turn: 0.5,
      phase: rand() * 10,
      weave: 0.1,
      hero: true,
    });
  });

  // A few riders in the middle distance, out to the sides, so the low shots
  // have depth between the heroes and the fleet instead of one band of wings
  // on the horizon. Then the fleet ahead: spread wide across the bay, none
  // closer than 9 m to another, and the heroes' lane left clear.
  const MIDGROUND = [
    new Vector3(-21, 0, -22),
    new Vector3(27, 0, -29),
    new Vector3(-40, 0, -41),
    new Vector3(15, 0, -52),
  ];
  const placed: Vector3[] = [];
  while (riders.length < 50) {
    const mid = MIDGROUND[placed.length];
    const p = mid ?? new Vector3(MathUtils.lerp(-72, 72, rand()), 0, MathUtils.lerp(-40, -128, rand()));
    if (!mid && Math.abs(p.x) < 14 && p.z > -70) continue;
    if (!mid && placed.some((q) => q.distanceTo(p) < 8)) continue;
    placed.push(p);
    riders.push({
      look: {
        vest: pick(VESTS),
        wing: pick(WINGS),
        board: pick(BOARDS),
        mast: pick(MASTS),
        suit: pick(SUITS),
        skin: pick(SKIN),
        hair: pick(HAIR),
        pad: 0x1e1f22,
      },
      pose: pose(),
      start: p,
      speed: 5 + rand() * 1.2,
      settle: 5.6 + rand() * 1.2,
      heading: (rand() - 0.5) * 0.16,
      turn: 0.38 + rand() * 0.2,
      phase: rand() * 10,
      weave: 0.4 + rand() * 0.8,
      hero: false,
    });
  }
  return riders;
}

/** A rider's sampled path: x, z, heading and speed at a fixed rate. */
export interface Track {
  rate: number;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
}

const smooth = (a: number, b: number, t: number) => MathUtils.smoothstep(t, a, b);

export function simulate(spec: RiderSpec, duration: number, rate = 30): Track {
  const n = Math.ceil(duration * rate) + 1;
  const track: Track = {
    rate,
    x: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
  };
  const sub = 4;
  const dt = 1 / rate / sub;
  let x = spec.start.x;
  let z = spec.start.z;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const turning = smooth(TURN_START, TURN_END, t);
    const heading =
      spec.heading + spec.turn * turning + 0.05 * spec.weave * Math.sin(t * 0.35 + spec.phase);
    track.x[i] = x;
    track.z[i] = z;
    track.heading[i] = heading;
    for (let s = 0; s < sub; s++) {
      const tt = t + s * dt;
      // Heroes hold their speed through the pass, then ease to the fleet's.
      const speed = MathUtils.lerp(spec.speed, spec.settle, smooth(10.5, 15, tt));
      const h =
        spec.heading +
        spec.turn * smooth(TURN_START, TURN_END, tt) +
        0.05 * spec.weave * Math.sin(tt * 0.35 + spec.phase);
      x += Math.sin(h) * speed * dt;
      z -= Math.cos(h) * speed * dt;
    }
    t += 1 / rate;
  }
  return track;
}

/** Position and heading on a track at time t, interpolated; beyond the end, extrapolated. */
export function sampleTrack(track: Track, t: number, out: Vector3): number {
  const f = Math.max(0, t * track.rate);
  const last = track.x.length - 1;
  if (f >= last) {
    const h = track.heading[last];
    const dx = track.x[last] - track.x[last - 1];
    const dz = track.z[last] - track.z[last - 1];
    const extra = f - last;
    out.set(track.x[last] + dx * extra, 0, track.z[last] + dz * extra);
    return h;
  }
  const i = Math.floor(f);
  const u = f - i;
  out.set(
    track.x[i] + (track.x[i + 1] - track.x[i]) * u,
    0,
    track.z[i] + (track.z[i + 1] - track.z[i]) * u,
  );
  return track.heading[i] + (track.heading[i + 1] - track.heading[i]) * u;
}
