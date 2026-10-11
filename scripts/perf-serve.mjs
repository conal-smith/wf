#!/usr/bin/env node
/**
 * Serve a built site the way production does, for performance measurement.
 *
 * `vite preview` neither compresses nor sets cache headers, so a page timed
 * against it is timed against a host nobody deploys to: every manifest arrives
 * at full size and every repeat visit re-downloads the bundle. This server
 * follows deploy/local/Caddyfile instead:
 *
 * - `/assets/*` and content-addressed data (any file inside a run directory,
 *   which is named for the hash of its content — its frames and its spot
 *   squares — or a file whose name ends in its hash) are `immutable` for a
 *   year;
 * - pointer manifests and the entry document revalidate on every load;
 * - a `.br` / `.gz` sidecar beside a file is served when the browser accepts it
 *   (Caddy's `precompressed br gzip`), and JSON, JS, CSS, HTML and SVG are
 *   compressed on the fly otherwise (Caddy's `encode zstd gzip`);
 * - unknown paths outside /weather and /marine fall back to index.html.
 *
 *   node scripts/perf-serve.mjs [--dir dist] [--port 4180]
 *
 * It is a measuring instrument, not a deployment: it holds compressed bodies
 * in memory and has no security hardening beyond refusing paths that escape
 * the served directory.
 */
import { createServer } from "node:http";
import { open, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const root = resolve(option("dir", "dist"));
const port = Number(option("port", process.env.PERF_PORT || 4180));
// The marketplace and community read /api; `--api http://127.0.0.1:8797`
// forwards it there, as `vite preview`'s proxy does.
const api = option("api", "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream",
  ".pmtiles": "application/octet-stream",
  ".webmanifest": "application/manifest+json",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
const IMMUTABLE_DATA =
  /^\/(?:weather|marine)\/(?:[a-z0-9][a-z0-9.-]*-[0-9a-f]{8}\/.+|[^/]*-[0-9a-f]{8,}\.json)$/;

/** On-the-fly encodings, memoised: the same manifest is asked for repeatedly. */
const encoded = new Map();
function encode(path, info, body, encoding) {
  // Keyed by the file's size and time too: a rebuild rewrites index.html in place.
  const key = `${path}\0${info.size}\0${info.mtimeMs}\0${encoding}`;
  let out = encoded.get(key);
  if (!out) {
    out =
      encoding === "br"
        ? brotliCompressSync(body, {
            // Caddy's default brotli level is low; 5 is a fair stand-in for a
            // CDN's on-the-fly brotli without making the first request crawl.
            params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
          })
        : gzipSync(body, { level: 6 });
    encoded.set(key, out);
  }
  return out;
}

async function file(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (api && url.pathname.startsWith("/api/")) {
    try {
      const upstream = await fetch(api + url.pathname + url.search, {
        method: request.method,
        headers: { ...request.headers, host: new URL(api).host },
        body: ["GET", "HEAD"].includes(request.method ?? "GET")
          ? undefined
          : request,
        duplex: "half",
      });
      const headers = Object.fromEntries(upstream.headers);
      delete headers["content-encoding"];
      delete headers["content-length"];
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502).end(String(error));
    }
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  const data = /^\/(?:weather|marine)\//.test(pathname);
  let target = normalize(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  let info = await file(target);
  if (!info && pathname.endsWith("/")) {
    target = join(target, "index.html");
    info = await file(target);
  }
  if (!info) {
    if (data) {
      response
        .writeHead(404, { "Content-Type": "text/plain" })
        .end("not found");
      return;
    }
    target = join(root, "index.html");
    pathname = "/index.html";
    info = await file(target);
  }
  const ext = extname(target);
  const headers = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
  };
  // As the Caddyfile has it: hashed assets and content-addressed data are
  // immutable, the entry document and the pointer manifests revalidate, and
  // anything else (riding-locations.json, the bathymetry) is sent with no
  // Cache-Control at all, which leaves the browser its heuristic.
  if (pathname.startsWith("/assets/") || IMMUTABLE_DATA.test(pathname))
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  else if (data || pathname === "/" || pathname === "/index.html")
    headers["Cache-Control"] = "max-age=0, must-revalidate";

  const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  headers.ETag = etag;
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers).end();
    return;
  }

  // Byte ranges, as Caddy's file_server answers them: PMTiles archives (the
  // bathymetry) are read a tile at a time and never downloaded whole.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const size = info.size;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    const handle = await open(target, "r");
    const slice = Buffer.alloc(end - start + 1);
    await handle.read(slice, 0, slice.length, start);
    await handle.close();
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    headers["Accept-Ranges"] = "bytes";
    headers["Content-Length"] = slice.length;
    response.writeHead(206, headers);
    response.end(request.method === "HEAD" ? undefined : slice);
    return;
  }
  headers["Accept-Ranges"] = "bytes";

  const accept = String(request.headers["accept-encoding"] ?? "");
  let body;
  for (const [encoding, suffix] of [
    ["br", ".br"],
    ["gzip", ".gz"],
  ]) {
    if (!accept.includes(encoding)) continue;
    if (await file(target + suffix)) {
      body = await readFile(target + suffix);
      headers["Content-Encoding"] = encoding;
      break;
    }
  }
  if (!body) {
    body = await readFile(target);
    if (COMPRESSIBLE.has(ext) && body.length > 1024) {
      const encoding = accept.includes("br")
        ? "br"
        : accept.includes("gzip")
          ? "gzip"
          : null;
      if (encoding) {
        body = encode(target, info, body, encoding);
        headers["Content-Encoding"] = encoding;
      }
    }
  }
  headers["Content-Length"] = body.length;
  response.writeHead(200, headers);
  response.end(request.method === "HEAD" ? undefined : body);
}).listen(port, "127.0.0.1", () => {
  console.log(`perf-serve: ${root} on http://127.0.0.1:${port}`);
});
