// The data host for tests: what src/config/urls.ts answers in production.
export const FORECAST_BASE_META = "wingfoil:forecast-base";
export const forecastUrl = (path: string) => `https://data.wingfoil.ie/${path.replace(/^\//, "")}`;
