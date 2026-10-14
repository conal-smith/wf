import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The app's logic, tested in Node: pure modules only (no React Native), the
 * way SprintEngine mobile keeps its *Logic.ts beside each screen. The site's
 * seams resolve to the app's, as in metro.config.js.
 */
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: [
      { find: /^.*\/force5\/src\/urls$/, replacement: here("./src/config/urls.test-stub.ts") },
    ],
  },
});
