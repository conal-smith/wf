// Bathymetry as vector tiles for the chart: <out>/{z}/{x}/{y}.pbf (default ./tiles)
//   z5–9  from the 0.0025° grid of all Ireland (tif/ie-*.tif): bands, contours, relief, soundings
//   z10–12 from EMODnet's own 1/16′ (~115 m) grid of the whole coast (tif/fine/*.tif):
//          bands and contours at 0,1,2,3,5,10,20,30,50,100,200 m, soundings every ~700 m in water under 60 m
// MapLibre overzooms past 12. Layers: bands (depth), contours (depth), soundings (d, label, rank), relief (height).
import { fromFile } from "geotiff";
import { contours } from "d3-contour";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const OUT = process.argv[2] ?? "tiles";
const COARSE_DEPTHS = [0, 2, 5, 10, 20, 30, 50, 100, 200];
const FINE_DEPTHS = [0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200];
const HEIGHTS = [50, 150, 300, 600, 900];
const SUB = "₀₁₂₃₄₅₆₇₈₉";

async function read(path) {
  const img = await (await fromFile(path)).getImage();
  const [west, south, east, north] = img.getBoundingBox();
  const [r] = await img.readRasters();
  return { w: img.getWidth(), h: img.getHeight(), west, south, east, north, res: (east - west) / img.getWidth(), z: Float32Array.from(r) };
}
const round = (x, p) => Math.round(x * p) / p;

function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, len ? ((px - ax) * dx + (py - ay) * dy) / len : 0));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > t2) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

/** Bands (areas at least t) and their outlines, cut where they run along the grid's edge. */
function isolines(g, field, thresholds, prop, minCells, tol) {
  const gen = contours().size([g.w, g.h]).thresholds(thresholds).smooth(true);
  const bands = [], lines = [];
  const ll = (ring) => ring.map(([x, y]) => [round(g.west + x * g.res, 1e5), round(g.north - y * g.res, 1e5)]);
  const onEdge = ([x, y]) => x <= 0.5 || y <= 0.5 || x >= g.w - 0.5 || y >= g.h - 0.5;
  for (const c of gen(Float64Array.from(field, (v) => (Number.isFinite(v) ? v : -9999)))) {
    const polys = [];
    for (const poly of c.coordinates) {
      if (Math.abs(ringArea(poly[0])) < minCells) continue;
      const rings = poly.map((r) => dp(ll(r), tol)).filter((r) => r.length >= 4);
      if (rings.length && poly[0].length >= 4) polys.push(rings);
      for (const ring of poly) {
        let run = [];
        const flush = () => { if (run.length > 2) lines.push({ type: "Feature", properties: { [prop]: c.value }, geometry: { type: "LineString", coordinates: dp(ll(run), tol) } }); run = []; };
        for (const pt of ring) (onEdge(pt) ? flush() : run.push(pt));
        flush();
      }
    }
    if (polys.length) bands.push({ type: "Feature", properties: { [prop]: c.value }, geometry: { type: "MultiPolygon", coordinates: polys } });
  }
  return { bands, lines };
}

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function soundings(g, depth, step, maxDepth) {
  const out = [];
  for (let y = step >> 1; y < g.h; y += step)
    for (let x = step >> 1; x < g.w; x += step) {
      const jx = Math.min(g.w - 1, Math.max(0, x + Math.round((rand() - 0.5) * step * 0.6)));
      const jy = Math.min(g.h - 1, Math.max(0, y + Math.round((rand() - 0.5) * step * 0.6)));
      const d = depth[jy * g.w + jx];
      if (!(d > 0.3) || d > maxDepth) continue;
      const whole = Math.floor(d), dec = d < 21 ? Math.round((d - whole) * 10) % 10 : 0;
      out.push({
        type: "Feature",
        properties: { d: d < 21 ? round(d, 10) : Math.round(d), label: dec ? `${whole}${SUB[dec]}` : String(whole), rank: Math.floor(rand() * 1000) },
        geometry: { type: "Point", coordinates: [round(g.west + (jx + 0.5) * g.res, 1e5), round(g.north - (jy + 0.5) * g.res, 1e5)] },
      });
    }
  return out;
}
const depthOf = (g) => Float32Array.from(g.z, (v) => (Number.isFinite(v) && Math.abs(v) < 12000 ? -v : NaN));

// ---- coarse ----
const q = {};
for (const k of ["sw", "nw", "se", "ne"]) q[k] = await read(`tif/ie-${k}.tif`);
const W = q.sw.w + q.se.w, H = q.sw.h + q.nw.h;
const ie = { w: W, h: H, west: q.sw.west, north: q.nw.north, res: q.sw.res, z: new Float32Array(W * H) };
const place = (t, ox, oy) => { for (let y = 0; y < t.h; y++) ie.z.set(t.z.subarray(y * t.w, (y + 1) * t.w), (oy + y) * W + ox); };
place(q.nw, 0, 0); place(q.ne, q.nw.w, 0); place(q.sw, 0, q.nw.h); place(q.se, q.sw.w, q.ne.h);
const ieDepth = depthOf(ie);
const coarseSea = isolines(ie, ieDepth, COARSE_DEPTHS, "depth", 6, 0.0012);
const coarseRelief = isolines(ie, Float32Array.from(ieDepth, (d) => -d), HEIGHTS, "height", 10, 0.0015);
const coarse = {
  bands: coarseSea.bands, contours: coarseSea.lines, relief: coarseRelief.lines,
  soundings: soundings(ie, ieDepth, 10, 400),
};
console.log("coarse", Object.fromEntries(Object.entries(coarse).map(([k, v]) => [k, v.length])));

// ---- fine ----
const fine = { bands: [], contours: [], soundings: [] };
for (const f of readdirSync("tif/fine").filter((f) => f.endsWith(".tif")).sort()) {
  const g = await read(`tif/fine/${f}`);
  const depth = depthOf(g);
  const iso = isolines(g, depth, FINE_DEPTHS, "depth", 3, 0.00025);
  fine.bands.push(...iso.bands); fine.contours.push(...iso.lines);
  fine.soundings.push(...soundings(g, depth, 6, 60));
  process.stdout.write(`${f} `);
}
console.log("\nfine", Object.fromEntries(Object.entries(fine).map(([k, v]) => [k, v.length])));

// ---- tiles ----
rmSync(OUT, { recursive: true, force: true });
const fc = (features) => ({ type: "FeatureCollection", features });
function writeTiles(set, minZ, maxZ) {
  const index = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, new geojsonvt(fc(v), { maxZoom: maxZ, indexMaxZoom: maxZ, tolerance: 2, extent: 4096, buffer: 64 })]));
  let count = 0, bytes = 0;
  // Tile range covering Ireland.
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  for (let z = minZ; z <= maxZ; z++)
    for (let x = lon2x(-11.3, z); x <= lon2x(-5.1, z); x++)
      for (let y = lat2y(55.6, z); y <= lat2y(51.2, z); y++) {
        const layers = {};
        for (const [name, idx] of Object.entries(index)) {
          const t = idx.getTile(z, x, y);
          if (t && t.features.length) layers[name] = t;
        }
        if (!Object.keys(layers).length) continue;
        const buf = Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 }));
        mkdirSync(`${OUT}/${z}/${x}`, { recursive: true });
        writeFileSync(`${OUT}/${z}/${x}/${y}.pbf`, buf);
        count++; bytes += buf.length;
      }
  console.log(`z${minZ}-${maxZ}: ${count} tiles, ${(bytes / 1e6).toFixed(1)} MB (gzip would be ~${(bytes / 1e6 / 3).toFixed(1)} MB)`);
}
writeTiles(coarse, 5, 9);
writeTiles(fine, 10, 12);
