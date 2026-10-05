import { readFileSync, writeFileSync } from "node:fs";
import { decodeFrame } from "../../../force5/src/f5bin";
import { sample, type Frame, type Manifest } from "../../../force5/src/weather";

const load = (model: string) => JSON.parse(readFileSync(`public/weather/${model}.json`, "utf8")) as Manifest;
const frameAt = (m: Manifest, iso: string): Frame | null => {
  const info = m.frames.find((f) => f.validTime === iso);
  if (!info) return null;
  const buf = readFileSync(`public/${info.url}`);
  return decodeFrame(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), m, info);
};
const harmonie = load("harmonie");
const ecmwf = load("ecmwf");
const W = -11.6, S = 51.2, D = 1 / 16, NX = 107, NY = 71;
const times: string[] = [];
const sources: string[] = [];
const SCALE = 4; // int8 = m/s * 4, so +-31.75 m/s
const u = new Int8Array(NX * NY * 40 * 1);
const v = new Int8Array(NX * NY * 40 * 1);
let k = 0;
for (let t = Date.parse("2026-10-05T06:00:00Z"); t <= Date.parse("2026-10-09T21:00:00Z"); t += 3 * 3600e3) {
  const iso = new Date(t).toISOString().replace(".000", "");
  let frame = frameAt(harmonie, iso);
  let src = "HARMONIE";
  if (!frame) { frame = frameAt(ecmwf, iso); src = "ECMWF"; }
  if (!frame) { console.warn("missing", iso); continue; }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const w = sample(frame, W + i * D, S + j * D);
      const o = k * NX * NY + j * NX + i;
      u[o] = w ? Math.max(-127, Math.min(127, Math.round(w.u * SCALE))) : -128;
      v[o] = w ? Math.max(-127, Math.min(127, Math.round(w.v * SCALE))) : -128;
    }
  times.push(iso); sources.push(src); k++;
}
const b64 = (a: Int8Array) => Buffer.from(a.buffer, 0, k * NX * NY).toString("base64");
const out = {
  about: "Real 10 m wind for the mockups: HARMONIE (2.5 km, Met Éireann) where its run covers the hour, ECMWF IFS (0.25°) after, resampled bilinearly to a 1/16° grid, 3-hourly. u, v are int8 of m/s × 4, row-major from the south-west corner, south to north; -128 is missing.",
  west: W, south: S, d: D, nx: NX, ny: NY, scale: SCALE, times, sources,
  u: b64(u), v: b64(v),
};
writeFileSync(new URL("../data/wind.js", import.meta.url).pathname, "// See `about`.\nwindow.WFWIND = " + JSON.stringify(out) + ";\n");
console.log(k, "frames", times[0], times.at(-1), sources.filter((s) => s === "HARMONIE").length, "from HARMONIE");
