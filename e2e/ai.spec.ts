import { expect, test, type Page } from "./fixtures";

/**
 * The AI page (/ai): a tile for every assistant, each with its own Add and
 * Ask, and the last one used remembered, which fills its button and is where
 * the example questions open. The links themselves are tested in
 * ai/web/install.test.ts; this is that the page wires them up.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const tile = (page: Page, assistant: string) =>
  page.locator(`[data-assistant="${assistant}"]`);
const add = (page: Page, assistant: string) =>
  page.locator(`[data-add="${assistant}"]`);
const ask = (page: Page, assistant: string) =>
  page.locator(`[data-ask="${assistant}"]`);
const firstQuestion = (page: Page) =>
  page.getByRole("link", { name: /^Ask [\w ]+: When's the next good session/ });
/** The one filled button on the page is the kit's primary, on the accent. */
const filled = /(^|\s)bg-accent(\s|$)/;

test("a tile for every assistant, and the last one used is kept", async ({
  page,
  context,
}) => {
  await page.goto("/ai");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ask your AI." }),
  ).toBeVisible();

  // The apps that take the server first, then the ones that can only be asked.
  await expect(page.locator("[data-assistant]")).toHaveCount(8);
  await expect(page.locator("[data-assistant] h3")).toHaveText([
    "ChatGPT",
    "Claude",
    "Grok",
    "Perplexity",
    "Le Chat",
    "Meta AI",
    "Gemini",
    "Copilot",
  ]);
  for (const a of ["meta", "gemini", "copilot"]) {
    await expect(add(page, a)).toHaveCount(0);
    await expect(tile(page, a)).toContainText(
      "Can't read wingfoil.ie's live data",
    );
  }

  // Claude to begin with: its Add is the one filled button, its connector
  // dialog filled in, in a new tab, and the questions open in Claude.
  await expect(page.locator(".bg-accent")).toHaveCount(1);
  await expect(add(page, "claude")).toHaveClass(filled);
  await expect(add(page, "claude")).toHaveAttribute(
    "href",
    /^https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&/,
  );
  await expect(add(page, "claude")).toHaveAttribute("target", "_blank");
  await expect(add(page, "chatgpt")).toHaveAttribute(
    "href",
    "https://chatgpt.com/plugins",
  );
  await expect(firstQuestion(page)).toHaveAttribute(
    "href",
    /^https:\/\/claude\.ai\/new\?q=When%27s\+the\+next\+good\+session/,
  );

  // Asking Grok from its tile makes it the one the questions open in.
  await page.route("https://grok.com/**", (route) => route.abort());
  await expect(ask(page, "grok")).toHaveAttribute(
    "href",
    /^https:\/\/grok\.com\/\?q=When%27s/,
  );
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    ask(page, "grok").click(),
  ]);
  await tab.close();
  await expect(add(page, "grok")).toHaveClass(filled);
  await expect(add(page, "claude")).not.toHaveClass(filled);
  await expect(firstQuestion(page)).toHaveAttribute(
    "href",
    /^https:\/\/grok\.com\/\?q=/,
  );
  await expect(page.locator("[data-ask-note]")).toContainText(
    "which may ask it straight away",
  );

  // Kept for the next visit.
  await page.reload();
  await expect(add(page, "grok")).toHaveClass(filled);

  // An app that can only be asked has its Ask filled when it is the one used.
  await page.route("https://gemini.google.com/**", (route) => route.abort());
  const [gemini] = await Promise.all([
    context.waitForEvent("page"),
    ask(page, "gemini").click(),
  ]);
  await gemini.close();
  await expect(ask(page, "gemini")).toHaveClass(filled);
  await expect(page.locator(".bg-accent")).toHaveCount(1);
  await expect(page.locator("[data-add-note]")).toContainText(
    "Gemini can't take wingfoil.ie",
  );

  // The editors and terminals are offered on a computer.
  await expect(
    page.getByRole("heading", { name: "Coding agents" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to Cursor" })).toBeVisible();
});

test("every copy says Copied, on the button and to a screen reader", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/ai");
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const address = page.getByRole("button", {
    name: "Copy the server address",
  });

  // The glyph-only buttons: a "Copied" tag in sight, and the same in a live
  // region beside each.
  await address.click();
  await expect(address.locator("..")).toContainText("Copied");
  await expect(
    page.getByRole("status").filter({ hasText: "Copied the server address" }),
  ).toHaveCount(1);
  expect(await clipboard()).toMatch(/\/api\/mcp$/);

  const question = page
    .getByRole("button", { name: "Copy the question" })
    .first();
  await question.click();
  await expect(question.locator("..")).toContainText("Copied");
  expect(await clipboard()).toMatch(/^When's the next good session/);

  // The worded ones say it in place.
  const command = page.getByRole("button", {
    name: "Copy the Claude Code command",
  });
  await command.click();
  await expect(command).toHaveText(/Copied/);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Copied the Claude Code command" }),
  ).toHaveCount(1);

  // Adding to Grok copies the address on the way and says so under the
  // tiles, after the tab it opens is long gone.
  await page.route("https://grok.com/**", (route) => route.abort());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    add(page, "grok").click(),
  ]);
  await tab.close();
  expect(await clipboard()).toMatch(/\/api\/mcp$/);
  await expect(page.locator("[data-add-note]")).toHaveText(
    /^Address copied\. In Grok's connectors/,
  );
  await page.waitForTimeout(2000);
  await expect(page.locator("[data-add-note]")).toHaveText(/^Address copied/);
  await expect(add(page, "grok")).toHaveText(/^Add$/);
});

test.describe("on an iPhone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE,
  });

  test("lays the tiles two across, and hands every link to the app", async ({
    page,
  }) => {
    await page.goto("/ai");
    await expect(add(page, "chatgpt")).toBeVisible();
    await expect(firstQuestion(page)).toBeVisible();

    // Two across: ChatGPT and Claude side by side, Grok under ChatGPT.
    const box = async (a: string) => (await tile(page, a).boundingBox())!;
    const [chatgpt, claude, grok] = await Promise.all(
      ["chatgpt", "claude", "grok"].map(box),
    );
    expect(Math.abs(chatgpt.y - claude.y)).toBeLessThan(1);
    expect(claude.x).toBeGreaterThan(chatgpt.x);
    expect(Math.abs(grok.x - chatgpt.x)).toBeLessThan(1);
    expect(grok.y).toBeGreaterThan(chatgpt.y);

    // ChatGPT opens its plugins in the app now, rather than only copying,
    // and says where it can be done for sure.
    await expect(add(page, "chatgpt")).toHaveAttribute(
      "href",
      "https://chatgpt.com/plugins",
    );
    await expect(tile(page, "chatgpt")).toContainText("Best on a computer");

    // Followed in the same tab, which is what opens the app rather than a
    // browser tab.
    await expect(add(page, "chatgpt")).not.toHaveAttribute("target", /.*/);
    await expect(ask(page, "claude")).not.toHaveAttribute("target", /.*/);
    await expect(firstQuestion(page)).not.toHaveAttribute("target", /.*/);

    // The coding agents are there to copy for a computer; their one-click
    // links, which open an editor this phone has not got, are not.
    await expect(
      page.getByRole("heading", { name: "Coding agents" }),
    ).toBeVisible();
    await expect(page.getByText("These run on a computer.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add to Cursor" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Copy the Claude Code command" }),
    ).toBeVisible();

    // The address breaks only after a slash.
    await expect(page.locator("code wbr")).not.toHaveCount(0);

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
    await expect(add(page, "chatgpt")).toHaveAttribute(
      "href",
      "intent://chatgpt.com/plugins#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fplugins;end",
    );
    await expect(add(page, "claude")).toHaveAttribute(
      "href",
      /^intent:\/\/claude\.ai\/customize\/connectors\?.+;package=com\.anthropic\.claude;/,
    );
    await expect(ask(page, "grok")).toHaveAttribute(
      "href",
      /^intent:\/\/grok\.com\/\?q=.+;package=ai\.x\.grok;/,
    );
    // An app whose maker hands it no such link opens on the web.
    await expect(ask(page, "gemini")).toHaveAttribute(
      "href",
      "https://gemini.google.com/app",
    );
  });
});
