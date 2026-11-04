import { expect, test, type Page } from "./fixtures";

/**
 * The information pages: the privacy policy (/privacy), the terms of use
 * (/terms) and help and support (/support). Each is a real address, drawn
 * under the site's top bar; the site menu links to all three from its foot,
 * and from the map they open over it (src/PagesOverMap.tsx). The privacy
 * policy says the site asks nobody else for anything on these pages, so the
 * test holds it to that.
 */

const PAGES = [
  { path: "/privacy", heading: "Privacy", title: "Privacy — wingfoil.ie" },
  {
    path: "/terms",
    heading: "Terms of use",
    title: "Terms of use — wingfoil.ie",
  },
  {
    path: "/support",
    heading: "Help and support",
    title: "Help and support — wingfoil.ie",
  },
];

const menuFoot = (page: Page) =>
  page
    .getByRole("dialog", { name: "Site menu" })
    .getByRole("list", { name: "About this site" });

for (const { path, heading, title } of PAGES)
  test(`${path} is a page of its own, under the site's top bar`, async ({
    page,
  }) => {
    const origins = new Set<string>();
    page.on("request", (request) => origins.add(new URL(request.url()).origin));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page).toHaveTitle(title);
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("button", { name: "Site menu" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Chart" })).toHaveAttribute(
      "href",
      "/?map",
    );
    // The other two pages, linked at the foot.
    const others = page.getByRole("navigation", { name: "About this site" });
    await expect(others.getByRole("link")).toHaveCount(2);
    // A page of sentences fetches nothing from anyone but the site.
    await page.waitForLoadState("networkidle");
    expect([...origins]).toEqual([new URL(page.url()).origin]);
  });

test("support links to the issues, the security policy and the AI page", async ({
  page,
}) => {
  await page.goto("/support");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: /Report a problem/ }),
  ).toHaveAttribute("href", "https://github.com/slopsmith/wf/issues/new");
  await expect(
    main.getByRole("link", { name: "Report a vulnerability" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/slopsmith/wf/security/advisories/new",
  );
  await expect(main.getByRole("link", { name: "Use with AI" })).toHaveAttribute(
    "href",
    "/ai",
  );
  await expect(main).toContainText("https://wingfoil.ie/api/mcp");
});

test("the terms say the forecast is a guide, and name the code's licence", async ({
  page,
}) => {
  await page.goto("/terms");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", {
      name: "The forecast is a guide, not a safety service",
    }),
  ).toBeVisible();
  await expect(main).toContainText("AGPL-3.0-only");
  await expect(main).toContainText("law of Ireland");
});

test("the site menu links to all three from its foot, and each opens over the map", async ({
  page,
}) => {
  await page.goto("/?map");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Site menu" }).click();
  await expect(menuFoot(page).getByRole("link")).toHaveText([
    "Privacy",
    "Terms",
    "Support",
  ]);
  await menuFoot(page).getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator(".map-under-page")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
  await expect(page.getByRole("dialog", { name: "Site menu" })).toHaveCount(0);
  // From one page to the next, and Back to the map as it was.
  await page
    .getByRole("navigation", { name: "About this site" })
    .getByRole("link", { name: "Terms of use" })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Terms of use",
  );
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(page.locator(".map-under-page")).toHaveCount(0);
});

test("on a phone, each page fits the screen's width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const { path } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
