import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * Met Éireann's warnings on the site (force5/src/warnings.ts): the spot page's
 * list and its rows, and the dock's strip and star cells, for a warning of
 * each level at Brandon Bay, and nothing but the link to met.ie from a file
 * too old to trust. The warnings file is routed in, as the tides are in
 * spot-page.spec.ts: `public/marine` is ingest output, never part of the e2e
 * site. SAMPLE_CLOCK is 21:00 UTC on 13 Sept, so tomorrow is daylight.
 *
 * WARNING_SHOTS=<dir> also saves a screenshot of each view there.
 */

const HOUR = 3600000;
const clock = SAMPLE_CLOCK.getTime();
const at = (hours: number) => new Date(clock + hours * HOUR).toISOString();
/** Tomorrow, 14 Sept, at an hour UTC. */
const tomorrow = (hour: number) => at(3 + hour);

const warning = (fields: Record<string, unknown>) => ({
  id: 1,
  type: "Wind",
  severity: "Moderate",
  certainty: "Likely",
  status: "Warning",
  issued: at(-10),
  updated: at(-10),
  description:
    "<p>Southwest winds veering westerly will reach gale force 8 or higher at times.&nbsp;</p><ul><li>Large coastal waves</li></ul>",
  ...fields,
});

const WARNINGS = [
  warning({
    capId: "test.yellow",
    type: "small-craft",
    level: "yellow",
    headline: "Small Craft warning for all coasts of Ireland",
    onset: tomorrow(8),
    expiry: tomorrow(11),
    regions: ["EI816", "EI817", "EI818"],
  }),
  warning({
    capId: "test.orange",
    level: "orange",
    severity: "Severe",
    headline: "Status Orange - Wind warning for Kerry",
    onset: tomorrow(12),
    expiry: tomorrow(15),
    regions: ["EI11"],
  }),
  warning({
    capId: "test.red",
    type: "Violent Storm",
    level: "red",
    severity: "Extreme",
    headline:
      "Status Red - Marine Violent Storm warning from Valentia to Loop Head",
    onset: at(27 + 10),
    expiry: at(27 + 13),
    regions: ["EI817"],
  }),
];

const file = (runTime: string) => ({
  schemaVersion: 1,
  kind: "warnings",
  model: "warnings",
  run: runTime.slice(0, 13).replace(/[-T]/g, ""),
  runTime,
  generatedAt: runTime.replace(":00.000Z", ":25.000Z"),
  sourceUrl: "https://www.met.ie/Open_Data/json/warning_ALL.json",
  attribution: "Weather warnings from Met Éireann (met.ie), CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  warnings: WARNINGS,
});

/** The file as the hourly job left it: read at :25 of the hour before the clock. */
const fresh = () =>
  file(new Date(clock - HOUR).toISOString().slice(0, 14) + "00:00.000Z");

async function withWarnings(page: Page, body: unknown) {
  await page.route("**/marine/warnings.json", (route) =>
    route.fulfill({ json: body }),
  );
}

async function shot(page: Page, name: string) {
  const dir = process.env.WARNING_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true });

/** The row of an hour on the spot page, by its instant. */
const row = (page: Page, iso: string) =>
  page.locator(`tr[data-hour="${new Date(iso).toISOString()}"]`);

test("a spot page lists its warnings, and orange and red stand in for the stars", async ({
  page,
}) => {
  await withWarnings(page, fresh());
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });

  const panel = page.locator("[data-warnings]");
  await expect(
    panel.getByRole("heading", { name: "Met Éireann warnings" }),
  ).toBeVisible();
  // Highest level first, a line each: its level, Met Éireann's headline
  // without the "Status Red - " its mark already says, and its validity in
  // Irish time. Its kind and Met Éireann's words fold underneath.
  await expect(panel.locator("[data-warning]")).toHaveCount(3);
  const items = panel.locator("[data-warning]");
  const headlines = panel.locator("[data-warning-headline]");
  await expect(items.nth(0)).toHaveAttribute("data-warning", "red");
  await expect(headlines.nth(0)).toHaveText(
    "Marine Violent Storm warning from Valentia to Loop Head",
  );
  await expect(items.nth(1)).toHaveAttribute("data-warning", "orange");
  await expect(headlines.nth(1)).toHaveText("Wind warning for Kerry");
  await expect(items.nth(1)).toContainText(
    /Mon 14 Sept? 13:00 – Mon 14 Sept? 16:00/,
  );
  await expect(items.nth(2)).toHaveAttribute("data-warning", "yellow");
  await expect(headlines.nth(2)).toHaveText(
    "Small Craft warning for all coasts of Ireland",
  );
  await expect(items.nth(1).locator("time").first()).toHaveAttribute(
    "datetime",
    tomorrow(12),
  );
  // What a warning does to the stars, said once for the list.
  const rule = panel.locator("[data-warnings-rule]");
  await expect(rule).toContainText(
    "Yellow: the stars still show beside it; see whether it bears on the water.",
  );
  await expect(rule).toContainText(
    "Orange and red: no stars for the hours they cover.",
  );
  await expect(panel.getByText(/stars still show/)).toHaveCount(1);
  // The kind and the description, every word kept, folded underneath.
  const words = items.nth(1).getByText("• Large coastal waves");
  await expect(words).toBeHidden();
  await items.nth(1).locator("summary").click();
  await expect(items.nth(1).getByText(/^Wind warning: /)).toBeVisible();
  await expect(words).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "The latest at met.ie" }),
  ).toHaveAttribute("href", "https://www.met.ie/warnings");
  await shot(page, "spot-page-warnings");

  // Orange: the mark where the stars were, for each hour it covers.
  for (const hour of [12, 13, 14]) {
    const cell = row(page, tomorrow(hour)).locator("[data-hour-warning]");
    await expect(cell).toHaveAttribute("data-hour-warning", "orange");
    await expect(cell).not.toHaveAttribute("data-stars");
    await expect(cell.locator('[data-warning-mark="orange"]')).toBeVisible();
    await expect(cell.getByRole("img", { name: /of 5 stars/ })).toHaveCount(0);
  }
  // Yellow: the stars stay, with its mark beside them.
  for (const hour of [8, 9, 10]) {
    const cell = row(page, tomorrow(hour)).locator("[data-hour-warning]");
    await expect(cell).toHaveAttribute("data-hour-warning", "yellow");
    await expect(cell).toHaveAttribute("data-stars", /\d/);
    await expect(cell.locator('[data-warning-mark="yellow"]')).toBeVisible();
  }
  // Before and after, the hours are as they were.
  for (const hour of [11, 15])
    await expect(
      row(page, tomorrow(hour)).locator("[data-hour-warning]"),
    ).toHaveCount(0);

  // The hour's card says what took its stars away.
  const orangeCell = row(page, tomorrow(13)).locator(
    "[data-hour-warning] button",
  );
  await orangeCell.scrollIntoViewIfNeeded();
  await orangeCell.hover();
  const tip = page
    .getByRole("tooltip")
    .filter({ hasText: "Met Éireann warning." });
  await expect(tip).toContainText(
    "Orange wind warning: no stars while it is in force.",
  );
  await shot(page, "spot-page-orange-hour");
  await page.keyboard.press("Escape");

  // Red, the day after: the same.
  await expect(
    row(page, at(27 + 11)).locator(
      '[data-hour-warning="red"] [data-warning-mark="red"]',
    ),
  ).toBeAttached();
  await row(page, at(27 + 11)).scrollIntoViewIfNeeded();
  await shot(page, "spot-page-red-hours");

  // The footer always links Met Éireann's warnings.
  await expect(page.locator("[data-warnings-source]")).toContainText(
    "Weather warnings: Met Éireann",
  );
});

/** Four yellow warnings, as Brandon had on 26 Oct 2026 (#219). */
const FOUR = [
  warning({
    capId: "test.coasts",
    type: "small-craft",
    level: "yellow",
    headline: "Small Craft warning for all coasts of Ireland",
    onset: at(-2),
    expiry: tomorrow(18),
    regions: ["EI816", "EI817", "EI818"],
  }),
  warning({
    capId: "test.wind",
    level: "yellow",
    headline: "Status Yellow - Wind warning for Kerry, Clare, Galway",
    onset: tomorrow(10),
    expiry: tomorrow(16),
    regions: ["EI11"],
  }),
  warning({
    capId: "test.west",
    type: "small-craft",
    level: "yellow",
    headline:
      "Small Craft warning from Mizen Head to Slyne Head to Bloody Foreland",
    onset: tomorrow(22),
    expiry: at(27 + 31),
    regions: ["EI817"],
  }),
  warning({
    capId: "test.rain",
    type: "Rain",
    level: "yellow",
    headline: "Status Yellow - Rain warning for Cork, Kerry",
    onset: at(27 + 34),
    expiry: at(27 + 46),
    regions: ["EI11"],
  }),
];

for (const { width, height } of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
])
  test(`four warnings leave the forecast where it was, at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await withWarnings(page, { ...fresh(), warnings: FOUR });
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });

    const panel = page.locator("[data-warnings]");
    const items = panel.locator("[data-warning]");
    await expect(items).toHaveCount(4);
    // Each says its own content once: no level twice, no shared sentence
    // under every one, and Met Éireann's words folded until asked for.
    for (const name of [
      "Wind warning for Kerry, Clare, Galway",
      "Rain warning for Cork, Kerry",
    ])
      await expect(
        panel.locator("[data-warning-headline]").filter({ hasText: name }),
      ).toHaveText(name);
    await expect(panel).not.toContainText("Status Yellow");
    await expect(panel.getByText(/stars still show/)).toHaveCount(1);
    for (const summary of await items.locator("summary").all())
      await expect(summary).toBeVisible();
    // Every warning is on the first screen, whole.
    for (const item of await items.all()) {
      const box = (await item.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    const days = page.locator("[data-day]").first();
    const without = async () => {
      await page.unroute("**/marine/warnings.json");
      await withWarnings(page, { ...fresh(), warnings: [] });
      await page.reload();
      await expect(heading(page)).toBeVisible({ timeout: 30000 });
      await expect(panel).toHaveCount(0);
      return (await days.boundingBox())!.y;
    };
    const withFour = (await days.boundingBox())!.y;
    if (width >= 1280) {
      // A screen with a margin: the list stands in it, and the forecast
      // starts where it would with no warnings at all, on the first screen.
      expect(withFour).toBeLessThan(height);
      await shot(page, "spot-page-four-warnings");
      expect(Math.abs(withFour - (await without()))).toBeLessThanOrEqual(1);
    } else {
      // In the column, a line or two each: four push the forecast down by
      // less than the picture's height.
      await shot(page, `spot-page-four-warnings-${width}`);
      expect(withFour - (await without())).toBeLessThan(height / 2);
    }
  });

test("a warnings file too old to trust shows nothing but the link to met.ie", async ({
  page,
}) => {
  await withWarnings(page, file(new Date(clock - 4 * HOUR).toISOString()));
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-day]").nth(1)).toBeVisible();
  await expect(page.locator("[data-warnings]")).toHaveCount(0);
  await expect(page.locator("[data-hour-warning]")).toHaveCount(0);
  await expect(
    page
      .locator("[data-warnings-source]")
      .getByRole("link", { name: "met.ie/warnings" }),
  ).toHaveAttribute("href", "https://www.met.ie/warnings");
});

test("the dock names the spot's warnings and marks their hours", async ({
  page,
}) => {
  await withWarnings(page, fresh());
  await page.goto("/?spot=brandon");
  const strip = page.locator("[data-dock-warnings]");
  await expect(strip).toBeVisible({ timeout: 30000 });
  await expect(strip.locator("[data-warning]")).toHaveCount(3);
  await expect(strip.locator("[data-warning]").first()).toHaveAttribute(
    "data-warning",
    "red",
  );
  await expect(strip.locator("[data-warning]").nth(1)).toContainText("Wind");
  await expect(strip.locator("[data-warning]").nth(1)).toContainText(
    /Mon 14 Sept? 13:00 – Mon 14 Sept? 16:00/,
  );
  await expect(strip.locator("[data-warning]").nth(1)).toHaveAttribute(
    "href",
    "/spot/brandon#warnings",
  );
  await expect(strip).toContainText("Met Éireann");

  // Under orange and red the stars' row holds the warning; under yellow the
  // stars, with its mark beside them.
  const stars = page.locator(".dock tr.tt-stars");
  await expect
    .poll(() => stars.locator('[data-warning-mark="orange"]').count(), {
      timeout: 30000,
    })
    .toBeGreaterThan(0);
  expect(
    await stars.locator('[data-warning-mark="red"]').count(),
  ).toBeGreaterThan(0);
  expect(
    await stars.locator('[data-warning-mark="yellow"]').count(),
  ).toBeGreaterThan(0);
  await expect(
    stars
      .getByRole("img", { name: /no stars, Orange Met Éireann warning/ })
      .first(),
  ).toBeAttached();

  // Scroll the hours to tomorrow afternoon, where the orange warning is.
  await stars
    .locator('[data-warning-mark="orange"]')
    .first()
    .evaluate((mark) =>
      mark.scrollIntoView({ inline: "center", block: "nearest" }),
    );
  await shot(page, "dock-warnings");
});
