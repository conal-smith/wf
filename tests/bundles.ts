// Where the tests find a published forecast bundle to read.
//
// Real ingest output is never committed (.gitignore: public/weather/), so the
// suite reads small SYNTHETIC bundles written in exactly the published format by
// `npm run weather:fixtures` (scripts/sample-weather.mjs). They carry a smooth
// analytic field, and every manifest says so in its provider and attribution.
// Frame urls inside a manifest are relative to the directory above it, exactly
// as they are in `public/`, so the fixtures mirror that layout.
import { readFileSync } from "node:fs";

export const FIXTURE_ROOT = "tests/fixtures";

/** One published manifest, by the file name the model registry gives it. */
export const readBundle = <T>(name: string): T =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/weather/${name}.json`, "utf8"));

/** One immutable frame, by the `weather/…` url its manifest points at. */
export const readFrame = <T>(url: string): T =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/${url}`, "utf8"));
