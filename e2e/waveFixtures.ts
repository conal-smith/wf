import type { Page } from "@playwright/test";
import { SAMPLE_CLOCK } from "./columns";
import { SQUARE_URL, spotSquare } from "../force5/src/spotData";
import { buildWaveBlend, WAVE_BLEND_KEY } from "../force5/src/waveBlend";
import type { WaveManifest } from "../force5/src/waves";

/**
 * Wave runs for Brandon, routed in over the sample site's (which publishes
 * GFS-Wave alone, from three days out, and no wave blend): the Met Office's
 * hourly 60 hours, MI SWAN's hourly six days, GFS-Wave's three-hourly ten
 * and ECMWF's fifteen, three-hourly to +144 h and six-hourly past it as its
 * open data is, from the evening before the clock, each a little higher than
 * the one before, and the wave blend worked out from them as the job does
 * (force5/src/waveBlend.ts).
 */

const HOUR = 3600000;
const clock = SAMPLE_CLOCK.getTime();
const RUN = "2026-09-13T18:00:00Z";
const run = Date.parse(RUN);
const BRANDON = { id: "brandon", lat: 52.276, lon: -10.024 };
const SQUARE = spotSquare(BRANDON.lat, BRANDON.lon);

const variable = (units: string, label: string) => ({ units, label });
export const MODELS: {
  id: string;
  name: string;
  step: number;
  hours: number;
  /** Where a run's steps widen: this many hours on, every `coarseStep`. */
  coarseFrom?: number;
  coarseStep?: number;
  base: number;
  variables: Record<string, { units: string; label: string }>;
  values: (h: number, m: number) => Record<string, number>;
}[] = [
  {
    id: "met-office-wave",
    name: "Met Office Wave",
    step: 1,
    hours: 60,
    base: 1.1,
    variables: {
      swh: variable("m", "Wave height"),
      pp1d: variable("s", "Peak period"),
      mwd: variable("deg", "Mean direction"),
      shww: variable("m", "Wind-sea height"),
      ppww: variable("s", "Wind-sea peak period"),
      mdww: variable("deg", "Wind-sea direction"),
      swell1_h: variable("m", "Swell 1 height"),
      swell1_p: variable("s", "Swell 1 peak period"),
      swell1_d: variable("deg", "Swell 1 direction"),
      swell2_h: variable("m", "Swell 2 height"),
      swell2_p: variable("s", "Swell 2 peak period"),
      swell2_d: variable("deg", "Swell 2 direction"),
    },
    values: (h, m) => ({
      swh: m,
      pp1d: 12,
      mwd: 280,
      shww: 0.3,
      ppww: 3,
      mdww: 60,
      swell1_h: m - 0.2,
      swell1_p: 13,
      swell1_d: 275,
      swell2_h: 0.2,
      swell2_p: 9,
      swell2_d: 250,
    }),
  },
  {
    id: "mi-swan",
    name: "MI SWAN",
    step: 1,
    hours: 144,
    base: 1.2,
    variables: {
      swh: variable("m", "Wave height"),
      hswe: variable("m", "Swell height"),
      pp1d: variable("s", "Peak period"),
      mwd: variable("deg", "Mean direction"),
    },
    values: (h, m) => ({ swh: m, hswe: m - 0.3, pp1d: 11, mwd: 285 }),
  },
  {
    id: "gfs-wave",
    name: "GFS-Wave",
    step: 3,
    hours: 240,
    base: 1.4,
    variables: {
      swh: variable("m", "Wave height"),
      pp1d: variable("s", "Peak period"),
      mwd: variable("deg", "Mean direction"),
      shww: variable("m", "Wind-wave height"),
      mpww: variable("s", "Wind-wave period"),
      mdww: variable("deg", "Wind-wave direction"),
      swell1_h: variable("m", "Swell height"),
      swell1_p: variable("s", "Swell period"),
      swell1_d: variable("deg", "Swell direction"),
    },
    values: (h, m) => ({
      swh: m,
      pp1d: 10,
      mwd: 290,
      shww: 0.4,
      mpww: 4,
      mdww: 70,
      swell1_h: m - 0.3,
      swell1_p: 11,
      swell1_d: 290,
    }),
  },
  {
    id: "ecmwf-wave",
    name: "ECMWF Wave",
    step: 3,
    hours: 360,
    coarseFrom: 144,
    coarseStep: 6,
    base: 1.5,
    variables: {
      swh: variable("m", "Wave height"),
      pp1d: variable("s", "Peak period"),
      mwd: variable("deg", "Mean direction"),
    },
    values: (h, m) => ({ swh: m, pp1d: 10, mwd: 295 }),
  },
];

const stepsOf = (m: (typeof MODELS)[number]) => {
  const steps: number[] = [];
  for (let h = 0; h <= m.hours; ) {
    steps.push(h);
    h += m.coarseFrom !== undefined && h >= m.coarseFrom ? m.coarseStep! : m.step;
  }
  return steps;
};

const runBase = (id: string) => `${id}-2026091318-test-v2-0a0b0c0d/`;
const height = (base: number, h: number) =>
  Math.round((base + 0.3 * Math.sin(h / 9)) * 100) / 100;

/** Each model's run, with its spot series merged in, as a reader holds it. */
const manifests = MODELS.map(
  (m) =>
    ({
      schemaVersion: 2,
      kind: "wave",
      model: m.id,
      modelName: m.name,
      provider: "test",
      run: "2026091318",
      runTime: RUN,
      generatedAt: RUN,
      stepHours: m.step,
      horizonHours: m.hours,
      resolutionKm: 9,
      variables: m.variables,
      base: runBase(m.id),
      frames: [],
      spots: {
        squareDegrees: 2,
        url: SQUARE_URL,
        squares: [SQUARE],
        keys: ["spotSeries"],
      },
      attribution: "Test wave data",
      licenseUrl: "https://example.test/licence",
      spotSeries: {
        [BRANDON.id]: stepsOf(m).map((h) => ({
          hour: h,
          validTime: new Date(run + h * HOUR).toISOString(),
          values: m.values(h, height(m.base, h)),
        })),
      },
    }) as unknown as WaveManifest,
);

const BLEND_BASE = "wave-blend-2026091321-test-v2-0a0b0c0d/";

/**
 * The wave runs routed in, those in `without` answering 404 as a model that
 * does not reach the place, and the wave blend of the rest unless `blend` is
 * false.
 */
export async function withWaves(
  page: Page,
  { blend = true, without = [] as string[] } = {},
) {
  for (const id of without)
    await page.route(`**/weather/${id}.json`, (route) =>
      route.fulfill({ status: 404 }),
    );
  const reaching = manifests.filter((m) => !without.includes(m.model));
  for (const m of reaching) {
    const { spotSeries, ...pointer } = m as unknown as Record<string, unknown>;
    await page.route(`**/weather/${m.model}.json`, (route) =>
      route.fulfill({ json: pointer }),
    );
    await page.route(`**/weather/${runBase(m.model)}spots/*.json`, (route) =>
      route.fulfill({
        json: {
          schemaVersion: 2,
          model: m.model,
          run: m.run,
          square: SQUARE,
          spotSeries,
        },
      }),
    );
  }
  if (!blend) {
    await page.route("**/weather/wave-blend.json", (route) =>
      route.fulfill({ status: 404 }),
    );
    return;
  }
  const built = buildWaveBlend(reaching, new Date(clock - HOUR));
  const { [WAVE_BLEND_KEY]: places, ...head } = built;
  await page.route("**/weather/wave-blend.json", (route) =>
    route.fulfill({
      json: {
        ...head,
        base: BLEND_BASE,
        spots: {
          squareDegrees: 2,
          url: SQUARE_URL,
          squares: [SQUARE],
          keys: [WAVE_BLEND_KEY],
        },
      },
    }),
  );
  await page.route(`**/weather/${BLEND_BASE}spots/*.json`, (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        model: "wave-blend",
        run: built.run,
        square: SQUARE,
        [WAVE_BLEND_KEY]: { [BRANDON.id]: places[BRANDON.id] },
      },
    }),
  );
}

