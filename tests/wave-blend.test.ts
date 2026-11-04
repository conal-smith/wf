// The published wave blend as a run of spot squares (src/waveBlend.ts): written
// by the same layout the job uses (scripts/runs.mjs, through
// force5/blend/waves.ts) and read back through the site's one spot loader, and
// the job itself over the sample runs.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import locations from "../public/riding-locations.json";
import { indexed, SWAN_VARIABLES, waveManifest } from "../force5/src/testing";
import type { WaveManifest, WaveStep } from "../force5/src/waves";
import { publishRun } from "../scripts/runs.mjs";
import { loadWaveBlend } from "../src/useWaveBlend";
import {
  buildWaveBlend,
  parseWaveBlend,
  WAVE_BLEND_KEY,
  WAVE_BLEND_PATH,
  waveBlendHours,
  waveBlendPrefix,
} from "../src/waveBlend";

const PLACES = ["brandon", "dollymount", "rusheen", "rossnowlagh", "keel"];
const NOW = new Date("2026-11-04T18:20:00Z");

/** A run covering several places, each a little different. */
function spread(manifest: WaveManifest): WaveManifest {
  const series = manifest.spotSeries!.brandon as WaveStep[];
  return indexed({
    ...manifest,
    spotSeries: Object.fromEntries(
      PLACES.map((id, i) => [
        id,
        series.map((step) => ({
          ...step,
          values: { ...step.values, swh: (step.values.swh ?? 0) + i / 10 },
        })),
      ]),
    ),
  });
}

const manifests = [
  spread(
    waveManifest({
      model: "mi-swan",
      runTime: "2026-11-04T00:00:00Z",
      hours: [0, 1, 2, 3],
      variables: SWAN_VARIABLES,
      values: (h) => ({
        swh: 1 + h / 10,
        pp1d: 9,
        mwd: 300,
        hswe: 0.8,
        shww: 0.4,
      }),
    }),
  ),
  spread(
    waveManifest({
      model: "gfs-wave",
      runTime: "2026-11-04T00:00:00Z",
      hours: [0, 3, 6, 9],
      values: (h) => ({ swh: 1.4 + h / 10, pp1d: 11, mwd: 290, swell1_h: 1.1 }),
    }),
  ),
];
const whole = buildWaveBlend(manifests, NOW);
const published = publishRun(whole, waveBlendPrefix(whole), [], locations) as {
  pointer: Record<string, unknown>;
  base: string;
  files: [string, Buffer][];
};
const files = new Map<string, unknown>([
  [WAVE_BLEND_PATH, JSON.parse(JSON.stringify(published.pointer))],
  ...published.files.map(
    ([path, bytes]) =>
      [path, JSON.parse(bytes.toString())] as [string, unknown],
  ),
]);
const read = async (path: string) =>
  files.has(path)
    ? structuredClone(files.get(path))
    : Promise.reject(new Error(`${path} 404`));

describe("the wave blend as a run of spot squares", () => {
  it("publishes a pointer with the times, the models and the squares, and no places", () => {
    const pointer = parseWaveBlend(files.get(WAVE_BLEND_PATH));
    expect(pointer.base).toMatch(/^wave-blend-2026110418-0h-v2-[0-9a-f]{8}\/$/);
    expect(pointer.spots.keys).toEqual([WAVE_BLEND_KEY]);
    expect(WAVE_BLEND_KEY in published.pointer).toBe(false);
    expect(pointer.sources.map((s) => s.id)).toEqual(["mi-swan", "gfs-wave"]);
  });

  it("is read back whole by the loader, and a place's hours from it", async () => {
    const pointer = parseWaveBlend(files.get(WAVE_BLEND_PATH));
    const blend = await loadWaveBlend(
      read,
      pointer.spots.squares,
      null,
      NOW.getTime(),
    );
    expect(blend!.spotWaveBlend).toEqual(whole.spotWaveBlend);
    const hours = waveBlendHours(blend!, "keel")!;
    expect(hours.map((h) => h.count)).toEqual([2, 2, 2, 2, 1, 1]);
    expect(hours[0]).toMatchObject({
      heightM: 1.6,
      lowM: 1.4,
      highM: 1.8,
      lead: "mi-swan",
    });
    expect(hours[5]).toMatchObject({ models: ["gfs-wave"], lead: "gfs-wave" });
    expect(hours[5].parts.swell1).toEqual({
      heightM: 1.1,
      periodS: null,
      from: null,
    });
  });

  it("keeps the blend in hand while the pointer names the same run", async () => {
    const pointer = parseWaveBlend(files.get(WAVE_BLEND_PATH));
    const first = await loadWaveBlend(
      read,
      pointer.spots.squares,
      null,
      NOW.getTime(),
    );
    expect(
      await loadWaveBlend(read, pointer.spots.squares, first, NOW.getTime()),
    ).toBe(first);
  });

  it("is none when there is no pointer, or once it is too old to show", async () => {
    const pointer = parseWaveBlend(files.get(WAVE_BLEND_PATH));
    expect(
      await loadWaveBlend(async () => null, pointer.spots.squares),
    ).toBeNull();
    const late = NOW.getTime() + 7 * 3600000;
    expect(
      await loadWaveBlend(read, pointer.spots.squares, null, late),
    ).toBeNull();
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("the wave blend job", () => {
  it("blends the sample wave runs it finds and names the members it could not", () => {
    const root = mkdtempSync(join(tmpdir(), "wave-blend-"));
    roots.push(root);
    cpSync(
      join(import.meta.dirname, "fixtures", "weather"),
      join(root, "weather"),
      {
        recursive: true,
      },
    );
    const out = join(root, "weather", "wave-blend.json");
    const log = execFileSync(
      join("node_modules", ".bin", "tsx"),
      [
        "force5/blend/waves.ts",
        "--root",
        root,
        "--out",
        out,
        "--spots",
        "public/riding-locations.json",
      ],
      { encoding: "utf8" },
    );
    expect(log).toMatch(/Not published, left out: mi-swan/);
    const pointer = parseWaveBlend(JSON.parse(readFileSync(out, "utf8")));
    expect(pointer.sources.map((source) => source.id)).toEqual(["gfs-wave"]);
    expect(pointer.spots.squares.length).toBeGreaterThan(0);
  }, 30000);
});
