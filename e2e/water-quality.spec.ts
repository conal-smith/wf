import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * The EPA's bathing water notices on the site (force5/src/waterQuality.ts):
 * the spot page's list and its rows, and the dock's strip and star cells, for
 * the prohibition at Portmarnock in the job's published fixture, moved a year
 * on to the sample's week. The file is routed in, as the warnings are in
 * warnings.spec.ts: `public/marine` is ingest output, never part of the e2e
 * site. SAMPLE_CLOCK is 21:00 UTC on Sun 13 Sept; the notice starts at the
 * beginning of Mon 14 Sept, Irish time, and stands until lifted.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const clock = SAMPLE_CLOCK.getTime();

const published = JSON.parse(
  readFileSync(
    new URL(
      "../force5/ingest/fixtures/water-quality-published-20250915.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  notices: { from: string | null; until: string | null }[];
} & Record<string, unknown>;

/** The file as the hourly job left it: read at :40 of the hour before the clock. */
function fresh() {
  const runTime = new Date(Math.floor(clock / HOUR) * HOUR - HOUR).toISOString();
  return {
    ...published,
    run: runTime.slice(0, 13).replace(/[-T]/g, ""),
    runTime,
    generatedAt: runTime.replace(":00:00.000Z", ":40:00.000Z"),
    notices: published.notices.map((n) => ({
      ...n,
      // 14 Sept 2025 is a Sunday, 14 Sept 2026 a Monday: a year is 365 days.
      from: n.from && new Date(Date.parse(n.from) + 365 * DAY).toISOString(),
      until:
        n.until && new Date(Date.parse(n.until) + 365 * DAY).toISOString(),
    })),
  };
}

async function withNotices(page: Page, body: unknown) {
  await page.route("**/marine/water-quality.json", (route) =>
    route.fulfill({ json: body }),
  );
}

/** Mon 14 Sept at an hour UTC. */
const monday = (hour: number) =>
  new Date(Date.parse("2026-09-14T00:00:00Z") + hour * HOUR).toISOString();
const row = (page: Page, iso: string) =>
  page.locator(`tr[data-hour="${new Date(iso).toISOString()}"]`);

test("a spot page lists its bathing water notice, which stands in for the stars", async ({
  page,
}) => {
  await withNotices(page, fresh());
  await page.goto("/spot/portmarnock");
  await expect(
    page.getByRole("heading", { level: 1, name: /Portmarnock/ }),
  ).toBeVisible({ timeout: 30000 });

  const panel = page.locator("[data-water-quality]");
  await expect(
    panel.getByRole("heading", { name: "Bathing water notices" }),
  ).toBeVisible();
  const items = panel.locator("[data-water-notice]");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute("data-water-notice", "replaces");
  await expect(items.first()).toContainText("Bathing is prohibited");
  await expect(items.first()).toContainText(
    "Water quality deteriorated due to suspected storm water overflow",
  );
  await expect(items.first()).toContainText(
    /From Mon 14 Sept?, expected to last 5 days, until lifted/i,
  );
  await expect(items.first()).toContainText(
    /Portmarnock, Velvet Strand Beach, 0\.2 km/i,
  );
  await expect(
    items.first().getByRole("link", { name: "The council’s notice" }),
  ).toHaveAttribute("href", /beaches\.ie\/wp-content\/files\/\/notice\//);
  await expect(
    panel.getByRole("link", { name: "The latest at beaches.ie" }),
  ).toHaveAttribute("href", "https://www.beaches.ie");

  // From Monday the notice stands where the stars were.
  for (const hour of [9, 12, 15]) {
    const cell = row(page, monday(hour)).locator("[data-hour-water]");
    await expect(cell).toHaveAttribute("data-hour-water", "replaces");
    await expect(cell).not.toHaveAttribute("data-stars");
    await expect(cell.locator('[data-water-mark="replaces"]')).toBeVisible();
  }
  // Sunday afternoon, before it, is as it was.
  await expect(
    row(page, "2026-09-13T16:00:00Z").locator("[data-hour-water]"),
  ).toHaveCount(0);

  // The hour's card says what took its stars away.
  const cell = row(page, monday(11)).locator("[data-hour-water] button");
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "Bathing water notice." }),
  ).toContainText(
    "Bathing is prohibited at Portmarnock, Velvet Strand Beach: no stars while it stands.",
  );

  await expect(page.locator("[data-water-quality-source]")).toContainText(
    "Bathing water notices: the EPA",
  );
});

test("a notices file too old to trust shows none", async ({ page }) => {
  await withNotices(page, {
    ...fresh(),
    runTime: new Date(clock - 4 * HOUR).toISOString(),
  });
  await page.goto("/spot/portmarnock");
  await expect(page.locator("[data-day]").nth(1)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("[data-water-quality]")).toHaveCount(0);
  await expect(page.locator("[data-hour-water]")).toHaveCount(0);
});

test("the dock names the spot's notice and marks its hours", async ({
  page,
}) => {
  await withNotices(page, fresh());
  await page.goto("/?spot=portmarnock");
  const strip = page.locator("[data-dock-warnings]");
  await expect(strip).toBeVisible({ timeout: 30000 });
  const notice = strip.locator("[data-water-notice]");
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("Bathing is prohibited");
  await expect(notice).toHaveAttribute(
    "href",
    "/spot/portmarnock#water-quality",
  );
  await expect(strip).toContainText("EPA");

  const stars = page.locator(".dock tr.tt-stars");
  await expect
    .poll(() => stars.locator('[data-water-mark="replaces"]').count(), {
      timeout: 30000,
    })
    .toBeGreaterThan(0);
  await expect(
    stars
      .getByRole("img", { name: /no stars, bathing water notice/ })
      .first(),
  ).toBeAttached();
});
