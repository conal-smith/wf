/**
 * Write the Caddyfile lines that name every riding place's page, for the
 * self-hosted site image (deploy/local/Dockerfile.web): Caddy cannot read
 * riding-locations.json itself, so the image is built with the list beside
 * its Caddyfile, which imports it into the matcher for a spot page with no
 * place behind it. That page is answered 404, as the Pages worker answers it
 * in production (mcp/pages/worker.ts, head.ts `isMissingSpot`).
 *
 *   node scripts/caddy-spot-paths.mjs OUTFILE
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: caddy-spot-paths.mjs OUTFILE");

const places = JSON.parse(
  readFileSync(
    new URL("../public/riding-locations.json", import.meta.url),
    "utf8",
  ),
);
const paths = places.flatMap(({ id }) => {
  // A Caddyfile token is cut at whitespace and braces: an id that needs
  // quoting is not one the site makes (scripts/import-owner-places.mjs).
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`unexpected spot id "${id}"`);
  return [`/spot/${id}`, `/spot/${id}/`];
});
writeFileSync(
  out,
  `# Written by scripts/caddy-spot-paths.mjs: every riding place's page.\n` +
    `not path ${paths.join(" ")}\n`,
);
console.log(`${out}: ${places.length} places`);
