/**
 * The committed synthetic fixtures laid out as the site publishes them:
 * `weather/<model>.json` from tests/fixtures/weather and the riding locations
 * from public/. The runs span 13–16 Sept 2026, so tests pin their clock.
 *
 * `marine/` is ingest output, git-ignored and absent from a clean checkout, so
 * it is never read from public/ here: a worktree that links it to real tides
 * would otherwise answer a test differently from CI. A test that wants tides
 * or a sea temperature passes them in `extra`.
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
      if (path.startsWith("weather/")) return fixtures.json(path);
      if (path.startsWith("marine/")) return Promise.resolve(null);
      return site.json(path);
    },
  };
}
