#!/usr/bin/env node
/**
 * The map's performance, scenario by scenario, with the foilable-depth layer
 * on and off, on a desktop and a mid-range phone: what each costs the CPU,
 * the frame rate, the JS heap and the GPU, what it fetches from where, the
 * Web Vitals, and (with --lighthouse) Lighthouse's score. Writes a JSON report
 * and a Markdown summary, and checks them against budgets (warn-only unless
 * --strict).
 *
 *   npm run perf -- --base https://wingfoil.ie
 *   npm run perf -- --base http://127.0.0.1:4180 --profiles desktop --foil on
 *   npm run perf -- --soak 300 --lighthouse        # the full analysis
 *
 * Options (all optional):
 *   --base URL          the site (default https://wingfoil.ie)
 *   --out DIR           where the reports go (default .perf/<host>-<time>)
 *   --profiles LIST     desktop,phone
 *   --foil LIST         on,off
 *   --scenarios LIST    cold,idle,zoom,pan,hours,taps (in that order; "none"
 *                       for only the soak or Lighthouse)
 *   --idle SECONDS      the idle scenario's length (60)
 *   --hours N           forecast hours stepped (24)
 *   --soak SECONDS      also run the leak soak on the desktop, foil on and
 *                       off: hour steps and pans for this long, with a heap
 *                       snapshot before and after (0: none)
 *   --lighthouse        also run Lighthouse (desktop and mobile presets)
 *   --budgets FILE      (default scripts/perf/budgets.json)
 *   --strict            exit 1 when a budget is over
 *   --no-gpu-budgets    skip the budgets marked `gpu` (CPU and frame times),
 *                       for a machine that draws WebGL in software (CI)
 *   --no-trace          skip the performance traces (CPU split)
 *   --profile           also take a JS CPU profile of each scenario and list
 *                       the functions with the most self time
 *   --keep-snapshots    keep the soak's raw heap snapshots in --out
 *   --runs N            run each profile and foil setting N times, report
 *                       the median of every number (1)
 *   --insecure-cors     launch Chrome with --disable-web-security: for a
 *                       local build reading production's data host, which
 *                       answers CORS for the site's own origin only
 *   --headed            show the browser
 *
 * Chrome is the installed Google Chrome (`channel: "chrome"`), headless with
 * its GPU: the map is WebGL, and SwiftShader would time the emulator
 * (PERF_CHROMIUM=1 uses Playwright's Chromium and SwiftShader instead, for a
 * runner with no GPU: see --no-gpu-budgets). The
 * phone is Chrome's device emulation (390×844 at 3×, touch), its CPU slowed
 * four times and its line Lighthouse's slow 4G (150 ms, 1.6 Mbit/s down),
 * applied to the page and to its workers (MapLibre fetches the basemap's
 * tiles from its workers) over a CDP connection of the script's own.
 *
 * Every scenario after the cold load runs on the same page, as one visit:
 * the HTTP cache is warm from what came before, as it is for a rider.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, freePort } from "./cdp.mjs";
import { analyseTrace, TRACE_CATEGORIES } from "./trace.mjs";
import { compareSnapshots, takeSnapshot } from "./heap.mjs";
import { instrument } from "./page.mjs";
import { checkBudgets, markdownReport } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--")
    ? argv[at + 1]
    : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const list = (name, fallback) =>
  option(name, fallback).split(",").filter(Boolean);

const base = option("base", "https://wingfoil.ie").replace(/\/$/, "");
const siteHost = new URL(base).host;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = resolve(
  option("out", `.perf/${siteHost.replace(/[:]/g, "_")}-${stamp}`),
);
const profiles = list("profiles", "desktop,phone");
const foils = list("foil", "on,off");
const scenarios = list("scenarios", "cold,idle,zoom,pan,hours,taps").filter(
  (name) => name !== "none",
);
const idleSeconds = Number(option("idle", 60));
const hourSteps = Number(option("hours", 24));
const soakSeconds = Number(option("soak", 0));
const budgetsFile = option("budgets", join(here, "budgets.json"));
const tracing = !flag("no-trace");
const runs = Math.max(1, Number(option("runs", 1)));
const profiling = flag("profile");

const PROFILES = {
  desktop: {
    context: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    },
    // A cable line.
    network: { latency: 20, down: 20e6, up: 5e6 },
    cpu: 1,
    timeout: 90_000,
  },
  phone: {
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    },
    // Lighthouse's mobile line ("slow 4G"): a mid-range phone's.
    network: { latency: 150, down: 1.6e6, up: 0.75e6 },
    cpu: 4,
    timeout: 240_000,
  },
};

/** Places on the chart, lon/lat. */
const AT = {
  dublinBay: [-6.12, 53.33],
  malahide: [-6.145, 53.455],
  between: [-6.13, 53.4],
  eastCoast: [
    [-6.05, 53.62], // Skerries
    [-6.04, 53.39], // Howth
    [-6.1, 53.3], // Dublin Bay
    [-6.06, 53.19], // Bray
    [-6.0, 52.98], // Wicklow
    [-6.08, 52.79], // Arklow
    [-6.2, 52.64], // Courtown
    [-6.37, 52.34], // Wexford
    [-6.33, 52.24], // Rosslare
  ],
};

const round = (v, places = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? v
    : Math.round(v * 10 ** places) / 10 ** places;
const MB = (bytes) => round(bytes / 1048576, 2);

/* ---- network: every request of the page and its workers, by data source ---- */

function sourceOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  const path = u.pathname;
  if (path.includes("/foildepth/"))
    return path.endsWith(".pmtiles") ? "foil-archives" : "foil-index";
  if (path.includes("/bathy/")) return "bathy";
  if (path.includes("/satellite/")) return "satellite";
  if (/openfreemap/.test(u.host)) return "basemap";
  if (path.includes("/tides/") || /\/marine\/tides/.test(path)) return "tides";
  if (u.host === siteHost) {
    if (/\.(js|mjs)$/.test(path)) return "app-js";
    if (/\.css$/.test(path)) return "app-css";
    if (/\.(woff2?|ttf|otf)$/.test(path)) return "app-fonts";
    if (/\/(weather|marine|blend|spots?|sea)\//.test(path)) return "forecast";
    if (path === "/" || path.endsWith(".html")) return "document";
    return "app-other";
  }
  if (
    /\/(weather|marine|blend|spots?|sea|squares?)\//.test(path) ||
    u.host.startsWith("data.")
  )
    return "forecast";
  return `3p:${u.host}`;
}

class Network {
  constructor(cdp) {
    this.entries = [];
    this.live = new Map();
    this.sessions = new Set();
    /** The workers' own scripts' URLs. */
    this.workerUrls = new Set();
    const on = (method, handler) =>
      cdp.on(method, (params, sessionId) => {
        if (this.sessions.has(sessionId))
          handler(params, `${sessionId}|${params.requestId}`);
      });
    on("Network.requestWillBeSent", (p, key) => {
      if (!/^https?:/.test(p.request.url)) return;
      // A worker's own script: the page's session sees it asked for and the
      // worker's sees it answered, so neither sees it finish. Counted once,
      // never left open.
      if (this.workerUrls.has(p.request.url)) return;
      if (p.redirectResponse && this.live.has(key)) {
        const e = this.live.get(key);
        e.status = p.redirectResponse.status;
        e.done = true;
      }
      const headers = p.request.headers ?? {};
      const entry = {
        url: p.request.url,
        method: p.request.method,
        source: sourceOf(p.request.url),
        range: headers.Range ?? headers.range ?? null,
        at: p.timestamp,
        seen: Date.now(),
        bytes: 0,
        cache: null,
        status: 0,
        cdn: null,
        failed: false,
        canceled: false,
        done: false,
      };
      this.live.set(key, entry);
      this.entries.push(entry);
    });
    on("Network.requestServedFromCache", (_, key) => {
      const e = this.live.get(key);
      if (e) e.cache = "memory";
    });
    on("Network.responseReceived", (p, key) => {
      const e = this.live.get(key);
      if (!e) return;
      e.status = p.response.status;
      if (p.response.fromDiskCache) e.cache ??= "disk";
      if (p.response.fromServiceWorker) e.cache ??= "service-worker";
      if (p.response.fromPrefetchCache) e.cache ??= "prefetch";
      const h = p.response.headers ?? {};
      e.cdn = h["cf-cache-status"] ?? h["CF-Cache-Status"] ?? null;
    });
    on("Network.loadingFinished", (p, key) => {
      const e = this.live.get(key);
      if (!e) return;
      e.bytes = p.encodedDataLength ?? 0;
      e.end = Date.now();
      e.done = true;
      this.live.delete(key);
    });
    on("Network.loadingFailed", (p, key) => {
      const e = this.live.get(key);
      if (!e) return;
      e.failed = true;
      e.canceled = !!p.canceled;
      e.done = true;
      this.live.delete(key);
    });
  }
  mark() {
    return this.entries.length;
  }
  /** A worker started from `url`: its script's request is not left open. */
  worker(url) {
    this.workerUrls.add(url);
    for (const [key, e] of this.live)
      if (e.url === url) {
        e.done = true;
        e.workerScript = true;
        this.live.delete(key);
      }
  }
  /** Milliseconds since the last request began, and how many are open. */
  calm() {
    const last = this.entries[this.entries.length - 1];
    // A request open for half a minute is a stream, not a load.
    const open = [...this.live.values()].filter(
      (e) => Date.now() - e.seen < 30000,
    ).length;
    return { sinceMs: last ? Date.now() - last.seen : Infinity, open };
  }
  summary(from = 0) {
    const list = this.entries.slice(from);
    const bySource = {};
    const seen = new Map();
    for (const e of list) {
      const s = (bySource[e.source] ??= {
        requests: 0,
        MB: 0,
        ranges: 0,
        cacheHits: 0,
        cdnHits: 0,
        canceled: 0,
        failed: 0,
      });
      s.requests++;
      s.MB += e.bytes / 1048576;
      if (e.range) s.ranges++;
      if (e.cache) s.cacheHits++;
      if (/HIT/i.test(e.cdn ?? "")) s.cdnHits++;
      if (e.canceled) s.canceled++;
      else if (e.failed) s.failed++;
      if (!e.cache && !e.canceled && !e.workerScript && e.method === "GET") {
        const key = `${e.url}|${e.range ?? ""}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const s of Object.values(bySource)) s.MB = round(s.MB, 3);
    const duplicates = [...seen].filter(([, n]) => n > 1);
    return {
      requests: list.length,
      MB: round(list.reduce((t, e) => t + e.bytes, 0) / 1048576, 3),
      bySource,
      duplicateFetches: duplicates.reduce((t, [, n]) => t + n - 1, 0),
      duplicateExamples: duplicates
        .slice(0, 8)
        .map(([key, n]) => ({ request: key, times: n })),
    };
  }
}

/* ---- a visit: a context, its page, its throttles ---- */

async function openVisit(browser, cdp, network, profileName, foil) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({
    ...profile.context,
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
  });
  await context.addInitScript(instrument, {
    layers: foil === "off" ? { foil: false } : null,
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  const { targetInfo } = await session.send("Target.getTargetInfo");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: targetInfo.targetId,
    flatten: true,
  });
  const conditions = {
    offline: false,
    latency: profile.network.latency,
    downloadThroughput: profile.network.down / 8,
    uploadThroughput: profile.network.up / 8,
  };
  const ours = new Set([sessionId]);
  const prime = async (id) => {
    network.sessions.add(id);
    await cdp.send("Network.enable", {}, id).catch(() => {});
    await cdp
      .send("Network.emulateNetworkConditions", conditions, id)
      .catch(() => {});
    if (profile.cpu > 1)
      await cdp
        .send("Emulation.setCPUThrottlingRate", { rate: profile.cpu }, id)
        .catch(() => {});
  };
  const off = cdp.on("Target.attachedToTarget", async (p, parent) => {
    if (!ours.has(parent)) return;
    ours.add(p.sessionId);
    if (p.targetInfo?.type === "worker") network.worker(p.targetInfo.url);
    await prime(p.sessionId);
    await cdp
      .send(
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
        p.sessionId,
      )
      .catch(() => {});
    await cdp
      .send("Runtime.runIfWaitingForDebugger", {}, p.sessionId)
      .catch(() => {});
  });
  await prime(sessionId);
  await cdp.send(
    "Target.setAutoAttach",
    { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
    sessionId,
  );
  const gpuInfo = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl
        ? "unknown"
        : "none";
  });
  return {
    profileName,
    profile,
    foil,
    context,
    page,
    session,
    gpuInfo,
    network,
    async close() {
      off();
      for (const id of ours) network.sessions.delete(id);
      for (const key of [...network.live.keys()])
        if (ours.has(key.split("|")[0])) network.live.delete(key);
      await context.close();
    },
  };
}

/**
 * The JS heap after a full collection, MB: what is held, not what is garbage.
 * `js` is V8's objects; `buffers` the ArrayBuffers' backing stores outside
 * it, where the decoded tiles are (the foil's heights among them).
 */
async function heapAfterGc(session) {
  try {
    await session.send("HeapProfiler.collectGarbage");
    const { usedSize, backingStorageSize } = await session.send(
      "Runtime.getHeapUsage",
    );
    return {
      js: round(usedSize / 1048576),
      buffers:
        backingStorageSize === undefined
          ? null
          : round(backingStorageSize / 1048576),
    };
  } catch {
    return null;
  }
}

/** A CPU profile's functions by self time, the 25 heaviest. */
function topFunctions(profile) {
  const dt = new Map();
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < samples.length; i++)
    dt.set(samples[i], (dt.get(samples[i]) ?? 0) + (timeDeltas[i] ?? 0));
  const self = new Map();
  let total = 0;
  for (const [id, us] of dt) {
    const f = byId.get(id).callFrame;
    if (["(idle)", "(program)"].includes(f.functionName)) continue;
    const file = f.url ? f.url.split("/").pop().split("?")[0] : "";
    const key = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    total += us;
  }
  return {
    totalMs: round(total / 1000),
    top: [...self]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([fn, us]) => ({ fn, ms: round(us / 1000) })),
  };
}

const metrics = async (session) => {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

async function mapReady(page, timeout) {
  await page.waitForSelector(".maplibregl-canvas", { timeout });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".spot-marker").length > 50 &&
      !document.querySelector(".spot-marker.pending"),
    null,
    { timeout, polling: 100 },
  );
}

const pageState = (page) =>
  page.evaluate(() => ({
    heap: performance.memory
      ? {
          usedMB: Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10,
          totalMB:
            Math.round(performance.memory.totalJSHeapSize / 104857.6) / 10,
        }
      : null,
    gpu: window.__perf.gpu(),
    tiles: window.__perf.tiles(),
    renders: window.__perf.renders,
    timers: { ...window.__perf.timers },
    longTasks: window.__perf.longTasks.length,
    events: window.__perf.events.length,
    foilLayers: (() => {
      const map = window.__perf.map();
      if (!map) return null;
      const ids = map.getLayersOrder().filter((id) => id.startsWith("foil-"));
      return {
        layers: ids.length,
        visible: ids.filter(
          (id) => map.getLayoutProperty(id, "visibility") !== "none",
        ).length,
      };
    })(),
    zoom: window.__perf.map()?.getZoom() ?? null,
  }));

/**
 * One scenario: its trace, the heap and the GPU before and after, the
 * network in between, the long tasks and the interactions the page saw.
 */
async function measure(browser, visit, network, name, run) {
  const { page, session } = visit;
  const from = network.mark();
  const gcBefore = await heapAfterGc(session);
  const before = await pageState(page).catch(() => null);
  const m0 = await metrics(session);
  if (profiling) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 200 });
    await session.send("Profiler.start");
  }
  if (tracing)
    await browser.startTracing(page, {
      categories: TRACE_CATEGORIES.split(","),
    });
  const t0 = Date.now();
  let extra = {};
  let error = null;
  try {
    extra = (await run()) ?? {};
  } catch (e) {
    error = e.message.split("\n")[0];
  }
  const wall = Date.now() - t0;
  let cpu = null;
  if (tracing) {
    const trace = await browser.stopTracing();
    try {
      cpu = analyseTrace(trace);
    } catch (e) {
      cpu = { error: e.message };
    }
  }
  let profile = null;
  if (profiling) {
    const { profile: p } = await session.send("Profiler.stop");
    profile = topFunctions(p);
  }
  const m1 = await metrics(session);
  const after = await pageState(page).catch(() => null);
  const gcAfter = await heapAfterGc(session);
  const observed = await page
    .evaluate(
      ({ lt, ev }) => {
        const p = window.__perf;
        const tasks = p.longTasks.slice(lt);
        const events = p.events.slice(ev);
        const byId = new Map();
        for (const e of events)
          byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.duration));
        const worst = [...byId.values()].sort((a, b) => b - a);
        return {
          longTasks: tasks.length,
          longTaskMaxMs: Math.max(0, ...tasks.map((t) => t.duration)),
          longTaskTotalMs: tasks.reduce((t, x) => t + x.duration, 0),
          interactions: byId.size,
          worstInteractionMs: worst[0] ?? 0,
        };
      },
      { lt: before?.longTasks ?? 0, ev: before?.events ?? 0 },
    )
    .catch(() => null);
  const result = {
    scenario: name,
    profile: visit.profileName,
    foil: visit.foil,
    wallMs: wall,
    error,
    ...extra,
    cpu,
    devtools: {
      taskMs: round((m1.TaskDuration - m0.TaskDuration) * 1000),
      scriptMs: round((m1.ScriptDuration - m0.ScriptDuration) * 1000),
      layoutMs: round((m1.LayoutDuration - m0.LayoutDuration) * 1000),
      styleMs: round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000),
    },
    heap: {
      usedBeforeMB: before?.heap?.usedMB ?? round(m0.JSHeapUsedSize / 1048576),
      usedAfterMB: after?.heap?.usedMB ?? round(m1.JSHeapUsedSize / 1048576),
      totalBeforeMB:
        before?.heap?.totalMB ?? round(m0.JSHeapTotalSize / 1048576),
      totalAfterMB: after?.heap?.totalMB ?? round(m1.JSHeapTotalSize / 1048576),
      afterGcBeforeMB: gcBefore,
      afterGcAfterMB: gcAfter,
      domNodes: m1.Nodes,
    },
    gpu: after?.gpu ?? null,
    tiles: after?.tiles ?? null,
    foilLayers: after?.foilLayers ?? null,
    renders: after && before ? after.renders - before.renders : null,
    timers:
      after && before
        ? Object.fromEntries(
            Object.entries(after.timers).map(([k, v]) => [
              k,
              v - before.timers[k],
            ]),
          )
        : null,
    observed,
    network: network.summary(from),
    profile,
  };
  rawNetwork.push({
    run: `${visit.profileName}/${visit.foil}`,
    scenario: name,
    entries: network.entries.slice(from),
  });
  console.log(
    `  ${visit.profileName}/${visit.foil} ${name}: ${wall} ms` +
      (cpu?.mainBusyMs !== undefined
        ? `, main ${cpu.mainBusyMs} ms, long ${cpu.longTasks.count}×/${cpu.longTasks.maxMs} ms`
        : "") +
      `, ${result.network.requests} req ${result.network.MB} MB` +
      (error ? `, ERROR ${error}` : ""),
  );
  return result;
}

/* ---- camera and input helpers, in the page ---- */

const ease = (page, camera, duration) =>
  page.evaluate(
    ({ camera, duration }) =>
      new Promise((resolve) => {
        const map = window.__perf.map();
        window.__perf.startFrames();
        map.once("moveend", () => resolve(window.__perf.stopFrames()));
        map.easeTo({ ...camera, duration, essential: true });
      }),
    { camera, duration },
  );
const jump = (page, camera) =>
  page.evaluate((camera) => window.__perf.map().jumpTo(camera), camera);
const idle = (page, ms = 15000) =>
  page.evaluate((ms) => window.__perf.idle(ms), ms);
const now = (page) => page.evaluate(() => performance.now());
/**
 * Until the map is idle and no request has begun for two seconds with none
 * still open: the page's performance.now() when it was so.
 */
async function quiet(visit, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await idle(visit.page, 5000);
    const { sinceMs, open } = visit.network.calm();
    if (sinceMs >= 2000 && open === 0) break;
    await visit.page.waitForTimeout(Math.max(250, 2000 - sinceMs));
  }
  return (await now(visit.page)) - 2000;
}
const nextPaint = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now())),
        ),
      ),
  );

/** Frame samples merged: frames, dropped, and the frame rate over all of them. */
function mergeFrames(samples) {
  const ok = samples.filter((s) => s && s.frames > 1);
  if (!ok.length) return null;
  const frames = ok.reduce((t, s) => t + s.frames, 0);
  const dropped = ok.reduce((t, s) => t + s.dropped, 0);
  const fps = ok.reduce((t, s) => t + s.fps * s.frames, 0) / frames;
  return {
    frames,
    dropped,
    droppedPct: round((dropped / (frames + dropped)) * 100),
    fps: round(fps),
    worstGapMs: Math.max(...ok.map((s) => s.worstGapMs)),
  };
}

/* ---- the scenarios ---- */

const SCENARIOS = {
  /** The all-Ireland view from an empty cache, to every light rated and the map idle. */
  async cold(visit) {
    const { page, profile } = visit;
    const t = Date.now();
    await page.goto(base + "/", {
      waitUntil: "commit",
      timeout: profile.timeout,
    });
    await mapReady(page, profile.timeout);
    const mapReadyMs = await now(page);
    const mapFound = await page.evaluate(() => !!window.__perf.map());
    const settled = mapFound ? await idle(page, profile.timeout) : false;
    const mapIdleMs = await now(page);
    // Then until nothing more is asked for: a phone's first camera move can
    // land after the map's first idle and bring the foil's areas with it.
    const quietMs = await quiet(visit, profile.timeout);
    // When the last of the foil's archive reads came in, from the start.
    const foilReads = visit.network.entries.filter(
      (e) => e.seen >= t && e.source === "foil-archives" && e.end,
    );
    const foilLoadedMs = foilReads.length
      ? Math.max(...foilReads.map((e) => e.end)) - t
      : null;
    // LCP and CLS settle a moment after.
    await page.waitForTimeout(2000);
    const vitals = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const p = window.__perf;
      return {
        ttfbMs: Math.round(nav.responseStart),
        fcpMs: Math.round(p.fcp),
        lcpMs: Math.round(p.lcp),
        cls: Math.round(p.cls * 10000) / 10000,
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      };
    });
    return {
      vitals,
      mapReadyMs: Math.round(mapReadyMs),
      mapIdleMs: Math.round(mapIdleMs),
      mapIdleReached: settled,
      quietMs: Math.round(quietMs),
      foilLoadedMs,
      loadWallMs: Date.now() - t,
    };
  },

  /** Nothing touched for a minute, on the all-Ireland view. */
  async idle(visit) {
    const { page } = visit;
    await page.waitForTimeout(idleSeconds * 1000);
    return { seconds: idleSeconds };
  },

  /** Into Dublin Bay and Malahide, z9 to z14, a zoom at a time. */
  async zoom(visit) {
    const { page } = visit;
    const frames = [];
    const settle = [];
    for (let z = 10; z <= 14; z++) {
      const k = (z - 9) / 5;
      const center = AT.between.map((v, i) => v + (AT.malahide[i] - v) * k);
      frames.push(await ease(page, { center, zoom: z }, 700));
      const t = await now(page);
      await idle(page, 20000);
      settle.push(Math.round((await now(page)) - t));
    }
    return { frames: mergeFrames(frames), tilesSettledMs: settle };
  },

  /** Along the east coast at z11, Skerries to Rosslare. */
  async pan(visit) {
    const { page } = visit;
    const frames = [];
    const settle = [];
    for (const center of AT.eastCoast.slice(1)) {
      frames.push(await ease(page, { center, zoom: 11 }, 1000));
      const t = await now(page);
      await idle(page, 20000);
      settle.push(Math.round((await now(page)) - t));
    }
    return { frames: mergeFrames(frames), tilesSettledMs: settle };
  },

  /** 24 forecast hours, a step every 250 ms, over Dublin Bay at z12. */
  async hours(visit) {
    const { page } = visit;
    const slider = page.locator('input[aria-label="Forecast time"]');
    if (!(await slider.count())) throw new Error("No forecast time slider.");
    await slider.focus();
    const ramp = () =>
      page.evaluate(() => {
        const map = window.__perf.map();
        return map
          .getLayersOrder()
          .filter(
            (id) =>
              id.startsWith("foil-") &&
              map.getLayoutProperty(id, "visibility") !== "none",
          )
          .map((id) =>
            JSON.stringify(map.getPaintProperty(id, "color-relief-color")),
          )
          .join("|");
      });
    const first = await ramp();
    const steps = [];
    await page.evaluate(() => window.__perf.startFrames());
    let changed = 0;
    let last = first;
    for (let i = 0; i < hourSteps; i++) {
      const t = await now(page);
      await page.keyboard.press("ArrowRight");
      const painted = await nextPaint(page);
      steps.push(painted - t);
      const r = await ramp();
      if (r !== last) changed++;
      last = r;
      await page.waitForTimeout(250);
    }
    const frames = await page.evaluate(() => window.__perf.stopFrames());
    await idle(page, 10000);
    const sorted = [...steps].sort((a, b) => a - b);
    return {
      steps: hourSteps,
      rampChanges: changed,
      stepToPaintMs: {
        median: round(sorted[sorted.length >> 1]),
        p95: round(sorted[Math.floor(sorted.length * 0.95)]),
        max: round(sorted[sorted.length - 1]),
      },
      frames,
    };
  },

  /** Taps a rider makes: the open sea, a light, an hour in the dock (INP). */
  async taps(visit) {
    const { page, profileName } = visit;
    const tap = async (x, y) => {
      if (profileName === "phone") await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    };
    const done = [];
    // The open sea off Dublin Bay.
    const sea = await page.evaluate(() => {
      const map = window.__perf.map();
      const p = map.project([-5.95, 53.35]);
      const box = map.getContainer().getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    });
    await tap(sea.x, sea.y);
    await page.waitForTimeout(1500);
    done.push("sea");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const marker = page.locator(".spot-marker").nth(5);
    if (await marker.count()) {
      const box = await marker.boundingBox();
      if (box) {
        await tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(2000);
        done.push("light");
      }
    }
    const hour = page.locator(".tt-wrap td[data-i]").nth(4);
    if (await hour.count()) {
      const box = await hour.boundingBox();
      if (box) {
        await tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1200);
        done.push("hour");
      }
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    return { tapped: done };
  },
};

/** Where each scenario starts from, once the previous one has finished. */
/**
 * The dock's hours, for the hour steps. A first visit opens on the chart
 * alone, and a spot brings the dock: the light nearest Dublin Bay is
 * chosen, as a rider would tap it. A page that already has them is left be.
 */
async function openHours(page) {
  const slider = page.locator('input[aria-label="Forecast time"]');
  if (await slider.count()) return;
  await jump(page, { center: AT.dublinBay, zoom: 11 });
  await idle(page, 15000);
  const at = await page.evaluate(() => {
    const box = window.__perf.map().getContainer().getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let best = null;
    for (const el of document.querySelectorAll(".spot-marker")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best;
  });
  if (!at) throw new Error("No light to open the dock with.");
  await page.mouse.click(at.x, at.y);
  await slider.waitFor({ state: "attached", timeout: 30000 });
  await page.evaluate(() => window.__perf.map().stop());
}

const START = {
  idle: async (page) => {
    await page.evaluate(() => {
      const map = window.__perf.map();
      map.stop();
    });
  },
  zoom: (page) => jump(page, { center: AT.between, zoom: 9 }),
  pan: (page) => jump(page, { center: AT.eastCoast[0], zoom: 11 }),
  hours: async (page) => {
    await openHours(page);
    await jump(page, { center: AT.dublinBay, zoom: 12 });
  },
  taps: async (page) => {
    await page.evaluate(() => {
      const map = window.__perf.map();
      const bounds = [
        [-10.7, 51.35],
        [-5.4, 55.45],
      ];
      map.fitBounds(bounds, { duration: 0, padding: 20 });
    });
  },
};

async function runVisit(browser, cdp, network, profileName, foil) {
  const visit = await openVisit(browser, cdp, network, profileName, foil);
  console.log(`${profileName}, foil ${foil} (GPU: ${visit.gpuInfo})`);
  const results = {};
  try {
    for (const name of scenarios) {
      if (name !== "cold" && !results.cold) {
        await visit.page.goto(base + "/", { waitUntil: "commit" });
        await mapReady(visit.page, visit.profile.timeout);
        await idle(visit.page, visit.profile.timeout);
        results.cold = { skipped: true };
      }
      if (START[name]) {
        await START[name](visit.page);
        await idle(visit.page, 30000);
        await visit.page.waitForTimeout(name === "idle" ? 3000 : 1000);
      }
      results[name] = await measure(browser, visit, network, name, () =>
        SCENARIOS[name](visit),
      );
    }
    results.gpuInfo = visit.gpuInfo;
  } finally {
    await visit.close();
  }
  return results;
}

/** Hour steps and pans for `seconds`, with a heap snapshot either side. */
async function soak(browser, cdp, network, foil) {
  const visit = await openVisit(browser, cdp, network, "desktop", foil);
  const { page, session } = visit;
  console.log(`soak: desktop, foil ${foil}, ${soakSeconds} s`);
  try {
    await page.goto(base + "/", { waitUntil: "commit" });
    await mapReady(page, 90000);
    await idle(page, 60000);
    await jump(page, { center: AT.dublinBay, zoom: 11 });
    await idle(page, 30000);
    // One lap first, so what any lap loads once (the stations' tides, the
    // coast's tiles) is in the "before" snapshot and only growth is after.
    const slider = page.locator('input[aria-label="Forecast time"]');
    const lap = async (i, at) => {
      await slider.focus();
      await page.keyboard.press(
        Math.floor(i / 24) % 2 ? "ArrowLeft" : "ArrowRight",
      );
      await page.waitForTimeout(300);
      if (i % 6 === 5) {
        const center = AT.eastCoast[at % AT.eastCoast.length];
        await ease(page, { center, zoom: 10 + (at % 3) }, 600);
        await idle(page, 5000);
        return at + 1;
      }
      return at;
    };
    let at = 0;
    for (let i = 0; i < AT.eastCoast.length * 6; i++) at = await lap(i, at);
    const keep = flag("keep-snapshots");
    const before = await takeSnapshot(
      session,
      keep ? join(out, `soak-${foil}-before.heapsnapshot`) : null,
    );
    const stateBefore = await pageState(page);
    const samples = [];
    const start = Date.now();
    let i = 0;
    let nextSample = 0;
    while (Date.now() - start < soakSeconds * 1000) {
      at = await lap(i++, at);
      if (Date.now() - start >= nextSample) {
        const s = await pageState(page);
        samples.push({
          t: Math.round((Date.now() - start) / 1000),
          heapUsedMB: s.heap?.usedMB,
          gpuTextureMB: s.gpu.textureMB,
          gpuTextures: s.gpu.textures,
          foilRasterMB: s.tiles?.foil?.rasterMB ?? 0,
          foilTiles:
            (s.tiles?.foil?.inView ?? 0) + (s.tiles?.foil?.cached ?? 0),
        });
        nextSample += 30000;
      }
    }
    const after = await takeSnapshot(
      session,
      keep ? join(out, `soak-${foil}-after.heapsnapshot`) : null,
    );
    const stateAfter = await pageState(page);
    const compared = compareSnapshots(before, after);
    console.log(
      `  soak ${foil}: heap ${MB(before.totalBytes)} → ${MB(after.totalBytes)} MB after GC, ${i} steps`,
    );
    return {
      foil,
      seconds: soakSeconds,
      steps: i,
      heapAfterGcMB: {
        before: MB(before.totalBytes),
        after: MB(after.totalBytes),
      },
      gpu: { before: stateBefore.gpu, after: stateAfter.gpu },
      tiles: { before: stateBefore.tiles, after: stateAfter.tiles },
      samples,
      compared: {
        ...compared,
        totalBefore: MB(compared.totalBefore),
        totalAfter: MB(compared.totalAfter),
        totalDelta: MB(compared.totalDelta),
        grew: compared.grew.map((r) => ({
          ...r,
          bytesDelta: MB(r.bytesDelta),
        })),
        shrank: compared.shrank.map((r) => ({
          ...r,
          bytesDelta: MB(r.bytesDelta),
        })),
      },
    };
  } finally {
    await visit.close();
  }
}

/** Lighthouse's performance category, against the running Chrome. */
function lighthouse(port, preset) {
  const output = join(out, `lighthouse-${preset}.json`);
  const args = [
    "--yes",
    "lighthouse@12",
    base + "/",
    `--port=${port}`,
    "--only-categories=performance",
    "--output=json",
    `--output-path=${output}`,
    "--quiet",
    ...(preset === "desktop" ? ["--preset=desktop"] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn("npx", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", async (code) => {
      if (code !== 0)
        return resolve({ error: err.trim().split("\n").slice(-3).join(" ") });
      try {
        const r = JSON.parse(await readFile(output, "utf8"));
        const a = r.audits;
        const v = (id) => a[id]?.numericValue ?? null;
        resolve({
          score: Math.round((r.categories.performance.score ?? 0) * 100),
          fcpMs: Math.round(v("first-contentful-paint")),
          lcpMs: Math.round(v("largest-contentful-paint")),
          tbtMs: Math.round(v("total-blocking-time")),
          cls: round(v("cumulative-layout-shift"), 4),
          speedIndexMs: Math.round(v("speed-index")),
          totalMB: MB(v("total-byte-weight")),
          report: output,
        });
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  });
}

/** Runs merged: every number the median of its runs, anything else the first's. */
function medianOf(samples) {
  const first = samples[0];
  if (samples.length === 1) return first;
  if (typeof first === "number") {
    const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return first;
    const mid = sorted.length >> 1;
    return sorted.length % 2
      ? sorted[mid]
      : round((sorted[mid - 1] + sorted[mid]) / 2, 2);
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const out = {};
    for (const key of Object.keys(first))
      out[key] = medianOf(
        samples.map((s) => s?.[key]).filter((v) => v !== undefined),
      );
    return out;
  }
  return first;
}

const rawNetwork = [];

/* ---- main ---- */

for (const name of scenarios)
  if (!SCENARIOS[name]) {
    console.error(
      `No scenario "${name}": ${Object.keys(SCENARIOS).join(", ")}.`,
    );
    process.exit(2);
  }

await mkdir(out, { recursive: true });
const port = await freePort();
const browser = await chromium.launch({
  channel: process.env.PERF_CHROMIUM ? undefined : "chrome",
  headless: !flag("headed"),
  args: [
    `--remote-debugging-port=${port}`,
    "--enable-precise-memory-info",
    ...(flag("insecure-cors") ? ["--disable-web-security"] : []),
    // Playwright's Chromium on a machine with no GPU (CI): WebGL in software,
    // the same software everywhere.
    ...(process.env.PERF_CHROMIUM
      ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
      : []),
  ],
});
const cdp = await Cdp.connect(port);
const network = new Network(cdp);
const report = {
  base,
  at: new Date().toISOString(),
  chrome: cdp.version.Browser,
  options: {
    profiles,
    foils,
    scenarios,
    idleSeconds,
    hourSteps,
    soakSeconds,
    tracing,
    runs,
  },
  runs: {},
  soak: [],
  lighthouse: {},
};
try {
  for (const profileName of scenarios.length ? profiles : [])
    for (const foil of foils) {
      const samples = [];
      for (let i = 0; i < runs; i++)
        try {
          samples.push(
            await runVisit(browser, cdp, network, profileName, foil),
          );
        } catch (e) {
          console.error(`${profileName}/${foil}: ${e.message.split("\n")[0]}`);
        }
      report.runs[`${profileName}/${foil}`] = samples.length
        ? medianOf(samples)
        : { error: "every run failed" };
    }
  if (soakSeconds > 0)
    for (const foil of foils) {
      try {
        report.soak.push(await soak(browser, cdp, network, foil));
      } catch (e) {
        console.error(`soak ${foil}: ${e.message.split("\n")[0]}`);
        report.soak.push({ foil, error: e.message.split("\n")[0] });
      }
    }
  if (flag("lighthouse"))
    for (const preset of ["desktop", "mobile"]) {
      console.log(`lighthouse ${preset}`);
      report.lighthouse[preset] = await lighthouse(port, preset);
      console.log(`  ${JSON.stringify(report.lighthouse[preset])}`);
    }
} finally {
  cdp.close();
  await browser.close();
}

let budgets = [];
try {
  budgets = JSON.parse(await readFile(budgetsFile, "utf8")).budgets ?? [];
} catch {
  console.warn(`No budgets read from ${budgetsFile}.`);
}
// A runner without a GPU draws WebGL in software: its CPU and frame times
// are not a rider's, so the budgets on them are left out there.
if (flag("no-gpu-budgets")) budgets = budgets.filter((b) => !b.gpu);
report.budgets = checkBudgets(report, budgets);
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(out, "report.md"), markdownReport(report));
await writeFile(join(out, "network.json"), JSON.stringify(rawNetwork));
const over = report.budgets.filter((b) => b.status === "over");
console.log(`\nwrote ${join(out, "report.json")} and report.md`);
if (over.length) {
  console.log(`${over.length} budget(s) over:`);
  for (const b of over)
    console.log(`  ${b.id} (${b.run}): ${b.value} > ${b.max}`);
  if (flag("strict")) process.exitCode = 1;
}
