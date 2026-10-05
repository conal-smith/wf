/**
 * Who is on the water, and where each of them is at every moment.
 *
 * The water is empty when the film opens. One rider overtakes the camera on
 * the sun's side, a silhouette against the glare; then two more go by
 * together, one either side. As the camera lifts, ten more come through
 * underneath it from behind, and the thirteen ride on together towards the
 * sunset.
 *
 * The three heroes keep to their marks until they are past the lens; after
 * that everyone rides as a rider would. Each has their own line to the wind
 * (some pointing up, some off the breeze), their own rhythm of carving turns
 * and their own pace; some like company and tuck in beside a friend, some
 * want room and steer clear; everyone looks ahead and turns away from whoever
 * is in their way. Speed follows the wind they are in, read off the same
 * field the water draws (gust.ts): faster in the dark patches, slower in the
 * lulls, and off like a shot when the squall reaches them.
 *
 * The whole fleet is simulated together up front at a fixed step, so the
 * camera can be aimed at where it will be rather than chasing it. The seed
 * picks who the ten are, how they ride and where the squall falls, so each
 * showing differs a little; the heroes' passes never do.
 */
import { MathUtils, Vector2, Vector3 } from "three";
import { CALM, gustAt, WIND, type Squall } from "./gust";
import { seeded } from "./random";
import type { Pose, RiderLook } from "./rider";

export interface RiderSpec {
  look: RiderLook;
  pose: Pose;
  /** Position at t = 0, on the water (y unused). */
  start: Vector3;
  /** Speed to begin with, m/s, and the speed it settles to once the fleet turns. */
  speed: number;
  settle: number;
  /** Heading in radians from -z, positive to the right (towards +x, downwind). */
  heading: number;
  /** How far this rider bears away towards the sun when the fleet turns. */
  turn: number;
  /** Phase offsets so no two riders bob or carve in step. */
  phase: number;
  hero: boolean;
  /** How this rider rides once free of the camera. */
  style: Style;
}

export interface Style {
  /** Their own line to the wind: negative points up, positive bears off. */
  course: number;
  /** Carving: two swings of the heading, amplitude (radians) and period (s) each. */
  carve: [number, number, number, number];
  /** Faster or slower than the fleet, as a factor. */
  pace: number;
  /** The room they want around them, metres. */
  room: number;
  /** A friend to ride beside, by index, or -1; and on which side (-1 left, 1 right). */
  buddy: number;
  side: number;
}

/** The moments the three heroes draw level with the lens, and their offsets. */
export const HERO_PASSES = [
  { time: 3.9, x: 3.3 },
  { time: 7.1, x: -3.4 },
  { time: 7.6, x: 5.6 },
];

/** The camera's ground speed while it skims the water. */
export const SKIM_SPEED = 4;
const HERO_SPEED = 11;
/** The ten behind come up faster, and catch the camera as it lifts. */
const FOLLOWER_SPEED = 13;
/** When the heroes are past the lens and free to ride as they like. */
const HEROES_FREE = 10;
/** Until when the ten keep out of the camera's lane as they come through. */
const LANE_CLEAR = 14;
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

/** The seed the film is reviewed with; a showing picks its own. */
export const REVIEW_SEED = 2026;

export function fleet(seed = REVIEW_SEED): RiderSpec[] {
  const rand = seeded(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const between = (a: number, b: number) => MathUtils.lerp(a, b, rand());
  const pose = (): Pose => ({
    tilt: 0.45 + rand() * 0.35,
    pitch: 0.14 + rand() * 0.16,
    sheet: 0.5 + rand() * 0.3,
    lean: 0.05 + rand() * 0.12,
  });
  const style = (): Style => {
    // Most hold close to a beam reach; a few point up hard or reach off.
    const kind = rand();
    return {
      course:
        kind < 0.25 ? between(-0.42, -0.22) : kind < 0.45 ? between(0.18, 0.34) : between(-0.12, 0.12),
      carve: [between(0.04, 0.2), between(5, 11), between(0.02, 0.12), between(2.2, 4)],
      pace: between(0.9, 1.1),
      room: between(6.5, 12),
      buddy: -1,
      side: rand() < 0.5 ? -1 : 1,
    };
  };
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
      turn: 0.3,
      phase: rand() * 10,
      hero: true,
      style: style(),
    });
  });
  // The two who passed together stay together.
  riders[2].style.buddy = 1;
  riders[2].style.side = 1;

  // Ten behind, out of shot until the camera lifts: a loose pack well back
  // from the lens at the start, none closer than 6 m to another, and none
  // passing straight under the camera.
  const placed: Vector3[] = [];
  while (riders.length < 13) {
    const p = new Vector3(between(-17, 17), 0, between(102, 128));
    // The camera lifts a metre or so right of where it skimmed.
    if (Math.abs(p.x - 1) < 5.5) continue;
    if (placed.some((q) => q.distanceTo(p) < 6)) continue;
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
      speed: FOLLOWER_SPEED + rand() * 0.8,
      settle: 5.8 + rand() * 0.8,
      heading: (rand() - 0.5) * 0.06,
      turn: 0.24 + rand() * 0.12,
      phase: rand() * 10,
      hero: false,
      style: style(),
    });
  }
  // A few friends among the ten, who ride in each other's company.
  for (let i = 3; i < riders.length; i++)
    if (rand() < 0.35) {
      const friend = 3 + Math.floor(rand() * 10);
      if (friend !== i && riders[friend].style.buddy !== i) {
        riders[i].style.buddy = friend;
        riders[i].style.room = between(5, 6.5);
      }
    }
  return riders;
}

/**
 * Where the squall comes through: across the fleet while the camera looks
 * straight down on it, its heart a little to windward so that some of the
 * fleet is in it first and the rest wait for it. Planned off a calm run's
 * centroid, which the squall barely moves before it arrives.
 */
export function planSquall(seed: number, centroid: (t: number) => Vector3): Squall {
  const rand = seeded(seed ^ 0x5eed);
  const t = 16.4 + rand() * 1.4;
  const c = centroid(t);
  const across = new Vector2(-WIND.y, WIND.x);
  const offset = (rand() - 0.5) * 16;
  return {
    t,
    x: c.x - WIND.x * 6 + across.x * offset,
    z: c.z - WIND.y * 6 + across.y * offset,
    speed: 8.5,
    along: 22,
    across: 30,
    from: t - 6,
    to: t + 8,
    power: 1.7 + rand() * 0.4,
  };
}

/** A rider's sampled path: x, z, heading and speed at a fixed rate. */
export interface Track {
  rate: number;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
}

const smooth = (a: number, b: number, t: number) => MathUtils.smoothstep(t, a, b);
const clamp = MathUtils.clamp;
const TAU = Math.PI * 2;

/** The quickest a rider turns, radians a second: a carve, not a spin. */
const TURN_RATE = 0.7;

export function simulateFleet(
  specs: RiderSpec[],
  duration: number,
  squall: Squall = CALM,
  rate = 30,
): Track[] {
  const n = Math.ceil(duration * rate) + 1;
  const count = specs.length;
  const tracks: Track[] = specs.map(() => ({
    rate,
    x: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
    speed: new Float32Array(n),
  }));
  const x = specs.map((s) => s.start.x);
  const z = specs.map((s) => s.start.z);
  const h = specs.map((s) => s.heading);
  const v = specs.map((s) => s.speed);
  const sub = 4;
  const dt = 1 / rate / sub;

  for (let i = 0; i < n; i++) {
    for (let r = 0; r < count; r++) {
      tracks[r].x[i] = x[r];
      tracks[r].z[i] = z[r];
      tracks[r].heading[i] = h[r];
      tracks[r].speed[i] = v[r];
    }
    for (let k = 0; k < sub; k++) {
      const t = i / rate + k * dt;
      const turning = smooth(TURN_START, TURN_END, t);
      for (let r = 0; r < count; r++) {
        const spec = specs[r];
        const { style } = spec;
        if (spec.hero && t < HEROES_FREE) {
          // On their marks: dead straight past the lens at a steady speed.
          x[r] += Math.sin(h[r]) * v[r] * dt;
          z[r] -= Math.cos(h[r]) * v[r] * dt;
          continue;
        }
        // Each rider's own riding fades in once they are clear of the camera.
        const free = spec.hero
          ? smooth(HEROES_FREE, HEROES_FREE + 3, t)
          : smooth(10.5, 14, t);
        const [a1, p1, a2, p2] = style.carve;
        const carve =
          a1 * Math.sin((TAU * t) / p1 + spec.phase) +
          a2 * Math.sin((TAU * t) / p2 + spec.phase * 1.7);
        const line = spec.turn * turning;
        let want = line + spec.heading + (style.course + carve) * free;

        // Look around: turn away from whoever is close and not behind, ease
        // off behind someone, and drift towards a friend.
        const fx = Math.sin(h[r]);
        const fz = -Math.cos(h[r]);
        let steer = 0;
        let ease = 1;
        for (let o = 0; o < count; o++) {
          if (o === r) continue;
          const dx = x[o] - x[r];
          const dz = z[o] - z[r];
          const dist = Math.hypot(dx, dz);
          if (dist > 16) continue;
          const ahead = dx * fx + dz * fz;
          const side = dx * -fz + dz * fx;
          const away = side >= 0 ? -1 : 1;
          const room = o === style.buddy ? 4.5 : style.room;
          if (dist < room && ahead > -2) {
            steer += away * (1 - dist / room) ** 2 * 1.4;
            if (ahead > 0 && Math.abs(side) < 2.5)
              ease = Math.min(ease, 0.8 + 0.2 * (dist / room));
          }
          // A wing is three metres across: closer than a wing and a half is
          // too close for anyone, friend or not. Turn away, and let whoever
          // is behind drop back.
          if (dist < 4.8) {
            steer += away * (1.2 + 2 * (1 - dist / 4.8));
            if (ahead > 0) ease = Math.min(ease, 0.7 + 0.25 * (dist / 4.8));
          }
        }
        if (style.buddy >= 0) {
          const b = style.buddy;
          const bx = Math.sin(h[b]);
          const bz = -Math.cos(h[b]);
          // Two wings' width off their shoulder and a little behind.
          const tx = x[b] - bz * style.side * 6.5 - bx * 2.5;
          const tz = z[b] + bx * style.side * 6.5 - bz * 2.5;
          const dx = tx - x[r];
          const dz = tz - z[r];
          const bearing = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
          steer += clamp(bearing, -0.5, 0.5) * 0.6 * free;
          // Catch them up, or wait for them.
          ease *= MathUtils.lerp(1, clamp(1 + (dx * fx + dz * fz) * 0.04, 0.85, 1.15), free);
        }
        // The ten keep out of the camera's lane while they come through.
        if (!spec.hero && t < LANE_CLEAR) {
          const off = x[r] - 1;
          if (Math.abs(off) < 6)
            steer += Math.sign(off || 1) * (1 - Math.abs(off) / 6) * 0.9;
        }
        want += clamp(steer, -1, 1);
        h[r] += clamp(want - h[r], -TURN_RATE * dt, TURN_RATE * dt);

        // Speed: the schedule, their own pace, the wind they are in, and a
        // little more off the breeze than pointing up into it.
        const schedule = MathUtils.lerp(spec.speed, spec.settle, smooth(10.5, 15, t));
        const wind = clamp(0.78 + 0.22 * gustAt(x[r], z[r], t, squall), 0.82, 1.55);
        const point = clamp(1 + 0.35 * (h[r] - line), 0.86, 1.12);
        const own = MathUtils.lerp(1, style.pace * wind * point, free);
        const target = schedule * own * ease;
        // Quick to take off in a gust, slower to bleed the speed away.
        v[r] += clamp(target - v[r], -1.4 * dt, 2.6 * dt);
        x[r] += Math.sin(h[r]) * v[r] * dt;
        z[r] -= Math.cos(h[r]) * v[r] * dt;
      }
    }
  }
  return tracks;
}

/** The fleet's centre at time t, from its tracks. */
export function centroidOf(tracks: Track[]): (t: number) => Vector3 {
  const p = new Vector3();
  return (t) => {
    const c = new Vector3();
    for (const track of tracks) c.add((sampleTrack(track, t, p), p));
    return c.divideScalar(tracks.length);
  };
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

/** How fast a rider is going at time t, m/s, and how fast they are turning, rad/s. */
export function sampleMotion(track: Track, t: number): { speed: number; turn: number } {
  const last = track.x.length - 1;
  const i = clamp(Math.round(t * track.rate), 1, last - 1);
  return {
    speed: track.speed[i],
    turn: ((track.heading[i + 1] - track.heading[i - 1]) * track.rate) / 2,
  };
}
