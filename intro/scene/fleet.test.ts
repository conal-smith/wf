import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  centroidOf,
  fleet,
  HERO_PASSES,
  planSquall,
  sampleTrack,
  simulateFleet,
  SKIM_SPEED,
} from "./fleet";
import { CALM, gustAt } from "./gust";

const SEEDS = [1, 7, 2026, 31337];

function ride(seed: number) {
  const specs = fleet(seed);
  const squall = planSquall(seed, centroidOf(simulateFleet(specs, 30)));
  return { specs, squall, tracks: simulateFleet(specs, 32, squall) };
}

describe("the fleet", () => {
  it("passes the lens on its marks whatever the seed", () => {
    const p = new Vector3();
    for (const seed of SEEDS) {
      const { tracks } = ride(seed);
      HERO_PASSES.forEach((pass, i) => {
        sampleTrack(tracks[i], pass.time, p);
        expect(p.x).toBeCloseTo(pass.x, 3);
        expect(p.z).toBeCloseTo(-SKIM_SPEED * pass.time, 1);
      });
    }
  });

  it("keeps a wing's width between riders", () => {
    const a = new Vector3();
    const b = new Vector3();
    for (const seed of SEEDS) {
      const { tracks } = ride(seed);
      let closest = Infinity;
      for (let t = 0; t < 30; t += 0.2)
        for (let i = 0; i < tracks.length; i++)
          for (let j = i + 1; j < tracks.length; j++) {
            sampleTrack(tracks[i], t, a);
            sampleTrack(tracks[j], t, b);
            closest = Math.min(closest, a.distanceTo(b));
          }
      expect(closest).toBeGreaterThan(3);
    }
  });

  it("rides differently from one showing to the next", () => {
    const at = (seed: number) => {
      const p = new Vector3();
      return ride(seed).tracks.map((track) => (sampleTrack(track, 20, p), p.x));
    };
    expect(at(1)).not.toEqual(at(7));
  });

  it("goes faster where the squall reaches it", () => {
    const p = new Vector3();
    const gains: number[] = [];
    for (const seed of SEEDS) {
      const { specs, squall, tracks } = ride(seed);
      const calm = simulateFleet(specs, 32);
      tracks.forEach((track, i) => {
        let hit = 0;
        let at = 0;
        for (let t = squall.from; t < squall.to; t += 0.2) {
          sampleTrack(track, t, p);
          const extra = gustAt(p.x, p.z, t, squall) - gustAt(p.x, p.z, t, CALM);
          if (extra > hit) [hit, at] = [extra, t];
        }
        const k = Math.round((at + 1) * track.rate);
        if (hit > 0.8) gains.push(track.speed[k] / calm[i].speed[k]);
      });
    }
    expect(gains.length).toBeGreaterThan(SEEDS.length * 4);
    expect(gains.reduce((a, b) => a + b) / gains.length).toBeGreaterThan(1.15);
  });
});
