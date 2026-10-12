// Screenshots of the satellite layer, off, at high tide and at low tide, at a
// few places, for a look by eye: seams, clouds, colour jumps between the two.
// Not a test: it needs a running app whose satellite index reaches the
// imagery (the dev server proxies the data host's archives).
//
//   npm run dev -- --port 5197 &
//   node scripts/satellite/shots.mjs http://127.0.0.1:5197 /Volumes/workdrive/satellite/shots \
//     kilcrea:2 bull-island-north:2 rusheen:1 brandon:0 ballyhornan:1 ireland:0
//
// Each place is a spot id (or "ireland": the chart as it opens) and how many
// times to zoom in past where the spot opens. The foil layer is off, so the
// image is what is seen.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [base = "http://127.0.0.1:5173", out = "shots", ...places] =
  process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const place of places.length ? places : ["kilcrea:2"]) {
  const [spot, zooms = "0"] = place.split(":");
  for (const option of ["off", "high", "low"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
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
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape"); // the focus, out of the way
    for (let i = 0; i < Number(zooms); i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.waitForTimeout(500);
    }
    await page.addStyleTag({
      content: ".particle-canvas, .map-pen { visibility: hidden !important; }",
    });
    // Every tile in: the network quiet for a while.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);
    const file = `${out}/${spot}-${option}.png`;
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
}
await browser.close();
