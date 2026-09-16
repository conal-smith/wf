import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "force5/src/**/*.test.ts",
      "tests/**/*.test.ts",
      "market/**/*.test.ts",
    ],
  },
});
