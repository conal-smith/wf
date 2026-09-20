import { defineConfig } from "@playwright/test";

// One preview server per run. The port is overridable so that several
// checkouts or worktrees can run the suite at the same time without silently
// testing each other's build.
const port = Number(process.env.PREVIEW_PORT || 4173);
// The community suite's API, on a port of its own for the same reason. Not
// 8787, where a developer's `npm run market:api` may be up over Postgres.
const apiPort = Number(process.env.PORT || 8797);
const api = `http://127.0.0.1:${apiPort}`;

/** The one spec written for a phone; every other spec is the desktop's. */
const PHONE = /community\/phone\.spec\.ts$/;
/** The marketplace's visual baseline, which sets its own widths and writes files. */
const SHOTS = /market\/shots\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", testIgnore: [PHONE, SHOTS] },
    {
      name: "phone",
      testMatch: PHONE,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    // `npm run market:shots` and nothing else: the baseline it writes is
    // committed, so a plain `playwright test` must not rewrite it on its way
    // past. It opens a window of its own per view, at a width of its own, so
    // neither project above fits, and it records forty-odd of them in a run.
    //
    // The two flags are what makes a re-run byte-identical rather than nearly
    // so: rastering a tile on several threads, and reusing part of an earlier
    // raster, both let the antialiasing along a rounded corner land a shade
    // either side, which is a file that differs for no reason anyone can see.
    ...(process.env.MARKET_SHOTS
      ? [
          {
            name: "market-shots",
            testMatch: SHOTS,
            timeout: 180000,
            use: {
              launchOptions: {
                args: ["--num-raster-threads=1", "--disable-partial-raster"],
              },
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // The real API over the memory repos and dev identities (D23), booted by
      // e2e/community/api.ts, which refuses any other mode. Never reused: what
      // answers on that port must be this run's own, empty and in memory.
      command: "npx tsx e2e/community/api.ts",
      url: `${api}/api/community/meta`,
      env: {
        MARKET_DB: "memory",
        MARKET_AUTH_MODE: "dev",
        MARKET_STORAGE: "local",
        MARKET_UPLOAD_DIR: ".cache/e2e-uploads",
        PORT: String(apiPort),
      },
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      // `preview:e2e` stages a scratch site in .e2e (scripts/e2e-site.mjs): the
      // committed files from public/, plus freshly generated synthetic sample
      // bundles as its weather. It then builds that into .e2e/dist and serves it.
      // `public/weather` — real ingest output in a working checkout — is neither
      // read nor written anywhere in the suite, and the specs read the same
      // staged manifests for their expectations (e2e/sample.ts).
      //
      // The preview proxies /api to the API above. The build signs nobody in
      // (VITE_MARKET_DEV_SWITCH, in the script): a community spec names who a
      // browser context is, see e2e/community/fixtures.ts.
      command: `npm run preview:e2e -- --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      env: { MARKET_API_PROXY: api },
      timeout: 180000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
