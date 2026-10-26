import { expect, test, type Page } from "./fixtures";

/**
 * The AI page (/ai): the spot finder's header, one line, and a row for each
 * app with one button that adds wingfoil.ie to it, then a row that copies the
 * address for any other. The links themselves are tested in
 * ai/web/install.test.ts; this is that the page wires them up.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const button = (page: Page, app: string) => page.locator(`[data-app="${app}"]`);
const lines = (page: Page) => page.locator("[data-line]");

test("one line, then a row and one button for each app", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.locator("main p").first()).toHaveText(
    "wingfoil.ie is fully compatible with your bots. Click below to add your favourite bot.",
  );
  await expect(page.locator("main h2")).toHaveText([
    "ChatGPT",
    "Claude",
    "Grok",
    "Perplexity",
    "Le Chat",
    "Another app",
  ]);
  await expect(page.locator("[data-app]")).toHaveText([
    "Add to ChatGPT",
    "Add to Claude",
    "Add to Grok",
    "Add to Perplexity",
    "Add to Le Chat",
    "Copy address",
  ]);
  // The header is the spot finder's: the menu and the wordmark, nothing else.
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Site menu" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText("wingfoil.ie");
  await expect(lines(page)).toHaveCount(0);

  // Claude opens its connector dialog filled in, in a new tab.
  await expect(button(page, "claude")).toHaveAttribute(
    "href",
    /^https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&/,
  );
  await expect(button(page, "claude")).toHaveAttribute("target", "_blank");
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

  // Claude is filled in for the rider: nothing is left to say.
  await page.route("https://claude.ai/**", (route) => route.abort());
  const [claude] = await Promise.all([
    context.waitForEvent("page"),
    button(page, "claude").click(),
  ]);
  await claude.close();
  await expect(lines(page)).toHaveCount(0);
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
    await expect(button(page, "claude")).not.toHaveAttribute("target", /.*/);

    // Each name and its button share a line, every button the same width.
    const boxes = await page
      .locator("[data-app]")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(new Set(boxes).size).toBe(1);
    const name = (await page.locator("main h2").first().boundingBox())!;
    const add = (await button(page, "chatgpt").boundingBox())!;
    expect(add.y).toBeLessThan(name.y + name.height);

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
    await expect(button(page, "claude")).toHaveAttribute(
      "href",
      /^intent:\/\/claude\.ai\/customize\/connectors\?.+;package=com\.anthropic\.claude;/,
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
