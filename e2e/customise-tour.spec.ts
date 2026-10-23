import { SAMPLE_CLOCK } from "./columns";
import { expect, openFromMenu, test, type Page } from "./fixtures";

/**
 * Customise (src/Customise.tsx) and the tour (src/Tour.tsx): the wizard
 * saves to the settings the stars are rated on, so the lights and the dock
 * re-rate as it closes; the tour is offered once, on a first visit, can be
 * skipped, and is never offered again.
 *
 * A browser driven by Playwright is never offered the tour
 * (src/tourOffer.ts), so no other spec meets it; these ask for it by
 * `TOUR_TEST_KEY`.
 */
const TOUR_KEY = "wingfoil.tour.v1";
const TOUR_TEST_KEY = "wingfoil.tour.e2e";

/** An afternoon of the sample run, when the lights are rated. */
const AFTERNOON = new Date(SAMPLE_CLOCK.getTime() - 7 * 3600000);

/** How many lights show each number of stars. */
const lightStars = (page: Page) =>
  page.locator(".spot-marker").evaluateAll((lights) => {
    const count = [0, 0, 0, 0, 0, 0];
    for (const light of lights)
      for (let n = 0; n <= 5; n++)
        if (light.classList.contains(`s${n}`)) count[n]++;
    return count;
  });

const dockStars = (page: Page) =>
  page
    .locator(".dock tr.tt-stars td[data-i]")
    .evaluateAll((cells) => cells.map((cell) => cell.innerHTML).join("|"));

test("Customise walks through the rider's settings and saves them, and the lights and the dock re-rate", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(AFTERNOON);
  await page.goto("/?spot=brandon");
  await expect(
    page.locator(".dock tr.tt-stars td[data-i] svg").first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".spot-marker.s5").first()).toBeAttached({
    timeout: 30000,
  });
  const lightsBefore = await lightStars(page);
  const dockBefore = await dockStars(page);

  await openFromMenu(page, "Customise");
  const wizard = page.getByRole("dialog", { name: "Customise" });
  const next = wizard.getByRole("button", { name: "Next", exact: true });

  // 1. The level: Riding to start, as Display options has it.
  await expect(
    wizard.getByRole("heading", { name: "How do you ride?" }),
  ).toBeVisible();
  await expect(wizard.getByRole("button", { name: /^Riding/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await next.click();

  // 2. The wind: a real day re-rated as a handle moves.
  const preview = wizard.locator("[data-preview]");
  await expect(preview).toBeVisible();
  const before = await preview.innerHTML();
  const floor = wizard.getByRole("slider", { name: "Too light below" });
  await floor.focus();
  await page.keyboard.press("PageUp");
  await expect(floor).toHaveAttribute("aria-valuetext", "13 kn");
  await expect.poll(() => preview.innerHTML()).not.toBe(before);
  await next.click();

  // 3. The shore: every way of wind but the kind one, never.
  for (const name of ["Onshore", "Cross-shore", "Cross-offshore", "Offshore"])
    await wizard
      .getByRole("group", { name, exact: true })
      .getByRole("button", { name: "Never" })
      .click();
  await expect(
    wizard
      .getByRole("group", { name: "Cross-onshore", exact: true })
      .getByRole("button", { name: "Ride" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Back and on again keeps what was set.
  await wizard.getByRole("button", { name: "Back" }).click();
  await expect(floor).toHaveAttribute("aria-valuetext", "13 kn");
  await next.click();
  await next.click();

  // 4. Pointing, 5. units, 6. spots, 7. the lot.
  await wizard
    .getByRole("group", { name: "Pointing upwind" })
    .getByRole("button", { name: "Sharp" })
    .click();
  await next.click();
  await next.click();
  await next.click();
  await expect(wizard.getByText("Here’s what we’ll show you")).toBeVisible();
  await expect(wizard.locator("[data-sample]")).toBeVisible();
  await wizard.getByRole("button", { name: "Show me the chart" }).click();
  await expect(wizard).toHaveCount(0);

  // Saved where Display options and the dock read the rider.
  const rider = await page.evaluate(
    () => JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider,
  );
  expect(rider.pointing).toBe("sharp");
  expect(rider.custom.wind.min).toBe(13);
  expect(rider.custom.direction).toEqual({
    onshore: 5,
    crossOn: 0,
    cross: 5,
    crossOff: 5,
    offshore: 5,
  });
  // The lights re-rate: most beaches now see a wind they will not ride.
  await expect
    .poll(async () => (await lightStars(page))[0], { timeout: 30000 })
    .toBeGreaterThan(lightsBefore[0]);
  await expect.poll(() => dockStars(page)).not.toBe(dockBefore);

  // Re-entered, it starts from what was saved; Escape keeps nothing new.
  await openFromMenu(page, "Customise");
  await next.click();
  await expect(floor).toHaveAttribute("aria-valuetext", "13 kn");
  await floor.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(wizard).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider.custom.wind
          .min,
    ),
  ).toBe(13);
  expect(errors).toEqual([]);
});

const card = (page: Page) => page.locator(".tour-card");
const prompt = (page: Page) => page.getByRole("dialog", { name: "New here?" });
const mapUp = (page: Page) =>
  expect(page.locator(".spot-marker").first()).toBeAttached({
    timeout: 30000,
  });

test("the tour is offered on a first visit, can be skipped, and is not offered again", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "1"),
    TOUR_TEST_KEY,
  );
  await page.clock.setFixedTime(AFTERNOON);
  await page.goto("/");
  await expect(prompt(page)).toBeVisible({ timeout: 30000 });
  await prompt(page).getByRole("button", { name: "Take the tour" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(card(page)).toContainText("The tour · 1 of 7");
  await expect(card(page)).toContainText("The lights");
  // The pen's ring is round a light.
  await expect(page.locator(".tour-ring path")).toBeVisible();
  await card(page).getByRole("button", { name: "Next" }).click();
  // Tapping a light: the tour opens a spot's hours.
  await expect(card(page)).toContainText("2 of 7");
  await expect(page.locator(".dock")).toBeVisible({ timeout: 30000 });
  await card(page).getByRole("button", { name: "Back" }).click();
  await expect(card(page)).toContainText("1 of 7");
  await card(page).getByRole("button", { name: "Next" }).click();
  await card(page).getByRole("button", { name: "Skip tour" }).click();
  await expect(card(page)).toHaveCount(0);
  // The chart as it was: no spot was open, so none is.
  await expect(page.locator(".dock")).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), TOUR_KEY),
  ).toBe("seen");

  await page.reload();
  await mapUp(page);
  await page.waitForTimeout(1500);
  await expect(prompt(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

test("No thanks is never asked again; Escape leaves the tour; the menu replays it to the end, and on to Customise", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "1"),
    TOUR_TEST_KEY,
  );
  await page.clock.setFixedTime(AFTERNOON);
  await page.goto("/");
  await expect(prompt(page)).toBeVisible({ timeout: 30000 });
  await prompt(page).getByRole("button", { name: "No thanks" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await page.reload();
  await mapUp(page);
  await page.waitForTimeout(1500);
  await expect(prompt(page)).toHaveCount(0);

  // From the menu, at any time; Escape leaves it.
  await openFromMenuRow(page, "Take the tour");
  await expect(card(page)).toContainText("1 of 7");
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  // Through every card: the dock, the hours, the loupe, the blend, the menu, the layers.
  await openFromMenuRow(page, "Take the tour");
  const steps = ["lights", "dock", "hours", "loupe", "blend", "menu", "layers"];
  for (const [i, id] of steps.entries()) {
    await expect(page.locator(".tour")).toHaveAttribute("data-step", id);
    await expect(card(page)).toContainText(`${i + 1} of 7`);
    await expect(page.locator(".tour-ring path")).toBeVisible({
      timeout: 15000,
    });
    if (id === "layers")
      await expect(
        page.getByRole("dialog", { name: "Layers", exact: true }),
      ).toBeVisible();
    await card(page)
      .getByRole("button", { name: i === steps.length - 1 ? "Finish" : "Next" })
      .click();
  }
  await expect(card(page)).toContainText("That’s the chart");
  await expect(
    page.getByRole("dialog", { name: "Layers", exact: true }),
  ).toHaveCount(0);
  await card(page).getByRole("button", { name: "Customise" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Customise your chart" }),
  ).toBeVisible();
});

test("a browser that says it is automated is never offered the tour", async ({
  page,
}) => {
  await page.goto("/");
  await mapUp(page);
  await page.waitForTimeout(1500);
  await expect(prompt(page)).toHaveCount(0);
});

/** A row of the menu that opens no dialog of the menu's own naming. */
async function openFromMenuRow(page: Page, name: "Take the tour") {
  const menu = page.getByRole("button", { name: "Site menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await page
    .getByRole("group", { name: "The chart" })
    .getByRole("button", { name, exact: true })
    .click();
}
