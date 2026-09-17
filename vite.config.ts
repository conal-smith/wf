import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The e2e build is a site of its own, served from a scratch tree.
 *
 * `public/weather` is ingest output and in a working checkout it holds the
 * owner's real forecast runs. The e2e suite must neither read nor write it, so
 * when E2E_SITE is set the public directory is `.e2e/public` — staged by
 * scripts/e2e-site.mjs from the committed files in `public/` plus freshly
 * generated synthetic weather — and the bundle is written to `.e2e/dist`.
 * Nothing in that build path opens `public/weather` at all, so real data can
 * neither leak into the served site nor be overwritten by the sample generator.
 */
// Declared here rather than pulling @types/node in for one lookup; the config
// runs in Node, and nothing else in the typed sources touches `process`.
declare const process: { env: Record<string, string | undefined> };
const e2e = Boolean(process.env.E2E_SITE);

// In development the marketplace API runs as its own process (npm run
// market:api); proxying /api keeps the browser on one origin so no CORS or
// VITE_MARKET_API_URL is needed locally.
const marketApi = process.env.MARKET_API_PROXY ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  publicDir: e2e ? ".e2e/public" : "public",
  build: { outDir: e2e ? ".e2e/dist" : "dist" },
  server: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
  preview: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
});
