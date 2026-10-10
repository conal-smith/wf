import { defineConfig } from "@playwright/test";

/**
 * The deployed-site smoke suite (e2e/smoke): a site somebody else is serving,
 * with real forecasts on the real clock. No web server is started here.
 *
 *   SMOKE_BASE_URL=https://staging.example.com SMOKE_MANIFESTS=weather/gfs.json \
 *     npx playwright test -c playwright.smoke.config.ts
 *
 * scripts/release/acceptance.sh runs it against the web image, and the release
 * workflow against staging and then production.
 */
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) throw new Error("SMOKE_BASE_URL is required: the site to check");

export default defineConfig({
  testDir: "./e2e/smoke",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  // A deployed site is reached over a network; one retry tells a dropped
  // request from a broken release.
  retries: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
