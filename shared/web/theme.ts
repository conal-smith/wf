/**
 * Light or dark. The rider's choice is kept on the device; with none, the
 * system's setting decides, and follows it when it changes. The page is
 * painted in the theme before anything is drawn: index.html carries the same
 * few lines inline in its head (THEME_BOOT below, kept equal by theme.test.ts),
 * so a dark page never flashes white. ui/theme.css holds both palettes; the
 * dark one applies under <html data-theme="dark">.
 *
 * A change is announced as THEME_EVENT on window, for what paints its colours
 * in code rather than CSS: the chart's MapLibre style (force5/src/WindMap.tsx).
 */
export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";

export const THEME_KEY = "wingfoil.theme.v1";
export const THEME_EVENT = "wingfoil:theme";

/** The browser's address bar and status bar colour, per theme. */
const THEME_COLOR: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0c0c0e",
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const store = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const systemDark = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export function themeChoice(storage: Store | null = store()): ThemeChoice {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(choice: ThemeChoice, dark = systemDark()): Theme {
  return choice === "system" ? (dark ? "dark" : "light") : choice;
}

export function currentTheme(): Theme {
  // Light on a server render, where there is no page yet.
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Paint the page in a theme, and tell whoever draws colours in code. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const was = currentTheme();
  if (theme === "dark") root.dataset.theme = "dark";
  else delete root.dataset.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[theme]);
  if (was !== theme)
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

/** The rider picks a theme; "system" forgets their choice. */
export function chooseTheme(choice: ThemeChoice, storage = store()) {
  try {
    if (choice === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // Best effort: the theme still changes for this page.
  }
  applyTheme(resolveTheme(choice));
}

/** Flip between light and dark, keeping the result as the rider's choice. */
export function toggleTheme() {
  chooseTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Start following the system's setting while the rider has made no choice. */
export function watchTheme() {
  applyTheme(resolveTheme(themeChoice()));
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const follow = () => {
    if (themeChoice() === "system")
      applyTheme(media.matches ? "dark" : "light");
  };
  media.addEventListener("change", follow);
  return () => media.removeEventListener("change", follow);
}

/** The head's inline script: the same decision, before the first paint. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;
