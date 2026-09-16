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
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
