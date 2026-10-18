import { expect, rememberSpot, test, type Page } from "./fixtures";

/**
 * "Your star rating" (spot/web/YourStarsDialog.tsx): opened from Display
 * options, set with the keyboard as well as the pointer, saved to the rider
 * the whole site rates for, and reset.
 */

async function openMap(page: Page, width = 1440, height = 1000) {
  await rememberSpot(page, "brandon");
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
}

const options = (page: Page) =>
  page.getByRole("button", { name: "Display options", exact: true });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Your star rating" });
const stars = (page: Page) =>
  page
    .locator(".dock tr.tt-stars td[data-i]")
    .evaluateAll((cells) => cells.map((cell) => cell.innerHTML).join("|"));

test("a rider sets their own stars, which the dock then rates with, and resets them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMap(page);
  await expect(
    page.locator(".dock tr.tt-stars td[data-i] svg").first(),
  ).toBeVisible({ timeout: 30000 });
  const before = await stars(page);

  await options(page).click();
  const row = page.locator("[data-star-rating]");
  await expect(row).toContainText("Standard for Riding");
  await row.getByRole("button", { name: "Customise" }).click();
  const box = dialog(page);
  await expect(box).toBeVisible();

  // The handles, from the keyboard: a knot a step, and a knot apart.
  const min = box.getByRole("slider", { name: "Minimum wind speed" });
  await expect(min).toHaveAttribute("aria-valuetext", "11 kn");
  await min.focus();
  await page.keyboard.press("ArrowRight");
  await expect(min).toHaveAttribute("aria-valuetext", "12 kn");
  await page.keyboard.press("PageUp");
  // Stopped a knot short of "ideal from", at 14.
  await expect(min).toHaveAttribute("aria-valuetext", "13 kn");

  // The gusts' worst, dragged hard left, stops a knot past their fine.
  const worst = box.getByRole("slider", {
    name: "Gusts take off the most from",
  });
  await worst.focus();
  await page.keyboard.press("Home");
  await expect(worst).toHaveAttribute("aria-valuetext", "29 kn");
  await box.getByRole("button", { name: "3★" }).click();

  // A direction, by its dot and by the buttons under the web.
  const offshore = box.getByRole("slider", {
    name: "Offshore: stars taken off",
    exact: true,
  });
  await offshore.focus();
  await page.keyboard.press("ArrowUp");
  await expect(offshore).toHaveAttribute("aria-valuetext", "−3½ stars");
  await expect(box.locator("[data-picked]")).toHaveAttribute(
    "data-picked",
    "offshore",
  );
  await box.getByRole("button", { name: "Take off half a star less" }).click();
  await expect(offshore).toHaveAttribute("aria-valuetext", "−3 stars");
  // A tap on a slice picks its direction and changes nothing.
  const slice = box.locator('[data-slice="onshore"]');
  const wedge = (await slice.boundingBox())!;
  await slice.click({
    position: { x: wedge.width / 2, y: wedge.height * 0.6 },
  });
  await expect(box.locator("[data-picked]")).toHaveAttribute(
    "data-picked",
    "onshore",
  );
  await expect(box.locator("[data-picked-value]")).toHaveText("−1★");

  // The examples say where theirs and the level's part.
  await expect(
    box.locator("[data-stars-examples] td.font-semibold"),
  ).not.toHaveCount(0);

  await box.getByRole("button", { name: "Save" }).click();
  await expect(box).toBeHidden();
  await expect.poll(() => stars(page)).not.toBe(before);
  await options(page).click();
  await expect(row).toContainText("Custom");
  await options(page).click();

  // The dock's chip says so, and opens the dialog on what was saved.
  const chip = page.getByRole("button", { name: "Custom star rating: edit" });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(min).toHaveAttribute("aria-valuetext", "13 kn");
  // Cancel keeps nothing.
  await min.focus();
  await page.keyboard.press("ArrowLeft");
  await box.getByRole("button", { name: "Cancel" }).click();
  await chip.click();
  await expect(min).toHaveAttribute("aria-valuetext", "13 kn");
  await box.getByRole("button", { name: "Close" }).click();

  // Kept on reload, and reset from the settings.
  await page.reload();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  await expect(chip).toBeVisible();
  await options(page).click();
  await row.getByRole("button", { name: "Reset" }).click();
  await expect(row).toContainText("Standard for Riding");
  await expect(chip).toHaveCount(0);
  await expect.poll(() => stars(page)).toBe(before);
  expect(errors).toEqual([]);
});

test("the dialog speaks the rider's unit and keeps knots", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("force5.prefs.v1", JSON.stringify({ units: "mph" })),
  );
  await openMap(page);
  await options(page).click();
  await page
    .locator("[data-star-rating]")
    .getByRole("button", { name: "Customise" })
    .click();
  const box = dialog(page);
  const max = box.getByRole("slider", { name: "Maximum wind speed" });
  // 30 kn is 34.5 mph, shown whole.
  await expect(max).toHaveAttribute("aria-valuetext", "35 mph");
  await max.focus();
  await page.keyboard.press("ArrowRight");
  await expect(max).toHaveAttribute("aria-valuetext", "36 mph");
  await expect(box.locator("[data-stars-examples] th").first()).toHaveText(
    "Forecast, mph",
  );
  await box.getByRole("button", { name: "Save" }).click();
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider.custom.wind
        .max,
  );
  // 36 mph in knots, to the tenth.
  expect(stored).toBe(31.3);
});

test("on a phone the dialog fits the width, and the web drags", async ({
  page,
}) => {
  await openMap(page, 390, 844);
  await options(page).click();
  await page
    .locator("[data-star-rating]")
    .getByRole("button", { name: "Customise" })
    .click();
  const box = dialog(page);
  await expect(box).toBeVisible();
  const wide = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(wide).toBeLessThanOrEqual(0);
  // Drag cross-offshore's dot out to the rim: nothing off.
  const web = box.locator("[data-direction-web]");
  await web.scrollIntoViewIfNeeded();
  const dot = box.locator('circle[data-dot="crossOff"][tabindex]');
  const at = (await dot.boundingBox())!;
  const rim = (await web.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(rim.x + rim.width - 2, rim.y + 2, { steps: 4 });
  await page.mouse.up();
  await expect(
    box.getByRole("slider", { name: "Cross-offshore: stars taken off" }),
  ).toHaveAttribute("aria-valuetext", "0 stars");
});

test("on a phone a finger scrolls the page over the web and the grid, unless it lands on a dot", async ({
  page,
}) => {
  await openMap(page, 390, 844);
  await options(page).click();
  await page
    .locator("[data-star-rating]")
    .getByRole("button", { name: "Customise" })
    .click();
  const box = dialog(page);
  const web = box.locator("[data-direction-web]");
  await web.scrollIntoViewIfNeeded();
  // A touchstart the page may not scroll from is one whose default was prevented.
  const held = (x: number, y: number) =>
    page.evaluate(
      ([cx, cy]) => {
        const target = document.elementFromPoint(cx, cy)!;
        const touch = new Touch({
          identifier: 1,
          target,
          clientX: cx,
          clientY: cy,
        });
        const event = new TouchEvent("touchstart", {
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      },
      [x, y],
    );
  const dot = (await box
    .locator('circle[data-dot="cross"][tabindex]')
    .boundingBox())!;
  expect(await held(dot.x + dot.width / 2, dot.y + dot.height / 2)).toBe(true);
  const rim = (await web.boundingBox())!;
  expect(await held(rim.x + 6, rim.y + rim.height - 6)).toBe(false);
  for (const svg of [web, box.locator("[data-stars-grid]")])
    expect(await svg.evaluate((el) => getComputedStyle(el).touchAction)).toBe(
      "pan-y",
    );
});

test("How the stars work says when the rating is the rider's own", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({
        rider: {
          weightKg: null,
          skill: "intermediate",
          wings: [],
          custom: {
            version: 1,
            base: "beginner",
            wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
            gust: { fine: 24, worst: 30, most: 3 },
            direction: {
              onshore: 0.5,
              crossOn: 0,
              cross: 0,
              crossOff: 2.5,
              offshore: 0,
            },
          },
        },
      }),
    ),
  );
  await page.goto("/stars?spot=brandon");
  await expect(page.locator("[data-ledger]")).toContainText(
    "Your own star rating, started from Learning",
    { timeout: 30000 },
  );
  await expect(
    page.locator("[data-band-table] tr", { hasText: "Your own" }),
  ).toContainText("you");
  await expect(
    page.locator("[data-shore-table] tr", { hasText: "150–180°" }),
  ).toContainText("none");
});
