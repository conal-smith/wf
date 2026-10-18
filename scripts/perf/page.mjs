/**
 * What the perf run installs in the page before any of its own script runs
 * (Playwright's addInitScript): the observers a field metrics library would
 * set up, a frame sampler, a count of the GPU memory the page asks WebGL
 * for, and a way to reach the MapLibre map without the app exposing it.
 *
 * Serialised into the page: nothing here may close over module scope.
 */
export function instrument(options) {
  if (window.top !== window) return;
  if (options.layers) {
    try {
      // The layers' store (src/App.tsx LAYERS_KEY), merged over its defaults.
      localStorage.setItem(
        "wingfoil.map.layers.v1",
        JSON.stringify(options.layers),
      );
    } catch {
      /* storage refused */
    }
  }
  const perf = (window.__perf = {
    fcp: 0,
    lcp: 0,
    cls: 0,
    longTasks: [],
    frames: [],
    events: [],
    timers: { timeout: 0, interval: 0, raf: 0 },
    renders: 0,
  });
  const observe = (type, callback, extra = {}) => {
    try {
      new PerformanceObserver((list) =>
        list.getEntries().forEach(callback),
      ).observe({ type, buffered: true, ...extra });
    } catch {
      /* unsupported entry type */
    }
  };
  observe("paint", (e) => {
    if (e.name === "first-contentful-paint") perf.fcp = e.startTime;
  });
  observe("largest-contentful-paint", (e) => (perf.lcp = e.startTime));
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
          id: e.interactionId,
          name: e.name,
          start: e.startTime,
          duration: e.duration,
        });
    },
    { durationThreshold: 16 },
  );

  /* ---- timers: how often the page asks for one, idle or not ---- */
  const realRaf = window.requestAnimationFrame.bind(window);
  const realTimeout = window.setTimeout.bind(window);
  const wrap = (name, key) => {
    const real = window[name];
    window[name] = function (...args) {
      perf.timers[key]++;
      return real.apply(this, args);
    };
  };
  wrap("setTimeout", "timeout");
  wrap("setInterval", "interval");
  wrap("requestAnimationFrame", "raf");

  /* ---- frames: rAF intervals while a sampler runs ---- */
  let sampling = false;
  perf.startFrames = () => {
    perf.frames = [];
    sampling = true;
    const tick = (now) => {
      if (!sampling) return;
      perf.frames.push(now);
      realRaf(tick);
    };
    realRaf(tick);
  };
  perf.stopFrames = () => {
    sampling = false;
    const f = perf.frames;
    if (f.length < 2) return { frames: f.length, fps: 0, dropped: 0 };
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    // The display's own interval: the commonest short gap.
    const sorted = [...gaps].sort((a, b) => a - b);
    const interval = Math.max(6, sorted[Math.floor(sorted.length * 0.25)]);
    const dropped = gaps.reduce(
      (n, g) => n + Math.max(0, Math.round(g / interval) - 1),
      0,
    );
    const span = f[f.length - 1] - f[0];
    return {
      frames: f.length,
      fps: Math.round((gaps.length * 10000) / span) / 10,
      dropped,
      droppedPct: Math.round((dropped / (gaps.length + dropped)) * 1000) / 10,
      intervalMs: Math.round(interval * 10) / 10,
      p95GapMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      worstGapMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  };

  /* ---- GPU memory, as the page allocates it ---- */
  const gpu = { textures: new Map(), buffers: new Map() };
  perf.gpu = () => {
    let textureBytes = 0;
    let bufferBytes = 0;
    for (const v of gpu.textures.values()) textureBytes += v;
    for (const v of gpu.buffers.values()) bufferBytes += v;
    return {
      textures: gpu.textures.size,
      textureMB: Math.round(textureBytes / 104857.6) / 10,
      buffers: gpu.buffers.size,
      bufferMB: Math.round(bufferBytes / 104857.6) / 10,
    };
  };
  const state = new WeakMap();
  const stateOf = (gl) => {
    let s = state.get(gl);
    if (!s) state.set(gl, (s = { unit: 0, tex: new Map(), buf: new Map() }));
    return s;
  };
  const BYTES = { 0x1401: 1, 0x1403: 2, 0x1405: 4, 0x1406: 4, 0x8d61: 2 };
  const CHANNELS = { 0x1908: 4, 0x1907: 3, 0x1906: 1, 0x1909: 1, 0x190a: 2 };
  for (const proto of [
    globalThis.WebGLRenderingContext?.prototype,
    globalThis.WebGL2RenderingContext?.prototype,
  ]) {
    if (!proto) continue;
    const patch = (name, after) => {
      const real = proto[name];
      if (!real) return;
      proto[name] = function (...args) {
        const result = real.apply(this, args);
        try {
          after(this, args, result);
        } catch {
          /* accounting only */
        }
        return result;
      };
    };
    patch("activeTexture", (gl, [unit]) => (stateOf(gl).unit = unit));
    patch("bindTexture", (gl, [target, tex]) =>
      stateOf(gl).tex.set(`${stateOf(gl).unit}:${target}`, tex),
    );
    patch("deleteTexture", (_, [tex]) => gpu.textures.delete(tex));
    const sized = (gl, target, level, w, h, bytes) => {
      const tex = stateOf(gl).tex.get(`${stateOf(gl).unit}:${target}`);
      if (!tex) return;
      const key = tex;
      const prev = level === 0 ? 0 : (gpu.textures.get(key) ?? 0);
      gpu.textures.set(key, prev + w * h * bytes);
    };
    patch("texImage2D", (gl, args) => {
      const [target, level] = args;
      if (args.length >= 8) {
        const [, , , w, h, , format, type] = args;
        sized(
          gl,
          target,
          level,
          w,
          h,
          (CHANNELS[format] ?? 4) * (BYTES[type] ?? 1),
        );
      } else {
        const [, , , format, type, source] = args;
        const w = source?.naturalWidth || source?.videoWidth || source?.width;
        const h =
          source?.naturalHeight || source?.videoHeight || source?.height;
        if (w && h)
          sized(
            gl,
            target,
            level,
            w,
            h,
            (CHANNELS[format] ?? 4) * (BYTES[type] ?? 1),
          );
      }
    });
    patch("texStorage2D", (gl, [target, levels, , w, h]) => {
      let bytes = 0;
      for (let l = 0; l < levels; l++)
        bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * 4;
      const tex = stateOf(gl).tex.get(`${stateOf(gl).unit}:${target}`);
      if (tex) gpu.textures.set(tex, bytes);
    });
    patch("bindBuffer", (gl, [target, buf]) =>
      stateOf(gl).buf.set(target, buf),
    );
    patch("deleteBuffer", (_, [buf]) => gpu.buffers.delete(buf));
    patch("bufferData", (gl, [target, data]) => {
      const buf = stateOf(gl).buf.get(target);
      if (!buf) return;
      gpu.buffers.set(
        buf,
        typeof data === "number" ? data : (data?.byteLength ?? 0),
      );
    });
  }

  /* ---- the map: found through React's fibers, not exposed by the app ---- */
  let found = null;
  perf.map = () => {
    if (found) return found;
    const el = document.querySelector(".maplibregl-map, .map-canvas");
    for (let node = el; node && !found; node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let f = node[key]; f && !found; f = f.return) {
        for (
          let h = f.memoizedState;
          h && typeof h === "object" && "next" in h && !found;
          h = h.next
        ) {
          const c = h.memoizedState?.current;
          if (c && typeof c.getZoom === "function" && c.style) found = c;
          else if (c?.map && typeof c.map.getZoom === "function") found = c.map;
        }
      }
    }
    if (found) found.on("render", () => perf.renders++);
    return found;
  };
  /** The map's sources: tiles in view and cached, and what they hold. */
  perf.tiles = () => {
    const map = perf.map();
    const managers = map?.style?.tileManagers ?? map?.style?.sourceCaches;
    if (!managers) return null;
    const out = {};
    for (const [id, m] of Object.entries(managers)) {
      const inView =
        m._inViewTiles?.getAllTiles?.() ?? Object.values(m._tiles ?? {});
      const cache = m._outOfViewCache ?? m._cache;
      const cached = Object.values(cache?.data ?? {}).flatMap((list) =>
        list.map((entry) => entry.value),
      );
      const size = (tile) =>
        (tile.dem?.data?.byteLength ?? 0) +
        (tile.demTexture?.size
          ? tile.demTexture.size[0] * tile.demTexture.size[1] * 4
          : 0) +
        (tile.texture?.size
          ? tile.texture.size[0] * tile.texture.size[1] * 4
          : 0);
      const type = m.getSource?.()?.type ?? m._source?.type;
      const group = id.startsWith("foil-") ? "foil" : id;
      const g = (out[group] ??= {
        type,
        sources: 0,
        sourcesUsed: 0,
        inView: 0,
        cached: 0,
        cacheMax: 0,
        rasterMB: 0,
      });
      g.sources++;
      if (m.used) g.sourcesUsed++;
      g.inView += inView.length;
      g.cached += cached.length;
      g.cacheMax += cache?.max ?? 0;
      g.rasterMB +=
        [...inView, ...cached].reduce((t, tile) => t + size(tile), 0) / 1048576;
    }
    for (const g of Object.values(out))
      g.rasterMB = Math.round(g.rasterMB * 10) / 10;
    return out;
  };
  /** Resolves once the map has drawn everything it wants (or after `ms`). */
  perf.idle = (ms = 15000) =>
    new Promise((resolve) => {
      const map = perf.map();
      if (!map) return resolve(false);
      const done = (v) => {
        clearTimeout(timer);
        resolve(v);
      };
      const timer = realTimeout(() => done(false), ms);
      if (map.loaded() && !map.isMoving() && map.areTilesLoaded())
        // A frame later, in case a change is queued.
        realRaf(() =>
          map.loaded() && map.areTilesLoaded()
            ? done(true)
            : map.once("idle", () => done(true)),
        );
      else map.once("idle", () => done(true));
    });
}
