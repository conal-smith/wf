/**
 * Light or dark, in the top bar: a round button that shows what it switches
 * to, the sun in dark and the moon in white (shared/web/theme.ts keeps the
 * choice on this device). On a phone the bar has no room for it, and
 * Settings carries the choice instead (src/Settings.tsx).
 */
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_EVENT, currentTheme, toggleTheme } from "../shared/web/theme";
import { Button } from "./Button";

export function ThemeButton({ className }: { className?: string }) {
  const [dark, setDark] = useState(() => currentTheme() === "dark");
  useEffect(() => {
    const follow = () => setDark(currentTheme() === "dark");
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  return (
    <Button
      icon
      className={className}
      aria-label={dark ? "Light mode" : "Dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={toggleTheme}
      data-theme-button
    >
      {dark ? (
        <Sun size={18} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Moon size={18} strokeWidth={1.75} aria-hidden="true" />
      )}
    </Button>
  );
}
