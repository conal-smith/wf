import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_BOOT, THEME_KEY, resolveTheme, themeChoice } from "./theme";

const memory = (value: string | null) => ({
  getItem: () => value,
  setItem: () => {},
  removeItem: () => {},
});

describe("light or dark", () => {
  it("follows the system until the rider picks", () => {
    expect(themeChoice(memory(null))).toBe("system");
    expect(themeChoice(memory("nonsense"))).toBe("system");
    expect(themeChoice(memory("dark"))).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("paints the first frame with the same decision the app makes", () => {
    const html = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain(`<script>${THEME_BOOT}</script>`);
    expect(THEME_BOOT).toContain(THEME_KEY);
  });
});
