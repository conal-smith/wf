/**
 * Write OUTDIR/sitemap.xml: the map, /stars, /ai and every riding place's
 * page, at the address search engines are to know them by (mcp/pages/head.ts
 * `SITE`, the same as each page's canonical link). Run by `npm run build`
 * after Vite, from public/riding-locations.json, so the list is the places
 * this build has. public/robots.txt names it.
 *
 *   node scripts/build-sitemap.mjs [OUTDIR]
 *
 * OUTDIR defaults to Vite's: dist, or .e2e/dist for the e2e build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITE = "https://wingfoil.ie";
const out = process.argv[2] ?? (process.env.E2E_SITE ? ".e2e/dist" : "dist");

const places = JSON.parse(
  readFileSync(
    new URL("../public/riding-locations.json", import.meta.url),
    "utf8",
  ),
);
const paths = [
  "/",
  "/stars",
  "/ai",
  ...places.map((place) => `/spot/${encodeURIComponent(place.id)}`),
];
const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...paths.map((path) => `  <url><loc>${escape(SITE + path)}</loc></url>`),
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(out, "sitemap.xml"), xml);
console.log(`${join(out, "sitemap.xml")}: ${paths.length} pages`);
