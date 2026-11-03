// Whether the open sea's waves can reach each spot from a wave model's cell:
// the straight line from the spot to the cell has to stay over water, as the
// map's own basemap draws it (scripts/water-tiles.mjs, OpenStreetMap), which is
// far finer at the shore than the wave model's 1.5 km grid. A pin on a beach
// may sit a little inland (or by a pond or a stream), so the line's first
// START_M is not looked at; past that, any land on the way (a spit, a causeway,
// a headland, the far shore of a lough) blocks it.
//
// Run by build_climate.py, which hands over each spot's candidate cells, nearest
// first, and gets back the first one the sea can reach from, or null:
//
//   node scripts/climate/sea-view.mjs <in.json> <out.json>
//
// in:  [{"id", "lat", "lon", "cells": [[lat, lon], ...]}, ...]
// out: {"<id>": {"cell": <index into cells> | null, "blocked": [[lat, lon], ...]}}
//      where `blocked` is, for each cell passed over, the first land in the way.
import { readFileSync, writeFileSync } from "node:fs";
import { isWater } from "../water-tiles.mjs";

/** The stretch of line next to the pin that is not looked at: a pin may sit inland of the beach. */
export const START_M = 500;
/** The spacing of the samples along the line. */
export const STEP_M = 50;

const R = 6371000;
function metres(a, b) {
  const la = (((a[0] + b[0]) / 2) * Math.PI) / 180;
  const dy = ((b[0] - a[0]) * Math.PI) / 180;
  const dx = (((b[1] - a[1]) * Math.PI) / 180) * Math.cos(la);
  return Math.hypot(dx, dy) * R;
}

/** The first land on the way from `from` to `to`, past START_M, or null when the line is clear. */
export async function landOnLine(from, to) {
  const length = metres(from, to);
  const n = Math.max(1, Math.ceil(length / STEP_M));
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    if (f * length < START_M) continue;
    const p = [
      from[0] + (to[0] - from[0]) * f,
      from[1] + (to[1] - from[1]) * f,
    ];
    if (!(await isWater(...p))) return p;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  const spots = JSON.parse(readFileSync(input, "utf8"));
  const out = {};
  for (const spot of spots) {
    const blocked = [];
    let cell = null;
    for (let i = 0; i < spot.cells.length; i++) {
      const land = await landOnLine([spot.lat, spot.lon], spot.cells[i]);
      if (!land) {
        cell = i;
        break;
      }
      blocked.push(land.map((v) => +v.toFixed(5)));
    }
    out[spot.id] = { cell, blocked };
  }
  writeFileSync(output, `${JSON.stringify(out)}\n`);
}
