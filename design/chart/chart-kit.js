/*
 * chart-kit.js: what the four chart mockups share.
 *
 *   WFChart.createMap(el, opts)   a MapLibre map drawn as an Admiralty chart: real
 *                                 coast from OpenStreetMap (OpenFreeMap tiles), real
 *                                 depths from EMODnet (data/bathy-*.js), soundings,
 *                                 contours with their depths, land relief.
 *   WFChart.wind(map, opts)       the real wind as ink streamlines over it
 *                                 (data/wind.js); .setTime(ms), .stop().
 *   WFChart.pen(map)              a red pen that writes on the chart and stays put as
 *                                 it pans and zooms: .circle(), .note(), .arrow(),
 *                                 .underline(), .clear().
 *   WFChart.windAt(lon, lat, ms)  { kn, gustless, dir } from the same field.
 *   WFChart.depthAt(lon, lat)     metres below chart datum in a featured bay, or null.
 *   WFChart.tideAt(id, ms)        tide height above chart datum at a featured spot.
 *   WFChart.C                     the palette.
 *
 * Needs maplibre-gl (global) and the data scripts loaded first:
 *   ../directions/data.js  data/wind.js  data/bathy-ireland.js  data/bathy-bays.js
 *   data/soundings.js  and, for depthAt, data/bathy-grids.js.
 */
window.WFChart = (() => {
  const KIT_URL = document.currentScript?.src ?? location.href;
  const C = {
    paper: "#F3EEE3",
    paper2: "#EDE6D6",
    land: "#EDE3C8",
    ink: "#1A1D21",
    depth: "#5F8C9C",
    sea: "#D5E6EA",
    mag: "#B0186A",
    red: "#D43A2C",
    buoy: "#E9B200",
    relief: "#B59E74",
  };
  // Shallow water darkest, deep water nearly paper, as on an Admiralty chart.
  const TINTS = [
    [0, "#A9CBD8"],
    [1, "#B3D1DC"],
    [2, "#BED7E0"],
    [3, "#C3DAE2"],
    [5, "#CDE0E6"],
    [10, "#DAE8EA"],
    [20, "#E5EDEA"],
    [30, "#ECF0EA"],
    [50, "#F0F1EA"],
    [100, "#F2F1EA"],
    [200, "#F3F1EA"],
  ];
  const tint = ["match", ["get", "depth"], ...TINTS.flat(), "#F3F1EA"];
  const FONT = ["Noto Sans Italic"];
  const FONT_UP = ["Noto Sans Regular"];

  // ---- data helpers ---------------------------------------------------------

  const W = window.WFWIND;
  const decode = (b64) => {
    const bin = atob(b64);
    const out = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
    return out;
  };
  const U = W && decode(W.u);
  const V = W && decode(W.v);
  const TIMES = W ? W.times.map(Date.parse) : [];
  const N = W ? W.nx * W.ny : 0;

  /** m/s (u east, v north) at lon/lat, time ms; bilinear in space, linear in time. */
  function windUV(lon, lat, ms) {
    if (!W) return null;
    const fx = (lon - W.west) / W.d;
    const fy = (lat - W.south) / W.d;
    if (fx < 0 || fy < 0 || fx > W.nx - 1 || fy > W.ny - 1) return null;
    let k = 0;
    while (k < TIMES.length - 2 && TIMES[k + 1] <= ms) k++;
    const ft = Math.max(0, Math.min(1, (ms - TIMES[k]) / (TIMES[k + 1] - TIMES[k])));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, W.nx - 1), y1 = Math.min(y0 + 1, W.ny - 1);
    const ax = fx - x0, ay = fy - y0;
    let u = 0, v = 0;
    for (const [kk, wt] of [[k, 1 - ft], [k + 1, ft]]) {
      const base = kk * N;
      const c = [base + y0 * W.nx + x0, base + y0 * W.nx + x1, base + y1 * W.nx + x0, base + y1 * W.nx + x1];
      if (c.some((i) => U[i] === -128)) return null;
      const w4 = [(1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay];
      for (let i = 0; i < 4; i++) {
        u += (U[c[i]] / W.scale) * w4[i] * wt;
        v += (V[c[i]] / W.scale) * w4[i] * wt;
      }
    }
    return { u, v };
  }

  /** Knots and the direction it blows FROM, degrees. */
  function windAt(lon, lat, ms) {
    const w = windUV(lon, lat, ms);
    if (!w) return null;
    return {
      kn: Math.hypot(w.u, w.v) * 1.94384,
      dir: ((Math.atan2(-w.u, -w.v) * 180) / Math.PI + 360) % 360,
    };
  }

  const GRIDS = {};
  /** Metres below chart datum (negative: land above it) in a featured bay, or null. */
  function depthAt(lon, lat) {
    const all = window.WFGRIDS;
    if (!all) return null;
    for (const [id, g] of Object.entries(all)) {
      const x = Math.floor((lon - g.west) / g.res);
      const y = Math.floor((g.north - lat) / g.res);
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (!GRIDS[id]) {
        const bin = atob(g.dm);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        GRIDS[id] = new Int16Array(bytes.buffer);
      }
      const v = GRIDS[id][y * g.w + x];
      return v === -32768 ? null : v / 10;
    }
    return null;
  }

  /** The grid behind depthAt, decoded: { west, north, res, w, h, dm: Int16Array }. */
  function grid(id) {
    const g = window.WFGRIDS?.[id];
    if (!g) return null;
    depthAt(g.west + g.res / 2, g.north - g.res / 2);
    return { ...g, dm: GRIDS[id] };
  }

  /** Tide height above chart datum, m, by cosine between the published turns. */
  function tideAt(id, ms) {
    const ev = window.WF?.featured?.[id]?.tides?.events;
    if (!ev?.length) return null;
    const t = ev.map((e) => ({ ms: Date.parse(e.time), h: e.height_m }));
    if (ms <= t[0].ms) return t[0].h;
    for (let i = 0; i < t.length - 1; i++)
      if (ms <= t[i + 1].ms) {
        const f = (ms - t[i].ms) / (t[i + 1].ms - t[i].ms);
        return t[i].h + (t[i + 1].h - t[i].h) * (1 - Math.cos(Math.PI * f)) / 2;
      }
    return t[t.length - 1].h;
  }

  // ---- the chart ------------------------------------------------------------

  function soundingsGeoJSON(flat, kind) {
    const features = [];
    for (let i = 0; i < flat.length; i += 3) {
      const d = flat[i + 2];
      // Charts write the decimetres small: 4₇ for 4.7 m.
      const whole = Math.floor(d);
      const dec = d < 21 ? Math.round((d - whole) * 10) : 0;
      features.push({
        type: "Feature",
        properties: { d, label: dec ? `${whole}${"₀₁₂₃₄₅₆₇₈₉"[dec]}` : String(whole), kind, rank: (i * 7919) % 997 },
        geometry: { type: "Point", coordinates: [flat[i], flat[i + 1]] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function chartStyle(opts) {
    // Depth from the tiled survey (data/bathy.pmtiles: ~250 m to zoom 9, EMODnet's own
    // ~115 m for the whole coast from zoom 10) when the page loads pmtiles; otherwise
    // from the older GeoJSON globals (bathy-ireland.js, bathy-bays.js, soundings.js).
    const tiled = Boolean(window.pmtiles) && opts.bathy !== "geojson";
    if (tiled && !maplibregl.__wfPmtiles) {
      maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
      maplibregl.__wfPmtiles = true;
    }
    const empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const B = window.WFBATHY;
    const bays = window.WFBAYS || {};
    const S = window.WFSOUNDINGS || { coarse: [], fine: [] };
    const lineWidth = ["match", ["get", "depth"], 0, 1.1, 5, 0.9, 10, 0.9, 2, 0.6, 1, 0.5, 3, 0.5, 0.6];
    const bathy = tiled
      ? {
          bathy: { type: "vector", url: "pmtiles://" + new URL("data/bathy.pmtiles", KIT_URL).href, minzoom: 5, maxzoom: 12 },
          bayBands: empty,
          bayLines: empty,
          soundFine: empty,
        }
      : {
          bands: { type: "geojson", data: B.bands, tolerance: 0.3 },
          lines: { type: "geojson", data: B.lines, tolerance: 0.3 },
          relief: { type: "geojson", data: B.relief, tolerance: 0.4 },
          bayBands: { type: "geojson", data: { type: "FeatureCollection", features: Object.values(bays).flatMap((b) => b.bands.features) }, tolerance: 0.2 },
          bayLines: { type: "geojson", data: { type: "FeatureCollection", features: Object.values(bays).flatMap((b) => b.lines.features) }, tolerance: 0.2 },
          soundCoarse: { type: "geojson", data: soundingsGeoJSON(S.coarse, "coarse") },
          soundFine: { type: "geojson", data: soundingsGeoJSON(S.fine, "fine") },
        };
    // A layer's source: the tiles' layer when tiled, the matching GeoJSON source otherwise.
    const from = (geojsonSource, tileLayer) => (tiled ? { source: "bathy", "source-layer": tileLayer } : { source: geojsonSource });
    return {
      version: 8,
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: {
        omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
        ...bathy,
      },
      layers: [
        { id: "land", type: "background", paint: { "background-color": opts.land ?? C.land } },
        // The sea itself, from OpenStreetMap's coast, as deep water: paper, nearly.
        // The survey's shallows are laid over it, darkest nearest the shore;
        // beyond the survey (open ocean, Britain's coast) the sea stays pale.
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": TINTS[TINTS.length - 1][1] } },
        { id: "bands", type: "fill", ...from("bands", "bands"), paint: { "fill-color": tint } },
        {
          id: "bay-bands", type: "fill", source: "bayBands", minzoom: 8.5,
          paint: { "fill-color": tint, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0, 9.5, 1] },
        },
        { id: "sand", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "sand"], paint: { "fill-color": "#EADCB4", "fill-opacity": 0.8 } },
        { id: "wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wetland"], paint: { "fill-color": "#C9D3B2", "fill-opacity": 0.6 } },
        {
          id: "relief", type: "line", ...from("relief", "relief"), minzoom: 6.5,
          paint: { "line-color": C.relief, "line-opacity": ["interpolate", ["linear"], ["zoom"], 6.5, 0.25, 10, 0.45], "line-width": 0.6 },
        },
        // Contours: the shallow ones dashed, as charts draw a line they are less sure of.
        ...[false, true].map((dashed) => ({
          id: dashed ? "contours-dashed" : "contours", type: "line", ...from("lines", "contours"),
          filter: dashed ? ["in", ["get", "depth"], ["literal", [1, 2, 3]]] : ["!", ["in", ["get", "depth"], ["literal", [1, 2, 3]]]],
          paint: {
            "line-color": C.depth,
            "line-width": lineWidth,
            "line-opacity": tiled ? ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 0.8] : ["interpolate", ["linear"], ["zoom"], 5, 0.55, 9, 0.8, 10, 0.25],
            ...(dashed ? { "line-dasharray": [3, 2] } : {}),
          },
        })),
        ...[false, true].map((dashed) => ({
          id: dashed ? "bay-contours-dashed" : "bay-contours", type: "line", source: "bayLines", minzoom: 8.5,
          filter: dashed ? ["in", ["get", "depth"], ["literal", [1, 2, 3]]] : ["!", ["in", ["get", "depth"], ["literal", [1, 2, 3]]]],
          paint: {
            "line-color": C.depth,
            "line-width": lineWidth,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0, 9.5, 0.9],
            ...(dashed ? { "line-dasharray": [3, 2] } : {}),
          },
        })),
        { id: "rivers", type: "line", source: "omt", "source-layer": "waterway", minzoom: 8, paint: { "line-color": C.depth, "line-width": 0.6, "line-opacity": 0.6 } },
        {
          id: "roads", type: "line", source: "omt", "source-layer": "transportation", minzoom: 9,
          filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]],
          paint: { "line-color": C.ink, "line-opacity": 0.18, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 14, 1.4] },
        },
        { id: "buildings", type: "fill", source: "omt", "source-layer": "building", minzoom: 13, paint: { "fill-color": C.ink, "fill-opacity": 0.12 } },
        // The coast in ink: the outline of OpenStreetMap's sea.
        {
          id: "coast", type: "line", source: "omt", "source-layer": "water",
          paint: { "line-color": C.ink, "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1, 14, 1.6] },
        },
        {
          id: "contour-labels", type: "symbol", ...from("lines", "contours"), minzoom: 7.5, maxzoom: tiled ? 24 : 10,
          filter: ["in", ["get", "depth"], ["literal", tiled ? [2, 5, 10, 20, 30, 50, 100, 200] : [5, 10, 20, 50, 100, 200]]],
          layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "depth"]], "text-font": FONT, "text-size": 10, "symbol-spacing": 320 },
          paint: { "text-color": C.depth, "text-halo-color": C.paper, "text-halo-width": 2 },
        },
        {
          id: "bay-contour-labels", type: "symbol", source: "bayLines", minzoom: 10,
          filter: ["in", ["get", "depth"], ["literal", [2, 5, 10, 20, 30]]],
          layout: { "symbol-placement": "line", "text-field": ["to-string", ["get", "depth"]], "text-font": FONT, "text-size": 10, "symbol-spacing": 260 },
          paint: { "text-color": C.depth, "text-halo-color": C.paper, "text-halo-width": 2 },
        },
        {
          id: "soundings", type: "symbol", ...from("soundCoarse", "soundings"), minzoom: 7.2, maxzoom: tiled ? 24 : 10,
          layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 10, "symbol-sort-key": ["get", "rank"], "text-padding": 6 },
          paint: { "text-color": C.ink, "text-opacity": 0.62 },
        },
        {
          id: "soundings-fine", type: "symbol", source: "soundFine", minzoom: 10,
          layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 10.5, "symbol-sort-key": ["get", "rank"], "text-padding": 4 },
          paint: { "text-color": C.ink, "text-opacity": 0.7 },
        },
        {
          id: "water-names", type: "symbol", source: "omt", "source-layer": "water_name",
          layout: {
            "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT, "text-transform": "uppercase",
            "text-letter-spacing": 0.25, "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 13],
          },
          paint: { "text-color": C.depth, "text-halo-color": C.paper, "text-halo-width": 1 },
        },
        {
          id: "places", type: "symbol", source: "omt", "source-layer": "place",
          filter: ["in", ["get", "class"], ["literal", ["city", "town", "village"]]],
          layout: {
            "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": FONT_UP,
            "text-size": ["match", ["get", "class"], "city", 13, "town", 11.5, 10],
            "text-letter-spacing": 0.08,
          },
          paint: { "text-color": C.ink, "text-opacity": 0.8, "text-halo-color": C.land, "text-halo-width": 1.5 },
        },
      ],
    };
  }

  /** A chart of Ireland's coast. opts: center, zoom, bounds, interactive, maxBounds… (any MapLibre option). */
  function createMap(el, opts = {}) {
    const map = new maplibregl.Map({
      container: el,
      style: chartStyle(opts),
      center: [-8.2, 53.4],
      zoom: 6.2,
      minZoom: 5,
      maxZoom: 15,
      attributionControl: false,
      ...opts,
    });
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: "Depths: EMODnet Bathymetry · Coast: © OpenStreetMap, OpenFreeMap · Wind: Met Éireann HARMONIE, ECMWF",
      }),
      "bottom-left",
    );
    return map;
  }

  /** Put an overlay over the map's canvas but under its markers and controls. */
  function overlay(map, node) {
    const holder = map.getCanvasContainer();
    holder.parentNode.insertBefore(node, holder.nextSibling);
  }

  // ---- wind as ink ----------------------------------------------------------

  /**
   * Streamlines of the real wind on a canvas over the map, in ink: each
   * particle a short comet that fades as it goes. Pauses while the map
   * moves, resamples the field for the new view, and goes on.
   * opts: time (ms), color, alpha, density (particles per 1000 px²), width, speed.
   */
  function wind(map, opts = {}) {
    const o = { color: "26,29,33", alpha: 0.55, density: 0.45, width: 1, speed: 1, fade: 0.93, ...opts };
    const host = map.getContainer();
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.className = "wf-wind";
    overlay(map, canvas);
    const ctx = canvas.getContext("2d");
    let time = o.time ?? Date.parse(window.WF?.now ?? W.times[0]);
    let w = 0, h = 0, field = null, fw = 0, fh = 0, cloud = [], raf = 0, stopped = false, last = 0;
    const STEP = 10;
    const resize = () => {
      const r = host.getBoundingClientRect();
      w = r.width; h = r.height;
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const build = () => {
      resize();
      fw = Math.ceil(w / STEP) + 1; fh = Math.ceil(h / STEP) + 1;
      field = new Float32Array(fw * fh * 3);
      // Pixels per second per m/s at this zoom, so lines move at a pace that reads.
      const mpp = (40075016 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
      const k = (o.speed * 18) / Math.max(mpp, 1) ** 0.35 / 30;
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const ll = map.unproject([x * STEP, y * STEP]);
          const uv = windUV(ll.lng, ll.lat, time);
          const i = (y * fw + x) * 3;
          field[i] = uv ? uv.u * k : NaN;
          field[i + 1] = uv ? -uv.v * k : NaN;
          field[i + 2] = uv ? Math.hypot(uv.u, uv.v) : 0;
        }
      const n = Math.round(((w * h) / 1000) * o.density);
      cloud = Array.from({ length: n }, spawn);
      ctx.clearRect(0, 0, w, h);
    };
    const spawn = () => ({ x: Math.random() * w, y: Math.random() * h, age: Math.random() * 60 });
    const at = (px, py) => {
      const gx = px / STEP, gy = py / STEP;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      if (x0 < 0 || y0 < 0 || x0 >= fw - 1 || y0 >= fh - 1) return null;
      const ax = gx - x0, ay = gy - y0;
      const s = [0, 0, 0];
      for (const [dx, dy, wt] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
        const i = ((y0 + dy) * fw + x0 + dx) * 3;
        if (Number.isNaN(field[i])) return null;
        s[0] += field[i] * wt; s[1] += field[i + 1] * wt; s[2] += field[i + 2] * wt;
      }
      return s;
    };
    // Each particle keeps its last few positions and its trail is drawn fresh every
    // frame, older segments fainter. (Fading the canvas instead never quite reaches
    // zero in 8-bit alpha and leaves a haze wherever particles have been.)
    const trailLength = () => Math.max(6, Math.min(24, Math.round(Math.log(0.15) / Math.log(o.fade))));
    const BUCKETS = 4;
    const frame = (now) => {
      raf = 0;
      if (stopped || map.isMoving() || document.hidden) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 30) return;
      last = now;
      if (!field) build();
      const L = trailLength();
      for (const p of cloud) {
        const s = at(p.x, p.y);
        if (!s || p.age > 70) { Object.assign(p, spawn(), { age: 0, trail: null }); continue; }
        if (!p.trail) p.trail = [p.x, p.y];
        p.x += s[0]; p.y += s[1]; p.age++;
        p.strong = s[2] > 7;
        p.trail.push(p.x, p.y);
        if (p.trail.length > (L + 1) * 2) p.trail.splice(0, 2);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      // Light air thin and pale, a breeze bolder; each in a few alpha steps along the trail.
      for (const strong of [false, true]) {
        ctx.lineWidth = strong ? o.width * 1.4 : o.width;
        for (let k = 0; k < BUCKETS; k++) {
          ctx.beginPath();
          for (const p of cloud) {
            const t = p.trail;
            if (!t || p.strong !== strong) continue;
            const n = t.length / 2 - 1;
            // Segment i (0 oldest) belongs to bucket floor(i / n * BUCKETS).
            for (let i = Math.floor((k * n) / BUCKETS); i < Math.floor(((k + 1) * n) / BUCKETS); i++) {
              ctx.moveTo(t[i * 2], t[i * 2 + 1]);
              ctx.lineTo(t[i * 2 + 2], t[i * 2 + 3]);
            }
          }
          const a = (strong ? o.alpha : o.alpha * 0.6) * ((k + 1) / BUCKETS);
          ctx.strokeStyle = `rgba(${o.color},${a.toFixed(3)})`;
          ctx.stroke();
        }
      }
    };
    const restart = () => { field = null; if (!raf && !stopped) raf = requestAnimationFrame(frame); };
    map.on("movestart", () => { ctx.clearRect(0, 0, w, h); cloud.forEach((p) => (p.trail = null)); });
    map.on("moveend", restart);
    map.on("resize", restart);
    document.addEventListener("visibilitychange", restart);
    if (map.loaded()) restart(); else map.once("load", restart);
    return {
      canvas,
      setTime(ms) { time = ms; restart(); },
      get time() { return time; },
      // Clearing raf matters: restart() only schedules a frame when none is pending.
      stop() { stopped = true; cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, w, h); },
      start() { stopped = false; restart(); },
      set(opt) { Object.assign(o, opt); restart(); },
    };
  }

  // ---- the red pen ----------------------------------------------------------

  /** A wobbly, hand-drawn closed loop round (cx, cy): overshoots its start the way a pen does. */
  function loopPath(cx, cy, rx, ry, seed = 1) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const start = rnd() * Math.PI * 2;
    const turns = 1.12 + rnd() * 0.1;
    const steps = 48;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = start + (i / steps) * turns * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(t * 3 + seed) + 0.03 * Math.sin(t * 7 + seed * 2);
      const grow = 1 + 0.08 * (i / steps);
      const x = cx + Math.cos(t) * rx * wob * grow;
      const y = cy + Math.sin(t) * ry * wob * grow - (i / steps) * ry * 0.08;
      d += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    return d;
  }

  /**
   * A pen that writes on an SVG over the map, at map coordinates, so its marks
   * stay on the coast they were made on as it pans and zooms. Each mark draws
   * itself in with the stroke the first time.
   */
  function pen(map, opts = {}) {
    const color = opts.color ?? C.red;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wf-pen");
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
    overlay(map, svg);
    const marks = [];
    let seed = 1;
    const el = (tag, attrs) => {
      const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const ink = (path, dur = 700, delay = 0) => {
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(.5,.1,.3,1) ${delay}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => (path.style.strokeDashoffset = 0)));
      setTimeout(() => (path.style.strokeDasharray = "none"), dur + delay + 50);
    };
    const place = () => marks.forEach((m) => m.place());
    map.on("move", place);
    map.on("resize", place);
    const stroke = { fill: "none", stroke: color, "stroke-width": opts.width ?? 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.88 };
    const api = {
      svg,
      /** A loop round lngLat, r px (or [rx, ry]). */
      circle(lngLat, r = 26, o = {}) {
        const s = seed++;
        const [rx, ry] = Array.isArray(r) ? r : [r * 1.15, r * 0.85];
        const p = el("path", { ...stroke, ...(o.attrs || {}) });
        svg.appendChild(p);
        const m = { place() { const q = map.project(lngLat); p.setAttribute("d", loopPath(q.x, q.y, rx, ry, s)); }, node: p };
        m.place(); ink(p, o.duration ?? 750, o.delay ?? 0);
        marks.push(m); return m;
      },
      /** Handwriting at lngLat, offset [dx, dy] px. */
      note(lngLat, text, o = {}) {
        const t = el("text", { fill: color, "font-family": "Kalam, cursive", "font-size": o.size ?? 17, "text-anchor": o.anchor ?? "start", opacity: 0 });
        t.textContent = text;
        if (o.rotate) t.dataset.rotate = o.rotate;
        svg.appendChild(t);
        const [dx, dy] = o.offset ?? [0, 0];
        const m = {
          place() { const q = map.project(lngLat); t.setAttribute("x", q.x + dx); t.setAttribute("y", q.y + dy); t.setAttribute("transform", `rotate(${o.rotate ?? -3} ${q.x + dx} ${q.y + dy})`); },
          node: t,
        };
        m.place();
        t.style.transition = `opacity 400ms ease ${o.delay ?? 300}ms`;
        requestAnimationFrame(() => (t.style.opacity = 1));
        marks.push(m); return m;
      },
      /** A pen stroke with an arrowhead from one lngLat to another, bowed a little. */
      arrow(from, to, o = {}) {
        const p = el("path", stroke);
        svg.appendChild(p);
        const m = {
          place() {
            const a = map.project(from), b = map.project(to);
            const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.15, my = (a.y + b.y) / 2 + (b.x - a.x) * 0.15;
            const ang = Math.atan2(b.y - my, b.x - mx);
            const h1 = [b.x - 11 * Math.cos(ang - 0.45), b.y - 11 * Math.sin(ang - 0.45)];
            const h2 = [b.x - 11 * Math.cos(ang + 0.45), b.y - 11 * Math.sin(ang + 0.45)];
            p.setAttribute("d", `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y} M${h1[0]} ${h1[1]} L${b.x} ${b.y} L${h2[0]} ${h2[1]}`);
          },
          node: p,
        };
        m.place(); ink(p, o.duration ?? 600, o.delay ?? 0);
        marks.push(m); return m;
      },
      /** A quick underline under a run of handwriting or a label, width px. */
      underline(lngLat, width, o = {}) {
        const p = el("path", stroke);
        svg.appendChild(p);
        const [dx, dy] = o.offset ?? [0, 0];
        const m = { place() { const q = map.project(lngLat); const x = q.x + dx, y = q.y + dy; p.setAttribute("d", `M${x} ${y} q${width / 2} ${-4} ${width} ${1}`); }, node: p };
        m.place(); ink(p, o.duration ?? 350, o.delay ?? 0);
        marks.push(m); return m;
      },
      remove(m) { m.node.remove(); marks.splice(marks.indexOf(m), 1); },
      clear() { marks.splice(0).forEach((m) => m.node.remove()); },
    };
    return api;
  }

  return { C, TINTS, createMap, chartStyle, wind, pen, loopPath, windAt, windUV, depthAt, grid, tideAt, times: TIMES };
})();
