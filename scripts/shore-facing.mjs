// Write data/locations/shore-facing.json: the way each riding place's shore
// looks out to sea, read from the map's own basemap tiles (OpenFreeMap, built
// from OpenStreetMap). The star ratings use it to tell onshore from offshore.
//
// For each place: 72 bearings, three distances (300 m, 700 m, 1.2 km), each
// sample tested against the tiles' water polygons. The facing is the circular
// mean of the bearings that are water. `strength` is how lopsided that is — a
// straight beach is strong, a pin on an isthmus or a lough's middle is weak —
// and only a facing clear enough to argue with is published for rating.
//
//   npm run spots:facing            (after npm run spots:export)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const root = new URL("..", import.meta.url).pathname;
const spots = JSON.parse(
  readFileSync(`${root}public/riding-locations.json`, "utf8"),
);
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const ZOOM = 13;
const RADII_M = [300, 700, 1200];
const STEP = 5;
/** Below this the water is on too many sides to call a facing. */
const MIN_STRENGTH = 0.15;
const cache = join(tmpdir(), "wingfoil-shore-tiles");
mkdirSync(cache, { recursive: true });

const style = await (await fetch(STYLE)).json();
const tilejson = await (await fetch(style.sources.openmaptiles.url)).json();
const template = tilejson.tiles[0];

const decoded = new Map();
async function waterPolygons(x, y) {
  const key = `${ZOOM}-${x}-${y}`;
  if (decoded.has(key)) return decoded.get(key);
  const file = join(cache, `${key}.pbf`);
  let bytes;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const url = template
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

async function isWater(lat, lon) {
  const { tx, ty, fx, fy } = tileOf(lat, lon);
  for (const polygon of await waterPolygons(tx, ty))
    if (inside(fx * polygon.extent, fy * polygon.extent, polygon.rings))
      return true;
  return false;
}

function offset(lat, lon, bearing, metres) {
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

// Hand corrections survive a rerun: they are the reason to rerun at all.
const target = `${root}data/locations/shore-facing.json`;
const previous = existsSync(target)
  ? JSON.parse(readFileSync(target, "utf8"))
  : {};
const overrides = previous.overrides ?? {};
// The spots on the water are the owner's word too, and survive the same way.
const onWater = previous.onWater ?? [];

const places = {};
for (const spot of spots) {
  let x = 0;
  let y = 0;
  let hits = 0;
  const samples = (360 / STEP) * RADII_M.length;
  for (let bearing = 0; bearing < 360; bearing += STEP) {
    let water = 0;
    for (const radius of RADII_M)
      if (await isWater(...offset(spot.lat, spot.lon, bearing, radius)))
        water++;
    hits += water;
    x += water * Math.sin((bearing * Math.PI) / 180);
    y += water * Math.cos((bearing * Math.PI) / 180);
  }
  const strength = Math.hypot(x, y) / samples;
  const bearing = Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360);
  places[spot.id] = {
    facing: strength >= MIN_STRENGTH ? bearing : null,
    bearing,
    strength: +strength.toFixed(2),
    water: +(hits / samples).toFixed(2),
  };
}

writeFileSync(
  target,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      method:
        "Circular mean of water bearings sampled at 300 m, 700 m and 1.2 km every 5 degrees, from the basemap's vector tiles at zoom 13. `facing` is published only where `strength` (0 to 1) is at least 0.15; `bearing` is kept either way. A computed estimate, not a survey: check it against the beach before trusting an offshore call. `overrides` maps an id to a surveyed facing in degrees (or null to rate on the wind alone) and wins over the computed value. `onWater` lists the spots on the water, ridden in the middle of an estuary or lagoon rather than off one beach: the stars rate them on the wind alone, whatever was computed.",
      source: `${STYLE} (OpenStreetMap data, ODbL)`,
      onWater,
      overrides,
      places,
    },
    null,
    2,
  )}\n`,
);
const published = Object.values(places).filter((p) => p.facing !== null);
console.log(
  `Wrote data/locations/shore-facing.json: ${published.length} of ${spots.length} places with a facing`,
);
