#!/usr/bin/env node
/**
 * The tidal depth's archives at one zoom, as files, for coast_glow.py: every
 * region's tiles at z8 (their overviews), read by range from the data host.
 *
 *   node scripts/foildepth/coast_glow_tiles.mjs --base https://data.example/ --out .cache/coast-glow
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FetchSource, PMTiles } from "pmtiles";

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const base = option("base", "https://data.wingfoil.ie/");
const out = option("out", ".cache/coast-glow");
const zoom = Number(option("zoom", 8));
const index = JSON.parse(readFileSync("public/foildepth/index.json", "utf8"));
mkdirSync(out, { recursive: true });

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** zoom);
const tileY = (lat) => {
  const rad = (lat * Math.PI) / 180;
  const y = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2;
  return Math.floor(y * 2 ** zoom);
};

let written = 0;
for (const area of index.areas.filter((a) => a.minzoom <= zoom)) {
  const archive = new PMTiles(
    new FetchSource(`${base}${index.base}${area.url}`),
  );
  const [west, south, east, north] = area.bounds;
  for (let x = tileX(west); x <= tileX(east); x += 1)
    for (let y = tileY(north); y <= tileY(south); y += 1) {
      const tile = await archive.getZxy(zoom, x, y);
      if (!tile) continue;
      writeFileSync(
        join(out, `${area.id}__${zoom}_${x}_${y}.bin`),
        Buffer.from(tile.data),
      );
      written += 1;
    }
}
console.log(`${written} tiles in ${out}`);
