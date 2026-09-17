import { readFileSync } from "node:fs";

/**
 * Where a spec reads the data the site under test is serving.
 *
 * Not `public/weather`. That is ingest output, and in a working checkout it is
 * the owner's real forecast: the suite must never read it, serve it or write to
 * it. `scripts/e2e-site.mjs` stages a site of its own under `.e2e` with freshly
 * generated synthetic bundles as its weather, `vite.config.ts` builds and serves
 * that tree when E2E_SITE is set, and this is the same directory — so what a
 * spec asserts and what the browser fetches are one set of files.
 */
export const SAMPLE_WEATHER = ".e2e/public/weather";

/**
 * One staged manifest, by the file name the model registry gives it. Untyped by
 * default, as `JSON.parse` was where these reads used to be written out.
 */
export const readSample = <T = any>(model: string): T =>
  JSON.parse(readFileSync(`${SAMPLE_WEATHER}/${model}.json`, "utf8"));
