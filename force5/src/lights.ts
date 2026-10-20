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
 * One DOM marker per place, made once and written to in place: rebuilding a
 * hundred and more markers per hour scrubbed stalls the camera.
 *
 * The names beside the lights are laid out once the camera rests: see
 * `placeLabels`.
 */
import * as maplibregl from "maplibre-gl";
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
  marker: maplibregl.Marker;
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
    for (const { el } of entries.values()) {
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
  };
  let queued = 0;
  const queue = () => {
    if (!queued) queued = requestAnimationFrame(() => {
      queued = 0;
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
  });
  classes.observe(map.getContainer(), {
    attributes: true,
    attributeFilter: ["class"],
  });
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
      onSelect(spot);
    });
    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([spot.lon, spot.lat])
      .addTo(map);
    entries.set(spot.id, {
      el,
      marker,
      arrow: el.querySelector<SVGGElement>(".lt-wind")!,
      pulse: el.querySelector<HTMLElement>(".lt-pulse")!,
      wedge: el.querySelector<SVGPathElement>(".lt-wedge path")!,
      figure: el.querySelector<SVGTextElement>(".lt-n")!,
      sub: el.querySelector<HTMLElement>(".lt-lab i")!,
      key: "",
    });
  }
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
      for (const entry of entries.values()) entry.marker.remove();
      entries.clear();
    },
  };
}
