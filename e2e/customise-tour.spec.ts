import { SAMPLE_CLOCK } from "./columns";
import {
  expect,
  layersRail,
  openFromMenu,
  siteRow,
  test,
  type Page,
} from "./fixtures";

/**
 * Settings (src/Settings.tsx) and the tour (src/Tour.tsx): Settings saves
 * to the preferences the stars are rated on, so the lights and the dock
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

test("Settings holds the rider's settings on one page and saves them, and the lights and the dock re-rate", async ({
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

  await openFromMenu(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settings.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  // One page, in four parts: no steps, no spots, no summary.
  await expect(settings.locator(".st-h")).toHaveText([
    "About you",
    "Wind strength",
    "Wind direction",
    "Riding upwind",
  ]);
  for (const name of ["Next", "Back", "Skip"])
    await expect(
      settings.getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
  await expect(settings.getByRole("progressbar")).toHaveCount(0);
  await expect(settings.getByText("Your spots")).toHaveCount(0);
  await expect(settings.getByLabel("Find a spot")).toHaveCount(0);
  await expect(settings.locator("[data-sample]")).toHaveCount(0);

  // About you: the weight and the units; no levels, no wings.
  await expect(
    settings.getByText("Your weight helps us suggest the right wing size."),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: /^Riding/ })).toHaveCount(
    0,
  );
  await expect(settings.getByLabel("Wings you own")).toHaveCount(0);
  await expect(
    settings.getByRole("group", { name: "Units" }).getByRole("button", {
      name: "Knots",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(settings.locator(".st-row .st-kick")).toHaveText([
    "Weight",
    "Units",
  ]);
  // Everything is ours to start: nothing to reset.
  const reset = settings.getByRole("button", { name: "Reset to ours" });
  await expect(reset).toHaveCount(0);
  await settings.getByRole("button", { name: "Heavier" }).click();
  // Weight is the rider's own, never ours to reset.
  await expect(reset).toHaveCount(0);

  // The wind: two handles, ours 11 and 35, the sweet spot (15–22) worked
  // out between them, and the stars they make right under the track; no
  // gust setting.
  const floor = settings.getByRole("slider", { name: "Too light below" });
  const much = settings.getByRole("slider", {
    name: "Too strong in gusts above",
  });
  await expect(floor).toHaveAttribute("aria-valuetext", "11 kn");
  await expect(much).toHaveAttribute("aria-valuetext", "35 kn");
  await expect(settings.locator(".st-knob")).toHaveCount(2);
  // Each handle wears the ring that says it can be dragged.
  await expect(settings.locator(".st-knob.st-grab")).toHaveCount(2);
  // In metres per second the two read as whole figures, 6 and 18, not the
  // knots converted (5.7 and 18.0), and back in knots they are as they were.
  const units = settings.getByRole("group", { name: "Units" });
  await units.getByRole("button", { name: "m/s", exact: true }).click();
  await expect(floor).toHaveAttribute("aria-valuetext", "6 m/s");
  await expect(settings.locator(".st-knob")).toHaveText(["6", "18"]);
  await units.getByRole("button", { name: "Knots", exact: true }).click();
  await expect(floor).toHaveAttribute("aria-valuetext", "11 kn");
  await expect(much).toHaveAttribute("aria-valuetext", "35 kn");
  await expect(settings.getByRole("group", { name: "Gusty wind" })).toHaveCount(
    0,
  );
  const strip = settings.locator("[data-star-strip] [data-stars]");
  await expect(strip).toHaveText(["1", "2", "3", "4", "5", "4", "3", "2", "1"]);
  await expect(settings.getByText("no stars past here")).toBeVisible();
  await floor.focus();
  // Too light up five is 16, and the sweet spot moves up with it.
  await page.keyboard.press("PageUp");
  await expect(floor).toHaveAttribute("aria-valuetext", "16 kn");
  await page.keyboard.press("ArrowLeft");
  await expect(floor).toHaveAttribute("aria-valuetext", "15 kn");
  // The strip follows: one star from 15, then a climb to four under 18.
  await expect(strip.first()).toHaveText("1");
  await expect(
    settings.locator('[data-star-strip] [data-stars="4"]').first(),
  ).toBeVisible();
  await expect(reset).toBeVisible();

  // Stars by wind direction: whole stars, a dot dragged to the middle is
  // no stars, each dot is a slider from the keyboard, and offshore is locked.
  const dot = (name: string) =>
    settings.getByRole("slider", {
      name: `${name}: stars taken off`,
      exact: true,
    });
  await expect(dot("Cross-shore")).toHaveAttribute(
    "aria-valuetext",
    "Full stars",
  );
  await expect(dot("Cross-offshore")).toHaveAttribute(
    "aria-valuetext",
    "1 star off",
  );
  await expect(dot("Offshore")).toHaveAttribute("aria-valuetext", "No stars");
  await expect(dot("Offshore")).toHaveAttribute("aria-readonly", "true");
  await expect(settings.locator('[data-direction="offshore"]')).toContainText(
    "We don't recommend going out in it.",
  );
  const webBox = settings.locator("[data-direction-web]");
  await webBox.scrollIntoViewIfNeeded();
  const web = await webBox.boundingBox();
  const offDot = await settings
    .locator('[data-dot="crossOff"] .st-dot-face')
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
    "No stars",
  );
  await expect(settings.locator('[data-direction="crossOff"]')).toContainText(
    "No stars",
  );
  // Offshore cannot be dragged or keyed off no stars.
  await dot("Offshore").focus();
  await page.keyboard.press("Home");
  await expect(dot("Offshore")).toHaveAttribute("aria-valuetext", "No stars");
  for (const name of ["Onshore", "Cross-shore"]) {
    await dot(name).focus();
    await page.keyboard.press("End");
    await expect(dot(name)).toHaveAttribute("aria-valuetext", "No stars");
  }
  await dot("Cross-onshore").focus();
  await page.keyboard.press("ArrowUp");
  await expect(dot("Cross-onshore")).toHaveAttribute(
    "aria-valuetext",
    "1 star off",
  );
  await page.keyboard.press("ArrowDown");
  await expect(dot("Cross-onshore")).toHaveAttribute(
    "aria-valuetext",
    "Full stars",
  );

  // Upwind: straight across and Not yet to start, the course to 10°
  // downwind; two angles, each set by its handles on the picture (the
  // right-hand one a slider from the keyboard), and no sliders beside it.
  const answers = settings.getByRole("group", { name: "Can you ride upwind?" });
  const into = settings.locator("[data-upwind] output");
  const below = settings.locator("[data-downwind] output");
  await expect(into).toHaveText("0°");
  await expect(below).toHaveText("10°");
  await expect(
    answers.getByRole("button", { name: "Not yet" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(settings.locator("[data-answer]")).toHaveText(
    "I can ride across the wind without losing ground.",
  );
  await expect(settings.locator(".st-up-pic")).toContainText("DRIFT");
  await expect(settings.locator(".st-up-pic")).toContainText("YOU LOSE GROUND");
  await expect(settings.locator(".st-up-pic")).not.toContainText("SLOW");
  await expect(settings.locator(".st-slide")).toHaveCount(0);
  await expect(settings.locator(".st-up-pic .st-grab-ring")).toHaveCount(4);
  // Straight across: no magenta angle, only the course's 10° downwind.
  await expect(settings.locator(".st-up-deg:not(.is-down)")).toHaveCount(0);
  await expect(settings.locator(".st-up-deg.is-down")).toHaveText([
    "10°",
    "10°",
  ]);
  await answers.getByRole("button", { name: "Yes" }).click();
  await expect(into).toHaveText("20°");
  await expect(settings.locator("[data-answer]")).toHaveText(
    "I can ride upwind with no trouble.",
  );
  await expect(settings.locator(".st-up-deg:not(.is-down)")).toHaveText([
    "20°",
    "20°",
  ]);
  await answers.getByRole("button", { name: "Not yet" }).click();
  const slide = settings.getByRole("slider", {
    name: "How far upwind you can ride",
  });
  await expect(slide).toHaveAttribute(
    "aria-valuetext",
    "straight across the wind",
  );
  // The course's upwind edge on the picture is a handle: dragged to 60° off
  // the wind, it is 30° into it.
  const picBox = settings.locator(".st-up-pic");
  await picBox.scrollIntoViewIfNeeded();
  const pic = await picBox.boundingBox();
  const edge = await settings
    .locator('[data-edge="into-right"] .st-up-edge-dot')
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
  // And a degree at a time from the keyboard.
  await slide.focus();
  await slide.press("ArrowLeft");
  await slide.press("ArrowLeft");
  await expect(into).toHaveText("28°");
  await expect(slide).toHaveAttribute("aria-valuetext", "28° upwind");
  const down = settings.getByRole("slider", {
    name: "How far downwind you will ride",
  });
  await down.focus();
  await down.press("PageUp");
  await expect(below).toHaveText("15°");
  await expect(down).toHaveAttribute("aria-valuetext", "15° downwind");

  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);

  // Saved where the dock and every page read the rider.
  const rider = await page.evaluate(
    () => JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider,
  );
  expect(rider.upwind).toBe(28);
  expect(rider.downwind).toBe(15);
  expect(rider.weightKg).toBe(85);
  expect(rider).not.toHaveProperty("skill");
  expect(rider).not.toHaveProperty("gusty");
  expect(rider.custom.version).toBe(3);
  expect(rider.custom.wind).toEqual({
    min: 15,
    sweetLow: 18,
    sweetHigh: 24,
    max: 35,
  });
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

  const storedMin = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider.custom.wind
          .min,
    );
  // Opened again, it starts from what was saved; Escape keeps nothing new,
  // and nor does Cancel.
  await openFromMenu(page, "Settings");
  await expect(floor).toHaveAttribute("aria-valuetext", "15 kn");
  await floor.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  expect(await storedMin()).toBe(15);
  await openFromMenu(page, "Settings");
  await expect(floor).toHaveAttribute("aria-valuetext", "15 kn");
  await floor.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(floor).toHaveAttribute("aria-valuetext", "14 kn");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(await storedMin()).toBe(15);

  // Reset to ours, saved, leaves no rating of their own; weight stays.
  await openFromMenu(page, "Settings");
  await reset.click();
  await expect(reset).toHaveCount(0);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider,
  );
  expect(after).not.toHaveProperty("custom");
  expect(after).not.toHaveProperty("upwind");
  expect(after).not.toHaveProperty("downwind");
  expect(after.weightKg).toBe(85);
  expect(errors).toEqual([]);
});

test("Settings starts from ours over settings stored before 25 October 2026, without a fault", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({
        version: 2,
        rider: {
          weightKg: 90,
          skill: "advanced",
          gusty: "lots",
          upwind: 40,
          wings: [4],
          custom: {
            version: 2,
            base: "advanced",
            wind: { min: 8, sweetLow: 13, sweetHigh: 28, max: 35 },
            direction: {
              onshore: 0,
              crossOn: 0,
              cross: 0,
              crossOff: 1,
              offshore: 4,
            },
          },
          keptCustom: null,
        },
      }),
    ),
  );
  await page.goto("/?spot=brandon");
  await expect(
    page.locator(".dock tr.tt-stars td[data-i]").first(),
  ).toBeAttached({ timeout: 30000 });
  await openFromMenu(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".st-stepper output")).toContainText("90");
  await expect(
    settings.getByRole("button", { name: "Reset to ours" }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("slider", { name: "Too light below" }),
  ).toHaveAttribute("aria-valuetext", "11 kn");
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
  await page.goto("/?map");
  await expect(prompt(page)).toBeVisible({ timeout: 30000 });
  await expect(prompt(page)).toContainText(
    "Take a 30-second tour of how the site works.",
  );
  await prompt(page).getByRole("button", { name: "Take the tour" }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(card(page)).toContainText("Step 1 of 7");
  await expect(card(page)).toContainText("Spots on the map");
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

test("No thanks is never asked again; Escape leaves the tour; the menu replays it to the end, and on to Settings", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "1"),
    TOUR_TEST_KEY,
  );
  await page.clock.setFixedTime(AFTERNOON);
  await page.goto("/?map");
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
    // The layers' card opens the rail by the zoom, and rings it.
    if (id === "layers") await expect(layersRail(page)).toBeVisible();
    await card(page)
      .getByRole("button", { name: i === steps.length - 1 ? "Finish" : "Next" })
      .click();
  }
  await expect(card(page)).toContainText("That’s the end of the tour");
  await expect(card(page)).not.toContainText("Almanac");
  // Shut again, as it was before the tour.
  await expect(layersRail(page)).toBeHidden();
  await card(page).getByRole("button", { name: "Open Settings" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("a browser that says it is automated is never offered the tour", async ({
  page,
}) => {
  await page.goto("/?map");
  await mapUp(page);
  await page.waitForTimeout(500);
  await expect(prompt(page)).toHaveCount(0);
});

/** A row of the menu that opens no dialog of the menu's own naming. */
async function openFromMenuRow(page: Page, name: "Take the tour") {
  const menu = page.getByRole("button", { name: "Site menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await siteRow(page, name).click();
}
