#!/usr/bin/env node
/**
 * The map's own canvas at three views, for comparing the foilable-depth layer
 * before and after a change: all of Ireland at z7, Dublin Bay at z12 and
 * Malahide at z13, at the same forecast hour, the wind and the lights left
 * out (they move). The pixels are read off the WebGL canvas as it renders,
 * so nothing drawn over the map is in them.
 *
 *   node scripts/perf/foil-shots.mjs --base http://127.0.0.1:4180 --out .perf/shots-after --insecure-cors
 *   npm run shots:compare -- .perf/shots-after .perf/shots-before
 *
 *   --hour N   the dock column to draw (default 6), the same on both sides
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};
const base = option("base", "https://wingfoil.ie").replace(/\/$/, "");
const out = resolve(option("out", ".perf/foil-shots"));
const hour = Number(option("hour", 6));

const VIEWS = [
  ["ireland-z7", { center: [-7.9, 53.4], zoom: 7 }],
  ["dublin-bay-z12", { center: [-6.12, 53.33], zoom: 12 }],
  ["malahide-z13", { center: [-6.145, 53.455], zoom: 13 }],
];

const browser = await chromium.launch({
  channel: "chrome",
  args: argv.includes("--insecure-cors") ? ["--disable-web-security"] : [],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  locale: "en-IE",
  timezoneId: "Europe/Dublin",
});
const page = await context.newPage();
await page.goto(base + "/");
await page.waitForFunction(
  () =>
    document.querySelectorAll(".spot-marker").length > 50 &&
    !document.querySelector(".spot-marker.pending"),
  null,
  { timeout: 90000 },
);
// The map, through React's fibers (as scripts/perf/page.mjs finds it).
await page.evaluate(() => {
  const el = document.querySelector(".maplibregl-map, .map-canvas");
  for (let node = el; node && !window.__map; node = node.parentElement) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (!key) continue;
    for (let f = node[key]; f && !window.__map; f = f.return)
      for (
        let h = f.memoizedState;
        h && typeof h === "object" && "next" in h;
        h = h.next
      ) {
        const c = h.memoizedState?.current;
        if (c && typeof c.getZoom === "function" && c.style) window.__map = c;
        else if (c?.map?.getZoom) window.__map = c.map;
      }
  }
  if (!window.__map) throw new Error("No map found.");
});
const slider = page.locator('input[aria-label="Forecast time"]');
if (!(await slider.count())) {
  // A first visit opens on the chart alone: a light brings the dock's hours.
  await page.locator(".spot-marker").first().click({ force: true });
  await slider.waitFor({ state: "attached", timeout: 30000 });
}
await slider.focus();
await page.keyboard.press("Home");
for (let i = 0; i < hour; i++) await page.keyboard.press("ArrowRight");
const at = await slider.getAttribute("aria-valuetext");
await mkdir(out, { recursive: true });
for (const [name, camera] of VIEWS) {
  const png = await page.evaluate(
    (camera) =>
      new Promise((resolve, reject) => {
        const map = window.__map;
        for (const id of map.getLayersOrder())
          if (/^wind|^focus/.test(id))
            map.setLayoutProperty(id, "visibility", "none");
        map.jumpTo(camera);
        const timer = setTimeout(() => reject(new Error("never idle")), 60000);
        map.once("idle", () => {
          clearTimeout(timer);
          // Read in the render that follows, before the buffer is cleared.
          map.once("render", () =>
            resolve(map.getCanvas().toDataURL("image/png").split(",")[1]),
          );
          map.triggerRepaint();
        });
      }),
    camera,
  );
  await writeFile(join(out, `${name}.png`), Buffer.from(png, "base64"));
  console.log(`${name}: ${at}`);
}
await writeFile(join(out, "hour.txt"), `${at}\n`);
await browser.close();
