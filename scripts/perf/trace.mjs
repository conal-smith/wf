/**
 * A Chrome performance trace, summed the way DevTools' Summary tab sums it:
 * the page's main thread split into scripting, rendering, painting, loading,
 * garbage collection and the rest by each event's self time, its long tasks,
 * and how busy the page's workers (MapLibre decodes its tiles there), the
 * raster threads and the GPU process were.
 */

export const TRACE_CATEGORIES = [
  "toplevel",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "v8",
  "v8.execute",
  "blink",
  "blink.user_timing",
  "loading",
  "cc",
  "gpu",
  "latencyInfo",
].join(",");

const NAMES = {
  scripting: [
    "EvaluateScript",
    "v8.evaluateModule",
    "v8.run",
    "V8.Execute",
    "FunctionCall",
    "TimerFire",
    "TimerInstall",
    "TimerRemove",
    "EventDispatch",
    "FireAnimationFrame",
    "RequestAnimationFrame",
    "CancelAnimationFrame",
    "FireIdleCallback",
    "RunMicrotasks",
    "v8.callFunction",
    "v8.compile",
    "v8.compileModule",
    "V8.CompileCode",
    "v8.produceCache",
    "v8.produceModuleCache",
    "CompileScript",
    "XHRReadyStateChange",
    "XHRLoad",
    "WebSocketReceive",
    "PerformanceObserver",
  ],
  rendering: [
    "UpdateLayoutTree",
    "RecalculateStyles",
    "Layout",
    "HitTest",
    "PrePaint",
    "UpdateLayer",
    "UpdateLayerTree",
    "ScheduleStyleRecalculation",
    "InvalidateLayout",
    "Layerize",
    "IntersectionObserverController::computeIntersections",
    "ParseAuthorStyleSheet",
  ],
  painting: [
    "Paint",
    "PaintImage",
    "PaintSetup",
    "CompositeLayers",
    "Commit",
    "Decode Image",
    "ImageDecodeTask",
    "Draw LazyPixelRef",
    "Decode LazyPixelRef",
    "RasterTask",
    "GPUTask",
    "Rasterize Paint",
  ],
  loading: [
    "ParseHTML",
    "ResourceSendRequest",
    "ResourceReceiveResponse",
    "ResourceReceivedData",
    "ResourceFinish",
    "ResourceWillSendRequest",
    "ResourceMarkAsCached",
  ],
  gc: [
    "MajorGC",
    "MinorGC",
    "V8.GCScavenger",
    "V8.GCIncrementalMarking",
    "V8.GCFinalizeMC",
    "V8.GCCompactor",
    "V8.GC_MC_BACKGROUND_MARKING",
    "BlinkGC.AtomicPhase",
    "BlinkGC.CompleteSweep",
    "BlinkGC.IncrementalMarkingStep",
    "BlinkGC.LazySweepInIdle",
    "ThreadState::performIdleLazySweep",
    "CppGC.AtomicMark",
    "CppGC.AtomicSweep",
    "CppGC.IncrementalMark",
    "CppGC.IncrementalSweep",
  ],
};
const CATEGORY = new Map(
  Object.entries(NAMES).flatMap(([category, names]) =>
    names.map((name) => [name, category]),
  ),
);
const TOP = new Set(["RunTask", "ThreadControllerImpl::RunTask"]);

/** The trace's thread names, by "pid:tid". */
function threadNames(events) {
  const names = new Map();
  for (const e of events)
    if (e.ph === "M" && e.name === "thread_name")
      names.set(`${e.pid}:${e.tid}`, e.args?.name ?? "");
  return names;
}

/** A thread's slices (X, and B/E paired), sorted outermost first. */
function slices(events) {
  const out = [];
  const open = [];
  for (const e of events) {
    if (e.ph === "X") out.push({ name: e.name, ts: e.ts, dur: e.dur ?? 0 });
    else if (e.ph === "B") open.push(e);
    else if (e.ph === "E") {
      const b = open.pop();
      if (b) out.push({ name: b.name, ts: b.ts, dur: e.ts - b.ts });
    }
  }
  return out.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
}

/** Self time per category, and the thread's top-level tasks. */
function walk(list) {
  const stack = [];
  const self = {};
  const top = [];
  const close = (s) => {
    const own = Math.max(0, s.dur - s.child);
    self[s.cat] = (self[s.cat] ?? 0) + own;
  };
  for (const s of list) {
    while (stack.length && stack[stack.length - 1].end <= s.ts)
      close(stack.pop());
    const parent = stack[stack.length - 1];
    const node = {
      ...s,
      end: s.ts + s.dur,
      child: 0,
      cat: CATEGORY.get(s.name) ?? parent?.cat ?? "other",
    };
    if (parent) parent.child += Math.min(s.dur, parent.end - s.ts);
    else top.push(node);
    stack.push(node);
  }
  while (stack.length) close(stack.pop());
  return { self, top };
}

const ms = (us) => Math.round(us / 100) / 10;

/**
 * @param {Buffer|string|object} trace what Playwright's stopTracing returns
 */
export function analyseTrace(trace) {
  const parsed =
    typeof trace === "object" && !Buffer.isBuffer(trace)
      ? trace
      : JSON.parse(trace.toString());
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const names = threadNames(events);
  const byThread = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    if (e.ph === "M" || !e.ts) continue;
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(e);
    if (e.ph === "X" || e.ph === "B") first = Math.min(first, e.ts);
    last = Math.max(last, e.ts + (e.dur ?? 0));
  }
  const busy = (key) => {
    const { top } = walk(slices(byThread.get(key) ?? []));
    return top.reduce((t, s) => t + s.dur, 0);
  };
  // The page's main thread: the busiest renderer main thread (an iframe's or
  // a blank page's is a fraction of it).
  let main = null;
  let mainBusy = -1;
  for (const [key, name] of names)
    if (name === "CrRendererMain") {
      const b = busy(key);
      if (b > mainBusy) {
        main = key;
        mainBusy = b;
      }
    }
  if (!main) return null;
  const mainPid = main.split(":")[0];
  const { self, top } = walk(slices(byThread.get(main) ?? []));
  const tasks = top.filter((s) => TOP.has(s.name) || s.dur > 0);
  const long = tasks.filter((s) => s.dur > 50_000);
  const sumBusy = (match) =>
    [...names]
      .filter(([key, name]) => match(key, name))
      .reduce((t, [key]) => t + busy(key), 0);
  const categories = {};
  for (const [cat, us] of Object.entries(self)) categories[cat] = ms(us);
  return {
    windowMs: ms(last - first),
    mainBusyMs: ms(tasks.reduce((t, s) => t + s.dur, 0)),
    categories,
    longTasks: {
      count: long.length,
      totalMs: ms(long.reduce((t, s) => t + s.dur, 0)),
      maxMs: ms(Math.max(0, ...long.map((s) => s.dur))),
      blockingMs: ms(long.reduce((t, s) => t + (s.dur - 50_000), 0)),
    },
    workersBusyMs: ms(
      sumBusy(
        (key, name) =>
          key.startsWith(`${mainPid}:`) && /Worker thread/i.test(name),
      ),
    ),
    rasterBusyMs: ms(
      sumBusy(
        (key, name) =>
          key.startsWith(`${mainPid}:`) && /CompositorTileWorker/.test(name),
      ),
    ),
    compositorBusyMs: ms(
      sumBusy(
        (key, name) => key.startsWith(`${mainPid}:`) && name === "Compositor",
      ),
    ),
    gpuBusyMs: ms(sumBusy((_, name) => name === "CrGpuMain")),
  };
}
