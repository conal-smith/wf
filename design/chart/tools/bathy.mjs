// Real bathymetry for the chart mockups, from EMODnet's DTM (fetch.sh).
// Writes design/chart/data/{bathy-ireland,bathy-bays,bathy-grids,soundings}.js
// as window globals, so the mockups open straight from disk.
import { fromFile } from "geotiff";
import { contours } from "d3-contour";
import { writeFileSync } from "node:fs";

const OUT = new URL("../data", import.meta.url).pathname;
const DEPTHS = [0, 2, 5, 10, 20, 30, 50, 100, 200];
const HEIGHTS = [50, 150, 300, 600, 900];

async function read(name) {
  const img = await (await fromFile(`tif/${name}.tif`)).getImage();
  const [west, south, east, north] = img.getBoundingBox();
  const [r] = await img.readRasters();
  return { w: img.getWidth(), h: img.getHeight(), west, south, east, north, res: (east - west) / img.getWidth(), z: Float32Array.from(r) };
}

/** Elevation (m, + up) grid -> depth (m, + down), with gaps filled from neighbours. */
function depthOf(g) {
  const d = new Float32Array(g.z.length);
  for (let i = 0; i < d.length; i++) {
    const v = g.z[i];
    d[i] = Number.isFinite(v) && Math.abs(v) < 12000 ? -v : NaN;
  }
  return d;
}

const round = (x, p) => Math.round(x * p) / p;

function toLonLat(g, ring) {
  return ring.map(([x, y]) => [round(g.west + x * g.res, 1e5), round(g.north - y * g.res, 1e5)]);
}

/** Filled areas at or beyond each threshold, and their outlines away from the grid's edge. */
function isolines(g, field, thresholds, tolerance, prop, minCells = 6) {
  const gen = contours().size([g.w, g.h]).thresholds(thresholds).smooth(true);
  const clean = Float64Array.from(field, (v) => (Number.isFinite(v) ? v : -9999));
  const bands = [];
  const lines = [];
  const onEdge = ([x, y]) => x <= 0.5 || y <= 0.5 || x >= g.w - 0.5 || y >= g.h - 0.5;
  for (const c of gen(clean)) {
    const polys = [];
    for (const poly of c.coordinates) {
      const area = Math.abs(ringArea(poly[0]));
      if (area < minCells) continue;
      polys.push(poly.map((ring) => toLonLat(g, ring)));
      // Outlines, cut wherever they run along the edge of the grid.
      for (const ring of poly) {
        let run = [];
        for (const pt of ring) {
          if (onEdge(pt)) {
            if (run.length > 1) lines.push({ type: "Feature", properties: { [prop]: c.value }, geometry: { type: "LineString", coordinates: toLonLat(g, run) } });
            run = [];
          } else run.push(pt);
        }
        if (run.length > 1) lines.push({ type: "Feature", properties: { [prop]: c.value }, geometry: { type: "LineString", coordinates: toLonLat(g, run) } });
      }
    }
    if (polys.length) bands.push({ type: "Feature", properties: { [prop]: c.value }, geometry: { type: "MultiPolygon", coordinates: polys } });
  }
  for (const f of bands)
    f.geometry.coordinates = f.geometry.coordinates
      .map((poly) => poly.map((ring) => dp(ring, tolerance)).filter((ring, i) => ring.length >= 4 || (i === 0 && false)))
      .filter((poly) => poly.length && poly[0].length >= 4);
  for (const f of lines) f.geometry.coordinates = dp(f.geometry.coordinates, tolerance);
  const fc = (features) => ({ type: "FeatureCollection", features });
  return {
    bands: fc(bands.filter((f) => f.geometry.coordinates.length)),
    lines: fc(lines.filter((f) => f.geometry.coordinates.length > 2)),
  };
}

/** Douglas-Peucker, iterative. */
function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
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

/** Soundings: one depth every `step` cells at sea, jittered a little, as flat [lon, lat, depth] triples. */
function soundings(g, depth, step, seed) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let y = step >> 1; y < g.h; y += step)
    for (let x = step >> 1; x < g.w; x += step) {
      const jx = Math.min(g.w - 1, Math.max(0, x + Math.round((rand() - 0.5) * step * 0.6)));
      const jy = Math.min(g.h - 1, Math.max(0, y + Math.round((rand() - 0.5) * step * 0.6)));
      const d = depth[jy * g.w + jx];
      if (!(d > 0.3)) continue;
      out.push(round(g.west + (jx + 0.5) * g.res, 1e4), round(g.north - (jy + 0.5) * g.res, 1e4), d < 21 ? round(d, 10) : Math.round(d));
    }
  return out;
}

const size = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + " kB";

// ---- Ireland, four quarters stitched into one grid ----
const q = { sw: await read("ie-sw"), nw: await read("ie-nw"), se: await read("ie-se"), ne: await read("ie-ne") };
const W = q.sw.w + q.se.w;
const H = q.sw.h + q.nw.h;
const ie = { w: W, h: H, west: q.sw.west, north: q.nw.north, south: q.sw.south, east: q.se.east, res: q.sw.res, z: new Float32Array(W * H) };
const place = (t, ox, oy) => { for (let y = 0; y < t.h; y++) ie.z.set(t.z.subarray(y * t.w, (y + 1) * t.w), (oy + y) * W + ox); };
place(q.nw, 0, 0); place(q.ne, q.nw.w, 0); place(q.sw, 0, q.nw.h); place(q.se, q.sw.w, q.ne.h);
const ieDepth = depthOf(ie);
const sea = isolines(ie, ieDepth, DEPTHS, 0.0012, "depth");
const relief = isolines(ie, Float32Array.from(ieDepth, (d) => -d), HEIGHTS, 0.0015, "height", 10);
const ireland = {
  about: "EMODnet Bathymetry DTM (mean depth, ~115 m survey grid incl. INFOMAR, read here at 0.0025° ≈ 250 m), depths in metres below chart datum (approx. Lowest Astronomical Tide), heights above it. bands: areas at least `depth` deep; lines: their outlines; relief: land at least `height` high.",
  bbox: [ie.west, ie.south, ie.east, ie.north],
  depths: DEPTHS, heights: HEIGHTS,
  bands: sea.bands, lines: sea.lines, relief: relief.lines,
};
writeFileSync(`${OUT}/bathy-ireland.js`, "// See `about`.\nwindow.WFBATHY = " + JSON.stringify(ireland) + ";\n");
console.log("ireland", size(sea.bands), size(sea.lines), size(relief.lines));

// ---- the featured bays, at the survey's own resolution ----
const BAYS = ["brandon", "dollymount", "rusheen", "keel", "the-burrow"];
const bays = {};
const grids = {};
const fine = [];
for (const id of BAYS) {
  const g = await read(id);
  const depth = depthOf(g);
  const iso = isolines(g, depth, [0, 1, 2, 3, 5, 10, 20, 30, 50], 0.00025, "depth", 3);
  bays[id] = { bbox: [g.west, g.south, g.east, g.north], bands: iso.bands, lines: iso.lines };
  // The grid itself, for anything that needs a depth at a point: decimetres, int16, north row first.
  const dm = new Int16Array(depth.length);
  for (let i = 0; i < depth.length; i++) dm[i] = Number.isFinite(depth[i]) ? Math.max(-32767, Math.min(32767, Math.round(depth[i] * 10))) : -32768;
  grids[id] = { west: g.west, north: g.north, res: g.res, w: g.w, h: g.h, dm: Buffer.from(dm.buffer).toString("base64") };
  fine.push(...soundings(g, depth, 4, 7 + fine.length));
  console.log(id, g.w + "x" + g.h, size(iso.bands), size(iso.lines));
}
writeFileSync(`${OUT}/bathy-bays.js`, "// The featured bays at ~115 m: bands and lines as in bathy-ireland.js, with 1 and 3 m added.\nwindow.WFBAYS = " + JSON.stringify(bays) + ";\n");
writeFileSync(`${OUT}/bathy-grids.js`, "// The featured bays' depth grids: int16 decimetres below chart datum (negative is land above it), row-major from the north-west corner, little-endian, base64; -32768 is no data.\nwindow.WFGRIDS = " + JSON.stringify(grids) + ";\n");
const coarse = soundings(ie, ieDepth, 10, 3);
writeFileSync(`${OUT}/soundings.js`, "// Real soundings, flat [lon, lat, depth m below chart datum] triples: `coarse` every ~2.5 km round Ireland, `fine` every ~450 m in the featured bays.\nwindow.WFSOUNDINGS = " + JSON.stringify({ coarse, fine }) + ";\n");
console.log("soundings", coarse.length / 3, fine.length / 3);
