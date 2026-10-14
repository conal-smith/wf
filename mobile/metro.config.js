/**
 * The app reads the forecast exactly as the site does: the stars, the blend,
 * the tides, the tile decoder and the indexes are the site's own modules
 * (force5/src, src, spot/web, mcp/api), imported from the repository root.
 *
 * Two things differ from the site's Vite build:
 *  - the site's two seams onto the browser resolve to the app's own: urls.ts
 *    (the data host, read from <meta>) and pageLife.ts (the tab in front, read
 *    from the document) become src/config/urls.ts and src/config/pageLife.ts.
 *  - packages resolve from mobile/node_modules only, so the site's React DOM
 *    and MapLibre GL never reach the bundle.
 */
const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const mobile = __dirname;
const repo = path.resolve(mobile, "..");

const config = getDefaultConfig(mobile);

config.watchFolders = [
  path.join(repo, "force5", "src"),
  path.join(repo, "src"),
  path.join(repo, "shared"),
  path.join(repo, "spot", "web"),
  path.join(repo, "mcp", "api"),
  path.join(repo, "ai", "web"),
  path.join(repo, "alerts", "shared"),
  path.join(repo, "data", "locations"),
  path.join(repo, "public"),
].filter((dir) => fs.existsSync(dir));
// The site's files sit above mobile/, so a package they import would be found
// in the repository's own node_modules first: that tree is hidden from Metro,
// and they fall through to the app's.
config.resolver.nodeModulesPaths = [path.join(mobile, "node_modules")];
const escape = (dir) => dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escape(path.join(repo, "node_modules"))}/.*`),
];

const SEAMS = new Map(
  ["urls.ts", "pageLife.ts"].map((file) => [
    path.join(repo, "force5", "src", file),
    path.join(mobile, "src", "config", file),
  ]),
);

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  let resolved;
  try {
    resolved = resolve(context, moduleName, platform);
  } catch (error) {
    // The site's ESM imports name a TypeScript file by its output, "./x.js".
    if (!/^\.\.?\/.*\.js$/.test(moduleName)) throw error;
    resolved = resolve(context, moduleName.slice(0, -3), platform);
  }
  const seam = resolved.type === "sourceFile" && SEAMS.get(resolved.filePath);
  return seam ? { type: "sourceFile", filePath: seam } : resolved;
};

// Cold start: modules are required when first used, not all at launch.
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: false, inlineRequires: true },
});

module.exports = config;
