import { expect, test, type Page } from "./fixtures";

/**
 * The AI page (/ai): one pick of assistant sets the one filled button and
 * where every example question opens; a phone sees the apps and the
 * questions only. The links themselves are tested in ai/web/install.test.ts;
 * this is that the page wires them up.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const pick = (page: Page, name: string) =>
  page.getByRole("group", { name: "Your AI" }).getByRole("button", { name });
const add = (page: Page) => page.locator("[data-add]");
const firstQuestion = (page: Page) =>
  page.getByRole("link", { name: /^Ask \w+: When's the next good session/ });

test("one pick sets the add button and where the questions open, and is kept", async ({
  page,
}) => {
  await page.goto("/ai");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ask your AI." }),
  ).toBeVisible();

  // Claude to begin with: its connector dialog, filled in, in a new tab.
  await expect(pick(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  await expect(add(page)).toHaveText(/Add to Claude/);
  await expect(add(page)).toHaveAttribute(
    "href",
    /^https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector&/,
  );
  await expect(add(page)).toHaveAttribute("target", "_blank");
  await expect(firstQuestion(page)).toHaveAttribute(
    "href",
    /^https:\/\/claude\.ai\/new\?q=When%27s\+the\+next\+good\+session/,
  );

  await pick(page, "Grok").click();
  await expect(add(page)).toHaveText(/Add to Grok/);
  await expect(firstQuestion(page)).toHaveAttribute(
    "href",
    /^https:\/\/grok\.com\/\?q=/,
  );

  // Kept for the next visit.
  await page.reload();
  await expect(pick(page, "Grok")).toHaveAttribute("aria-pressed", "true");

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
  // button, after the tab it opens is long gone.
  await page.route("https://grok.com/**", (route) => route.abort());
  await pick(page, "Grok").click();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    add(page).click(),
  ]);
  await tab.close();
  expect(await clipboard()).toMatch(/\/api\/mcp$/);
  await expect(page.locator("[data-add-note]")).toHaveText(
    /^Address copied\. In Grok's connectors/,
  );
  await page.waitForTimeout(2000);
  await expect(page.locator("[data-add-note]")).toHaveText(/^Address copied/);
  await expect(add(page)).toHaveText(/Add to Grok/);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE,
  });

  test("shows the apps and the questions only, and hands links to the app", async ({
    page,
  }) => {
    await page.goto("/ai");
    await expect(add(page)).toBeVisible();
    await expect(firstQuestion(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coding agents" }),
    ).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Add to Cursor" }),
    ).toBeHidden();

    // Followed in the same tab, which is what opens the app rather than a
    // browser tab.
    await expect(add(page)).not.toHaveAttribute("target", /.*/);
    await expect(firstQuestion(page)).not.toHaveAttribute("target", /.*/);

    // Nothing on the page is wider than the phone.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide).toBe(false);
  });
});
