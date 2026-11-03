// Water or land at a point, read from the map's own basemap tiles (OpenFreeMap,
// built from OpenStreetMap): the water layer's polygons at zoom 13, the sea and
// the lakes and the wider rivers. Tiles are kept in the system's temporary
// directory, so a second run fetches nothing. Shared by the shore facing
// (scripts/shore-facing.mjs) and the wave climate's line to the sea
// (scripts/climate/sea-view.mjs).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export const STYLE = "https://tiles.openfreemap.org/styles/positron";
const ZOOM = 13;
const cache = join(tmpdir(), "wingfoil-shore-tiles");

let template;
async function tileUrl() {
  if (!template) {
    mkdirSync(cache, { recursive: true });
    const style = await (await fetch(STYLE)).json();
    const tilejson = await (await fetch(style.sources.openmaptiles.url)).json();
    template = tilejson.tiles[0];
  }
  return template;
}

const decoded = new Map();
async function waterPolygons(x, y) {
  const key = `${ZOOM}-${x}-${y}`;
  if (decoded.has(key)) return decoded.get(key);
  const file = join(cache, `${key}.pbf`);
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const url = (await tileUrl())
      .replace("{z}", ZOOM)
      .replace("{x}", x)
      .replace("{y}", y);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(file, bytes);
    // A courtesy pause: this is a free, volunteer-run tile service.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const layer = new VectorTile(new PbfReader(bytes)).layers.water;
  const polygons = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type === 3)
      polygons.push({ rings: feature.loadGeometry(), extent: layer.extent });
  }
  decoded.set(key, polygons);
  return polygons;
}

function tileOf(lat, lon) {
  const n = 2 ** ZOOM;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return { tx, ty, fx: x - tx, fy: y - ty };
}

/** Even-odd over every ring of a feature, so islands fall out as holes. */
function inside(px, py, rings) {
  let within = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (
        a.y > py !== b.y > py &&
        px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x
      )
        within = !within;
    }
  return within;
}

export async function isWater(lat, lon) {
  const { tx, ty, fx, fy } = tileOf(lat, lon);
  for (const polygon of await waterPolygons(tx, ty))
    if (inside(fx * polygon.extent, fy * polygon.extent, polygon.rings))
      return true;
  return false;
}

/** The point `metres` from (lat, lon) on `bearing` degrees from north. */
export function offset(lat, lon, bearing, metres) {
  const b = (bearing * Math.PI) / 180;
  const d = metres / 6371000;
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const la2 = Math.asin(
    Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b),
  );
  const lo2 =
    lo +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(la),
      Math.cos(d) - Math.sin(la) * Math.sin(la2),
    );
  return [(la2 * 180) / Math.PI, (lo2 * 180) / Math.PI];
}
