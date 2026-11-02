import { expect, test, type Page } from "./fixtures";

/**
 * The AI page (/ai): the site's top bar, a short scene (a phone with an AI
 * app reading wingfoil.ie), and a list of the apps, each its maker's mark and
 * one row that adds wingfoil.ie to it, then a row that copies the address for
 * any other. The links themselves are tested in ai/web/install.test.ts; this
 * is that the page wires them up. Most tests ask for less motion, which shows
 * the scene's last beat at once.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const button = (page: Page, app: string) => page.locator(`[data-app="${app}"]`);
const lines = (page: Page) => page.locator("[data-line]");

test.use({ reducedMotion: "reduce" });

test("the line, then a row for each app with its maker's mark", async ({
  page,
}) => {
  await page.goto("/ai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "wingfoil.ie is fully compatible with your bots.",
  );
  await expect(page.locator("[data-app]")).toHaveText([
    "Add to ChatGPT",
    "Add to Grok",
    "Add to Perplexity",
    "Add to Mistral Vibe",
    "Another app",
  ]);
  // Each app's mark is its maker's own file, and it is there.
  const marks = await page.locator(".ai-logo img, .ai-logo .mono").evaluateAll(
    (els) =>
      els.map((el) =>
        el instanceof HTMLImageElement
          ? el.getAttribute("src")
          : getComputedStyle(el).getPropertyValue("--ai-mark").trim(),
      ),
  );
  expect(marks).toEqual([
    "url(/ai/logos/openai-blossom.svg)",
    "url(/ai/logos/grok-logomark.svg)",
    "url(/ai/logos/perplexity-symbol.svg)",
    "/ai/logos/mistral-icon.svg",
  ]);
  for (const file of [
    "openai-blossom",
    "grok-logomark",
    "perplexity-symbol",
    "mistral-icon",
  ])
    expect((await page.request.get(`/ai/logos/${file}.svg`)).status()).toBe(200);
  await expect(page.locator("main")).toContainText(
    "Product names and logos are trademarks of their owners",
  );
  // The site's one top bar: the wordmark, the search, Chart and the menu.
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("button", { name: "Site menu" })).toBeVisible();
  await expect(bar.getByRole("link", { name: /^wingfoil\.ie/ })).toHaveText(
    "wingfoil.ie",
  );
  await expect(
    bar.getByRole("combobox", { name: "Search spots" }),
  ).toBeVisible();
  await expect(bar.getByRole("link", { name: "Chart" })).toHaveAttribute(
    "href",
    "/?map",
  );
  await expect(lines(page)).toHaveCount(0);

  // Claude is not listed until Anthropic has approved its mark here.
  await expect(button(page, "claude")).toHaveCount(0);
  await expect(button(page, "chatgpt")).toHaveAttribute("target", "_blank");
  await expect(button(page, "chatgpt")).toHaveAttribute(
    "href",
    "https://chatgpt.com/plugins",
  );
  await expect(button(page, "grok")).toHaveAttribute(
    "href",
    "https://grok.com/connectors",
  );
  await expect(button(page, "perplexity")).toHaveAttribute(
    "href",
    "https://www.perplexity.ai/computer/plugins",
  );
  await expect(button(page, "lechat")).toHaveAttribute(
    "href",
    "https://chat.mistral.ai/",
  );
});

test("a button that copies the address says where to paste it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/ai");
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  // Adding to Grok copies the address on the way and says so on its row,
  // after the tab it opens is long gone.
  await page.route("https://grok.com/**", (route) => route.abort());
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    button(page, "grok").click(),
  ]);
  await tab.close();
  expect(await clipboard()).toMatch(/\/api\/mcp$/);
  await expect(lines(page)).toHaveCount(1);
  await expect(page.locator("li", { has: button(page, "grok") })).toContainText(
    "Address copied. Paste it in Grok.",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Paste it in Grok." }),
  ).toHaveCount(1);

  // Another app: the address, and the one line, on its own row only.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await button(page, "other").click();
  expect(await clipboard()).toMatch(/\/api\/mcp$/);
  await expect(lines(page)).toHaveCount(1);
  await expect(
    page.locator("li", { has: button(page, "other") }),
  ).toContainText("Address copied. Paste it in your app.");
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the scene plays, the list comes in, and Replay plays it again", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/ai");
    const stage = page.locator("main.ai-stage");
    const replay = page.getByRole("button", { name: "Replay" });
    // The line types itself; the phone's app is asked, and answers with a chart.
    await expect(page.locator(".ai-intro .c.on").first()).toBeAttached();
    await expect(page.locator('[data-scene="card"].on')).toBeAttached({
      timeout: 20000,
    });
    await expect(stage).toHaveClass(/is-done/, { timeout: 20000 });
    await expect(replay).toHaveClass(/\bon\b/);
    await expect(button(page, "chatgpt")).toHaveCSS("opacity", "1");
    await replay.click();
    await expect(stage).not.toHaveClass(/is-done/);
  });

  test("a press while it plays skips to its end", async ({ page }) => {
    await page.goto("/ai");
    const stage = page.locator("main.ai-stage");
    await expect(stage).not.toHaveClass(/is-done/);
    await page.mouse.wheel(0, 200);
    await expect(stage).toHaveClass(/is-done/);
    await expect(page.locator('[data-scene="say2"].on')).toBeAttached();
  });
});

test.describe("on an iPhone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE,
  });

  test("hands every link to the app, in the same tab, and fits the phone", async ({
    page,
  }) => {
    await page.goto("/ai");
    await expect(button(page, "chatgpt")).toBeVisible();
    await expect(button(page, "chatgpt")).toHaveAttribute(
      "href",
      "https://chatgpt.com/plugins",
    );
    // Followed in the same tab, which is what opens the app rather than a
    // browser tab.
    await expect(button(page, "chatgpt")).not.toHaveAttribute("target", /.*/);

    // Every row the same width, the line over the phone, the list under it.
    const boxes = await page
      .locator("[data-app]")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(new Set(boxes).size).toBe(1);
    const line = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const phone = (await page.locator(".ai-phone").boundingBox())!;
    const add = (await button(page, "chatgpt").boundingBox())!;
    expect(phone.y).toBeGreaterThan(line.y + line.height);
    expect(add.y).toBeGreaterThan(phone.y + phone.height);

    // Nothing on the page is wider than the phone.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide).toBe(false);
  });
});

test.describe("on Android", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID,
  });

  test("names the app in the link, with the web to fall back on", async ({
    page,
  }) => {
    await page.goto("/ai");
    await expect(button(page, "chatgpt")).toHaveAttribute(
      "href",
      "intent://chatgpt.com/plugins#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fplugins;end",
    );
    await expect(button(page, "grok")).toHaveAttribute(
      "href",
      /^intent:\/\/grok\.com\/connectors#.+;package=ai\.x\.grok;/,
    );
    // An app whose maker hands it no such link opens on the web.
    await expect(button(page, "lechat")).toHaveAttribute(
      "href",
      "https://chat.mistral.ai/",
    );
  });
});
