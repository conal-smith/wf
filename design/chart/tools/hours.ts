// Every spot, every hour, for the chart mockups: data/hours.js (window.WFHOURS).
// Run from the repository root (stars from feature/stars-v2): npx tsx design/chart/tools/hours.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirSource } from "../../../mcp/api/source";
import { loadSpots, spotForecast } from "../../../mcp/api/forecast";
import { sunTimes, formatLocal } from "../../../force5/src/sun";
import {
  rateHour,
  rideableWind,
  windBand,
  DEFAULT_RIDER,
  SESSION_LABEL,
} from "../../../force5/src/stars";

const OUT = new URL("../data/hours.js", import.meta.url).pathname;
const src = dirSource("public");
const facingDoc = JSON.parse(readFileSync("data/locations/shore-facing.json", "utf8"));
const face = (id: string) =>
  id in facingDoc.overrides ? facingDoc.overrides[id] : (facingDoc.places[id]?.facing ?? null);
const spots = await loadSpots(src);
const from = Date.parse("2026-10-05T00:00:00Z");
const now = Date.parse("2026-10-05T12:00:00Z");
const DAYS = 5;
const KN = 1.94384;
const band = windBand(DEFAULT_RIDER);

// The ensembles' members at each spot, for probabilities.
const ens = ["ecmwf-ens", "gefs"].map((m) => JSON.parse(readFileSync(`public/weather/${m}.json`, "utf8")));
/** Members' (wind, gust) in knots at time t, interpolated linearly between the 6-hourly steps. */
function members(id: string, t: number): [number, number | null][] {
  const out: [number, number | null][] = [];
  for (const m of ens) {
    const series = m.spotMembers[id] as { validTime: string; u: number[]; v: number[]; gust: (number | null)[] }[];
    const i = series.findIndex((f) => Date.parse(f.validTime) > t);
    if (i <= 0) continue;
    const a = series[i - 1], b = series[i];
    const f = (t - Date.parse(a.validTime)) / (Date.parse(b.validTime) - Date.parse(a.validTime));
    for (let k = 0; k < a.u.length; k++) {
      const w = (1 - f) * Math.hypot(a.u[k], a.v[k]) + f * Math.hypot(b.u[k], b.v[k]);
      const ga = a.gust[k], gb = b.gust[k];
      out.push([w * KN, ga != null && gb != null ? ((1 - f) * ga + f * gb) * KN : null]);
    }
  }
  return out;
}

const SESSIONS = Object.keys(SESSION_LABEL);
const SHORES = ["onshore", "cross-on", "cross", "cross-off", "offshore"];
const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);

const out: any = {
  about:
    "Every riding place, every hour 5–9 Oct 2026, from the product's own forecast reduction (mcp/api/forecast.ts: the blend of HARMONIE, AROME, ARPEGE, ECMWF, ICON-EU, GFS, AIFS and the ensembles, one line per model) and the v2 stars for an 80 kg intermediate. hours[i] = [UTC hour index from 2026-10-05T00Z, daylight 0/1, wind kn, gust kn, models' min kn, max kn, from deg, agreement (h/m/l), wave m, wave s, wave from deg, air °C, rain mm, cloud %, stars, potential, session index, shore index, wing m², rides-like kn, reasons (array), ensemble: chance (0–100) the rideable wind reaches the rider's floor, ensemble p10 kn, p50, p90]. Nulls where a source has no value (air temperature, cloud and rain stop at Wed 14:00, ICON-EU's range). sun per day: [first light, sunrise, sunset, last light] local hh:mm. tides: Marine Institute events at the nearest station (LAT).",
  sessions: SESSIONS.map((k) => [k, SESSION_LABEL[k as keyof typeof SESSION_LABEL]]),
  shores: SHORES,
  floorKn: band.min,
  spots: {},
};
for (const spot of spots) {
  const facing = face(spot.id);
  const f = await spotForecast(src, spot, { from, to: from + DAYS * 24 * 3600e3 - 3600e3, stepHours: 1 }, { now });
  const hours = f.hours.map((h: any, i: number) => {
    const w = h.wind;
    const r = w
      ? rateHour({ windKn: w.wind_kn, gustKn: w.gust_kn, from: w.direction_deg, agreement: w.agreement, daylight: h.daylight }, { facing }, DEFAULT_RIDER)
      : null;
    const m = members(spot.id, Date.parse(h.time));
    let chance = null, p10 = null, p50 = null, p90 = null;
    if (m.length) {
      const ride = m.map(([wk, gk]) => rideableWind(wk, gk, DEFAULT_RIDER));
      chance = Math.round((100 * ride.filter((x) => x >= band.min).length) / ride.length);
      const s = m.map(([wk]) => wk).sort((a, b) => a - b);
      const q = (p: number) => r1(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
      [p10, p50, p90] = [q(0.1), q(0.5), q(0.9)];
    }
    return [
      i, h.daylight ? 1 : 0,
      r1(w?.wind_kn), r1(w?.gust_kn), r1(w?.min_kn), r1(w?.max_kn), w?.direction_deg ?? null, w?.agreement?.[0] ?? null,
      r1(h.waves?.height_m), h.waves?.period_s ?? null, h.waves?.direction_deg ?? null,
      h.weather?.air_c ?? null, h.weather?.rain_mm ?? null, h.weather?.cloud_pct ?? null,
      r ? r.stars : null, r ? r.potential : null, r ? SESSIONS.indexOf(r.session) : null, r?.shore ? SHORES.indexOf(r.shore) : null,
      r ? r.wing.recommended : null, r ? r1(r.rideKn) : null, r ? r.reasons : null,
      chance, p10, p50, p90,
    ];
  });
  out.spots[spot.id] = {
    name: spot.name, county: spot.county, lat: spot.lat, lon: spot.lon, facing,
    sun: Array.from({ length: DAYS }, (_, d) => {
      const t = sunTimes(spot.lat, spot.lon, new Date(from + d * 864e5 + 12 * 36e5));
      const hm = (x: Date | null) => (x ? formatLocal(x) : null);
      return { date: t.date, first: hm(t.civilDawn), rise: hm(t.sunrise), set: hm(t.sunset), last: hm(t.civilDusk) };
    }),
    tides: f.tides?.events ? { station: f.tides.station, km: f.tides.distance_km, events: f.tides.events.map((e: any) => [e.time, e.tide[0], e.height_m]) } : null,
    sea: f.sea_temperature?.temperature_c ?? null,
    hours,
  };
}
writeFileSync(OUT, "// See `about`.\nwindow.WFHOURS = " + JSON.stringify(out) + ";\n");
const b = out.spots.brandon;
console.log(Object.keys(out.spots).length, "spots;", (JSON.stringify(out).length / 1024).toFixed(0), "kB");
console.log("brandon sun", JSON.stringify(b.sun[1]), "tides", b.tides?.events.length, JSON.stringify(b.tides?.events[0]));
console.log("brandon Tue 18:00 UTC17", JSON.stringify(b.hours[24 + 17]));
console.log("donabate Mon 12 UTC", JSON.stringify(out.spots.donabate.hours[12]));
