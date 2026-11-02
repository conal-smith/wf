/**
 * The AI apps' spot card (mcp/app/spotCard.ts) as one HTML file: its code
 * bundled with esbuild, its styles, and the site's colours from ui/theme.css,
 * light and dark, written into mcp/app/spotCard.generated.ts as a string the
 * MCP server serves (mcp/api/server.ts). A string in a module rather than a
 * file beside it, so the Pages worker and the Node API both carry it with no
 * file to read.
 *
 *   node scripts/mcp-card/build.mjs           write it
 *   node scripts/mcp-card/build.mjs --check   fail if it is out of date
 *
 * The check runs in the unit tests (mcp/app/card.test.ts).
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(REPO, "mcp/app/spotCard.generated.ts");

/** The card's names for the site's colours, and the theme's names for them. */
const COLOURS = {
  ground: "color-ground",
  sunken: "color-sunken",
  line: "color-line",
  ink: "color-ink",
  "ink-2": "color-ink-2",
  "ink-muted": "color-ink-muted",
  magenta: "color-chart-magenta",
  sea: "color-sea-1",
  "on-wind": "color-photo-shade",
  "stars-1": "color-stars-1",
  "stars-2": "color-stars-2",
  "stars-3": "color-stars-3",
  "stars-4": "color-stars-4",
  "stars-5": "color-stars-5",
};

/** Every `--name: value;` in the theme's blocks that open with `opening`. */
function declared(css, opening) {
  const out = {};
  let at = 0;
  for (;;) {
    const start = css.indexOf(opening, at);
    if (start < 0) return out;
    const end = css.indexOf("\n}", start);
    for (const [, name, value] of css
      .slice(start, end)
      .matchAll(/^\s+--([\w-]+):\s*([^;]+);/gm))
      out[name] = value.trim();
    at = end;
  }
}

/** The card's colours as custom properties, light then dark. */
function colours() {
  const css = readFileSync(join(REPO, "ui/theme.css"), "utf8");
  const light = declared(css, "@theme static {");
  const dark = { ...light, ...declared(css, ':root[data-theme="dark"] {') };
  const block = (values) =>
    Object.entries(COLOURS)
      .map(([ours, theirs]) => {
        if (!values[theirs]) throw new Error(`ui/theme.css has no --${theirs}`);
        return `--${ours}:${values[theirs]}`;
      })
      .join(";");
  return `:root{${block(light)}}:root[data-theme="dark"]{${block(dark)}}`;
}

/** The whole card, as the HTML the app's frame loads. */
export async function spotCardHtml() {
  const bundle = await build({
    entryPoints: [join(REPO, "mcp/app/spotCard.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    logLevel: "warning",
  });
  const code = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const styles = await build({
    entryPoints: [join(REPO, "mcp/app/spotCard.css")],
    bundle: true,
    write: false,
    minify: true,
    logLevel: "warning",
  });
  const css = colours() + styles.outputFiles[0].text;
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>wingfoil.ie spot forecast</title><style>${css}</style></head>` +
    `<body><main id="card" aria-live="polite"></main><script>${code}</script></body></html>`
  );
}

/** The module the server imports. */
export async function spotCardModule() {
  const html = await spotCardHtml();
  return `/**
 * The AI apps' spot card as one HTML file, written by
 * scripts/mcp-card/build.mjs from mcp/app/spotCard.ts, spotCard.css and
 * ui/theme.css. Do not edit; run \`npm run mcp:card\`.
 */
export const SPOT_CARD_HTML = ${JSON.stringify(html)};
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const module = await spotCardModule();
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== module) {
      console.error(
        "mcp/app/spotCard.generated.ts is out of date: run npm run mcp:card",
      );
      process.exit(1);
    }
    console.log("mcp/app/spotCard.generated.ts is current");
  } else {
    writeFileSync(OUT, module);
    console.log(
      `mcp/app/spotCard.generated.ts: ${(module.length / 1024).toFixed(0)} KB`,
    );
  }
}
