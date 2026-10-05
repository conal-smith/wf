import { expect, test, type Page } from "./fixtures";

/**
 * Gust, the companion, against the real API with its scripted fake model
 * (COMPANION_FAKE=1 in playwright.config.ts) over the staged sample forecast:
 * every card, chip and map move here comes from the real tool code, only the
 * words between them are scripted.
 */

const launcher = (page: Page) =>
  page.getByRole("button", { name: /Gust/ }).first();

/** The chart, and Gust in his corner: he comes once the chart is drawn. */
async function openMap(page: Page) {
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 20000,
  });
  await expect(launcher(page)).toBeVisible({ timeout: 20000 });
}
const panel = (page: Page) => page.getByRole("dialog", { name: "Gust" });

test("Gust answers a suggestion with lookups and a spot card, and shows it on the map", async ({
  page,
}) => {
  await openMap(page);
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText("Where to, rider?")).toBeVisible();

  await panel(page)
    .getByRole("button", { name: "Where's best tomorrow?" })
    .click();

  const log = panel(page).getByRole("log", { name: "Conversation with Gust" });
  await expect(log.getByText("Where's best tomorrow?")).toBeVisible();
  const chips = log.getByRole("list", { name: "What Gust looked up" });
  await expect(chips.locator('li[data-status="done"]')).toHaveCount(1);
  const cards = log.locator("[data-spot-card]");
  await expect(cards.first()).toBeVisible();
  await expect(
    log.getByText(/your best bet|Nothing's looking rideable/),
  ).toBeVisible();

  const first = cards.first();
  const id = await first.getAttribute("data-spot-card");
  const name = await first.getByRole("heading").textContent();
  expect(id).toBeTruthy();
  await expect(first).toContainText(/★/);

  await first.getByRole("button", { name: "Show on map" }).click();
  await expect(
    page.locator(`.spot-marker.sel[data-spot-id="${id}"]`),
  ).toBeVisible();
  await expect(page.locator(".dock .dk-name")).toHaveText(name!);
  // Showing it moves no conversation along and leaves the panel where it was.
  await expect(panel(page)).toBeVisible();
});

test("a profile is only saved when the rider confirms it", async ({ page }) => {
  await openMap(page);
  await launcher(page).click();
  const box = panel(page).getByRole("textbox", { name: "Message Gust" });
  await box.fill("I'm 85 kg and ride a 4, 5 and 6 m");
  await box.press("Enter");

  const card = panel(page).getByRole("article", {
    name: "Rider profile proposal",
  });
  await expect(card).toContainText("Save 85 kg · Riding · 4/5/6 m?");
  const stored = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("force5.prefs.v1") ?? "{}").rider ??
        null,
    );
  expect(await stored()).toBeNull();

  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card).toContainText("Saved: 85 kg · Riding · 4/5/6 m");
  expect(await stored()).toEqual({
    weightKg: 85,
    skill: "intermediate",
    wings: [4, 5, 6],
  });
  // The dock re-rates for the new rider at once, and says who for.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "About these figures" }).click();
  await expect(
    page.getByRole("dialog", { name: "About these figures" }),
  ).toContainText("85 kg intermediate");
});

test("the conversation survives a reload, and a new chat clears it", async ({
  page,
}) => {
  await openMap(page);
  await launcher(page).click();
  await panel(page)
    .getByRole("button", { name: "What wing should I take?" })
    .click();
  const log = panel(page).getByRole("log", { name: "Conversation with Gust" });
  // The transcript is kept once a turn has settled, not mid-stream.
  await expect(log.getByText(/your best bet|no rideable window/)).toBeVisible();
  await expect(log.locator("[data-spot-card]")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 20000,
  });
  await launcher(page).click();
  await expect(log.getByText("What wing should I take?")).toBeVisible();
  await expect(log.locator("[data-spot-card]")).toHaveCount(1);

  await panel(page).getByRole("button", { name: "New chat" }).click();
  await expect(panel(page).getByText("Where to, rider?")).toBeVisible();
});

test("Ctrl+J toggles Gust and Escape closes him without closing the dock", async ({
  page,
}) => {
  await openMap(page);
  await page.keyboard.press("Control+j");
  await expect(panel(page)).toBeVisible();
  await expect(
    panel(page).getByRole("textbox", { name: "Message Gust" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(launcher(page)).toBeFocused();
  await expect(page.locator(".dock")).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(panel(page)).toBeHidden();
});

test("the launcher covers none of the map's controls or the dock", async ({
  page,
}) => {
  await openMap(page);
  const box = (await launcher(page).boundingBox())!;
  for (const selector of [".map-ctrl", ".map-print", ".map-footer", ".map-head"]) {
    const other = (await page.locator(selector).boundingBox())!;
    const overlaps =
      box.x < other.x + other.width &&
      other.x < box.x + box.width &&
      box.y < other.y + other.height &&
      other.y < box.y + box.height;
    expect(overlaps, selector).toBe(false);
  }
});

test("asleep when the server has no companion, and says so", async ({
  page,
}) => {
  await page.route("**/api/companion/status", (route) =>
    route.fulfill({ json: { configured: false, fake: false } }),
  );
  await openMap(page);
  await expect(launcher(page)).toHaveAttribute("data-mood", "asleep");
  await launcher(page).click();
  await expect(
    panel(page).getByText("Gust is asleep", { exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("textbox", { name: "Message Gust" }),
  ).toBeDisabled();
});
