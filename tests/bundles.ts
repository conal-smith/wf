// Where the tests find a published forecast bundle to read.
//
// Real ingest output is never committed (.gitignore: public/weather/), so the
// suite reads small SYNTHETIC bundles written in exactly the published format by
// `npm run weather:fixtures` (scripts/sample-weather.mjs). They carry a smooth
// analytic field, and every manifest says so in its provider and attribution.
// Frame urls inside a manifest are relative to the directory above it, exactly
// as they are in `public/`, so the fixtures mirror that layout.
import { readFileSync } from "node:fs";
import { F5_ENCODING, decodeFrame } from "../force5/src/f5bin";
import type { Frame, FrameInfo, Manifest } from "../force5/src/weather";

export const FIXTURE_ROOT = "tests/fixtures";

/** One published manifest, by the file name the model registry gives it. */
export const readBundle = <T>(name: string): T =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/weather/${name}.json`, "utf8"));

/** One immutable frame, by the `weather/…` url its manifest points at. */
export const readFrame = <T>(url: string): T =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/${url}`, "utf8"));

/**
 * One wind frame, whichever encoding its manifest declares.
 *
 * A binary fixture goes through the browser's own decoder, so a test that reads
 * a bundle end to end is reading it the way the site does.
 */
export function readWindFrame(manifest: Manifest, info: FrameInfo): Frame {
  if (manifest.encoding !== F5_ENCODING) return readFrame<Frame>(info.url);
  const file = readFileSync(`${FIXTURE_ROOT}/${info.url}`);
  const buffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;
  return decodeFrame(buffer, manifest, info);
}
