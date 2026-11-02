/**
 * The AI page's scene (ai/web/AiApp.tsx draws its parts, ai/web/ai.css gives
 * them their look): "wingfoil.ie is fully compatible with your bots" types
 * itself at the centre; the line lifts away and a phone rises under it with
 * an AI app open; someone asks where to wing foil on Saturday, the app reads
 * wingfoil.ie and answers with a little wind chart pinned on a spot; then the
 * phone slides over and the ways to add wingfoil.ie come in beside it. On a
 * phone's width the line settles over the phone and the list follows under.
 *
 * Replay plays it again. A reader who asks for less motion, or a window
 * resized mid-way, is shown its last beat at once, and so is one who
 * scrolls, presses a key or taps while it plays: nobody waits for it. The conversation is an
 * example, not a forecast: the page reads no forecast of its own.
 */
import { THEME_EVENT } from "../../shared/web/theme";
import { windColor, windCss } from "../../force5/src/windPalette";

/** The line the scene opens with, word by word, its second line softer. */
const INTRO = [
  ["wingfoil.ie", "is", "fully", "compatible"],
  ["with", "your", "bots."],
];
const QUESTION = "Where should I wing foil this Saturday?";

/** The example's hours on the card: the hour, and its wind in knots. */
export const HOURS: readonly (readonly [number, number])[] = [
  [8, 12],
  [10, 15],
  [12, 19],
  [14, 22],
  [16, 21],
  [18, 17],
];

/* ------------------------------------------------------ the mini chart */

// Ireland and the west of Britain, roughly, as lon/lat: enough for a thumbnail.
const IRELAND: [number, number][] = [
  [-7.37, 55.38], [-7.15, 55.25], [-6.95, 55.19], [-6.65, 55.21], [-6.38, 55.24], [-6.15, 55.22], [-6.03, 55.07], [-5.97, 54.98], [-5.8, 54.85], [-5.72, 54.73],
  [-5.92, 54.63], [-5.7, 54.66], [-5.53, 54.64], [-5.45, 54.48], [-5.43, 54.37], [-5.53, 54.33], [-5.62, 54.25], [-5.88, 54.2], [-6.08, 54.1], [-6.1, 54.01],
  [-6.35, 53.99], [-6.25, 53.85], [-6.22, 53.72], [-6.13, 53.58], [-6.09, 53.47], [-6.05, 53.39], [-6.22, 53.34], [-6.1, 53.27], [-6.03, 53.12], [-5.99, 52.97],
  [-6.13, 52.79], [-6.2, 52.6], [-6.3, 52.45], [-6.4, 52.34], [-6.36, 52.27], [-6.36, 52.17], [-6.58, 52.19], [-6.8, 52.17], [-6.93, 52.13], [-7.0, 52.22],
  [-7.15, 52.14], [-7.6, 52.07], [-7.85, 51.95], [-8.25, 51.8], [-8.53, 51.6], [-8.95, 51.53], [-9.4, 51.48], [-9.82, 51.45], [-9.5, 51.66], [-9.8, 51.62],
  [-10.15, 51.6], [-9.75, 51.8], [-10.05, 51.78], [-10.35, 51.88], [-10.0, 52.0], [-9.8, 52.09], [-10.2, 52.07], [-10.48, 52.1], [-10.25, 52.23], [-10.15, 52.28],
  [-10.03, 52.24], [-9.85, 52.27], [-9.72, 52.25], [-9.9, 52.42], [-9.66, 52.55], [-9.35, 52.6], [-9.6, 52.6], [-9.93, 52.56], [-9.65, 52.68],
  [-9.45, 52.85], [-9.47, 52.96], [-9.3, 53.12], [-9.05, 53.24], [-9.3, 53.24], [-9.6, 53.28], [-9.92, 53.38], [-10.2, 53.45], [-10.12, 53.56], [-9.85, 53.63],
  [-9.95, 53.75], [-9.65, 53.83], [-9.93, 53.9], [-10.2, 54.0], [-10.08, 54.15], [-10.12, 54.25], [-9.95, 54.3], [-9.6, 54.33], [-9.35, 54.32], [-9.18, 54.22],
  [-8.85, 54.27], [-8.6, 54.3], [-8.52, 54.4], [-8.45, 54.47], [-8.2, 54.6], [-8.45, 54.62], [-8.75, 54.62], [-8.8, 54.72], [-8.55, 54.82], [-8.45, 54.98],
  [-8.32, 55.15], [-8.0, 55.2], [-7.75, 55.25], [-7.63, 55.27], [-7.55, 55.12], [-7.45, 55.27],
];
const BRITAIN: [number, number][] = [
  [0, 57.5], [-5.7, 57.5], [-5.65, 56.9], [-5.9, 56.6], [-5.5, 56.4], [-5.6, 56.1], [-5.7, 55.75], [-5.8, 55.45], [-5.75, 55.3], [-5.5, 55.4],
  [-5.35, 55.75], [-4.9, 55.9], [-4.7, 55.6], [-4.85, 55.3], [-5.05, 55.05], [-5.1, 54.85], [-4.86, 54.64], [-4.4, 54.8], [-3.8, 54.85], [-3.3, 54.95],
  [-3.6, 54.6], [-3.65, 54.48], [-3.2, 54.12], [-2.85, 54.05], [-3.05, 53.8], [-3.05, 53.45], [-3.3, 53.35], [-3.85, 53.33], [-4.2, 53.3], [-4.55, 53.4],
  [-4.62, 53.25], [-4.35, 53.12], [-4.6, 52.95], [-4.78, 52.8], [-4.4, 52.88], [-4.05, 52.72], [-4.08, 52.4], [-4.65, 52.12], [-5.07, 52.03], [-5.3, 51.88],
  [-5.1, 51.7], [-4.7, 51.65], [-4.3, 51.55], [-3.9, 51.6], [-3.15, 51.45], [-2.7, 51.5], [-3.1, 51.2], [-4.2, 51.2], [-4.53, 51.02], [-5.0, 50.6],
  [-5.7, 50.07], [-5.2, 49.96], [-4.5, 50.35], [-4.15, 50.33], [0, 50.5],
];
const MAN: [number, number][] = [[-4.37, 54.42], [-4.3, 54.25], [-4.6, 54.06], [-4.8, 54.1], [-4.7, 54.3]];
const ROSSLARE: [number, number] = [-6.355, 52.255];

/** An illustrative south-westerly over Ireland: where it blows, and how hard. */
function field(lon: number, lat: number): [number, number, number] {
  const ang =
    ((36 + 9 * Math.sin((lat - 51) * 1.1) - 7 * Math.cos((lon + 8) * 0.7)) * Math.PI) / 180;
  const kn =
    12.5 +
    9 * Math.exp(-(((lon + 6.1) / 1.25) ** 2 + ((lat - 52.05) / 0.85) ** 2)) +
    13 * Math.max(0, Math.min(1, (-9.6 - lon) / 3)) +
    5 * Math.exp(-(((lon + 8.6) / 1.8) ** 2 + ((lat - 51.15) / 0.6) ** 2)) -
    6 * Math.max(0, Math.min(1, (lat - 53.9) / 1.2)) * Math.max(0, Math.min(1, (lon + 7.2) / 1.5)) -
    2 * Math.max(0, Math.min(1, (lat - 54.3) / 1.2)) +
    1.6 * Math.sin(lon * 2.3 + lat * 1.7);
  return [Math.cos(ang), Math.sin(ang), kn];
}

interface Particle {
  x: number;
  y: number;
  trail: [number, number][];
  life: number;
  age: number;
}

/** The card's little chart: the coast, the wind's colours, and lines moving with it. */
function miniChart(map: HTMLElement, canvas: HTMLCanvasElement, pin: HTMLElement, tag: HTMLElement) {
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let proj: ((lon: number, lat: number) => [number, number]) | null = null;
  let inv: (x: number, y: number) => [number, number] = () => [0, 0];
  let land = new Path2D();
  let onLand: (x: number, y: number) => boolean = () => false;
  let wash: HTMLCanvasElement | null = null;
  let parts: Particle[] = [];
  let frame = 0;
  let washAlpha = 0;
  let running = false;

  function setup() {
    W = map.clientWidth;
    H = map.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(2.5, (window.devicePixelRatio || 1) * 1.25);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const kx = Math.cos((53.4 * Math.PI) / 180);
    const [lon0, lon1, lat0, lat1] = [-11.1, -5.0, 55.75, 51.05];
    const s = Math.min((H - 14) / (lat0 - lat1), (W - 14) / ((lon1 - lon0) * kx));
    const ox = (W - (lon1 - lon0) * kx * s) / 2 - 2;
    const oy = (H - (lat0 - lat1) * s) / 2;
    const to = (lon: number, lat: number): [number, number] => [
      ox + (lon - lon0) * kx * s,
      oy + (lat0 - lat) * s,
    ];
    proj = to;
    inv = (x, y) => [lon0 + (x - ox) / (kx * s), lat0 - (y - oy) / s];
    land = new Path2D();
    for (const poly of [IRELAND, BRITAIN, MAN]) {
      poly.forEach(([lo, la], i) => {
        const [x, y] = to(lo, la);
        if (i) land.lineTo(x, y);
        else land.moveTo(x, y);
      });
      land.closePath();
    }
    // A coarse mask of the land, so the lines slow over it.
    const mask = document.createElement("canvas");
    mask.width = Math.ceil(W / 2);
    mask.height = Math.ceil(H / 2);
    const mc = mask.getContext("2d")!;
    mc.scale(0.5, 0.5);
    mc.fill(land);
    const md = mc.getImageData(0, 0, mask.width, mask.height).data;
    onLand = (x, y) =>
      md[(Math.floor(y / 2) * mask.width + Math.floor(x / 2)) * 4 + 3] > 128;
    // The wind's colours, at a quarter of the resolution and smoothed up.
    const q = 4;
    const ww = Math.ceil(W / q);
    const wh = Math.ceil(H / q);
    wash = document.createElement("canvas");
    wash.width = ww;
    wash.height = wh;
    const wc = wash.getContext("2d")!;
    const img = wc.createImageData(ww, wh);
    for (let y = 0; y < wh; y++)
      for (let x = 0; x < ww; x++) {
        const [lo, la] = inv(x * q + q / 2, y * q + q / 2);
        const c = windColor(field(lo, la)[2]);
        const i = (y * ww + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    wc.putImageData(img, 0, 0);
    // The pin, and its tag over it.
    const [px, py] = to(...ROSSLARE);
    pin.style.left = `${px}px`;
    pin.style.top = `${py}px`;
    tag.style.left = `${px}px`;
    tag.style.bottom = `${H - py + 13}px`;
    tag.style.marginLeft = `${-Math.min(px - 6, tag.offsetWidth * 0.62)}px`;
    parts = Array.from({ length: Math.round((W * H) / 300) }, () =>
      born({ x: 0, y: 0, trail: [], life: 0, age: 0 }, true),
    );
    return true;
  }

  function born(p: Particle, first = false): Particle {
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    p.trail = [[p.x, p.y]];
    p.life = 70 + Math.random() * 160;
    p.age = first ? Math.random() * p.life : 0;
    return p;
  }

  function step() {
    for (const p of parts) {
      const [lo, la] = inv(p.x, p.y);
      const [u, v, kn] = field(lo, la);
      const pace = 0.048 * kn * (onLand(p.x, p.y) ? 0.55 : 1);
      p.x += u * pace;
      p.y -= v * pace;
      p.trail.push([p.x, p.y]);
      if (p.trail.length > 20) p.trail.shift();
      p.age++;
      if (p.age > p.life || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) born(p);
    }
  }

  function draw() {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const dark = document.documentElement.dataset.theme === "dark";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = token("--color-basemap-water");
    ctx.fillRect(0, 0, W, H);
    if (washAlpha > 0 && wash) {
      ctx.globalAlpha = washAlpha * (dark ? 0.62 : 0.78);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(wash, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = token("--color-basemap-land");
    ctx.fill(land);
    ctx.strokeStyle = token("--color-line-strong");
    ctx.lineWidth = 0.7;
    ctx.lineJoin = "round";
    ctx.stroke(land);
    if (washAlpha <= 0) return;
    // The lines, in ink, fading in along their trails.
    ctx.lineCap = "round";
    ctx.strokeStyle = token("--color-ink");
    const bands = 4;
    for (let b = 0; b < bands; b++) {
      ctx.beginPath();
      for (const p of parts) {
        const n = p.trail.length;
        if (n < 2) continue;
        const fade = Math.min(1, p.age / 12, (p.life - p.age) / 16);
        const lo = Math.floor((b / bands) * (n - 1));
        const hi = Math.floor(((b + 1) / bands) * (n - 1));
        if (hi <= lo || fade <= 0) continue;
        ctx.moveTo(p.trail[lo][0], p.trail[lo][1]);
        for (let i = lo + 1; i <= hi; i++) ctx.lineTo(p.trail[i][0], p.trail[i][1]);
      }
      ctx.globalAlpha = (0.06 + 0.16 * b) * washAlpha * (dark ? 1 : 0.9);
      ctx.lineWidth = 0.7 + b * 0.18;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    if (!running) return;
    if (washAlpha < 1) washAlpha = Math.min(1, washAlpha + 0.03);
    step();
    draw();
    frame = requestAnimationFrame(loop);
  }

  return {
    start(still: boolean) {
      if (!proj && !setup()) return;
      cancelAnimationFrame(frame);
      if (still) {
        washAlpha = 1;
        for (let i = 0; i < 40; i++) step();
        draw();
        running = false;
        return;
      }
      running = true;
      loop();
    },
    reset() {
      running = false;
      cancelAnimationFrame(frame);
      washAlpha = 0;
      proj = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    redraw() {
      if (proj) draw();
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}

/* ------------------------------------------------------------ the scene */

/** Plays the scene in `stage`, the page's <main>; returns what stops it. */
export function startScene(stage: HTMLElement): () => void {
  const $ = <T extends HTMLElement = HTMLElement>(name: string) =>
    stage.querySelector<T>(`[data-scene="${name}"]`)!;
  const intro = $("intro");
  const slot = $("slot");
  const head = $("head");
  const h1 = $("h1");
  const sub = $("sub");
  const list = $("list");
  const fine = $("fine");
  const track = $("track");
  const ctext = $("ctext");
  const send = $("send");
  const replay = $("replay");
  const map = $("map");
  const hours = $("hours");
  const toolIcon = $("tool-icon");
  const toolText = $("tool-text");
  const chart = miniChart(map, $<HTMLCanvasElement>("canvas"), $("pin"), $("tag"));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 899px)");
  let run = 0;

  // The line's letters, each its own, the wordmark's in its own face.
  intro.replaceChildren();
  INTRO.forEach((line, li) => {
    if (li) intro.append(document.createElement("br"));
    const wrap = document.createElement("span");
    if (li === 1) wrap.className = "ai-soft";
    line.forEach((word, wi) => {
      const w = document.createElement("span");
      w.className = word === "wingfoil.ie" ? "w ai-wm" : "w";
      [...word].forEach((ch, ci) => {
        const c = document.createElement("span");
        c.className = word === "wingfoil.ie" && ci >= 8 ? "c ai-wm-ie" : "c";
        c.textContent = ch;
        w.append(c);
      });
      wrap.append(w);
      if (wi < line.length - 1 || li === 0) wrap.append(" ");
    });
    intro.append(wrap);
  });
  const chars = [...intro.querySelectorAll<HTMLElement>(".c")];

  // The assistant's lines, word by word.
  for (const say of stage.querySelectorAll<HTMLElement>("[data-say]")) {
    const walk = (node: Node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType !== Node.TEXT_NODE) {
          walk(n);
          continue;
        }
        const frag = document.createDocumentFragment();
        for (const t of (n.textContent ?? "").split(/(\s+)/)) {
          if (!t) continue;
          if (/^\s+$/.test(t)) frag.append(t);
          else {
            const w = document.createElement("span");
            w.className = "wd";
            w.textContent = t;
            frag.append(w);
          }
        }
        n.replaceWith(frag);
      }
    };
    if (!say.querySelector(".wd")) walk(say);
  }

  // The card's hours, in the wind's colours, and its scale.
  hours.replaceChildren(
    ...HOURS.map(([h, k], i) => {
      const hr = document.createElement("div");
      hr.className = h === 14 ? "ai-hr best" : "ai-hr";
      const bx = document.createElement("div");
      bx.className = "bx";
      bx.style.background = windCss(k);
      bx.style.transitionDelay = `${i * 60}ms`;
      bx.textContent = String(k);
      const hh = document.createElement("div");
      hh.className = "h";
      hh.textContent = String(h).padStart(2, "0");
      hr.append(bx, hh);
      return hr;
    }),
  );
  $("scale-bar").style.background = `linear-gradient(90deg, ${[0, 5, 10, 15, 20, 25, 30, 35, 40]
    .map(windCss)
    .join(",")})`;

  const rows = () => [...list.querySelectorAll<HTMLElement>(":scope > li")];
  const wait = (ms: number, id: number) =>
    new Promise<void>((ok, no) =>
      setTimeout(() => (id === run ? ok() : no(new Stale())), ms),
    );
  function set(
    el: HTMLElement,
    transform: string | null,
    opacity: string | null,
    ms = 0,
    ease = "var(--ai-ease-out)",
    delay = 0,
  ) {
    el.style.transition = ms
      ? `transform ${ms}ms ${ease} ${delay}ms, opacity ${Math.min(ms, 600)}ms ease ${delay}ms`
      : "none";
    if (transform !== null) el.style.transform = transform;
    if (opacity !== null) el.style.opacity = opacity;
  }
  const rel = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  };

  function sizePhone() {
    const ps = narrow.matches
      ? Math.min(0.64, (window.innerWidth - 120) / 318)
      : Math.min(1, (window.innerHeight - 60 - 80) / 672);
    stage.style.setProperty("--ai-ps", Math.max(0.6, ps).toFixed(3));
  }

  /** Where the line and the phone stand at each beat, from the laid-out page. */
  function plan() {
    for (const el of [intro, slot, head]) set(el, "none", null);
    const S = stage.getBoundingClientRect();
    const W = S.width;
    const visH = Math.min(S.height, window.innerHeight - Math.max(0, S.top));
    const iw = intro.offsetWidth;
    const ih = intro.offsetHeight;
    const P = rel(slot);
    const Hd = rel(h1);
    const tf = (p: { x: number; y: number; s: number }) =>
      `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
    const a = { x: (W - iw) / 2, y: (visH - ih) / 2 - (narrow.matches ? 30 : 10), s: 1 };
    let b: { x: number; y: number; s: number };
    let phoneB = "none";
    if (narrow.matches) {
      const s = Hd.w / iw;
      b = { x: Hd.x + (Hd.w - iw * s) / 2, y: Hd.y, s };
    } else {
      b = { x: (W - iw * 0.52) / 2, y: 30, s: 0.52 };
      const top = b.y + ih * b.s + 26;
      const k = Math.min(1, (visH - top - 30) / P.h);
      phoneB = `translate(${W / 2 - (P.w * k) / 2 - P.x}px, ${top - P.y}px) scale(${k})`;
    }
    const s = Math.min(Hd.w / iw, Hd.h / ih);
    const d = { x: Hd.x + (Hd.w - iw * s) / 2, y: Hd.y + (Hd.h - ih * s) / 2, s };
    return { A: tf(a), B: tf(b), D: tf(d), phoneB, narrow: narrow.matches };
  }

  function resetChat() {
    for (const el of track.querySelectorAll<HTMLElement>(".ai-it"))
      el.classList.toggle("on", el.dataset.scene === "hello");
    for (const w of track.querySelectorAll(".wd")) w.classList.remove("on");
    track.style.transform = "none";
    ctext.textContent = "Ask anything";
    ctext.classList.add("ph");
    send.classList.remove("hot", "press");
    toolIcon.innerHTML = '<span class="ai-spin"></span>';
    toolText.textContent = "Checking wingfoil.ie";
    toolText.className = "ai-shimmer";
    map.classList.remove("live", "pinned");
    hours.classList.remove("on");
    chart.reset();
  }

  // Show a message, and glide what is above it up rather than jump.
  function show(name: string) {
    const el = $(name);
    const before = track.offsetTop;
    el.classList.add("on");
    const shift = before - track.offsetTop;
    if (shift) {
      track.style.transition = "none";
      track.style.transform = `translateY(${shift}px)`;
      void track.offsetHeight;
      track.style.transition = "transform 520ms var(--ai-ease-out)";
      track.style.transform = "none";
    }
    return el;
  }
  async function stream(name: string, id: number, per: number) {
    show(name);
    for (const w of $(name).querySelectorAll(".wd")) {
      w.classList.add("on");
      await wait(per, id);
    }
  }
  function toolDone() {
    toolIcon.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    toolText.className = "";
    toolText.innerHTML = 'Read wingfoil.ie <span class="more">· Sat, 6 spots</span>';
  }

  /** The last beat, at once: everything in its place, the chart drawn. */
  function finalState() {
    run++;
    stage.classList.add("is-done");
    sizePhone();
    set(intro, null, "0");
    for (const el of [slot, head, sub, fine, list, ...rows()]) set(el, "none", "1");
    resetChat();
    for (const name of ["user", "tool", "say1", "card", "say2"]) $(name).classList.add("on");
    for (const w of track.querySelectorAll(".wd")) w.classList.add("on");
    toolDone();
    map.classList.add("live", "pinned");
    chart.start(reduce.matches);
    hours.classList.add("on");
    replay.classList.add("on");
  }

  async function play() {
    const id = ++run;
    stage.classList.remove("is-done");
    sizePhone();
    resetChat();
    replay.classList.remove("on");
    const p = plan();
    for (const c of chars) c.classList.remove("on", "caret");

    // Beat 0: an empty stage.
    set(intro, p.A, "1");
    set(slot, p.phoneB === "none" ? "translateY(60px) scale(0.96)" : `${p.phoneB} translateY(70px)`, "0");
    for (const el of [head, sub, fine]) set(el, "translateY(14px)", "0");
    for (const li of rows()) set(li, "translateX(28px)", "0");
    set(list, "translateY(16px)", "0");

    try {
      // Beat 1: the line types itself at the centre.
      await wait(380, id);
      for (let i = 0; i < chars.length; i++) {
        chars[i].classList.add("on", "caret");
        if (i) chars[i - 1].classList.remove("caret");
        await wait(i === 29 ? 200 : 30, id);
      }
      await wait(650, id);
      chars[chars.length - 1].classList.remove("caret");

      // Beat 2: the line lifts away and the phone rises under it.
      set(intro, p.B, "1", 900, "var(--ai-ease-io)");
      if (p.narrow) {
        set(head, "none", "1", 300, "ease", 850);
        set(intro, p.B, "0", 300, "ease", 850);
      }
      set(slot, p.phoneB, "1", 1000, "var(--ai-ease-out)", 260);
      await wait(1350, id);

      // Beat 3: the conversation.
      ctext.classList.remove("ph");
      for (let i = 1; i <= QUESTION.length; i++) {
        ctext.innerHTML = `${QUESTION.slice(0, i).replace(/ /g, "&nbsp;")}<span class="cur"></span>`;
        if (i === 1) send.classList.add("hot");
        await wait(QUESTION[i - 1] === " " ? 50 : 24 + Math.random() * 20, id);
      }
      await wait(280, id);
      send.classList.add("press");
      await wait(140, id);
      send.classList.remove("press", "hot");
      ctext.textContent = "Ask anything";
      ctext.classList.add("ph");
      show("user");
      await wait(420, id);
      show("tool");
      await wait(950, id);
      toolDone();
      await wait(320, id);
      await stream("say1", id, 40);
      await wait(200, id);
      show("card");
      await wait(260, id);
      map.classList.add("live");
      chart.start(false);
      await wait(650, id);
      map.classList.add("pinned");
      await wait(300, id);
      hours.classList.add("on");
      await wait(700, id);
      await stream("say2", id, 34);
      await wait(800, id);

      // Beat 4: the phone slides over, and the ways in follow.
      if (!p.narrow) {
        set(slot, "none", "1", 1100, "var(--ai-ease-io)");
        set(intro, p.D, "0", 900, "var(--ai-ease-io)", 120);
        set(head, "none", "1", 700, "var(--ai-ease-out)", 620);
      }
      const t0 = p.narrow ? 0 : 760;
      set(sub, "none", "1", 700, "var(--ai-ease-out)", t0 + 90);
      set(list, "none", "1", 700, "var(--ai-ease-out)", t0 + 140);
      rows().forEach((li, i) => set(li, "none", "1", 720, "var(--ai-ease-out)", t0 + 200 + i * 75));
      set(fine, "none", "1", 700, "var(--ai-ease-out)", t0 + 200 + rows().length * 75 + 60);
      await wait(t0 + 1500, id);
      stage.classList.add("is-done");
      replay.classList.add("on");
    } catch (error) {
      if (!(error instanceof Stale)) throw error;
    }
  }

  const onReplay = () => (reduce.matches ? finalState() : void play());
  replay.addEventListener("click", onReplay);
  // A new width lays the page out again: settle on the last beat rather than
  // replay mid-way.
  let resized = 0;
  let lastWidth = window.innerWidth;
  const onResize = () => {
    clearTimeout(resized);
    resized = window.setTimeout(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      finalState();
    }, 150);
  };
  window.addEventListener("resize", onResize);
  const onTheme = () => requestAnimationFrame(() => chart.redraw());
  window.addEventListener(THEME_EVENT, onTheme);
  // Anything the reader does while it plays skips to its end.
  const SKIP = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
  const onSkip = (event: Event) => {
    if (stage.classList.contains("is-done")) return;
    if (event instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta"].includes(event.key))
      return;
    if (event.target instanceof Element && event.target.closest("[data-scene='replay']")) return;
    finalState();
  };
  for (const type of SKIP) window.addEventListener(type, onSkip, { passive: true });

  if (reduce.matches) finalState();
  else void (document.fonts?.ready ?? Promise.resolve()).then(() => play());

  return () => {
    run++;
    chart.stop();
    clearTimeout(resized);
    replay.removeEventListener("click", onReplay);
    window.removeEventListener("resize", onResize);
    window.removeEventListener(THEME_EVENT, onTheme);
    for (const type of SKIP) window.removeEventListener(type, onSkip);
    stage.style.removeProperty("--ai-ps");
  };
}

/** A beat that a newer run has overtaken. */
class Stale extends Error {}
