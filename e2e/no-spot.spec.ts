import {
  expect,
  rememberSpot,
  SPOTS_KEY,
  steadyFrames,
  test,
  type Page,
} from "./fixtures";
import { sampleStrip } from "./columns";
import { readSample } from "./sample";
import { clock } from "../src/strip";

/**
 * The map has no default place, and no dock until a spot is chosen. Only a
 * link that names a spot opens on it; a remembered or starred spot waits for
 * a tap, and the page opens on the whole of Ireland and every light, the
 * chart alone, at the hour the page opened on (src/openingSpot.ts).
 */

const harmonie = readSample<{
  base: string;
  frames: { validTime: string; hour: number }[];
}>("harmonie");

/**
 * The chart up and every light placed. On all of Ireland every light is rated
 * too; a linked spot flies the chart in, and the lights read only the blend
 * squares in view (src/spotBlend.ts), so the far ones may stay pending there,
 * depending on whether the squares or the flight come first.
 */
async function openMap(page: Page, path = "/?map") {
  await page.goto(path);
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  if (!new URL(path, "http://x").searchParams.has("spot"))
    await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
      timeout: 30000,
    });
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
const brandon = (page: Page) => page.locator('[data-spot-id="brandon"]');

/** A point on the open chart: water or land, clear of the lights and the boxes over it. */
async function openChart(page: Page) {
  const open = await page.evaluate(() => {
    for (let y = 200; y < innerHeight - 240; y += 20)
      for (let x = 30; x < innerWidth - 30; x += 20)
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains("maplibregl-canvas")
        )
          return { x, y };
    return null;
  });
  expect(open).not.toBeNull();
  return open!;
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`a first visit opens on the chart alone, and a spot brings the dock at the chart's hour, at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await openMap(page);
    expect(await stored(page)).toBeNull();

    // No dock: no days, no hours, nothing at the foot of the chart, which
    // has the whole height. No light chosen, none focused.
    await expect(page.locator(".dock")).toHaveCount(0);
    await expect(
      page.getByRole("slider", { name: "Forecast time" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => [
        document.querySelector(".map-footer")!.getBoundingClientRect().height,
        document.querySelector(".maplibregl-canvas")!.getBoundingClientRect()
          .height,
        innerHeight,
      ]),
    ).toEqual([0, height, height]);
    await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
    await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
    // The lights are rated at the hour the page opened on.
    const opened = (await brandon(page).getAttribute("aria-label"))!;
    const at = sampleStrip.findIndex((c) =>
      opened.startsWith(`Brandon Bay, Kerry: ${clock(c.time)} `),
    );
    expect(at).toBeGreaterThanOrEqual(0);

    // A spot chosen: the dock, on that same hour.
    await findSpot(page, "Keel");
    const dock = page.getByRole("region", { name: "Forecast for Keel Beach" });
    await expect(dock).toBeVisible();
    const slider = page.getByRole("slider", { name: "Forecast time" });
    await expect(slider).toHaveValue(String(at));
    await expect(dock.locator(`tr.tt-hour td[data-i="${at}"]`)).toHaveClass(
      /c-sel/,
    );

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
    await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
    await slider.fill(String(target));
    await expect(slider).toHaveValue(String(target));
    await expect(dock.locator(`tr.tt-hour td[data-i="${target}"]`)).toHaveClass(
      /c-sel/,
    );
    await expect
      .poll(() => asked.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(brandon(page)).toHaveAttribute(
      "aria-label",
      new RegExp(`^Brandon Bay, Kerry: ${clock(sampleStrip[target].time)} `),
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

  test("in the morning the hour opened on is the one framed in the middle", async ({
    page,
  }) => {
    // 11:00 Irish time. The strip fills out as the models answer, the browser
    // re-snaps its scroll as it does, and the opening hour is set again for
    // the longer strip: a scroll read a frame late, against the strip as it
    // was, once picked an hour the strip was no longer scrolling to.
    await page.clock.setFixedTime(new Date("2026-09-13T10:00:00Z"));
    await openMap(page, "/?spot=brandon");
    await expect(dockName(page)).toHaveText("Brandon Bay");
    await expectHourUnderCursor(page);
  });
});

async function expectHourUnderCursor(page: Page) {
  const slider = page.getByRole("slider", { name: "Forecast time" });
  // The scroll against the one that brings the selected hour to the
  // strip's middle (its snap mark), and the card against its column.
  const offCursor = () =>
    page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".dock .tt-wrap");
      const cell = document.querySelector<HTMLElement>(
        ".dock tr.tt-hour td.c-sel",
      );
      const frame = document.querySelector(".dock .tt-card");
      if (!wrap || !cell || !frame) return Infinity;
      const snap =
        wrap.querySelectorAll<HTMLElement>(".tt-snaps i")[
          Number(cell.dataset.i)
        ];
      const max = wrap.scrollWidth - wrap.clientWidth;
      const c = cell.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      return Math.max(
        Math.abs(wrap.scrollLeft - Math.min(max, parseFloat(snap.style.left))),
        Math.abs(c.left + c.width / 2 - (f.left + f.width / 2)),
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

test("the spot chosen is remembered, a bare point is not, and neither opens the next visit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await expect(page.locator(".dock")).toHaveCount(0);
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
  await expect(page.locator(".dock .dk-tools")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  await expect(
    page.locator(".dock").getByRole("button", { name: /^Star / }),
  ).toHaveCount(0);

  expect(Object.keys((await stored(page)).visits).sort()).toEqual([
    "dollymount",
    "keel",
  ]);

  // Remembered on the device, but the next visit opens on the chart alone:
  // nothing at its foot until a spot is chosen again.
  await page.reload();
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".dock")).toHaveCount(0);
  await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
});

test("the spot chosen is in the link, by search or light, and Back steps through them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await expect(page).toHaveURL(/\/\?map$/);
  await findSpot(page, "Keel");
  await expect(dockName(page)).toHaveText("Keel Beach");
  await expect(page).toHaveURL(/\/\?spot=keel$/);
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect(dockName(page)).toHaveText("Dollymount");
  await expect(page).toHaveURL(/\/\?spot=dollymount$/);
  // Back to the spot before, then to the chart alone; Forward again.
  await page.goBack();
  await expect(page).toHaveURL(/\/\?spot=keel$/);
  await expect(dockName(page)).toHaveText("Keel Beach");
  await page.goBack();
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(page.locator(".dock")).toHaveCount(0);
  await page.goForward();
  await expect(dockName(page)).toHaveText("Keel Beach");
  // The link opens on the spot it names.
  await page.goto("/?spot=keel");
  await expect(dockName(page)).toHaveText("Keel Beach", { timeout: 30000 });
});

test("Back lets go of a tap on the chart still waiting to pick a point: the chart alone at the link with no spot (#90)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.locator('[data-spot-id="tramore"]').dispatchEvent("click");
  await expect(dockName(page)).toHaveText("Tramore", { timeout: 30000 });
  await page
    .locator(".dock")
    .getByRole("button", { name: "Close the forecast for Tramore" })
    .click();
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(page.locator(".dock")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?spot=tramore$/);
  await expect(dockName(page)).toHaveText("Tramore");
  const open = await openChart(page);
  // A tap there waits a moment for a second before it picks the point: Back
  // within that moment, and then the moment passing, picks nothing.
  await page.mouse.click(open.x, open.y);
  await page.goBack();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(page.locator(".dock")).toHaveCount(0);
  expect(await page.evaluate(() => history.state)).toBeNull();
});

test("a spot chosen while a tap on the chart waits to pick its point is the one the dock opens on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  const light = async (id: string) => {
    const box = (await page.locator(`[data-spot-id="${id}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  /** The dock a moment after the tap's wait, and the link. */
  const settles = async (name: string, id: string) => {
    await page.waitForTimeout(800);
    await expect(dockName(page)).toHaveText(name);
    await expect(page).toHaveURL(new RegExp(`/\\?spot=${id}$`));
  };
  // A tap on the chart, then at once a light: the light's click stops there,
  // and the map never heard of it.
  let open = await openChart(page);
  let at = await light("tramore");
  await page.mouse.click(open.x, open.y);
  await page.mouse.click(at.x, at.y);
  await settles("Tramore", "tramore");
  // The same with the open spot's own light, once the chart has flown to it.
  await steadyFrames(page);
  open = await openChart(page);
  at = await light("tramore");
  await page.mouse.click(open.x, open.y);
  await page.mouse.click(at.x, at.y);
  await settles("Tramore", "tramore");
  // And a spot found by the search.
  open = await openChart(page);
  await page.mouse.click(open.x, open.y);
  await findSpot(page, "Keel");
  await settles("Keel Beach", "keel");
});

test("a spot in the link opens on it, focused; a remembered one waits to be chosen", async ({
  page,
}) => {
  await rememberSpot(page, "dollymount");
  await openMap(page, "/?spot=keel");
  await expect(dockName(page)).toHaveText("Keel Beach");
  await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
  // Opening a link is not choosing, and the remembered spot opens nothing.
  await page.goto("/?map");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".dock")).toHaveCount(0);
  expect(Object.keys((await stored(page)).visits)).toEqual(["dollymount"]);
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`a visitor with stars and a spot chosen before still opens on the chart alone, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((key) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(
          key,
          JSON.stringify({
            starred: ["rusheen", "keel"],
            visits: { brandon: { id: "brandon", count: 3, last: 9e12 } },
          }),
        );
    }, SPOTS_KEY);
    await openMap(page);
    await expect(page.locator(".dock")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".map-footer")!.getBoundingClientRect().height,
      ),
    ).toBe(0);
    await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
    // A tap on a star's light brings its dock.
    await page.locator('[data-spot-id="rusheen"]').dispatchEvent("click");
    await expect(dockName(page)).toHaveText("Rusheen Bay");
    await expect(
      page.locator(".dock").getByRole("button", { name: "Unstar Rusheen Bay" }),
    ).toBeVisible();
  });
}
