import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin, type Rollup } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { OWN_BUNDLE_PATHS } from "./force5/src/siteNav";

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

/**
 * Ask for the map's chunk as the page opens, on the map's paths only.
 *
 * src/main.tsx imports the map (src/App.tsx) dynamically, so that a spot page,
 * /stars or /ai never downloads it. Left at that, the map's paths would fetch
 * the entry, run it, and only then ask for the map: one more round trip than
 * the single bundle it replaced, ~90 ms on a slow 4G profile. So the page's
 * head gets a few lines that, unless the path is one of OWN_BUNDLE_PATHS,
 * preload the map's chunk, the chunks it imports and its stylesheet, beside
 * the entry. They are the same URLs, with the same `crossorigin`, that Vite's
 * own preload asks for when the import runs, so nothing is fetched twice.
 * The map's own first requests start from the entry (force5/src/boot.ts).
 */
function preloadTheMap(): Plugin {
  let base = "/";
  return {
    name: "wingfoil:preload-the-map",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        if (!bundle) return;
        const chunks = Object.values(bundle).filter(
          (c): c is Rollup.OutputChunk => c.type === "chunk",
        );
        // Rollup leaves this chunk's facadeModuleId null, so it is found by
        // what it holds.
        const app = chunks.find(
          (c) =>
            c.isDynamicEntry &&
            c.moduleIds.some((id) => id.endsWith("/src/App.tsx")),
        );
        const entry = chunks.find((c) => c.isEntry);
        if (!app || !entry) throw new Error("preloadTheMap: no map chunk");
        // What the entry already brings in statically is not the map's to ask for.
        const byName = new Map(chunks.map((c) => [c.fileName, c]));
        const reach = (from: Rollup.OutputChunk, into: Set<string>) => {
          if (into.has(from.fileName)) return;
          into.add(from.fileName);
          for (const name of from.imports) {
            const next = byName.get(name);
            if (next) reach(next, into);
          }
        };
        const loaded = new Set<string>();
        reach(entry, loaded);
        const wanted = new Set<string>();
        reach(app, wanted);
        const files = [...wanted].filter((name) => !loaded.has(name));
        const css = files.flatMap((name) => [
          ...(byName.get(name)?.viteMetadata?.importedCss ?? []),
        ]);
        const urls = [...files, ...css].map((name) => `${base}${name}`);
        const paths = OWN_BUNDLE_PATHS.map((p) => p.toString()).join(",");
        return [
          {
            tag: "script",
            injectTo: "head",
            children:
              `if(![${paths}].some(function(p){return p.test(location.pathname)}))` +
              `${JSON.stringify(urls)}.forEach(function(u){` +
              `var l=document.createElement("link");` +
              `l.crossOrigin="";l.href=u;` +
              `if(/\\.css$/.test(u)){l.rel="preload";l.as="style"}else l.rel="modulepreload";` +
              `document.head.appendChild(l)})`,
          },
        ];
      },
    },
  };
}

/**
 * The chart's static archives, which deployments read from the data host
 * (scripts/foildepth/publish.py: bathy/v…/, foildepth/v…/;
 * scripts/satellite/publish.py: satellite/v…/, intertidal/v…/), served by the
 * dev and preview servers at the same paths from `public-data/`, by range, so
 * the map works offline. They are not in `public/`, so no build ships them to
 * Pages. An archive that is not on disk (the national foilable-depth regions,
 * the satellite imagery and the intertidal heights, too large to commit) is
 * fetched from the data host in dev, range and all, when it is reachable; the
 * e2e site stages its own (scripts/e2e-site.mjs). The LiDAR layer's lidar/v…/
 * is not among them: the layer is off since 2026-10-24 (scripts/lidar/README.md).
 */
function staticData(): Plugin {
  const root = fileURLToPath(new URL("./public-data/", import.meta.url));
  const upstream =
    process.env.STATIC_DATA_UPSTREAM ?? "https://data.wingfoil.ie/";
  const middleware =
    (proxy: boolean): Connect.NextHandleFunction =>
    (req, res, next) => {
      const path = decodeURIComponent((req.url ?? "").split("?")[0]);
      const match =
        /^\/((?:foildepth|bathy|satellite|intertidal)\/v[0-9a-f]+\/[\w.-]+)$/.exec(
          path,
        );
      if (!match || (req.method !== "GET" && req.method !== "HEAD"))
        return next();
      const file = join(root, match[1]);
      if (!existsSync(file)) {
        if (!proxy || e2e) return next();
        const range = req.headers.range;
        fetch(upstream + match[1], { headers: range ? { range } : {} })
          .then(async (r) => {
            res.statusCode = r.status;
            for (const h of ["content-type", "content-range", "etag"]) {
              const v = r.headers.get(h);
              if (v) res.setHeader(h, v);
            }
            res.end(Buffer.from(await r.arrayBuffer()));
          })
          .catch(() => {
            res.statusCode = 504;
            res.end();
          });
        return;
      }
      const size = statSync(file).size;
      const ranged = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      const start = ranged ? Number(ranged[1]) : 0;
      const end = ranged?.[2] ? Math.min(Number(ranged[2]), size - 1) : size - 1;
      if (start > end) {
        res.statusCode = 416;
        res.setHeader("content-range", `bytes */${size}`);
        return res.end();
      }
      res.statusCode = ranged ? 206 : 200;
      res.setHeader(
        "content-type",
        file.endsWith(".json") ? "application/json" : "application/octet-stream",
      );
      res.setHeader("accept-ranges", "bytes");
      res.setHeader("content-length", String(end - start + 1));
      if (ranged) res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      if (req.method === "HEAD") return res.end();
      createReadStream(file, { start, end }).pipe(res);
    };
  return {
    name: "wingfoil:static-data",
    configureServer(server) {
      server.middlewares.use(middleware(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(false));
    },
  };
}

// Tailwind is configured in CSS, not here: ui/theme.css is the theme and the
// list of directories scanned for class names. There is no tailwind.config.js.
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadTheMap(), staticData()],
  publicDir: e2e ? ".e2e/public" : "public",
  build: {
    outDir: e2e ? ".e2e/dist" : "dist",
    rollupOptions: {
      output: {
        // MapLibre and React change far less often than the site: in chunks of
        // their own they stay in the browser's cache across a deploy, instead
        // of being downloaded again inside a map chunk whose hash moved.
        manualChunks(id) {
          // Code only: a stylesheet placed in a chunk is loaded with it.
          if (id.endsWith(".css")) return;
          if (id.includes("/node_modules/maplibre-gl/")) return "maplibre";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "react";
        },
      },
    },
  },
  server: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
  preview: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
});
