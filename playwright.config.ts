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
    // `preview:e2e` stages a scratch site in .e2e (scripts/e2e-site.mjs): the
    // committed files from public/, plus freshly generated synthetic sample
    // bundles as its weather. It then builds that into .e2e/dist and serves it.
    // `public/weather` — real ingest output in a working checkout — is neither
    // read nor written anywhere in the suite, and the specs read the same
    // staged manifests for their expectations (e2e/sample.ts).
    command: `npm run preview:e2e -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180000,
    reuseExistingServer: !process.env.CI,
  },
});
