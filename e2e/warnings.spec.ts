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
  // Highest level first, each with its kind, Met Éireann's headline as
  // issued, and its validity in Irish time.
  await expect(panel.locator("[data-warning]")).toHaveCount(3);
  const items = panel.locator("[data-warning]");
  await expect(items.nth(0)).toHaveAttribute("data-warning", "red");
  await expect(items.nth(0)).toContainText("Violent storm warning (marine)");
  await expect(items.nth(0)).toContainText(
    "Status Red - Marine Violent Storm warning from Valentia to Loop Head",
  );
  await expect(items.nth(1)).toHaveAttribute("data-warning", "orange");
  await expect(items.nth(1)).toContainText(
    "Status Orange - Wind warning for Kerry",
  );
  await expect(items.nth(1)).toContainText(
    /Mon 14 Sept? 13:00 – Mon 14 Sept? 16:00/,
  );
  await expect(items.nth(1)).toContainText("No stars for the hours it covers.");
  await expect(items.nth(2)).toHaveAttribute("data-warning", "yellow");
  await expect(items.nth(2)).toContainText("The stars still show beside it");
  await expect(items.nth(1).locator("time").first()).toHaveAttribute(
    "datetime",
    tomorrow(12),
  );
  // The description, every word kept, folded underneath.
  await items.nth(1).getByText("What Met Éireann says").click();
  await expect(items.nth(1)).toContainText("• Large coastal waves");
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

test("on a phone the dock's strip says how many warnings there are, and opens to each in full", async ({
  page,
}) => {
  await withWarnings(page, fresh());
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?spot=brandon");
  const strip = page.locator("[data-dock-warnings]");
  await expect(strip).toBeVisible({ timeout: 30000 });
  // One line: the highest level's tag, how many and their kinds, cut short
  // inside the screen rather than run off it.
  const summary = strip.getByRole("button", {
    name: "3 Met Éireann warnings: Violent storm, Wind, Small craft",
  });
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(summary.locator('[data-warning-mark="red"]')).toBeVisible();
  await expect(summary).toContainText("3 warnings");
  const kinds = summary.locator(".dk-warnings-kinds");
  await expect(kinds).toHaveCSS("text-overflow", "ellipsis");
  const edge = (el: Element) => el.getBoundingClientRect().right;
  expect(await summary.evaluate(edge)).toBeLessThanOrEqual(393);
  await expect(strip.locator("[data-warning]").first()).toBeHidden();
  // Pressed, every warning under it, each over as many lines as it needs and
  // all of it on the screen; pressed again, folded.
  await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  const items = strip.locator("[data-warning]");
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) {
    await expect(item).toBeVisible();
    expect(await item.evaluate(edge)).toBeLessThanOrEqual(393);
    expect(await item.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  }
  await expect(items.nth(1)).toContainText(
    /Wind\s*Mon 14 Sept? 13:00 – Mon 14 Sept? 16:00/,
  );
  await expect(items.nth(1)).toHaveAttribute("href", "/spot/brandon#warnings");
  await shot(page, "dock-warnings-phone");
  await summary.click();
  await expect(items.first()).toBeHidden();
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
