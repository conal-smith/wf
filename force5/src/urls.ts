/** Base includes any CDN prefix, but not /weather (manifest paths include it). */
export function forecastUrl(path: string) {
  const base =
    import.meta.env.VITE_FORECAST_BASE_URL || import.meta.env.BASE_URL;
  return `${base.replace(/\/?$/, "/")}${path}`;
}
