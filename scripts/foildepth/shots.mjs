// Screenshots of the foilable-depth layer at low, mid and high water, for a
// look by eye against what the estuary does. Not a test: it needs the real
// forecast and tide data (public/weather, public/marine) and a running app.
//
//   npm run dev -- --port 5197 &
//   node scripts/foildepth/shots.mjs http://127.0.0.1:5197 /tmp/wf-foildepth/shots kilcrea 2
//
// Arguments: the app's URL, the output folder, a spot to centre on, and how
// many times to zoom in past the spot's own zoom.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [
  base = "http://127.0.0.1:5173",
  out = "shots",
  spot = "kilcrea",
  zooms = "2",
  now,
] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
// An optional fifth argument pins the page's clock (ISO time), so that a
// stale local forecast still has its hourly columns.
if (now) await page.clock.setFixedTime(new Date(now));
await page.addInitScript(() => {
  localStorage.setItem(
    "wingfoil.map.layers.v1",
    JSON.stringify({
      tints: true,
      soundings: true,
      relief: true,
      names: true,
      foil: true,
    }),
  );
});
await page.goto(`${base}/?spot=${spot}`);
const scrub = page.getByRole("slider", { name: "Forecast time" });
await scrub.waitFor({ timeout: 30000 });
// The chart up before anything moves it: "Drawing the chart…" gone.
await page
  .locator(".map-loading")
  .waitFor({ state: "detached", timeout: 60000 });
await page.waitForTimeout(3500); // the flight to the spot
await page.keyboard.press("Escape"); // the focus, out of the way
for (let i = 0; i < Number(zooms); i++) {
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(600);
}

// The key is in the map's information dialog, not on the chart: open it,
// read it, and shut it again so the chart is clear for the next move.
const readKey = async (read) => {
  await page.getByRole("button", { name: "Map information" }).click();
  const key = page.locator(".foil-at");
  await key.waitFor();
  const value = await read(key);
  await page.keyboard.press("Escape");
  await page.locator(".map-info").waitFor({ state: "detached" });
  return value;
};

// The tide the key reports at each of the next day's columns.
const tideAt = async (i) => {
  await scrub.fill(String(i));
  await page.waitForTimeout(250);
  const v = await readKey((key) => key.getAttribute("data-foil-tide"));
  return v === null || v === "" ? null : Number(v);
};
const first = Number(await scrub.inputValue());
const max = Number(await scrub.getAttribute("max"));
const seen = [];
// The far columns are hours apart, near a tide's half period: look a few
// days ahead so that a mid-tide hour turns up too.
for (let i = first; i <= max; i++) {
  const t = await tideAt(i);
  if (t !== null) seen.push({ i, t });
}
if (!seen.length)
  throw new Error("No tide in the key: is public/marine there?");
const soon = seen.filter(({ i }) => i <= first + 12);
const low = (soon.length ? soon : seen).reduce((a, b) => (b.t < a.t ? b : a));
const high = (soon.length ? soon : seen).reduce((a, b) => (b.t > a.t ? b : a));
const midT = (low.t + high.t) / 2;
const mid = seen.reduce((a, b) =>
  Math.abs(b.t - midT) < Math.abs(a.t - midT) ? b : a,
);

for (const [name, at] of [
  ["low", low],
  ["mid", mid],
  ["high", high],
]) {
  await scrub.fill(String(at.i));
  await page.waitForTimeout(2500); // tiles, and the ramp
  const key = await readKey((at) => at.innerText());
  const file = `${out}/${spot}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`${name}: ${key} → ${file}`);
}

// TAP=x,y: tap the water there at the last hour and keep what the key says.
if (process.env.TAP) {
  const [x, y] = process.env.TAP.split(",").map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(1000);
  const file = `${out}/${spot}-tap.png`;
  await page.screenshot({ path: file });
  const probe = await readKey(async () => {
    const at = page.locator(".foil-probe");
    await at.waitFor({ timeout: 10000 });
    return at.innerText();
  });
  console.log(`tap: ${probe} → ${file}`);
}
await browser.close();
