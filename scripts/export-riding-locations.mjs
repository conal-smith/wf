// Write public/riding-locations.json: the public riding places the ingest adapters
// precompute spot series for. Vite loads the real TypeScript merge, so the browser
// and the Python pipeline can never disagree about ids or coordinates.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("..", import.meta.url).pathname;
const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "warn",
  server: { middlewareMode: true },
  // Nothing is served to a browser, so skip the browser dependency pre-bundle.
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { ridingLocations } = await server.ssrLoadModule("/src/locations.ts");
  const original = JSON.parse(readFileSync(`${root}public/spots.json`, "utf8"));
  const places = ridingLocations(original).map(
    ({ id, name, county, lat, lon }) => ({ id, name, county, lat, lon }),
  );
  if (new Set(places.map((place) => place.id)).size !== places.length)
    throw new Error("Duplicate riding-location id");
  for (const spot of original) {
    const place = places.find((candidate) => candidate.id === spot.id);
    if (!place || place.lat !== spot.lat || place.lon !== spot.lon)
      throw new Error(`Original spot ${spot.id} lost its id or coordinate`);
  }
  writeFileSync(
    `${root}public/riding-locations.json`,
    `${JSON.stringify(places, null, 2)}\n`,
  );
  console.log(
    `Wrote public/riding-locations.json: ${places.length} riding places`,
  );
} finally {
  await server.close();
}
