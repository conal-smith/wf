/**
 * The spots as a chart's lights: a figure in a ring, the selected hour's
 * stars, with a short arrow blowing downwind. Ink at three and four stars,
 * magenta at five, a plain ring at one and two, dashed at none, faint in the
 * dark. A true offshore hour is struck through in the pen; a cross-offshore
 * one keeps its stars and gets a red arrow instead (and is struck for a
 * learner: the caller decides, through `mark`).
 *
 * One DOM marker per place, made once and written to in place: rebuilding a
 * hundred and more markers per hour scrubbed stalls the camera.
 */
import * as maplibregl from "maplibre-gl";
import type { Spot } from "./weather";

export interface LightState {
  /** Solid stars at the hour, or null where it is dark or not rated yet. */
  stars: number | null;
  /** True until the place's ratings have been worked out. */
  pending: boolean;
  dark: boolean;
  /** Where the wind blows from, in degrees, or null with no reading. */
  from: number | null;
  windKn: number | null;
  compass: string | null;
  mark: "struck" | "cross-off" | null;
}

interface Entry {
  el: HTMLButtonElement;
  marker: maplibregl.Marker;
  arrow: SVGGElement;
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
];

const LIGHT_SVG = `<svg viewBox="-30 -30 60 60" aria-hidden="true"><g class="lt-wind"><path class="lt-arrow" d="M0 -9.6V-20.5M-3.4 -16.6L0 -21L3.4 -16.6"/></g><circle class="lt-ring" r="7.6"/><line class="lt-strike" x1="-5.6" y1="5.6" x2="5.6" y2="-5.6"/><text class="lt-n" y="3.4" text-anchor="middle"></text></svg>`;

export interface Lights {
  update(
    states: ReadonlyMap<string, LightState>,
    selected: string | null,
    named: ReadonlySet<string>,
    label: (spot: Spot, state: LightState | undefined) => string,
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
  for (const spot of spots) {
    const el = document.createElement("button");
    el.type = "button";
    // Before the marker is made: it adds classes of its own to the element.
    el.className = "spot-marker lt pending";
    el.dataset.spotId = spot.id;
    el.innerHTML = `${LIGHT_SVG}<span class="lt-lab" aria-hidden="true"><b></b><i></i></span>`;
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
      figure: el.querySelector<SVGTextElement>(".lt-n")!,
      sub: el.querySelector<HTMLElement>(".lt-lab i")!,
      key: "",
    });
  }
  return {
    update(states, selected, named, label) {
      for (const spot of spots) {
        const entry = entries.get(spot.id);
        if (!entry) continue;
        const s = states.get(spot.id);
        const on = spot.id === selected;
        const key = s
          ? `${s.pending}|${s.stars}|${s.dark}|${s.mark}|${s.from === null ? "" : Math.round(s.from)}|${s.windKn === null ? "" : Math.round(s.windKn)}|${on}|${named.has(spot.id)}`
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
        entry.sub.textContent =
          s && !s.pending && s.compass !== null && s.windKn !== null
            ? `${s.stars !== null && !s.dark ? `${s.stars}★ ` : ""}${s.compass} ${Math.round(s.windKn)}${s.mark ? ` · ${s.mark === "struck" ? "offshore" : "cross-off"}` : ""}`
            : "";
        el.setAttribute("aria-label", label(spot, s));
      }
    },
    element: (id) => entries.get(id)?.el,
    destroy() {
      for (const entry of entries.values()) entry.marker.remove();
      entries.clear();
    },
  };
}
