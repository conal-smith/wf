/**
 * Where a deployment says its forecast data lives, in index.html:
 * `<meta name="wingfoil:forecast-base" content="https://data.example/">`.
 * The release pipeline writes it (scripts/release/release.mjs configure-site),
 * so the one build a nightly made serves staging and production unchanged.
 */
export const FORECAST_BASE_META = "wingfoil:forecast-base";

function deployedBase() {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector<HTMLMetaElement>(
    `meta[name="${FORECAST_BASE_META}"]`,
  );
  return meta?.content.trim() ?? "";
}

/** Base includes any CDN prefix, but not /weather (manifest paths include it). */
export function forecastUrl(path: string) {
  const base =
    deployedBase() ||
    import.meta.env.VITE_FORECAST_BASE_URL ||
    import.meta.env.BASE_URL;
  return `${base.replace(/\/?$/, "/")}${path}`;
}
