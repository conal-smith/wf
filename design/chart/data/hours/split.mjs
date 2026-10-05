// Splits data/hours.js (every spot, every hour) into what 1-the-chart.html loads:
//   index.js   every spot's name, place, facing and day bests, plus a compact string per spot
//              of each hour's stars, potential, shore, direction, wind and gust (enough for the
//              lights on the map, search and the favourites list), ~110 KB;
//   <id>.js    one spot's full hours, sun and tides, loaded when that spot is opened.
// Both are plain scripts so the page still opens from disk. Run: node data/hours/split.mjs
import { readFileSync, writeFileSync } from "node:fs";
const here = new URL(".", import.meta.url).pathname;
const load = (f) => { const window = {}; new Function("window", readFileSync(f, "utf8"))(window); return window; };
const { WFHOURS: H } = load(here + "../hours.js");
const { WF } = load(here + "../../../directions/data.js");
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const ch = (v, max = 63) => (v == null ? "." : B64[Math.max(0, Math.min(max, Math.round(v)))]);
const spots = WF.spots.map((s) => {
  const h = H.spots[s.id];
  // per hour, 6 characters: stars, potential, shore, direction/10°, wind kn, gust kn
  const code = h.hours.map((r) => ch(r[14]) + ch(r[15]) + ch(r[17]) + ch(r[6] / 10, 35) + ch(r[2]) + ch(r[3])).join("");
  return [s.id, s.name, s.county, s.lat, s.lon, h.facing, s.days.map((d) => (d.best ? [d.best.stars, d.best.wind, d.best.gust, d.best.dir, d.best.at] : null)), code];
});
const index = { about: "Index for 1-the-chart.html; see split.mjs.", now: WF.now, days: WF.spots[0].days.map((d) => d.date), featured: Object.keys(WF.featured), sessions: H.sessions, shores: H.shores, spots };
writeFileSync(here + "index.js", "window.WFIDX = " + JSON.stringify(index) + ";\n");
let n = 0;
for (const [id, s] of Object.entries(H.spots)) {
  writeFileSync(here + id + ".js", `(window.WFH1 = window.WFH1 || {})[${JSON.stringify(id)}] = ${JSON.stringify(s)};\n`);
  n++;
}
console.log("index", Math.round(readFileSync(here + "index.js").length / 1024), "KB;", n, "spot files");
