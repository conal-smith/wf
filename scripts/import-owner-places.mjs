// Rewrite data/locations/owner-places.json from the owner's spot editor.
//
//   npm run spots:owner -- /path/to/wingfoil-spot-editor/corrections.json
//   npm run spots:owner -- corrections.json --offline   (no county lookup)
//
// then npm run spots:export and npm run spots:facing, as for any change to the
// place list. The editor's file is { spots: { <public id>: { status, lat, lon,
// note } }, added: [{ id: "new-…", name, county, lat, lon, note }] }.
//
// A move, an `ok` or a `remove` is kept by the public id it names; `todo` is
// the owner's own reminder and is left out. An added place gets a clean slug id
// from its name, and the editor's id it came from is stored with it, so the
// next import gives the same added place the same slug however it is renamed.
// The editor guesses an added place's county from the nearest spot, which is
// wrong at a county line, so the county is looked up instead, from the
// OpenStreetMap county boundaries: Nominatim's address for the point (the
// Republic's admin_level 6 counties), else Overpass for the county boundary the
// point is in or, on the water outside every polygon, the nearest one (which
// also covers Northern Ireland's six, mapped as historic boundaries).
// A place whose position has not changed keeps the county already recorded,
// once it has been looked up; an unchecked guess is looked up again.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const target = `${root}data/locations/owner-places.json`;
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const input = args.find((arg) => !arg.startsWith("--"));
if (!input) {
  console.error("Usage: npm run spots:owner -- <corrections.json> [--offline]");
  process.exit(2);
}

const editor = JSON.parse(readFileSync(input, "utf8"));
const previous = existsSync(target)
  ? JSON.parse(readFileSync(target, "utf8"))
  : { overrides: {}, records: [] };
const readJson = (path) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));

/** Ids the owner's own added places must not take: every id the map has held. */
const ownIds = new Set(previous.records.map((record) => record.id));
const publicPlaces = readJson("public/riding-locations.json").filter(
  (place) => !ownIds.has(place.id),
);
const taken = new Set([
  ...publicPlaces.map((place) => place.id),
  ...readJson("public/spots.json").map((spot) => spot.id),
  ...readdirSync(`${root}data/locations`)
    .filter((file) => file.endsWith(".json") && file !== "owner-places.json")
    .flatMap((file) => readJson(`data/locations/${file}`).records ?? [])
    .map((record) => record.id),
]);

const NORTHERN_IRELAND = new Set([
  "Antrim",
  "Armagh",
  "Derry",
  "Down",
  "Fermanagh",
  "Tyrone",
]);
const round = (value) => +Number(value).toFixed(6);

// ---- overrides, by public id -------------------------------------------
const overrides = {};
for (const [id, entry] of Object.entries(editor.spots ?? {})) {
  if (!["moved", "ok", "remove"].includes(entry.status)) continue;
  // A place an earlier import removed is no longer exported, but is still one.
  const known =
    id in (previous.overrides ?? {}) ||
    publicPlaces.some((place) => place.id === id);
  if (!known)
    throw new Error(`${id}: the editor names a place the map does not hold`);
  const override = { status: entry.status };
  if (entry.status === "moved") {
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon))
      throw new Error(`${id}: moved without a coordinate`);
    override.lat = round(entry.lat);
    override.lon = round(entry.lon);
  }
  if (entry.note?.trim()) override.note = entry.note.trim();
  overrides[id] = override;
}

// ---- county lookup -------------------------------------------------------
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const COUNTY =
  '[boundary~"^(administrative|historic)$"][admin_level=6][name~"^County "]';
async function overpass(query) {
  let failure;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(OVERPASS[attempt % OVERPASS.length], {
        method: "POST",
        headers: { "User-Agent": "wingfoil.ie owner-places import" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) return (await response.json()).elements;
      failure = new Error(`Overpass answered ${response.status}`);
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw failure;
}
const countyName = (tags) =>
  tags.name
    .replace(/^County /, "")
    .replace(/^Londonderry$/, "Derry")
    .trim();
function metres(lat, lon, a, b) {
  // Point to segment, on a local flat projection: plenty for a few kilometres.
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const [ax, ay] = [(a.lon - lon) * kx, (a.lat - lat) * ky];
  const [bx, by] = [(b.lon - lon) * kx, (b.lat - lat) * ky];
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(
    0,
    Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(ax + t * dx, ay + t * dy);
}
async function nominatimCounty(lat, lon) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&zoom=18&format=jsonv2`,
    {
      headers: { "User-Agent": "wingfoil.ie owner-places import" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  // Nominatim's usage policy: at most one request a second.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  if (!response.ok) return undefined;
  const county = (await response.json()).address?.county ?? "";
  return /^County /.test(county) ? countyName({ name: county }) : undefined;
}
async function lookupCounty(lat, lon) {
  const named = await nominatimCounty(lat, lon).catch(() => undefined);
  if (named) return { county: named, how: "Nominatim" };
  const inside = await overpass(
    `[out:json][timeout:90];is_in(${lat},${lon})->.a;area.a${COUNTY};out tags;`,
  );
  if (inside.length) return { county: countyName(inside[0].tags), how: "in" };
  // On the water, below the coastline every county polygon stops at: the
  // county whose boundary passes nearest. One candidate settles it; two (a
  // place near a county line) are told apart by their boundary lines.
  for (const radius of [1500, 5000, 15000]) {
    const around = `around:${radius},${lat},${lon}`;
    const near = await overpass(
      `[out:json][timeout:90];rel(${around})${COUNTY};out tags;`,
    );
    if (near.length === 1)
      return { county: countyName(near[0].tags), how: `within ${radius} m` };
    if (!near.length) continue;
    let best;
    for (const relation of near) {
      const ways = await overpass(
        `[out:json][timeout:120];rel(${relation.id});way(r)(${around});out geom;`,
      );
      for (const way of ways)
        for (let i = 1; i < (way.geometry?.length ?? 0); i++) {
          const distance = metres(
            lat,
            lon,
            way.geometry[i - 1],
            way.geometry[i],
          );
          if (!best || distance < best.distance)
            best = { county: countyName(relation.tags), distance };
        }
    }
    if (best)
      return { county: best.county, how: `${Math.round(best.distance)} m` };
  }
  return undefined;
}

// ---- added places --------------------------------------------------------
const slugOf = (name) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const used = new Set(taken);
const records = [];
for (const added of editor.added ?? []) {
  const before = previous.records.find(
    (record) => record.editorId === added.id,
  );
  const lat = round(added.lat);
  const lon = round(added.lon);
  let id = before?.id;
  if (!id) {
    const base = slugOf(added.name);
    id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  } else if (used.has(id))
    throw new Error(`${added.name}: its id ${id} is now another place's`);
  used.add(id);

  let county = before?.county;
  let countySource = before?.countySource;
  if (
    !before ||
    before.lat !== lat ||
    before.lon !== lon ||
    before.countySource !== "osm-county-boundary"
  ) {
    const found = offline
      ? undefined
      : await lookupCounty(lat, lon).catch((error) => {
          console.warn(
            `${added.name}: county lookup failed (${error.message})`,
          );
          return undefined;
        });
    if (found) {
      county = found.county;
      countySource = "osm-county-boundary";
      const guess = added.county ? ` (editor guessed ${added.county})` : "";
      console.log(`${added.name}: Co. ${county}, ${found.how}${guess}`);
    } else {
      county = added.county;
      countySource = "editor-guess";
      console.warn(
        `${added.name}: county not looked up; keeping the editor's guess, ${county}. Check it.`,
      );
    }
  }
  records.push({
    id,
    editorId: added.id,
    // The site writes a place and its area with a spaced em dash.
    name: added.name.trim().replace(/ +[-–] +/g, " — "),
    county,
    countySource,
    jurisdiction: NORTHERN_IRELAND.has(county) ? "UK-NI" : "IE",
    lat,
    lon,
    kind: "spot",
    coordinateType: "owner-surveyed",
    waterType: before?.waterType ?? "sea",
    sports: before?.sports ?? ["wingfoiling"],
    aliases: before?.aliases ?? [],
    note: added.note?.trim() ?? "",
  });
}

writeFileSync(
  target,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      source: "wingfoil.ie site owner",
      note: "Positions placed by the site's owner from their own knowledge of riding these places, not copied from any guide or map. They win over every other coordinate for the same id. `overrides` holds the owner's moves (`moved`, with lat/lon), confirmations (`ok`) and removals (`remove`) of public places by id; `records` holds places the owner added, each keyed to the editor id it came from (`editorId`) so a re-import keeps its slug. Written by `npm run spots:owner`; edit the owner's spot editor rather than this file.",
      licence: "AGPL-3.0-only",
      editorUpdatedAt: editor.updatedAt ?? null,
      overrides,
      records,
    },
    null,
    2,
  )}\n`,
);

// ---- flag, don't decide: an added place close to a public one ------------
const NEAR_M = 700;
const where = publicPlaces
  .filter((place) => overrides[place.id]?.status !== "remove")
  .map((place) => ({ ...place, ...(overrides[place.id] ?? {}) }));
records.forEach((record, index) => {
  // Each pair once: the public places, then the added ones before this one.
  for (const place of [...where, ...records.slice(0, index)]) {
    const distance = metres(record.lat, record.lon, place, place);
    if (distance < NEAR_M)
      console.warn(
        `Check: ${record.name} (${record.id}) is ${Math.round(distance)} m from ${place.name} (${place.id}). Same place?`,
      );
  }
});

const counts = Object.values(overrides).reduce(
  (sum, o) => ({ ...sum, [o.status]: (sum[o.status] ?? 0) + 1 }),
  {},
);
console.log(
  `Wrote data/locations/owner-places.json: ${Object.entries(counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(
      ", ",
    )}, ${records.length} added. Now npm run spots:export and npm run spots:facing.`,
);
