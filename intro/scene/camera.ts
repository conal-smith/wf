/**
 * The shot list, as one continuous move:
 *
 *   0 – 9 s    skimming a hand's breadth above the water towards the island
 *              while three riders overtake: left, right, left;
 *   9 – 17 s   rising and tipping forward until it looks straight down on the
 *              whole fleet, fifty wings on the water;
 *   17 – 20 s  holding top-down, turning slowly;
 *   20 – 27 s  lifting its head to the horizon and turning to the sun, the
 *              fleet below it bearing away towards the sunset;
 *   then       drifting with the fleet for as long as the menu is up.
 *
 * The skim is analytic (dead straight, a little handheld). Everything after it
 * is a Hermite spline through keyframes placed relative to where the fleet
 * actually is at that moment, read off the simulated tracks.
 */
import { MathUtils, Vector3 } from "three";
import { SKIM_SPEED, sampleTrack, type Track } from "./fleet";

export const SUN_AZIMUTH = MathUtils.degToRad(35);
/** The direction looking at the sun, on the water plane. */
const SUNWARD = new Vector3(Math.sin(SUN_AZIMUTH), 0, -Math.cos(SUN_AZIMUTH));

export interface CameraState {
  position: Vector3;
  /** Degrees. Yaw positive turns left; pitch positive looks up. */
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

interface Key {
  t: number;
  /** x, y, z, yaw, pitch, roll, fov */
  v: number[];
}

const SKIM_END = 9.2;

export function cameraPath(tracks: Track[]) {
  const centroid = (t: number) => {
    const c = new Vector3();
    const p = new Vector3();
    for (const track of tracks) c.add((sampleTrack(track, t, p), p));
    return c.divideScalar(tracks.length);
  };
  const key = (t: number, pos: Vector3, yaw: number, pitch: number, roll: number, fov: number): Key => ({
    t,
    v: [pos.x, pos.y, pos.z, yaw, pitch, roll, fov],
  });
  const behindSunward = (t: number, back: number, up: number) =>
    centroid(t).addScaledVector(SUNWARD, -back).setY(up);
  // The last shot keeps the sun right of centre: the name stands on the left,
  // over darker sky, rather than in the glare.
  const sunYaw = -MathUtils.radToDeg(SUN_AZIMUTH) + 9;

  const keys: Key[] = [
    key(SKIM_END, new Vector3(0, 0.86, -SKIM_SPEED * SKIM_END), 5, 0.8, 0, 44),
    key(12, new Vector3(1, 7, -62), 2, -14, 0, 46),
    key(14.5, centroid(14.5).add(new Vector3(0, 40, 28)), -6, -56, 0, 49),
    key(17, centroid(17).add(new Vector3(0, 74, 6)), -16, -89, 0, 50),
    key(19.5, centroid(19.5).add(new Vector3(0, 78, 0)), -28, -89, 0, 50),
    key(22.5, behindSunward(22.5, 55, 42), sunYaw + 2, -30, 0, 44),
    key(26.5, behindSunward(26.5, 72, 17), sunYaw, -6.5, 0, 40),
    key(34, behindSunward(34, 78, 14), sunYaw, -4.5, 0, 40),
  ];
  const last = keys[keys.length - 1];

  // Tangents: the skim's own velocity where the spline takes over, and
  // non-uniform Catmull-Rom everywhere else.
  const tangents = keys.map((k, i) => {
    if (i === 0) return [0, 0, -SKIM_SPEED, -0.3, 0, 0, 0];
    const a = keys[Math.max(0, i - 1)];
    const b = keys[Math.min(keys.length - 1, i + 1)];
    return k.v.map((_, j) => (b.v[j] - a.v[j]) / (b.t - a.t));
  });

  const state: CameraState = { position: new Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 44 };

  return function sample(t: number): CameraState {
    if (t <= SKIM_END) {
      const u = t / SKIM_END;
      // Handheld, settling as the spline is about to take over.
      const hand = 1 - MathUtils.smoothstep(t, SKIM_END - 2.2, SKIM_END);
      state.position.set(
        0.05 * Math.sin(t * 0.7) * hand,
        0.86 + (0.035 * Math.sin(t * 1.3) + 0.015 * Math.sin(t * 2.9 + 1)) * hand,
        -SKIM_SPEED * t,
      );
      state.yaw = MathUtils.lerp(7, 5, u) + 0.25 * Math.sin(t * 0.5) * hand;
      state.pitch = MathUtils.lerp(1.2, 0.8, u) + 0.25 * Math.sin(t * 1.7) * hand;
      state.roll = 0.6 * Math.sin(t * 0.9) * hand;
      state.fov = 44;
      return state;
    }
    if (t >= last.t) {
      // Drift on with the fleet, at the last key's offset from it.
      const anchor = behindSunward(t, 78, 14);
      state.position.copy(anchor);
      [state.yaw, state.pitch, state.roll, state.fov] = last.v.slice(3);
      state.pitch += 0.3 * Math.sin((t - last.t) * 0.4);
      return state;
    }
    let i = 0;
    while (keys[i + 1].t < t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const h = b.t - a.t;
    const s = (t - a.t) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const v = a.v.map(
      (_, j) => h00 * a.v[j] + h10 * h * tangents[i][j] + h01 * b.v[j] + h11 * h * tangents[i + 1][j],
    );
    state.position.set(v[0], v[1], v[2]);
    [state.yaw, state.pitch, state.roll, state.fov] = v.slice(3);
    return state;
  };
}

/** Sun elevation in degrees: low already, and sinking through the film. */
export function sunElevation(t: number): number {
  return MathUtils.lerp(2.6, 0.6, MathUtils.smoothstep(t, 0, 45));
}

export function sunDirection(t: number, out: Vector3): Vector3 {
  const e = MathUtils.degToRad(sunElevation(t));
  return out.set(Math.sin(SUN_AZIMUTH) * Math.cos(e), Math.sin(e), -Math.cos(SUN_AZIMUTH) * Math.cos(e));
}
