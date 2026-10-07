#!/usr/bin/env node
/**
 * Time the site the way a visitor meets it, in real Chrome, and write the
 * numbers down.
 *
 *   node scripts/perf-serve.mjs --dir dist --port 4180 &
 *   node scripts/perf-audit.mjs --base http://127.0.0.1:4180 \
 *     --out .perf/after.json --shots .perf/after --runs 3
 *
 * Each scenario is run `--runs` times in a fresh browser context and the
 * median is reported. Two network/CPU profiles are used, the same two
 * Lighthouse uses: a desktop on a cable line and a mid-range phone on 4G
 * (150 ms RTT, 1.6 Mbit/s, CPU slowed 4x). Chrome is launched headless with
 * its GPU (`channel: "chrome"`), because the map is WebGL and SwiftShader's
 * software raster would time the emulator rather than the page.
 *
 * What is measured, per load: TTFB, FCP, LCP, CLS, total blocking time (the
 * part of every long task over 50 ms, from navigation until the map is
 * ready), "map ready" (every riding place on the map with its rating), "dock
 * ready" (the forecast's days and stars on the page), and the bytes and
 * requests it took. Then, on a warm page, the
 * interactions a rider makes: switching model, stepping the forecast time,
 * opening a riding place, and opening search, each as the wall time from the
 * input to the page settling plus the Event Timing API's worst interaction
 * (the INP field metric's lab stand-in).
 *
 * Interleave two builds (`--base` one, then the other, a run at a time) when
 * the machine is busy: background load then falls on both alike.
 *
 * The forecast in public/weather is whatever run was last ingested, so the
 * page's clock can be started inside that run (`--clock`); otherwise it would
 * time the "every run has expired" notice.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const base = option("base", "http://127.0.0.1:4180");
const out = option("out", ".perf/audit.json");
const shots = option("shots", "");
const runs = Number(option("runs", 3));
const clock = option("clock", "");
const only = option("only", "");

const PROFILES = {
  desktop: {
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    network: { latency: 40, down: 10 * 1024 * 1024, up: 5 * 1024 * 1024 },
    cpu: 1,
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    network: { latency: 150, down: 1.6 * 1024 * 1024, up: 750 * 1024 },
    cpu: 4,
  },
};

/** Installed before any page script: the observers a field RUM library sets up. */
const OBSERVERS = () => {
  const perf = (window.__perf = {
    lcp: 0,
    cls: 0,
    longTasks: [],
    events: [],
    fcp: 0,
  });
  const observe = (type, callback, extra = {}) => {
    try {
      new PerformanceObserver((list) =>
        list.getEntries().forEach(callback),
      ).observe({
        type,
        buffered: true,
        ...extra,
      });
    } catch {
      /* unsupported entry type */
    }
  };
  observe("largest-contentful-paint", (e) => (perf.lcp = e.startTime));
  observe("paint", (e) => {
    if (e.name === "first-contentful-paint") perf.fcp = e.startTime;
  });
  observe("layout-shift", (e) => {
    if (!e.hadRecentInput) perf.cls += e.value;
  });
  observe("longtask", (e) =>
    perf.longTasks.push({ start: e.startTime, duration: e.duration }),
  );
  observe(
    "event",
    (e) => {
      if (e.interactionId)
        perf.events.push({
          name: e.name,
          start: e.startTime,
          duration: e.duration,
        });
    },
    { durationThreshold: 16 },
  );
};

/**
 * Start the wall clock at `start` and let it run. Playwright's own clock
 * replaces `performance` and the timers along with `Date`, which would stop
 * the very clock this script times the page by; this moves `Date` alone.
 */
const SHIFT_CLOCK = (start) => {
  const RealDate = Date;
  const offset = start - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(RealDate.now() + offset);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
};

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function throttle(page, profile) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.network.latency,
    downloadThroughput: profile.network.down / 8,
    uploadThroughput: profile.network.up / 8,
  });
  if (profile.cpu > 1)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  return cdp;
}

/**
 * The map is ready when every riding place is on it with its rating: the
 * markers stay "pending" until the models behind their stars have loaded.
 */
async function mapReady(page) {
  await page.waitForSelector(".maplibregl-canvas", { timeout: 90000 });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".spot-marker").length > 50 &&
      !document.querySelector(".spot-marker.pending"),
    null,
    { timeout: 90000, polling: 50 },
  );
}

/** The dock is ready when its days and its stars row are on the page. */
async function dockReady(page) {
  await page.waitForFunction(
    () => !!document.querySelector(".dock tr.tt-stars, .dock .sc-day"),
    null,
    { timeout: 90000, polling: 50 },
  );
}

async function collect(page, readyAt) {
  return page.evaluate((readyAt) => {
    const perf = window.__perf;
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const before = resources.filter((r) => r.responseEnd <= readyAt);
    const sum = (list, key) => list.reduce((t, r) => t + (r[key] || 0), 0);
    const kind = (r) =>
      /\.js(\?|$)/.test(r.name)
        ? "js"
        : /\.css(\?|$)/.test(r.name)
          ? "css"
          : /\/weather\/[^/]+\.json/.test(r.name)
            ? "manifest"
            : /\/weather\//.test(r.name)
              ? "frame"
              : /openfreemap|tiles\./.test(r.name)
                ? "basemap"
                : "other";
    const byKind = {};
    for (const r of resources) {
      const k = kind(r);
      byKind[k] ??= { requests: 0, transfer: 0, decoded: 0 };
      byKind[k].requests++;
      byKind[k].transfer += r.transferSize || 0;
      byKind[k].decoded += r.decodedBodySize || 0;
    }
    const tbt = perf.longTasks
      .filter((t) => t.start < readyAt)
      .reduce((t, task) => t + Math.max(0, task.duration - 50), 0);
    return {
      ttfb: nav.responseStart,
      fcp: perf.fcp,
      lcp: perf.lcp,
      cls: Number(perf.cls.toFixed(4)),
      tbt,
      longestTask: Math.max(0, ...perf.longTasks.map((t) => t.duration)),
      domContentLoaded: nav.domContentLoadedEventEnd,
      requestsBeforeReady: before.length + 1,
      transferBeforeReady:
        sum(before, "transferSize") + (nav.transferSize || 0),
      requestsTotal: resources.length + 1,
      transferTotal: sum(resources, "transferSize") + (nav.transferSize || 0),
      decodedTotal:
        sum(resources, "decodedBodySize") + (nav.decodedBodySize || 0),
      byKind,
      jsHeapMB: performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null,
    };
  }, readyAt);
}

async function newContext(browser, profile) {
  const { network, cpu, ...device } = profile;
  const context = await browser.newContext({ ...device, locale: "en-IE" });
  await context.addInitScript(OBSERVERS);
  if (clock) await context.addInitScript(SHIFT_CLOCK, Date.parse(clock));
  return context;
}

async function loadOnce(
  browser,
  profileName,
  path,
  { warm = false, shot } = {},
) {
  const profile = PROFILES[profileName];
  const context = await newContext(browser, profile);
  const page = await context.newPage();
  await throttle(page, profile);
  if (warm) {
    // Prime the HTTP cache with one full visit, then measure the return.
    await page.goto(base + path, { waitUntil: "load" });
    if (path === "/") await mapReady(page);
    await page.waitForTimeout(1500);
  }
  const start = Date.now();
  await page.goto(base + path, { waitUntil: "commit" });
  let readyAt = null;
  let dockAt = null;
  if (path === "/") {
    await Promise.all([
      mapReady(page).then(async () => {
        readyAt = await page.evaluate(() => performance.now());
      }),
      dockReady(page).then(async () => {
        dockAt = await page.evaluate(() => performance.now());
      }),
    ]);
  } else {
    await page
      .waitForLoadState("networkidle", { timeout: 90000 })
      .catch(() => {});
    readyAt = await page.evaluate(() => performance.now());
  }
  // LCP and CLS settle after the map is ready; give them a moment.
  await page.waitForTimeout(1500);
  const metrics = await collect(page, readyAt);
  metrics.mapReady = readyAt;
  metrics.dockReady = dockAt;
  metrics.wall = Date.now() - start;
  if (shot) {
    await mkdir(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
  }
  await context.close();
  return metrics;
}

/** Wall time from an input to the page standing still again, plus the worst event. */
async function interactions(browser, profileName, shotDir) {
  const profile = PROFILES[profileName];
  const context = await newContext(browser, profile);
  const page = await context.newPage();
  await page.goto(base + "/");
  await mapReady(page);
  await dockReady(page);
  await page.waitForTimeout(2500);
  await throttle(page, profile);
  const result = {};

  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          // Two frames under 50 ms in a row: the main thread is free again.
          let last = performance.now();
          let calm = 0;
          const tick = (now) => {
            calm = now - last < 50 ? calm + 1 : 0;
            last = now;
            if (calm >= 3) resolve(now);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
  const worstEvent = (since) =>
    page.evaluate(
      (since) =>
        Math.max(
          0,
          ...window.__perf.events
            .filter((e) => e.start >= since)
            .map((e) => e.duration),
        ),
      since,
    );
  const time = async (name, act, until) => {
    const since = await page.evaluate(() => performance.now());
    await act();
    if (until) await until();
    const end = await settle();
    result[name] = {
      ms: Math.round(end - since),
      worstEventMs: await worstEvent(since),
    };
  };

  // Step the forecast an hour on, by keyboard, five times.
  const slider = page.getByRole("slider", { name: "Forecast time" });
  if (await slider.count()) {
    await slider.focus();
    await time("stepTime5x", async () => {
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    });
  }

  // Switch model: ECMWF (a different grid and run), then back to HARMONIE.
  for (const model of ["ecmwf", "harmonie"]) {
    // The models sit in the layers panel; open it as a reader would.
    const layers = page.getByRole("button", { name: "Layers", exact: true });
    if (
      (await layers.count()) &&
      (await layers.getAttribute("aria-expanded")) !== "true"
    )
      await layers.click();
    const button = page.locator(`[data-model="${model}"]`).first();
    if (!(await button.count())) continue;
    await time(
      `switchModel:${model}`,
      () => button.click(),
      () =>
        page.waitForFunction(
          (model) =>
            document
              .querySelector(`[data-model="${model}"]`)
              ?.getAttribute("aria-pressed") === "true",
          model,
          { timeout: 60000 },
        ),
    );
  }
  await page.keyboard.press("Escape");

  // Open a riding place from its marker.
  const marker = page.locator(".spot-marker").nth(10);
  if (await marker.count()) {
    await time(
      "openSpot",
      () => marker.click({ force: true }),
      () => page.waitForTimeout(50),
    );
    if (shotDir)
      await page.screenshot({ path: join(shotDir, `${profileName}-spot.png`) });
  }

  // Switch the dock's view to the blend and back to the table.
  for (const view of ["Blend", "Table"]) {
    const button = page
      .locator(".dock")
      .getByRole("radio", { name: view })
      .or(page.locator(".dock").getByRole("button", { name: view }))
      .first();
    if (!(await button.count())) continue;
    await time(`dockView:${view.toLowerCase()}`, () => button.click());
    if (shotDir && view === "Blend")
      await page.screenshot({
        path: join(shotDir, `${profileName}-blend.png`),
      });
  }

  // Pan the map: a drag across a third of the screen.
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (box) {
    const y = box.y + box.height * 0.3;
    await time("panMap", async () => {
      await page.mouse.move(box.x + box.width * 0.6, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, y, { steps: 12 });
      await page.mouse.up();
    });
    // Frame rate while the particles run: frames drawn in two seconds.
    result.fps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = (now) => {
            frames++;
            if (now - start < 2000) requestAnimationFrame(tick);
            else resolve(Math.round((frames * 1000) / (now - start)));
          };
          requestAnimationFrame(tick);
        }),
    );
  }
  result.jsHeapMB = await page.evaluate(() =>
    performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null,
  );
  await context.close();
  return result;
}

function summarise(samples) {
  const keys = Object.keys(samples[0]).filter(
    (k) => typeof samples[0][k] === "number",
  );
  const summary = {};
  for (const key of keys) summary[key] = median(samples.map((s) => s[key]));
  summary.byKind = samples[0].byKind;
  return summary;
}

const browser = await chromium.launch({ channel: "chrome" });
const report = {
  base,
  clock,
  runs,
  at: new Date().toISOString(),
  loads: {},
  interactions: {},
};
const SCENARIOS = [
  ["map:desktop:cold", "desktop", "/", false],
  ["map:desktop:warm", "desktop", "/", true],
  ["map:mobile:cold", "mobile", "/", false],
  ["map:mobile:warm", "mobile", "/", true],
  ["market:desktop:cold", "desktop", "/market", false],
  ["community:desktop:cold", "desktop", "/community", false],
  ["ai:desktop:cold", "desktop", "/ai", false],
  ["stars:desktop:cold", "desktop", "/stars", false],
];
for (const [name, profile, path, warm] of SCENARIOS) {
  if (only && !name.includes(only)) continue;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const shot =
      shots && i === 0
        ? join(shots, `${name.replaceAll(":", "-")}.png`)
        : undefined;
    try {
      samples.push(await loadOnce(browser, profile, path, { warm, shot }));
    } catch (error) {
      console.error(`${name} run ${i}: ${error.message.split("\n")[0]}`);
    }
  }
  if (samples.length) report.loads[name] = summarise(samples);
  console.log(name, JSON.stringify(report.loads[name] ?? null));
}
if (!only || only.includes("interact")) {
  for (const profile of ["desktop", "mobile"]) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      try {
        samples.push(
          await interactions(browser, profile, i === 0 && shots ? shots : ""),
        );
      } catch (error) {
        console.error(
          `interactions ${profile} run ${i}: ${error.message.split("\n")[0]}`,
        );
      }
    }
    if (!samples.length) continue;
    const merged = {};
    for (const key of Object.keys(samples[0])) {
      const values = samples.map((s) => s[key]);
      merged[key] =
        typeof values[0] === "object" && values[0]
          ? {
              ms: median(values.map((v) => v?.ms)),
              worstEventMs: median(values.map((v) => v?.worstEventMs)),
            }
          : median(values);
    }
    report.interactions[profile] = merged;
    console.log(`interactions:${profile}`, JSON.stringify(merged));
  }
}
await browser.close();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
