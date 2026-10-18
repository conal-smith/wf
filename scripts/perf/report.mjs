/**
 * The perf run's report as Markdown, and its budgets checked: a budget names
 * a scenario, a dot path into its result (report.json), and a `max` (or a
 * `min`), for some profiles and foil settings or all of them.
 */

const get = (object, path) =>
  path.split(".").reduce((v, key) => (v == null ? v : v[key]), object);

/** Each budget against each run it applies to: ok, over, or missing. */
export function checkBudgets(report, budgets) {
  const rows = [];
  for (const b of budgets) {
    const targets = [];
    if (b.scenario === "soak")
      for (const s of report.soak ?? [])
        targets.push([`desktop/${s.foil}`, s, "desktop", s.foil]);
    else if (b.scenario === "lighthouse")
      for (const [preset, r] of Object.entries(report.lighthouse ?? {}))
        targets.push([
          preset,
          r,
          preset === "mobile" ? "phone" : "desktop",
          "on",
        ]);
    else
      for (const [run, results] of Object.entries(report.runs ?? {})) {
        const [profile, foil] = run.split("/");
        targets.push([run, results?.[b.scenario], profile, foil]);
      }
    for (const [run, result, profile, foil] of targets) {
      if (b.profiles && !b.profiles.includes(profile)) continue;
      if (b.foil && b.foil !== foil) continue;
      if (!result || result.skipped) continue;
      const value = get(result, b.metric);
      const status =
        typeof value !== "number"
          ? "missing"
          : (b.max !== undefined && value > b.max) ||
              (b.min !== undefined && value < b.min)
            ? "over"
            : "ok";
      rows.push({
        id: b.id,
        run,
        metric: `${b.scenario}.${b.metric}`,
        value: value ?? null,
        max: b.max,
        min: b.min,
        status,
      });
    }
  }
  return rows;
}

const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "–"
    : typeof v === "number"
      ? Number.isInteger(v)
        ? String(v)
        : v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)
      : String(v);

const src = (r, name, key) => r?.network?.bySource?.[name]?.[key] ?? 0;

/** The rows every scenario shows, then each scenario's own. */
const COMMON = [
  ["wall time (ms)", (r) => r.wallMs],
  ["main thread busy (ms)", (r) => r.cpu?.mainBusyMs],
  ["  scripting (ms)", (r) => r.cpu?.categories?.scripting],
  ["  rendering (ms)", (r) => r.cpu?.categories?.rendering],
  ["  painting (ms)", (r) => r.cpu?.categories?.painting],
  ["  GC (ms)", (r) => r.cpu?.categories?.gc],
  ["long tasks >50 ms (n)", (r) => r.cpu?.longTasks?.count],
  ["longest task (ms)", (r) => r.cpu?.longTasks?.maxMs],
  ["blocking time (ms)", (r) => r.cpu?.longTasks?.blockingMs],
  ["workers busy (ms)", (r) => r.cpu?.workersBusyMs],
  ["GPU process busy (ms)", (r) => r.cpu?.gpuBusyMs],
  [
    "JS heap after GC, before → after (MB)",
    (r) =>
      r.heap?.afterGcAfterMB &&
      `${fmt(r.heap.afterGcBeforeMB?.js)} → ${fmt(r.heap.afterGcAfterMB.js)}`,
  ],
  [
    "ArrayBuffers after GC, before → after (MB)",
    (r) =>
      r.heap?.afterGcAfterMB?.buffers != null &&
      `${fmt(r.heap.afterGcBeforeMB?.buffers)} → ${fmt(r.heap.afterGcAfterMB.buffers)}`,
  ],
  ["JS heap total, end (MB)", (r) => r.heap?.totalAfterMB],
  ["GPU textures (MB, live)", (r) => r.gpu?.textureMB],
  ["GPU buffers (MB, live)", (r) => r.gpu?.bufferMB],
  [
    "foil sources (used/added)",
    (r) =>
      r.tiles?.foil && `${r.tiles.foil.sourcesUsed}/${r.tiles.foil.sources}`,
  ],
  [
    "foil tiles in view + cached",
    (r) => r.tiles?.foil && `${r.tiles.foil.inView} + ${r.tiles.foil.cached}`,
  ],
  ["foil DEM held (MB, CPU + GPU)", (r) => r.tiles?.foil?.rasterMB],
  ["requests (n)", (r) => r.network?.requests],
  ["transferred (MB)", (r) => r.network?.MB],
  [
    "  foil archives: req / MB / ranges",
    (r) =>
      r.network &&
      `${src(r, "foil-archives", "requests")} / ${fmt(src(r, "foil-archives", "MB"))} / ${src(r, "foil-archives", "ranges")}`,
  ],
  [
    "  bathy: req / MB",
    (r) =>
      r.network &&
      `${src(r, "bathy", "requests")} / ${fmt(src(r, "bathy", "MB"))}`,
  ],
  [
    "  basemap: req / MB",
    (r) =>
      r.network &&
      `${src(r, "basemap", "requests")} / ${fmt(src(r, "basemap", "MB"))}`,
  ],
  [
    "  forecast: req / MB",
    (r) =>
      r.network &&
      `${src(r, "forecast", "requests")} / ${fmt(src(r, "forecast", "MB"))}`,
  ],
  [
    "  tides: req / MB",
    (r) =>
      r.network &&
      `${src(r, "tides", "requests")} / ${fmt(src(r, "tides", "MB"))}`,
  ],
  [
    "  app (js+css+fonts): MB",
    (r) =>
      r.network &&
      fmt(
        src(r, "app-js", "MB") +
          src(r, "app-css", "MB") +
          src(r, "app-fonts", "MB") +
          src(r, "document", "MB"),
      ),
  ],
  [
    "cache hits (n)",
    (r) =>
      r.network &&
      Object.values(r.network.bySource).reduce((t, s) => t + s.cacheHits, 0),
  ],
  ["duplicate fetches (n)", (r) => r.network?.duplicateFetches],
];
const OWN = {
  cold: [
    ["TTFB (ms)", (r) => r.vitals?.ttfbMs],
    ["FCP (ms)", (r) => r.vitals?.fcpMs],
    ["LCP (ms)", (r) => r.vitals?.lcpMs],
    ["CLS", (r) => r.vitals?.cls],
    ["lights rated (ms)", (r) => r.mapReadyMs],
    ["map idle (ms)", (r) => r.mapIdleMs],
    ["network quiet (ms)", (r) => r.quietMs],
    ["foil's last archive read (ms from start)", (r) => r.foilLoadedMs],
  ],
  idle: [
    ["map renders (n)", (r) => r.renders],
    ["rAF requests (n)", (r) => r.timers?.raf],
    ["setTimeout calls (n)", (r) => r.timers?.timeout],
    [
      "CPU share of one core (%)",
      (r) =>
        r.cpu &&
        (100 * (r.cpu.mainBusyMs + r.cpu.workersBusyMs)) / (r.seconds * 1000),
    ],
  ],
  zoom: [
    ["fps while moving", (r) => r.frames?.fps],
    [
      "dropped frames (n / %)",
      (r) => r.frames && `${r.frames.dropped} / ${fmt(r.frames.droppedPct)}`,
    ],
    ["worst frame gap (ms)", (r) => r.frames?.worstGapMs],
    [
      "tiles settled per step (ms, max)",
      (r) => r.tilesSettledMs && Math.max(...r.tilesSettledMs),
    ],
  ],
  hours: [
    ["step → painted (median ms)", (r) => r.stepToPaintMs?.median],
    ["step → painted (p95 ms)", (r) => r.stepToPaintMs?.p95],
    ["worst interaction (ms)", (r) => r.observed?.worstInteractionMs],
    ["ramp changes / steps", (r) => r.steps && `${r.rampChanges} / ${r.steps}`],
    ["fps while stepping", (r) => r.frames?.fps],
    [
      "dropped frames (n / %)",
      (r) => r.frames && `${r.frames.dropped} / ${fmt(r.frames.droppedPct)}`,
    ],
  ],
  taps: [
    ["INP, lab (worst interaction ms)", (r) => r.observed?.worstInteractionMs],
    ["interactions (n)", (r) => r.observed?.interactions],
  ],
};
OWN.pan = OWN.zoom;

export function markdownReport(report) {
  const runs = Object.keys(report.runs);
  const lines = [
    `# Map performance: ${report.base}`,
    "",
    `${report.at} · ${report.chrome} · GPU: ${Object.values(report.runs).find((r) => r?.gpuInfo)?.gpuInfo ?? "?"}`,
    "",
    "Desktop: 1440×900 at 2×, 20 Mbit/s, 20 ms. Phone: 390×844 at 3×, touch, CPU ÷4, 1.6 Mbit/s, 150 ms. " +
      "Every scenario after `cold` runs on the same page (a warm HTTP cache).",
    "",
  ];
  for (const scenario of report.options.scenarios) {
    lines.push(`## ${scenario}`, "");
    lines.push(
      `| | ${runs.join(" | ")} |`,
      `|---|${runs.map(() => "---:").join("|")}|`,
    );
    for (const [label, pick] of [...(OWN[scenario] ?? []), ...COMMON]) {
      const cells = runs.map((run) => {
        const r = report.runs[run]?.[scenario];
        if (!r || r.skipped) return "–";
        try {
          return fmt(pick(r));
        } catch {
          return "–";
        }
      });
      if (
        cells.every(
          (c) => c === "–" || c === "0" || c === "0 / 0 / 0" || c === "0 / 0",
        )
      )
        continue;
      lines.push(`| ${label} | ${cells.join(" | ")} |`);
    }
    const errors = runs
      .map((run) => [run, report.runs[run]?.[scenario]?.error])
      .filter(([, e]) => e);
    for (const [run, e] of errors) lines.push("", `${run}: error: ${e}`);
    lines.push("");
  }
  if (report.soak?.length) {
    lines.push("## Soak (hour steps and pans, desktop)", "");
    for (const s of report.soak) {
      if (s.error) {
        lines.push(`foil ${s.foil}: error: ${s.error}`, "");
        continue;
      }
      lines.push(
        `**Foil ${s.foil}**, ${s.seconds} s, ${s.steps} steps: JS heap after GC ${s.heapAfterGcMB.before} → ${s.heapAfterGcMB.after} MB ` +
          `(${s.compared.nodesDelta >= 0 ? "+" : ""}${s.compared.nodesDelta} objects); GPU textures ${s.gpu.before.textureMB} → ${s.gpu.after.textureMB} MB ` +
          `(${s.gpu.before.textures} → ${s.gpu.after.textures}).`,
        "",
        "| t (s) | heap used (MB) | GPU textures (MB) | textures (n) | foil tiles | foil DEM (MB) |",
        "|---:|---:|---:|---:|---:|---:|",
        ...s.samples.map(
          (x) =>
            `| ${x.t} | ${fmt(x.heapUsedMB)} | ${fmt(x.gpuTextureMB)} | ${x.gpuTextures} | ${x.foilTiles} | ${fmt(x.foilRasterMB)} |`,
        ),
        "",
        "Grew most (heap snapshot comparison, self size):",
        "",
        "| constructor | count before → after | Δ MB |",
        "|---|---:|---:|",
        ...s.compared.grew
          .slice(0, 12)
          .map(
            (g) =>
              `| ${g.name.replace(/\|/g, "\\|")} | ${g.countBefore} → ${g.countAfter} | ${fmt(g.bytesDelta)} |`,
          ),
        "",
      );
    }
  }
  if (Object.keys(report.lighthouse ?? {}).length) {
    lines.push(
      "## Lighthouse (performance, foil on: a first visit's defaults)",
      "",
    );
    lines.push(
      "| | score | FCP | LCP | TBT | CLS | SI | MB |",
      "|---|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const [preset, r] of Object.entries(report.lighthouse))
      lines.push(
        r.error
          ? `| ${preset} | error: ${r.error} |`
          : `| ${preset} | ${r.score} | ${r.fcpMs} | ${r.lcpMs} | ${r.tbtMs} | ${r.cls} | ${r.speedIndexMs} | ${r.totalMB} |`,
      );
    lines.push("");
  }
  if (report.budgets?.length) {
    lines.push(
      "## Budgets",
      "",
      "| budget | run | value | limit | |",
      "|---|---|---:|---:|---|",
    );
    for (const b of report.budgets)
      lines.push(
        `| ${b.id} | ${b.run} | ${fmt(b.value)} | ${b.max !== undefined ? `≤ ${b.max}` : `≥ ${b.min}`} | ${b.status === "over" ? "**over**" : b.status} |`,
      );
    lines.push("");
  }
  const profiled = Object.entries(report.runs).flatMap(([run, results]) =>
    Object.entries(results ?? {})
      .filter(([, r]) => r?.profile?.top?.length)
      .map(([scenario, r]) => [run, scenario, r.profile]),
  );
  if (profiled.length) {
    lines.push("## JS self time (CPU profile), heaviest functions", "");
    for (const [run, scenario, p] of profiled)
      lines.push(
        `<details><summary>${run} ${scenario}: ${p.totalMs} ms of JS</summary>`,
        "",
        "| function | ms |",
        "|---|---:|",
        ...p.top.slice(0, 15).map((f) => `| \`${f.fn}\` | ${fmt(f.ms)} |`),
        "",
        "</details>",
        "",
      );
  }
  return lines.join("\n");
}
