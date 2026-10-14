#!/usr/bin/env node
/**
 * Cuts every app icon from the site's own mark (public/favicon.svg, the
 * puffin on paper) so the app and the site never drift apart:
 *
 *   assets/brand/icon.png                1024², production
 *   assets/brand/icon-staging.png        1024², a magenta STAGING band
 *   assets/brand/icon-development.png    1024², an ink DEV band
 *   assets/brand/adaptive-foreground.png 1024², the puffin in Android's safe zone
 *   assets/brand/adaptive-monochrome.png 1024², the puffin in one ink, for themed icons
 *   assets/brand/splash.png              512², the puffin alone
 *   assets/brand/notification-icon.png   96², white on clear (Android's status bar)
 *
 * Rendered by the Chromium the site's Playwright already installs:
 *   npm run brand:icons        (from mobile/; needs the root's npm ci)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, "..");
const repo = join(mobile, "..");
const out = join(mobile, "assets", "brand");
mkdirSync(out, { recursive: true });

const require = createRequire(join(repo, "package.json"));
const { chromium } = require("@playwright/test");

const favicon = readFileSync(join(repo, "public", "favicon.svg"), "utf8");
// The puffin's own group, without the favicon's frame and ground.
const puffin = favicon.match(/<g transform="[^"]+">[\s\S]*?<\/g>(?=<\/g>)/)[0];

const PAPER = "#f3eee3";
const INK = "#1a1d21";
const MAGENTA = "#b0186a";

/** The puffin inside a 64-unit box, scaled about its centre. */
const bird = (scale, fill) => {
  const body = fill
    ? puffin.replace(/fill="#[0-9a-f]{6}"/gi, `fill="${fill}"`).replace(/stroke="#[0-9a-f]{6}"/gi, `stroke="${fill}"`)
    : puffin;
  return `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)"><clipPath id="c"><rect x="4" y="4" width="56" height="56"/></clipPath><g clip-path="url(#c)">${body}</g></g>`;
};

const band = (label, colour) =>
  `<rect x="0" y="48" width="64" height="16" fill="${colour}"/>` +
  `<text x="32" y="59.2" text-anchor="middle" font-family="IBM Plex Mono, Menlo, monospace" font-weight="600" font-size="7.4" letter-spacing="1.4" fill="${PAPER}">${label}</text>`;

const square = (inner, ground = PAPER) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${ground}"/>${inner}</svg>`;

const clear = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`;

const icons = [
  ["icon.png", 1024, square(bird(1))],
  ["icon-staging.png", 1024, square(bird(1) + band("STAGING", MAGENTA))],
  ["icon-development.png", 1024, square(bird(1) + band("DEV", INK))],
  // Android shows the middle two thirds of an adaptive icon: at 0.85 the
  // favicon's own crop falls outside that, so no straight edge shows.
  ["adaptive-foreground.png", 1024, clear(bird(0.85))],
  ["adaptive-monochrome.png", 1024, clear(bird(0.85, "#000000"))],
  ["splash.png", 512, clear(bird(1))],
  ["notification-icon.png", 96, clear(bird(1.05, "#ffffff"))],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, svg] of icons) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`brand:icons ${name} ${size}²`);
  }
} finally {
  await browser.close();
}
