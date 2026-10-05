import { expect, test, type Page } from "./fixtures";

/**
 * The community's shell: the header, the channel rail and the column a page
 * will stand in.
 *
 * The API is not running in this suite, so the two replies the rail is drawn
 * from are answered here, in the API's own shapes. What a thread or a feed
 * does is not this spec's business: the lists a page asks for are answered
 * empty, and nothing under test reads one.
 */

const CATEGORIES = [
  { id: "cat_community", name: "Community", position: 0 },
  { id: "cat_gear", name: "Gear", position: 1 },
];

const channel = (
  slug: string,
  name: string,
  categoryId: string,
  position: number,
  extra: Record<string, unknown> = {},
) => ({
  id: `ch_${slug}`,
  slug,
  categoryId,
  name,
  description: "",
  postPolicy: "everyone",
  status: "active",
  position,
  threadCount: 0,
  followerCount: 0,
  lastMessageAt: null,
  tags: [],
  ...extra,
});

const CHANNELS = [
  channel("announcements", "Announcements", "cat_community", 0, {
    postPolicy: "staff",
  }),
  channel("general", "General", "cat_community", 1, { unread: 2 }),
  channel("wings", "Wings", "cat_gear", 0, { unread: 7 }),
  channel("foils", "Foils", "cat_gear", 1),
];

async function answerApi(page: Page) {
  await page.route("**/api/community/meta", (route) =>
    route.fulfill({
      json: {
        categories: CATEGORIES,
        channels: CHANNELS,
        reactions: [],
        limits: {},
        auth: "dev",
      },
    }),
  );
  await page.route("**/api/community/channels", (route) =>
    route.fulfill({ json: { channels: CHANNELS } }),
  );
  const nothing = { json: { items: [], nextCursor: null } };
  await page.route("**/api/community/feed?*", (route) =>
    route.fulfill(nothing),
  );
  await page.route("**/api/community/channels/*/threads*", (route) =>
    route.fulfill(nothing),
  );
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Channels" });
const row = (page: Page, name: string | RegExp) =>
  rail(page).getByRole("link", { name });
const current = (page: Page) => rail(page).locator('[aria-current="page"]');

test("/community is the header, the rail from the API and one main column", async ({
  page,
}) => {
  await answerApi(page);
  const asked: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/")) asked.push(pathname);
  });
  await page.goto("/community");

  await expect(
    page.getByRole("link", { name: "wingfoil.ie Community, home" }),
  ).toBeVisible();
  // Signed out on this build: Sign in, and nothing a reader cannot use.
  const actions = page.getByRole("navigation", { name: "Community" });
  await expect(actions.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(actions.getByText("New thread")).toHaveCount(0);

  await expect(rail(page).getByRole("searchbox")).toHaveAccessibleName(
    "Search the community",
  );
  await expect(rail(page).getByRole("button", { expanded: true })).toHaveText([
    "Community",
    "Gear",
  ]);
  await expect(rail(page).locator('a[href^="/community/c/"]')).toHaveText([
    /Announcements/,
    /General/,
    /Wings/,
    /Foils/,
  ]);
  await expect(page.getByRole("main")).toHaveCount(1);

  // Two columns: the rail is 236px, and the page starts to its right.
  const railBox = (await rail(page).boundingBox())!;
  const mainBox = (await page.getByRole("main").boundingBox())!;
  expect(Math.round(railBox.width)).toBe(236);
  expect(mainBox.x).toBeGreaterThan(railBox.x + railBox.width);
  // And the page measure is 1200 however wide the window.
  expect(mainBox.x + mainBox.width - railBox.x).toBeLessThanOrEqual(1200);

  // The rail's two reads and home's feed, and no more: a signed-out reader has
  // no bell to ask for.
  expect([...new Set(asked)].sort()).toEqual([
    "/api/community/channels",
    "/api/community/feed",
    "/api/community/meta",
  ]);
});

test("unread is weight and a count, and a staff-only channel is a lock with words", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/community");

  await expect(row(page, /Wings/)).toHaveAccessibleName("Wings 7 unread");
  await expect(row(page, /General/)).toHaveAccessibleName("General 2 unread");
  const weight = (name: RegExp) =>
    row(page, name).evaluate((el) => Number(getComputedStyle(el).fontWeight));
  expect(await weight(/Wings/)).toBeGreaterThan(await weight(/Foils/));

  await expect(row(page, /Announcements/)).toHaveAccessibleName(
    "Announcements staff posts only",
  );
  await expect(row(page, /Foils/)).toHaveAccessibleName("Foils");
});

test("the rail is reachable by keyboard, and aria-current follows the open channel", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/community/c/wings");
  await expect(current(page)).toHaveText(["Wings"]);

  // From the search field, Tab walks the rail in reading order.
  await rail(page).getByRole("searchbox").focus();
  const walked: string[] = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    walked.push(
      await page.evaluate(() => {
        const el = document.activeElement!;
        return `${el.tagName.toLowerCase()} ${el.firstChild?.nextSibling?.textContent ?? el.textContent}`;
      }),
    );
  }
  expect(walked).toEqual([
    "a Latest",
    "a Following",
    "a Mentions",
    "button Community",
    "a Announcements",
    "a General",
    "button Gear",
    "a Wings",
    "a Foils",
  ]);

  // Enter on a row is a push, not a page load, and the mark moves with it.
  let loads = 0;
  page.on("load", () => loads++);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/community/c/foils");
  await expect(current(page)).toHaveText(["Foils"]);
  expect(loads).toBe(0);

  await row(page, "Latest").focus();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/community");
  await expect(current(page)).toHaveText(["Latest"]);

  // The one ring, not the map's: 2px of focus (the chart's magenta), 2px clear.
  const ring = await row(page, "Latest").evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.outlineWidth} ${style.outlineOffset}`;
  });
  expect(ring).toBe("2px 2px");
});

test("a category head folds its channels away and says so", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/community");
  const head = rail(page).getByRole("button", { name: "Gear" });
  await expect(head).toHaveAttribute("aria-expanded", "true");

  await head.focus();
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(head).not.toHaveAttribute("aria-controls", /.*/);
  await expect(row(page, /Wings/)).toHaveCount(0);
  await expect(row(page, /General/)).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(row(page, /Wings/)).toBeVisible();
});

test("an unknown URL under /community is the not-found page, with its one filled action", async ({
  page,
}) => {
  await answerApi(page);
  await page.goto("/community/nowhere");
  await expect(page.getByText("That page does not exist")).toBeVisible();
  await expect(current(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Back to the community" }).click();
  await page.waitForURL((url) => url.pathname === "/community");
  await expect(current(page)).toHaveText(["Latest"]);
});

test("without the API the rail says what failed and offers to try again", async ({
  page,
}) => {
  await page.route("**/api/community/**", (route) =>
    route.fulfill({ status: 502, contentType: "text/html", body: "<html>" }),
  );
  await page.goto("/community");
  await expect(rail(page).getByRole("alert")).toContainText(
    "The community is not responding right now.",
  );
  // The feeds do not need the channels, and stay.
  await expect(row(page, "Latest")).toBeVisible();

  await page.unroute("**/api/community/**");
  await answerApi(page);
  await rail(page).getByRole("button", { name: "Try again" }).click();
  await expect(row(page, /Wings/)).toBeVisible();
  await expect(rail(page).getByRole("alert")).toHaveCount(0);
});

test.describe("below 900px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const overflow = (page: Page) =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

  test("the channels are the page at /community, in rows a finger can hit", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/community");
    await expect(row(page, /Wings/)).toBeVisible();

    const railBox = (await rail(page).boundingBox())!;
    expect(railBox.width).toBeGreaterThan(340);
    for (const name of [/Latest/, /Announcements/, /Wings/]) {
      const box = (await row(page, name).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("link", { name: "Channels" })).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // Nothing inside the header's pill overflows it.
    const bar = page.locator("header > div");
    expect(
      await bar.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);
  });

  test("a channel is a page of its own, with a way back to the channels", async ({
    page,
  }) => {
    await answerApi(page);
    await page.goto("/community");
    await row(page, /Wings/).click();
    await page.waitForURL("**/community/c/wings");

    await expect(rail(page)).toBeHidden();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.getByRole("link", { name: "Channels" }).click();
    await page.waitForURL((url) => url.pathname === "/community");
    await expect(row(page, /Wings/)).toBeVisible();
  });
});
