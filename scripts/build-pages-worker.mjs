/**
 * Bundle mcp/pages/worker.ts into dist/_worker.js, the worker Cloudflare Pages
 * runs for the paths public/_routes.json names (only /api/mcp). Run by
 * `npm run build` after Vite, so the site build the release train ships
 * carries it: staging and production get the same bytes.
 *
 *   node scripts/build-pages-worker.mjs [OUTDIR]
 *
 * OUTDIR defaults to Vite's: dist, or .e2e/dist for the e2e build
 * (vite.config.ts), which serves it with `vite preview` and never runs it.
 */
import { build } from "esbuild";
import { join } from "node:path";

const out = process.argv[2] ?? (process.env.E2E_SITE ? ".e2e/dist" : "dist");

await build({
  entryPoints: ["mcp/pages/worker.ts"],
  outfile: join(out, "_worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
console.log(`${join(out, "_worker.js")}: /api/mcp for Cloudflare Pages`);
