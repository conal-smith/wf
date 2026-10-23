/**
 * The spots as a chart's lights: a figure in a ring, the selected hour's
 * stars, with a short arrow blowing downwind. Ink at three and four stars,
 * magenta at five, a plain ring at one and two, dashed at none, faint in the
 * dark. A true offshore hour is struck through in the pen; a cross-offshore
 * one keeps its stars and gets a red arrow instead (and is struck for a
 * learner: the caller decides, through `mark`).
 *
 * Behind the open spot's ring, a wedge spans the headings this rider can
 * hold out to sea at the hour's wind (./rideWedge): the longer the wedge,
 * the better powered the rider, and it pulses faster the more stars. The caller gives it to one light
 * only; on all of them at once it buried the chart. The pulse is a transform
 * and an opacity on an HTML box, for the compositor to run.
 *
 * One DOM button per place, made once and written to in place: rebuilding a
 * hundred and more markers per hour scrubbed stalls the camera.
 *
 * They are not MapLibre's markers, and are not moved one by one through a
 * camera move: each frame of a zoom, a marker's projection, its transform,
 * its promise and animation frame, and the browser working out its style
 * again and moving its layer cost the page more than the rest of the chart
 * did. The buttons are placed where the camera rests; through a move they
 * step aside (src/map.css `.is-moving`) and one canvas draws them, from
 * pictures made at rest (./lightsCanvas). The chart has no rotation and no
 * pitch, so a move takes every light by one scale and shift. A light the
 * rider is at (open, pointed at, on the keys) stays a button and is moved.
 *
 * The names beside the lights are laid out once the camera rests: see
 * `placeLabels`.
 */
import type * as maplibregl from "maplibre-gl";
import { nearestLight } from "./lightHit";
import { drawLights, lookOf, type Drawn, type Look } from "./lightsCanvas";
import type { Wedge } from "./rideWedge";
import { knotsIn, type Units } from "./units";
import type { Spot } from "./weather";

export interface LightState {
  /** Solid stars at the hour, or null where it is dark or not rated yet. */
  stars: number | null;
  /** True until the place's ratings have been worked out. */
  pending: boolean;
  dark: boolean;
  /** Where the wind blows from, in degrees, or null with no reading. */
  from: number | null;
  /** The wind, in knots whatever the rider's units: `knotsIn` converts it. */
  windKn: number | null;
  compass: string | null;
  mark: "struck" | "cross-off" | null;
  /** The headings the rider can hold out to sea, or null. */
  wedge: Wedge | null;
}

interface Entry {
  el: HTMLButtonElement;
  lngLat: [number, number];
  /** Where it stood on the screen as the camera last rested. */
  x: number;
  y: number;
  /**
   * Its pictures for the canvas through a move (./lightsCanvas), by what each
   * was made from: a zoom in and out over the whole chart goes back and
   * forth between two looks, the lights smaller at the national zoom.
   */
  looks: Map<string, Look>;
  /** Counted up whenever its look changes: its state, or its name's place. */
  rev: number;
  arrow: SVGGElement;
  pulse: HTMLElement;
  wedge: SVGPathElement;
  figure: SVGTextElement;
  sub: HTMLElement;
  key: string;
}

/** The classes this module owns on a marker; the marker keeps its own. */
const MANAGED = [
  "pending",
  "dark",
  "s0",
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
  "off",
  "xoff",
  "sel",
  "active",
  "named",
  "w-over",
];

/** How long a frame of a move may spend making the lights' pictures. */
const BUDGET_MS = 4;

/** The base map's own names, which a light's name should not print over. */
const PLACE_LAYERS = ["places", "places-near", "water-names"];

/** Ranks a light's name for the label pass: the open spot, then the starred, then by stars. */
function labelRank(el: HTMLElement): number {
  if (el.classList.contains("sel")) return 100;
  const named = el.classList.contains("named") ? 50 : 0;
  for (let n = 5; n >= 0; n--) if (el.classList.contains(`s${n}`)) return named + n;
  return named - 1;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box, pad = 1) =>
  a.left < b.right + pad &&
  b.left < a.right + pad &&
  a.top < b.bottom + pad &&
  b.top < a.bottom + pad;

const LIGHT_SVG = `<svg viewBox="-30 -30 60 60" aria-hidden="true"><g class="lt-wind"><path class="lt-arrow" d="M0 -9.6V-20.5M-3.4 -16.6L0 -21L3.4 -16.6"/></g><circle class="lt-ring" r="7.6"/><line class="lt-strike" x1="-5.6" y1="5.6" x2="5.6" y2="-5.6"/><text class="lt-n" y="3.4" text-anchor="middle"></text></svg>`;

/** The wedge's radius, in the light's 60-unit box: just foiling to fully powered. */
const WEDGE_SHORT = 11;
const WEDGE_LONG = 32;

const point = (bearing: number, r: number) => {
  const a = (bearing * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
};

/** A sector from the ring's centre, clockwise from `from` to `to`. */
export function wedgePath({ from, to, power }: Wedge): string {
  const r = WEDGE_SHORT + (WEDGE_LONG - WEDGE_SHORT) * power;
  return `M0 0L${point(from, r)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, r)}Z`;
}

export interface Lights {
  update(
    states: ReadonlyMap<string, LightState>,
    selected: string | null,
    named: ReadonlySet<string>,
    label: (spot: Spot, state: LightState | undefined) => string,
    units: Units,
  ): void;
  element(id: string): HTMLButtonElement | undefined;
  destroy(): void;
}

export function createLights(
  map: maplibregl.Map,
  spots: readonly Spot[],
  onSelect: (spot: Spot) => void,
): Lights {
  const entries = new Map<string, Entry>();
  /**
   * The names, laid out greedily: the open spot's first, then the starred
   * ones', then the rest by their stars. Each takes its usual side of its
   * light, or the other side, where neither another light's ring, a name
   * already placed nor one of the base map's place names is in the way; a
   * name with room on neither side is left off (its light still says its
   * stars, and its title its name). The open spot's name always shows, on
   * whichever side is clearer. Run when the camera comes to rest, and after
   * the lights change, never per frame.
   */
  let laid = "";
  let dirty = true;
  const placeLabels = () => {
    const camera = `${map.getZoom().toFixed(3)}|${map.getCenter().toArray().join(",")}`;
    if (!dirty && camera === laid) return;
    laid = camera;
    dirty = false;
    const frame = map.getContainer().getBoundingClientRect();
    const layers = PLACE_LAYERS.filter((id) => map.getLayer(id));
    const rings: { el: HTMLElement; box: Box }[] = [];
    const shown: { el: HTMLElement; ring: Box; lab: Box; rank: number }[] = [];
    const before = new Map<Entry, string>();
    for (const entry of entries.values()) {
      const { el } = entry;
      before.set(
        entry,
        `${el.classList.contains("lab-hide")}${el.classList.contains("lab-left")}`,
      );
      el.classList.remove("lab-hide", "lab-left");
    }
    for (const { el } of entries.values()) {
      const r = el.getBoundingClientRect();
      if (
        r.right < frame.left ||
        r.left > frame.right ||
        r.bottom < frame.top ||
        r.top > frame.bottom
      )
        continue;
      // The ring, not the button's whole square.
      const ring = {
        left: r.left + 3,
        top: r.top + 3,
        right: r.right - 3,
        bottom: r.bottom - 3,
      };
      rings.push({ el, box: ring });
      const lab = el.querySelector<HTMLElement>(".lt-lab");
      if (!lab || lab.offsetParent === null) continue;
      const b = lab.getBoundingClientRect();
      shown.push({
        el,
        ring,
        lab: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        rank: labelRank(el),
      });
    }
    shown.sort((a, b) => b.rank - a.rank);
    const placed: Box[] = [];
    const free = (el: HTMLElement, box: Box) =>
      !placed.some((p) => overlaps(p, box)) &&
      !rings.some((ring) => ring.el !== el && overlaps(ring.box, box)) &&
      !(
        layers.length &&
        map.queryRenderedFeatures(
          [
            [box.left - frame.left, box.top - frame.top],
            [box.right - frame.left, box.bottom - frame.top],
          ],
          { layers },
        ).length
      );
    for (const { el, ring, lab, rank } of shown) {
      // The same name on the light's other side: mirrored about its centre.
      const cx = (ring.left + ring.right) / 2;
      const left = { ...lab, left: 2 * cx - lab.right, right: 2 * cx - lab.left };
      if (free(el, lab)) placed.push(lab);
      else if (free(el, left)) {
        el.classList.add("lab-left");
        placed.push(left);
      } else if (rank >= 100) placed.push(lab);
      else el.classList.add("lab-hide");
    }
    for (const [entry, was] of before) {
      const { el } = entry;
      if (
        `${el.classList.contains("lab-hide")}${el.classList.contains("lab-left")}` !==
        was
      )
        entry.rev++;
    }
  };
  let queued = 0;
  const queue = () => {
    if (!queued) queued = requestAnimationFrame(() => {
      queued = 0;
      // Laid out where the buttons stand, once the camera rests: through a
      // move they stand where it last did.
      if (moving) return;
      placeLabels();
    });
  };
  map.on("moveend", queue);
  map.on("idle", queue);
  // The chart's own classes decide which names show at all (zoom, focus,
  // the names layer): a change there is a change of what to lay out.
  const classes = new MutationObserver(() => {
    dirty = true;
    queue();
    // Across a zoom's own steps (the lights smaller further out, the names
    // shown closer in) the canvas changes with the buttons.
    if (moving) {
      refresh();
      follow();
    }
  });
  classes.observe(map.getContainer(), {
    attributes: true,
    attributeFilter: ["class"],
  });
  const byId = new Map(spots.map((spot) => [spot.id, spot]));
  /**
   * The spot a click on `el` meant: from a pointer, the nearest light within
   * a button's reach of it (./lightHit), since the reaches of close lights
   * overlap; from a key, the light's own.
   */
  const meant = (spot: Spot, el: HTMLElement, event: MouseEvent): Spot => {
    if (!event.detail) return spot;
    const reach = parseFloat(getComputedStyle(el, "::before").width) / 2 || 22;
    const centres = [...entries].map(([id, entry]) => {
      const r = entry.el.getBoundingClientRect();
      return { id, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const id = nearestLight(centres, event.clientX, event.clientY, reach);
    return (id && byId.get(id)) || spot;
  };
  // The lights' common parent: no box of its own (display: contents), so each
  // light stacks in the map as a marker did. The canvas the lights are drawn
  // on through a move goes under it, so a light kept a button stays on top.
  const layer = document.createElement("div");
  layer.className = "map-lights";
  const canvas = document.createElement("canvas");
  canvas.className = "lights-canvas";
  canvas.setAttribute("aria-hidden", "true");
  map.getCanvasContainer().append(canvas, layer);
  /** Where the screen's top left corner was when the lights were last placed. */
  let origin: maplibregl.LngLat | null = null;
  let restZoom = 0;
  const moveTo = (el: HTMLElement, x: number, y: number) => {
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  };
  /** The lights kept as buttons through a move, and the rest, as drawn. */
  let live: Entry[] = [];
  /** The lights still waiting for their pictures, buttons until they have them. */
  const waiting = new Set<Entry>();
  let drawn: Drawn[] = [];
  let moving = false;
  /** Whether some light still waits for its picture, out of the last frame's time. */
  let behind = false;
  const dpr = () => window.devicePixelRatio || 1;
  /** A light the rider is at: pointed at, open, on the keys, or pulsing. */
  const isLive = ({ el, pulse }: Entry) =>
    el.classList.contains("sel") ||
    el.classList.contains("gust-highlight") ||
    el === document.activeElement ||
    el.matches(":hover") ||
    pulse.style.display !== "none";
  /**
   * Each light's picture, made again where what it is drawn from changed:
   * its classes and state, the chart's (zoom, focus, names) and the pixel
   * ratio. A name is drawn only for a light within a screen of the view:
   * further off, at a close zoom, every name in the country would be a
   * picture held.
   */
  const capture = (budget: number) => {
    const w = boxW;
    const h = boxH;
    const chart = `${map.getContainer().className}|${dpr()}`;
    const out = new Map<Entry, Look>();
    const until = performance.now() + budget;
    behind = false;
    for (const entry of entries.values()) {
      if (live.includes(entry)) continue;
      const near =
        entry.x > -w && entry.x < 2 * w && entry.y > -h && entry.y < 2 * h;
      const sig = `${chart}|${entry.rev}|${near}`;
      let look = entry.looks.get(sig);
      if (!look && performance.now() > until) {
        // Out of time in this frame: it stays a button until the next.
        behind = true;
        continue;
      }
      if (!look) {
        const r = entry.el.getBoundingClientRect();
        look = lookOf(
          entry.el,
          { x: r.left + r.width / 2, y: r.top + r.height / 2 },
          dpr(),
          near,
        );
        // The last few only: the pictures of a look long gone are let go.
        if (entry.looks.size >= 3)
          entry.looks.delete(entry.looks.keys().next().value!);
        entry.looks.set(sig, look);
      }
      out.set(entry, look);
    }
    return out;
  };
  /**
   * What the canvas draws, in the order the buttons stack: the named on top.
   * Through a move, a few milliseconds of new pictures a frame: a zoom in to
   * where every light's name shows makes a picture of each.
   */
  const refresh = () => {
    const looks = capture(BUDGET_MS);
    // A light with no picture yet stays a button, moved, until it has one.
    for (const entry of entries.values()) {
      if (live.includes(entry)) continue;
      const wait = !looks.has(entry);
      if (wait === waiting.has(entry)) continue;
      if (wait) waiting.add(entry);
      else waiting.delete(entry);
      entry.el.classList.toggle("lt-live", wait);
    }
    const named = (e: Entry) => e.el.classList.contains("named");
    const all = [...looks.keys()];
    drawn = [
      ...all.filter((e) => !named(e)),
      ...all.filter(named),
    ].map((e) => ({ x: e.x, y: e.y, look: looks.get(e)! }));
  };
  /** Each light at its place on the screen, with the camera at rest. */
  const place = () => {
    for (const entry of entries.values()) {
      const p = map.project(entry.lngLat);
      entry.x = Math.round(p.x);
      entry.y = Math.round(p.y);
      moveTo(entry.el, entry.x, entry.y);
    }
    origin = map.unproject([0, 0]);
    restZoom = map.getZoom();
  };
  /**
   * The map's box, read when it is resized: read as a move begins, it laid
   * the page out again then and there.
   */
  let boxW = 0;
  let boxH = 0;
  const measure = () => {
    const box = map.getContainer();
    boxW = box.clientWidth;
    boxH = box.clientHeight;
  };
  /** The canvas over the map's box, in device pixels. */
  const size = () => {
    const w = Math.round(boxW * dpr());
    const h = Math.round(boxH * dpr());
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  const resized = () => {
    measure();
    end();
  };
  /** A move begins: the lights step aside for their pictures. */
  const begin = () => {
    if (moving) return;
    moving = true;
    live = [...entries.values()].filter(isLive);
    for (const entry of live) entry.el.classList.add("lt-live");
    refresh();
    size();
    layer.classList.add("is-moving");
    follow();
  };
  /** Through a move: the same scale and shift for every light. */
  const follow = () => {
    if (!origin) return;
    if (!moving) begin();
    else if (behind) refresh();
    const at = map.project(origin);
    const k = 2 ** (map.getZoom() - restZoom);
    drawLights(canvas, drawn, k, at.x, at.y, dpr());
    for (const { el, x, y } of live) moveTo(el, k * x + at.x, k * y + at.y);
    for (const { el, x, y } of waiting)
      moveTo(el, k * x + at.x, k * y + at.y);
  };
  /** At rest: the buttons back, where the camera has them. */
  const end = () => {
    place();
    if (!moving) return;
    moving = false;
    layer.classList.remove("is-moving");
    for (const entry of [...live, ...waiting])
      entry.el.classList.remove("lt-live");
    live = [];
    waiting.clear();
    drawn = [];
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
  };
  for (const spot of spots) {
    const el = document.createElement("button");
    el.type = "button";
    // Before the marker is made: it adds classes of its own to the element.
    el.className = "spot-marker lt pending";
    el.dataset.spotId = spot.id;
    el.innerHTML = `<span class="lt-pulse" aria-hidden="true"><svg class="lt-wedge" viewBox="-30 -30 60 60"><path/></svg></span>${LIGHT_SVG}<span class="lt-lab" aria-hidden="true"><b></b><i></i></span>`;
    el.querySelector(".lt-lab b")!.textContent = spot.name;
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(meant(spot, el, event));
    });
    // As MapLibre's markers do: a press on a light neither drags it as an
    // image nor moves the focus.
    el.addEventListener("dragstart", (event) => event.preventDefault());
    el.addEventListener("mousedown", (event) => event.preventDefault());
    layer.appendChild(el);
    entries.set(spot.id, {
      el,
      lngLat: [spot.lon, spot.lat],
      x: 0,
      y: 0,
      looks: new Map(),
      rev: 0,
      arrow: el.querySelector<SVGGElement>(".lt-wind")!,
      pulse: el.querySelector<HTMLElement>(".lt-pulse")!,
      wedge: el.querySelector<SVGPathElement>(".lt-wedge path")!,
      figure: el.querySelector<SVGTextElement>(".lt-n")!,
      sub: el.querySelector<HTMLElement>(".lt-lab i")!,
      key: "",
    });
  }
  // Through a move the buttons are out of reach (src/map.css): a tap on a
  // light as it is drawn chooses it all the same, the nearest within a
  // button's reach (./lightHit), and goes no further, to the chart's own pick.
  const box = map.getContainer();
  const tapped = (event: MouseEvent) => {
    if (!moving || !origin || !box.contains(event.target as Node)) return;
    const frame = box.getBoundingClientRect();
    const at = map.project(origin);
    const k = 2 ** (map.getZoom() - restZoom);
    const centres = [...entries].map(([id, { x, y }]) => ({
      id,
      x: frame.left + k * x + at.x,
      y: frame.top + k * y + at.y,
    }));
    // A button's reach (src/map.css .lt::before): 44 px across under a
    // finger, 32 under a mouse.
    const reach = window.matchMedia("(pointer: coarse)").matches ? 22 : 16;
    const id = nearestLight(centres, event.clientX, event.clientY, reach);
    const spot = id ? byId.get(id) : undefined;
    if (!spot) return;
    event.stopPropagation();
    onSelect(spot);
  };
  window.addEventListener("click", tapped, true);
  measure();
  place();
  map.on("movestart", begin);
  map.on("move", follow);
  map.on("moveend", end);
  map.on("resize", resized);
  return {
    update(states, selected, named, label, units) {
      for (const spot of spots) {
        const entry = entries.get(spot.id);
        if (!entry) continue;
        const s = states.get(spot.id);
        const on = spot.id === selected;
        const w = s?.wedge;
        const key = s
          ? `${s.pending}|${s.stars}|${s.dark}|${s.mark}|${s.from === null ? "" : Math.round(s.from)}|${s.windKn === null ? "" : knotsIn(s.windKn, units)}|${w ? `${Math.round(w.from)},${Math.round(w.to)},${Math.round(w.power * 20)},${w.state}` : ""}|${on}|${named.has(spot.id)}`
          : `none|${on}|${named.has(spot.id)}`;
        if (entry.key === key) continue;
        entry.key = key;
        entry.rev++;
        const { el } = entry;
        const level =
          !s || s.pending ? "pending" : s.dark || s.stars === null ? "dark" : `s${s.stars}`;
        const want = new Set([
          level,
          ...(s?.mark === "struck" ? ["off"] : []),
          ...(s?.mark === "cross-off" ? ["xoff"] : []),
          ...(w?.state === "over" ? ["w-over"] : []),
          ...(on ? ["sel", "active"] : []),
          ...(named.has(spot.id) ? ["named"] : []),
        ]);
        for (const name of MANAGED) el.classList.toggle(name, want.has(name));
        entry.figure.textContent =
          s && !s.pending && !s.dark && s.stars !== null ? String(s.stars) : "";
        if (s && s.from !== null) {
          entry.arrow.setAttribute(
            "transform",
            `rotate(${Math.round(s.from + 180)})`,
          );
          entry.arrow.style.display = "";
        } else entry.arrow.style.display = "none";
        if (w && level.startsWith("s")) {
          entry.wedge.setAttribute("d", wedgePath(w));
          entry.pulse.style.display = "";
        } else entry.pulse.style.display = "none";
        entry.sub.textContent =
          s && !s.pending && s.compass !== null && s.windKn !== null
            ? // The wind and the shore, not the stars: the ring's figure
              // says those, and "0★" under a dashed "0" read as a glitch.
              `${s.compass} ${knotsIn(s.windKn, units)}${s.mark ? ` · ${s.mark === "struck" ? "offshore" : "cross-off"}` : ""}`
            : "";
        dirty = true;
      }
      // Every time, not only when the light changes: the name also says the
      // hour and the units, which a light's look does not show.
      for (const spot of spots) {
        const el = entries.get(spot.id)?.el;
        const name = label(spot, states.get(spot.id));
        if (el && el.getAttribute("aria-label") !== name)
          el.setAttribute("aria-label", name);
      }
      if (dirty) queue();
    },
    element: (id) => entries.get(id)?.el,
    destroy() {
      cancelAnimationFrame(queued);
      classes.disconnect();
      map.off("moveend", queue);
      map.off("idle", queue);
      map.off("movestart", begin);
      map.off("move", follow);
      map.off("moveend", end);
      map.off("resize", resized);
      window.removeEventListener("click", tapped, true);
      layer.remove();
      canvas.remove();
      entries.clear();
    },
  };
}
