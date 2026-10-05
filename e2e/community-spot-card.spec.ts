import { SAMPLE_CLOCK } from "./columns";
import { expect, test, type Page } from "./fixtures";
import { readSample } from "./sample";

/**
 * A spot on a thread: the card under the opening post, its wind from the map's
 * own manifest, and the link that opens the map on the spot.
 *
 * The API is not running in this suite, so the thread is answered here in the
 * API's own shapes. The weather is not answered: it is the staged sample the
 * site serves, read here for what the card should say. The one test that moves
 * the clock answers a run of its own, so it can say what each hour holds.
 */

const KNOTS = 1.94384449;

const aoife = {
  id: "dev_aoife",
  handle: "aoife",
  displayName: "Aoife K",
  avatarUrl: null,
  role: "member",
};

const thread = (id: string, spotId: string | null) => ({
  id,
  channel: { id: "ch_wings", slug: "wings", name: "Wings" },
  author: aoife,
  title: "5m or 6m as a one-wing quiver for Dublin Bay?",
  slug: "5m-or-6m",
  spotId,
  status: "open",
  pinned: false,
  lockedReason: null,
  tags: [],
  lastSeq: 0,
  replyCount: 0,
  participantCount: 1,
  lastMessageAt: "2026-09-13T12:00:00Z",
  lastMessageBy: aoife,
  createdAt: "2026-09-13T12:00:00Z",
  preview: null,
  participants: [aoife],
  thumbnail: null,
});

const opening = (threadId: string) => ({
  id: `m_${threadId}`,
  threadId,
  seq: 0,
  author: aoife,
  body: "Most of my days are 14 to 22 knots.",
  replyTo: null,
  reactions: {},
  status: "visible",
  editedAt: null,
  createdAt: "2026-09-13T12:00:00Z",
  photos: [],
  mentions: [],
});

const THREADS: Record<string, string | null> = {
  t_spot: "dollymount",
  t_plain: null,
  t_gone: "atlantis",
};

async function answerApi(page: Page) {
  await page.route("**/api/community/meta", (route) =>
    route.fulfill({
      json: {
        categories: [],
        channels: [],
        reactions: [],
        limits: {},
        auth: "dev",
      },
    }),
  );
  await page.route("**/api/community/channels", (route) =>
    route.fulfill({ json: { channels: [] } }),
  );
  await page.route("**/api/community/threads/*/events", (route) =>
    route.abort(),
  );
  await page.route("**/api/community/threads/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (!(id in THREADS)) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      json: {
        thread: thread(id, THREADS[id]),
        opening: opening(id),
        messages: { items: [], hasOlder: false, hasNewer: false },
      },
    });
  });
}

const card = (page: Page) => page.locator('a[href^="/?spot="]');

test("a thread with a spot shows its name, its wind now and the way to the map", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/community/t/t_spot/5m-or-6m");

  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toContainText("Dollymount, Co. Dublin");
  await expect(card(page)).toHaveAttribute("href", "/?spot=dollymount");

  // The fixture pins the clock on one of the sample run's hours: that hour's wind.
  const harmonie = readSample("harmonie");
  const hour = harmonie.spotForecasts.dollymount.find(
    (entry: { validTime: string }) =>
      Date.parse(entry.validTime) === SAMPLE_CLOCK.getTime(),
  );
  const knots = Math.round(Math.hypot(hour.u, hour.v) * KNOTS);
  await expect(card(page)).toContainText(`${knots} kn now`);

  // The swatch is the ramp's stop for that speed; the number is the page's ink.
  const stop = [0, 5, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 65]
    .filter((from) => knots >= from)
    .pop()!;
  const swatch = card(page).locator(
    `.bg-wind-k${String(stop).padStart(2, "0")}`,
  );
  await expect(swatch).toHaveCount(1);
  const [swatchColour, numberColour, ink] = await Promise.all([
    swatch.evaluate((el) => getComputedStyle(el).backgroundColor),
    card(page)
      .locator(".tabular-nums")
      .evaluate((el) => getComputedStyle(el).color),
    page
      .getByRole("heading", { level: 1 })
      .evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(swatchColour).not.toBe("rgba(0, 0, 0, 0)");
  expect(numberColour).toBe(ink);

  // Under the opening post's words, inside its card.
  const post = page.locator("#m-0");
  await expect(post.locator('a[href^="/?spot="]')).toHaveCount(1);
  const words = (await post.getByText("Most of my days").boundingBox())!;
  const box = (await card(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(words.y);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: "test-results/community-spot-card.png" });

  // On a phone the card keeps the name, the wind and the number.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card(page)).toContainText("Dollymount, Co. Dublin");
  await expect(card(page).locator(".tabular-nums")).toBeVisible();
  const narrow = (await card(page).boundingBox())!;
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/community-spot-card-mobile.png",
  });

  // The link is a page load into the map, which opens on the spot.
  await card(page).click();
  await expect(page).toHaveURL(/\/\?spot=dollymount$/);
  await expect(page.locator('[data-spot-id="dollymount"]')).toHaveClass(
    /active/,
    { timeout: 30000 },
  );
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
});

test("a thread without a spot shows no card, and neither does a spot the map does not list", async ({
  page,
}) => {
  await answerApi(page);
  const asked: string[] = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));

  await page.goto("/community/t/t_plain/5m-or-6m");
  await expect(page.getByText("Most of my days")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  // Nothing of the map's is asked for on a thread that names no spot.
  expect(
    asked.filter((path) => /riding-locations|weather\//.test(path)),
  ).toEqual([]);

  const listed = page.waitForResponse(/riding-locations\.json/);
  await page.goto("/community/t/t_gone/5m-or-6m");
  await expect(page.getByText("Most of my days")).toBeVisible();
  // The list has been read, and the id is not in it.
  await (await listed).finished();
  await expect(card(page)).toHaveCount(0);
  expect(asked.filter((path) => /weather\//.test(path))).toEqual([]);
});

test("without the forecast the card is still the name and the link", async ({
  page,
}) => {
  await answerApi(page);
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await page.goto("/community/t/t_spot/5m-or-6m");
  await expect(card(page)).toContainText("Dollymount, Co. Dublin");
  await expect(card(page)).toContainText("Forecast on the wind map");
  await expect(card(page)).not.toContainText("kn");
});

test("the reading keeps up with the clock on a thread left open, and stands down past the run", async ({
  page,
}) => {
  await answerApi(page);
  // Two hours of a run, three hours apart: a westerly that builds, with its gust.
  const at = (hours: number) =>
    new Date(SAMPLE_CLOCK.getTime() + hours * 3600000).toISOString();
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({
      json: {
        spotForecasts: {
          dollymount: [
            {
              hour: 0,
              validTime: at(0),
              u: 19 / KNOTS,
              v: 0,
              gust: 26 / KNOTS,
            },
            {
              hour: 3,
              validTime: at(3),
              u: 31 / KNOTS,
              v: 0,
              gust: 40 / KNOTS,
            },
          ],
        },
      },
    }),
  );
  // A controlled clock, so three hours can pass without waiting for them.
  await page.clock.install({ time: SAMPLE_CLOCK });
  await page.goto("/community/t/t_spot/5m-or-6m");
  await expect(card(page)).toContainText("W · gusting 26 kn");
  await expect(card(page)).toContainText("19 kn now");
  await expect(card(page).locator(".bg-wind-k15")).toHaveCount(1);

  await page.clock.fastForward("03:00:00");
  await expect(card(page)).toContainText("W · gusting 40 kn");
  await expect(card(page)).toContainText("31 kn now");
  await expect(card(page).locator(".bg-wind-k30")).toHaveCount(1);

  // Two hours past the run's last hour there is no "now" to give.
  await page.clock.fastForward("02:00:00");
  await expect(card(page)).toContainText("Forecast on the wind map");
  await expect(card(page)).not.toContainText("kn");
});

test("the map opens where it always has for a spot it does not hold", async ({
  page,
}) => {
  await page.goto("/?spot=atlantis");
  await expect(page.locator('[data-spot-id="brandon"]')).toHaveClass(/active/, {
    timeout: 30000,
  });
});
