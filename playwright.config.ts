import { defineConfig } from "@playwright/test";

// One preview server per run. The port is overridable so that several
// checkouts or worktrees can run the suite at the same time without silently
// testing each other's build.
const port = Number(process.env.PREVIEW_PORT || 4173);

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
  webServer: {
    // `preview:e2e` puts the synthetic sample bundles in public/weather if it is
    // empty, builds, then serves dist/. No forecast output is committed, so a
    // clean clone has no weather data at all; the generator refuses to touch a
    // public/weather that already holds manifests, so a working checkout with
    // real ingest output is served exactly as it is.
    command: `npm run preview:e2e -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180000,
    reuseExistingServer: !process.env.CI,
  },
});
