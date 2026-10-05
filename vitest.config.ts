import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "force5/src/**/*.test.ts",
      "tests/**/*.test.ts",
      "market/**/*.test.ts",
      "site/**/*.test.ts",
      "shared/**/*.test.ts",
      "community/**/*.test.ts",
      "mcp/**/*.test.ts",
      "ai/**/*.test.ts",
      "intro/**/*.test.ts",
      "ui/**/*.test.{ts,tsx}",
    ],
  },
});
