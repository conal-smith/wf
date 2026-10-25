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
  const count = wizard.locator(".cw-count");
  // One title a step, in the head, with how far through it is; no step labels.
  const title = (name: string, n: number) =>
    Promise.all([
      expect(wizard.getByRole("heading", { name, exact: true })).toBeVisible(),
      expect(count).toHaveText(`${n} / 6`),
    ]);

  // 1. How they ride: Riding to start, the wings and the units here too.
  await title("How do you ride?", 1);
  await expect(wizard.getByText("Customise your chart")).toHaveCount(0);
  await expect(wizard.getByText("The Almanac")).toHaveCount(0);
  await expect(wizard.getByRole("button", { name: /^Riding/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(wizard.getByRole("button", { name: /^Riding/ })).toContainText(
    "Riding both ways, starting to gybe.",
  );
  await wizard.getByLabel("Wings you own").fill("4, 5.5");
  await expect(
    wizard.getByRole("group", { name: "Wind units" }).getByRole("button", {
      name: "kn",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await next.click();

  // 2. The wind: a real day re-rated as a handle moves.
  await title("What wind suits you?", 2);
  const preview = wizard.locator("[data-sample]");
  await expect(preview).toBeVisible();
  const before = await preview.innerHTML();
  const floor = wizard.getByRole("slider", { name: "Too light below" });
  await floor.focus();
  await page.keyboard.press("PageUp");
  await expect(floor).toHaveAttribute("aria-valuetext", "13 kn");
  await expect.poll(() => preview.innerHTML()).not.toBe(before);
  await expect(
    wizard.getByRole("slider", { name: "Too much, in gusts" }),
  ).toBeVisible();
  await expect(wizard.getByText("a gust past here: no stars")).toBeVisible();
  // Gusty wind: Some to start, and no gust curve to drag.
  const gusty = wizard.getByRole("group", { name: "Gusty wind" });
  await expect(gusty.getByRole("button", { name: "Some" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    wizard.getByText("How much does uneven wind bother you?"),
  ).toBeVisible();
  await expect(wizard.getByRole("slider", { name: /^Gusts/ })).toHaveCount(0);
  await gusty.getByRole("button", { name: "A lot" }).click();
  await next.click();

  // 3. Stars by wind direction: a dot dragged to the middle is never, and
  // each dot is a slider from the keyboard.
  await title("Stars by wind direction", 3);
  const dot = (name: string) =>
    wizard.getByRole("slider", {
      name: `${name}: stars taken off`,
      exact: true,
    });
  await expect(dot("Cross-shore")).toHaveAttribute("aria-valuetext", "no cost");
  const web = await wizard.locator("[data-direction-web]").boundingBox();
  const offDot = await wizard
    .locator('[data-dot="crossOff"] .cw-dot-face')
    .first()
    .boundingBox();
  await page.mouse.move(
    offDot!.x + offDot!.width / 2,
    offDot!.y + offDot!.height / 2,
  );
  await page.mouse.down();
  // The beach, the web's middle, is 158 of its 316 units across and 140 of 284 down.
  await page.mouse.move(
    web!.x + (158 / 316) * web!.width,
    web!.y + (140 / 284) * web!.height,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(dot("Cross-offshore")).toHaveAttribute(
    "aria-valuetext",
    "never",
  );
  await expect(wizard.locator('[data-direction="crossOff"]')).toContainText(
    "never",
  );
  for (const name of ["Onshore", "Cross-shore", "Offshore"]) {
    await dot(name).focus();
    await page.keyboard.press("End");
    await expect(dot(name)).toHaveAttribute("aria-valuetext", "never");
  }
  await dot("Cross-onshore").focus();
  await page.keyboard.press("ArrowUp");
  await expect(dot("Cross-onshore")).toHaveAttribute("aria-valuetext", "−0.5★");
  await page.keyboard.press("ArrowDown");
  await expect(dot("Cross-onshore")).toHaveAttribute(
    "aria-valuetext",
    "no cost",
  );

  // Back and on again keeps what was set.
  await wizard.getByRole("button", { name: "Back" }).click();
  await expect(floor).toHaveAttribute("aria-valuetext", "13 kn");
  await next.click();
  await next.click();

  // 4. Upwind: degrees into the wind, Riding's 20° to start.
  await title("Can you ride upwind?", 4);
  const answers = wizard.getByRole("group", { name: "Can you ride upwind?" });
  const into = wizard.locator("[data-upwind] output");
  await expect(into).toHaveText("20°");
  await expect(answers.getByRole("button", { name: /^Yes/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Each side's angle is in magenta on the picture; straight across, none.
  await expect(wizard.locator(".cw-up-deg")).toHaveText(["20°", "20°"]);
  await answers.getByRole("button", { name: /^Not yet/ }).click();
  await expect(into).toHaveText("0°");
  await expect(wizard.locator(".cw-up-deg")).toHaveCount(0);
  const slide = wizard.getByRole("slider", { name: "Degrees into the wind" });
  await expect(slide).toHaveAttribute(
    "aria-valuetext",
    "straight across the wind",
  );
  // The course's edge on the picture is a handle: dragged to 60° off the
  // wind, it is 30° into it.
  const pic = await wizard.locator(".cw-up-pic").boundingBox();
  const edge = await wizard
    .locator('[data-edge="right"] .cw-up-edge-dot')
    .boundingBox();
  const k = pic!.width / 372;
  const [cx, cy] = [pic!.x + 186 * k, pic!.y + 168 * k];
  await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2);
  await page.mouse.down();
  const off = (60 * Math.PI) / 180;
  await page.mouse.move(cx + Math.sin(off) * 100, cy - Math.cos(off) * 100, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(into).toHaveText("30°");
  await expect(wizard.locator(".cw-up-deg")).toHaveText(["30°", "30°"]);
  // And a degree at a time from the keyboard.
  await slide.focus();
  await slide.press("ArrowLeft");
  await slide.press("ArrowLeft");
  await expect(into).toHaveText("28°");
  await expect(slide).toHaveAttribute("aria-valuetext", "28° into the wind");
  await next.click();

  // 5. Your spots: nearest to where the map is, and starring moves nothing.
  await title("Your spots", 5);
  await expect(wizard.locator("[data-near]")).toContainText(
    "Nearest to where the map is · ",
  );
  await expect(
    wizard.getByRole("button", { name: "Use my location" }),
  ).toBeVisible();
  const names = () =>
    wizard.locator(".cw-spot-list .cw-spot-name b").allTextContents();
  const order = await names();
  const third = wizard.locator(".cw-spot-list li").nth(2).getByRole("button");
  await third.click();
  await expect(third).toHaveAttribute("aria-pressed", "true");
  expect(await names()).toEqual(order);
  await next.click();

  // 6. All set: the lot, each with a way back to it, and the day for you.
  await title("All set", 6);
  await expect(wizard.locator("[data-sample]")).toBeVisible();
  await expect(wizard.locator('[data-sum="upwind"]')).toContainText(
    "28° into the wind",
  );
  await expect(wizard.locator('[data-sum="wind"]')).toContainText(
    "gusty: a lot",
  );
  await expect(wizard.locator('[data-sum="you"]')).toContainText(
    "wings 4, 5.5 m²",
  );
  await expect(wizard.locator('[data-sum="spots"]')).toContainText(order[2]);
  await expect(wizard.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await wizard.getByRole("button", { name: "Change shore" }).click();
  await title("Stars by wind direction", 3);
  // Skip goes to the end, keeping what was set.
  await wizard.getByRole("button", { name: "Skip" }).click();
  await title("All set", 6);
  await wizard.getByRole("button", { name: "Show me the chart" }).click();
  await expect(wizard).toHaveCount(0);

  // Saved where Display options and the dock read the rider.
  const rider = await page.evaluate(
    () => JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider,
  );
  expect(rider.upwind).toBe(28);
  expect(rider).not.toHaveProperty("pointing");
  expect(rider.gusty).toBe("lots");
  expect(rider.custom.wind.min).toBe(13);
  expect(rider.wings).toEqual([4, 5.5]);
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
  await page.waitForTimeout(500);
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
  await page.waitForTimeout(500);
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
  await expect(page.getByRole("dialog", { name: "Customise" })).toBeVisible();
});

test("a browser that says it is automated is never offered the tour", async ({
  page,
}) => {
  await page.goto("/");
  await mapUp(page);
  await page.waitForTimeout(500);
  await expect(prompt(page)).toHaveCount(0);
});

/** A row of the menu that opens no dialog of the menu's own naming. */
async function openFromMenuRow(page: Page, name: "Take the tour") {
  const menu = page.getByRole("button", { name: "Site menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await page
    .getByRole("group", { name: "This chart" })
    .getByRole("button", { name, exact: true })
    .click();
}
