import { expect, rememberSpot, SPOTS_KEY, test, type Page } from "./fixtures";
import { sampleStrip } from "./columns";
import { readSample } from "./sample";
import { clock } from "../src/strip";

/**
 * The map has no default place. Its dock opens on the spot in the link, else
 * the one this visitor chose last, else their first star, else on none: the
 * whole of Ireland, every light, and the hours that drive the chart, with an
 * ask for a spot where a spot's rows would be (src/openingSpot.ts).
 */

const harmonie = readSample<{
  base: string;
  frames: { validTime: string; hour: number }[];
}>("harmonie");

/**
 * The chart up, every light placed, and the dock drawn. On all of Ireland every
 * light is rated too; a linked spot flies the chart in, and the lights read
 * only the blend squares in view (src/spotBlend.ts), so the far ones may stay
 * pending there, depending on whether the squares or the flight come first.
 */
async function openMap(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  if (!new URL(path, "http://x").searchParams.has("spot"))
    await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
      timeout: 30000,
    });
  await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible();
}

/** Find a spot by name and take the first result. */
async function findSpot(page: Page, words: string) {
  await page.getByRole("combobox", { name: "Find a spot" }).fill(words);
  await page.locator(".spot-row").first().click();
}

const stored = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    SPOTS_KEY,
  );

const dockName = (page: Page) => page.locator(".dock .dk-name");

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`a first visit opens on no spot, and the hours still drive the chart, at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await openMap(page);
    expect(await stored(page)).toBeNull();

    // The dock: no spot, the ask for one, and nothing a spot would fill.
    const dock = page.getByRole("region", { name: "Forecast, no spot chosen" });
    await expect(dock).toBeVisible();
    await expect(dockName(page)).toHaveText("All of Ireland");
    await expect(dock.locator(".dk-none")).toContainText(
      "Tap a light 4 on the chart for its week.",
    );
    for (const row of ["stars", "wind", "from", "wing", "tide", "waves"])
      await expect(dock.locator(`tr.tt-${row}`)).toHaveCount(0);
    await expect(dock.getByRole("link", { name: "Spot page →" })).toHaveCount(
      0,
    );
    await expect(dock.locator(".tt-pen .pen-loop")).toHaveCount(0);
    // The chart: the whole of Ireland, no light chosen, none focused.
    await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
    await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);

    // "Find a spot" in the dock is the chart's own search.
    await dock.getByRole("button", { name: "Find a spot" }).click();
    await expect(
      page.getByRole("combobox", { name: "Find a spot" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");

    // The time: the hours scroll and the slider steps them, and the chart's
    // frame and every light follow. The last HARMONIE hour on the strip is
    // one nothing has asked for yet.
    const target = sampleStrip.findLastIndex((c) =>
      harmonie.frames.some((f) => Date.parse(f.validTime) === c.time),
    );
    const frame = harmonie.frames.find(
      (f) => Date.parse(f.validTime) === sampleStrip[target].time,
    )!;
    const tile = `/${String(frame.hour).padStart(3, "0")}.bin`;
    const asked: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(harmonie.base) && request.url().endsWith(tile))
        asked.push(request.url());
    });
    const slider = page.getByRole("slider", { name: "Forecast time" });
    await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
    await slider.fill(String(target));
    await expect(slider).toHaveValue(String(target));
    await expect(dock.locator(`tr.tt-hour td[data-i="${target}"]`)).toHaveClass(
      /c-sel/,
    );
    await expect
      .poll(() => asked.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(page.locator('[data-spot-id="brandon"]')).toHaveAttribute(
      "aria-label",
      new RegExp(`^Brandon Bay, Kerry: ${clock(sampleStrip[target].time)} `),
    );
    // The keys step it too.
    await slider.press("Home");
    await expect(dock.locator('tr.tt-hour td[data-i="0"]')).toHaveClass(
      /c-sel/,
    );
    await expect(page.locator('[data-spot-id="brandon"]')).toHaveAttribute(
      "aria-label",
      new RegExp(`: ${clock(sampleStrip[0].time)} `),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("in the morning the hour opened on is the one under the cursor", async ({
    page,
  }) => {
    // 11:00 Irish time. The strip fills out as the models answer, the browser
    // re-snaps its scroll as it does, and the opening hour is set again for
    // the longer strip: a scroll read a frame late, against the strip as it
    // was, once picked an hour the strip was no longer scrolling to.
    await page.clock.setFixedTime(new Date("2026-09-13T10:00:00Z"));
    await openMap(page);
    await expectHourUnderCursor(page);
  });
});

async function expectHourUnderCursor(page: Page) {
  const slider = page.getByRole("slider", { name: "Forecast time" });
  const offCursor = () =>
    page.evaluate(() => {
      const cell = document.querySelector(".dock tr.tt-hour td.c-sel");
      const cursor = document.querySelector(".dock .dk-cur");
      if (!cell || !cursor) return Infinity;
      const c = cell.getBoundingClientRect();
      return Math.abs(
        c.left + c.width / 2 - cursor.getBoundingClientRect().left,
      );
    });
  await expect.poll(offCursor).toBeLessThan(2);
  // And it stays there once the strip has settled.
  await page.waitForTimeout(1000);
  expect(await offCursor()).toBeLessThan(2);
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${await slider.inputValue()}"]`),
  ).toHaveClass(/c-sel/);
}

test("the spot chosen is the one a returning visit opens on, unfocused; a bare point is not", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await expect(dockName(page)).toHaveText("All of Ireland");
  await findSpot(page, "Keel");
  await expect(dockName(page)).toHaveText("Keel Beach");
  expect(Object.keys((await stored(page)).visits)).toEqual(["keel"]);

  // A light chosen on the chart is remembered the same way, over the last.
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect(dockName(page)).toHaveText("Dollymount");

  // A point on the open sea is not a riding place: it takes the dock, and
  // is not remembered.
  await page.keyboard.press("Escape");
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  const water = await page.evaluate((box) => {
    for (let y = 300; y < box.height - 360; y += 30)
      for (let x = 400; x > 60; x -= 30) {
        const hit = document.elementFromPoint(box.x + x, box.y + y);
        if (hit?.tagName === "CANVAS") return { x, y };
      }
    return { x: 300, y: 300 };
  }, box);
  await canvas.click({ position: water });
  // Named by the nearest place or its coordinates, with no star.
  await expect(page.locator(".dock .dk-head")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  await expect(
    page.locator(".dock").getByRole("button", { name: /^Star / }),
  ).toHaveCount(0);

  await page.reload();
  await expect(dockName(page)).toHaveText("Dollymount", { timeout: 30000 });
  await expect(page.locator('[data-spot-id="dollymount"]')).toHaveClass(
    /\bsel\b/,
  );
  // Restored, not linked: the chart is not focused on it or flown to.
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("a spot in the link wins over the remembered one, and is focused", async ({
  page,
}) => {
  await rememberSpot(page, "dollymount");
  await openMap(page, "/?spot=keel");
  await expect(dockName(page)).toHaveText("Keel Beach");
  await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
  // Opening a link is not choosing: the remembered spot stands.
  await page.goto("/");
  await expect(dockName(page)).toHaveText("Dollymount", { timeout: 30000 });
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
});

test("a visitor who has starred but never chosen opens on their first star", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null)
      localStorage.setItem(
        key,
        JSON.stringify({ starred: ["rusheen", "keel"], visits: {} }),
      );
  }, SPOTS_KEY);
  await openMap(page);
  await expect(dockName(page)).toHaveText("Rusheen Bay");
  await expect(
    page.locator(".dock").getByRole("button", { name: "Unstar Rusheen Bay" }),
  ).toBeVisible();
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
});

test("a remembered spot the catalogue no longer holds falls back down the list", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        starred: ["atlantis", "keel"],
        visits: { lyonesse: { id: "lyonesse", count: 9, last: 9e12 } },
      }),
    );
  }, SPOTS_KEY);
  await openMap(page);
  // The last chosen has gone, so the first star still here.
  await expect(dockName(page)).toHaveText("Keel Beach");

  // And with nothing left that is still a place: no spot.
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        starred: ["atlantis"],
        visits: { lyonesse: { id: "lyonesse", count: 9, last: 9e12 } },
      }),
    );
  }, SPOTS_KEY);
  await page.reload();
  await expect(dockName(page)).toHaveText("All of Ireland", { timeout: 30000 });
});
