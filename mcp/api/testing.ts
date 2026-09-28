/**
 * The committed synthetic fixtures laid out as the site publishes them:
 * `weather/<model>.json` from tests/fixtures/weather and the riding locations
 * from public/. The runs span 13–16 Sept 2026, so tests pin their clock.
 */
import { fileURLToPath } from "node:url";
import { dirSource, type ForecastSource } from "./source";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = dirSource(`${repo}tests/fixtures`);
const site = dirSource(`${repo}public`);

/** 18:00 UTC on 16 Sept: ECMWF, GFS and ARPEGE are live; HARMONIE and ICON-EU have ended. */
export const FIXTURE_NOW = Date.parse("2026-09-16T18:00:00Z");

export function fixtureSource(
  extra: Record<string, unknown> = {},
): ForecastSource {
  return {
    json(path) {
      if (path in extra) return Promise.resolve(extra[path]);
      return path.startsWith("weather/")
        ? fixtures.json(path)
        : site.json(path);
    },
  };
}
