// Screenshots of the satellite layer, off, at high tide and at low tide, at a
// few places, for a look by eye: seams, clouds, colour jumps between the two.
// Not a test.
//
//   npm run preview:e2e -- --port 4392 &
//   node scripts/satellite/shots.mjs http://127.0.0.1:4392 /Volumes/workdrive/satellite/shots \
//     kilcrea:1 bull-island-north:1 rusheen:0 brandon:0 ballyhornan:0 ireland:0
//
// Each place is a spot id (or "ireland": the chart as it opens) and how many
// times to zoom in past where the spot opens. The foil layer is off, so the
// image is what is seen. The site's own satellite index is used unless
// SATELLITE_INDEX names one (e.g. public/satellite/index.json, the national
// set), whose archives are then read from DATA_BASE (default the data host):
// that is how the e2e site, which serves only the small offline set, shows
// the whole country.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [base = "http://127.0.0.1:5173", out = "shots", ...places] =
  process.argv.slice(2);
const indexFile = process.env.SATELLITE_INDEX;
const dataBase = process.env.DATA_BASE ?? "https://data.wingfoil.ie/";
const index = indexFile ? JSON.parse(readFileSync(indexFile, "utf8")) : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const place of places.length ? places : ["kilcrea:1"]) {
  const [spot, zooms = "0"] = place.split(":");
  for (const option of ["off", "high", "low"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    if (index) {
      await page.route("**/satellite/index.json", (route) =>
        route.fulfill({ json: index }),
      );
      await page.route(`**/${index.base}*`, async (route) => {
        const name = new URL(route.request().url()).pathname.split("/").pop();
        const response = await route.fetch({
          url: `${dataBase}${index.base}${name}`,
        });
        await route.fulfill({ response });
      });
    }
    await page.addInitScript((satellite) => {
      localStorage.setItem(
        "wingfoil.map.layers.v1",
        JSON.stringify({ foil: false, satellite }),
      );
    }, option);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spot === "ireland" ? `${base}/` : `${base}/?spot=${spot}`);
    await page
      .locator(".map-loading")
      .waitFor({ state: "detached", timeout: 60000 });
    // The flight to the spot, then the focus out of the way.
    await page.waitForTimeout(spot === "ireland" ? 1500 : 4000);
    if (spot !== "ireland") await page.keyboard.press("Escape");
    for (let i = 0; i < Number(zooms); i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.waitForTimeout(700);
    }
    await page.addStyleTag({
      content: ".particle-canvas, .map-pen { visibility: hidden !important; }",
    });
    // Every tile in: the network quiet for a while.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);
    const file = `${out}/${spot}-${option}.png`;
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
}
await browser.close();
