// Where the tests find a published forecast bundle to read.
//
// Real ingest output is never committed (.gitignore: public/weather/), so the
// suite reads small SYNTHETIC bundles written in exactly the published format by
// `npm run weather:fixtures` (scripts/sample-weather.mjs). They carry a smooth
// analytic field, and every manifest says so in its provider and attribution.
// Each pointer names its run directory beside it, `base`, and its frame urls
// and spot squares are inside that directory, exactly as they are in `public/`,
// so the fixtures mirror that layout.
import { readFileSync } from "node:fs";
import { F5_ENCODING, decodeFrame } from "../force5/src/f5bin";
import {
  runPath,
  withSpotSquares,
  type ReadJson,
  type RunPointer,
} from "../force5/src/spotData";
import {
  validateWeatherManifest,
  validateWeatherSpots,
  type WeatherManifest,
} from "../force5/src/surface";
import {
  validateWaveManifest,
  validateWaveSpots,
  type WaveManifest,
} from "../force5/src/waves";
import {
  validateManifest,
  validateWindSpots,
  type Frame,
  type FrameInfo,
  type Manifest,
} from "../force5/src/weather";

export const FIXTURE_ROOT = "tests/fixtures";

/** One published pointer, by the file name the model registry gives it. */
export const readBundle = <T>(name: string): T =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/weather/${name}.json`, "utf8"));

/** A published file, by its path from the site root, as the loader asks for it. */
export const readFixture: ReadJson = async (path) =>
  JSON.parse(readFileSync(`${FIXTURE_ROOT}/${path}`, "utf8"));

/**
 * One published run with every one of its spot squares merged in, read through
 * the site's own loader (force5/src/spotData.ts): the shape a reader that
 * needs every spot holds.
 */
export const readRun = async <T extends RunPointer>(name: string): Promise<T> =>
  (await withSpotSquares(
    readFixture,
    `weather/${name}.json`,
    readBundle<T>(name),
  )) as T;

/**
 * A wind, wave or weather run, checked as the site checks it: the pointer as
 * published, then every square's data as it arrives.
 */
export async function readWindRun(name: string): Promise<Manifest> {
  validateManifest(readBundle<Manifest>(name));
  return validateWindSpots(await readRun<Manifest>(name));
}
export async function readWaveRun(name: string): Promise<WaveManifest> {
  validateWaveManifest(readBundle<WaveManifest>(name));
  return validateWaveSpots(await readRun<WaveManifest>(name));
}
export async function readWeatherRun(name: string): Promise<WeatherManifest> {
  validateWeatherManifest(readBundle<WeatherManifest>(name));
  return validateWeatherSpots(await readRun<WeatherManifest>(name));
}

/** Where one of a run's own files is, from the site root. */
export const runFile = (manifest: { base: string }, url: string) =>
  `${FIXTURE_ROOT}/${runPath("weather/pointer.json", manifest.base, url)}`;

/** One immutable JSON frame of a run, by its url inside the run directory. */
export const readFrame = <T>(manifest: { base: string }, url: string): T =>
  JSON.parse(readFileSync(runFile(manifest, url), "utf8"));

/**
 * One wind frame, whichever encoding its manifest declares.
 *
 * A binary fixture goes through the browser's own decoder, so a test that reads
 * a bundle end to end is reading it the way the site does.
 */
export function readWindFrame(manifest: Manifest, info: FrameInfo): Frame {
  if (manifest.encoding !== F5_ENCODING)
    return readFrame<Frame>(manifest, info.url);
  const file = readFileSync(runFile(manifest, info.url));
  const buffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;
  return decodeFrame(buffer, manifest, info);
}
