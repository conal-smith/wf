/**
 * Light or dark, in a page's top bar: the moon to go dark, the sun to come
 * back (shared/web/theme.ts keeps the choice on this device).
 */
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_EVENT, currentTheme, toggleTheme } from "../shared/web/theme";
import { Button } from "./Button";

export function ThemeButton({ size }: { size?: "sm" | "md" }) {
  const [dark, setDark] = useState(() => currentTheme() === "dark");
  useEffect(() => {
    const follow = () => setDark(currentTheme() === "dark");
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  return (
    <Button
      variant="raised"
      size={size}
      icon
      aria-label={dark ? "Light mode" : "Dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={toggleTheme}
      data-theme-button
    >
      {dark ? (
        <Sun size={17} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Moon size={17} strokeWidth={1.75} aria-hidden="true" />
      )}
    </Button>
  );
}
