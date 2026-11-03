/**
 * The Live wind layer: each weather station and buoy as a small gold pill at
 * its place on the map, with the wind it last measured (./windObs): an arrow
 * blowing downwind, the speed, and the gust raised beside it. A reading over
 * READING_FRESH_HOURS old is faded; one past READING_SHOWN_HOURS is not drawn.
 *
 * Under the pointer, or tapped, a pill opens a small card: the station's name
 * and network, the wind, gust and direction, when it was measured, and the
 * network's credit. One card for the layer, laid over the map beside the pill.
 *
 * MapLibre's own markers: two dozen of them, not the hundred and more lights
 * (./lights.ts), whose cost through a move made them buttons of their own.
 * They stand under the spots' lights (src/map.css), so a spot is never hidden
 * by a station beside it.
 */
import * as maplibregl from "maplibre-gl";
import { speedShort, speedWords, unitLabel, type Units } from "./units";
import { compass } from "./weather";
import {
  NETWORK_NAME,
  OBS_CREDIT,
  isStale,
  latestReading,
  measuredAt,
  stationKind,
  type WindReading,
  type WindStation,
} from "./windObs";

const SVG = "http://www.w3.org/2000/svg";
/** The arrow, pointing up (downwind once turned), in a 12-unit box. */
const ARROW = "M0 4.6V-4.4M-2.7 -1.6L0 -4.8L2.7 -1.6";

export interface ReadingPills {
  /** Draw these stations' latest readings at `now`, or none (null). */
  update(
    stations: readonly WindStation[] | null,
    now: number,
    units: Units,
  ): void;
  destroy(): void;
}

interface Pill {
  marker: maplibregl.Marker;
  el: HTMLElement;
  button: HTMLButtonElement;
  turn: SVGGElement;
  speed: HTMLElement;
  gust: HTMLElement;
  station: WindStation;
  reading: WindReading | null;
  key: string;
}

/** "14", "14 g19": a reading's figures in the rider's units. */
export function readingFigures(r: WindReading, units: Units) {
  return {
    speed: speedShort(r.windKn, units),
    gust: r.gustKn === null ? "" : speedShort(r.gustKn, units),
  };
}

/** The reading as it is read aloud: "Malin Head, Met Éireann: 14 knots, gusting 19, from the west, measured 19:00". */
export function readingWords(
  station: WindStation,
  r: WindReading,
  units: Units,
  now: number,
) {
  const gust =
    r.gustKn === null ? "" : `, gusting ${speedShort(r.gustKn, units)}`;
  const from = r.from === null ? "" : `, from ${compassWord(r.from)}`;
  const stale = isStale(r, now) ? ", over 3 hours ago" : "";
  return `${station.name}, ${NETWORK_NAME[station.network]}: ${speedWords(r.windKn, units)}${gust}${from}, measured ${measuredAt(r.time)}${stale}`;
}

const POINTS: Record<string, string> = {
  N: "the north",
  NE: "the north-east",
  E: "the east",
  SE: "the south-east",
  S: "the south",
  SW: "the south-west",
  W: "the west",
  NW: "the north-west",
};
/** "the west", or the sixteen-point name as it is ("WSW") where it has no word. */
const compassWord = (from: number) => {
  const point = compass(from);
  return POINTS[point] ?? point;
};

export function createReadingPills(map: maplibregl.Map): ReadingPills {
  const pills = new Map<string, Pill>();
  let units: Units = "kn";
  let now = Date.now();
  /** The card, made once and moved to whichever pill it is about. */
  const card = document.createElement("div");
  card.className = "obs-card";
  card.setAttribute("role", "tooltip");
  card.id = `obs-card-${Math.random().toString(36).slice(2, 8)}`;
  card.hidden = true;
  map.getContainer().append(card);
  /** The pill the card is about, and whether a tap (not a hover) opened it. */
  let open: Pill | null = null;
  let pinned = false;

  const fill = (pill: Pill) => {
    const r = pill.reading;
    if (!r) return;
    const { speed, gust } = readingFigures(r, units);
    const unit = units === "bft" ? "" : ` ${unitLabel(units)}`;
    const stale = isStale(r, now);
    card.replaceChildren();
    const add = (tag: string, className: string, text = "") => {
      const el = document.createElement(tag);
      el.className = className;
      el.textContent = text;
      return el;
    };
    const head = add("div", "obs-card-head");
    head.append(
      add("b", "obs-card-name", pill.station.name),
      add(
        "span",
        "obs-card-net",
        `${NETWORK_NAME[pill.station.network]} · ${stationKind(pill.station)}`,
      ),
    );
    const figures = add("div", "obs-card-wind");
    const arrow = arrowSvg(r.from);
    figures.append(
      arrow.svg,
      add("b", "obs-card-speed", speed),
      ...(gust ? [add("span", "obs-card-gust", `g${gust}`)] : []),
      add("span", "obs-card-unit", unit.trim()),
      ...(r.from === null
        ? []
        : [add("span", "obs-card-from", compass(r.from))]),
    );
    card.append(
      head,
      figures,
      add(
        "div",
        `obs-card-when${stale ? " is-stale" : ""}`,
        `Measured ${measuredAt(r.time)}${stale ? ", over 3 hours ago" : ""}`,
      ),
      add("div", "obs-card-credit", OBS_CREDIT[pill.station.network]),
    );
  };

  /** The card beside its pill: above it, or below where there is no room. */
  const place = () => {
    if (!open || card.hidden) return;
    const frame = map.getContainer().getBoundingClientRect();
    const r = open.button.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const cx = r.left + r.width / 2 - frame.left;
    const left = Math.max(8, Math.min(frame.width - w - 8, cx - w / 2));
    const above = r.top - frame.top - h - 8;
    const top = above >= 8 ? above : r.bottom - frame.top + 8;
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const show = (pill: Pill, tap: boolean) => {
    if (!pill.reading) return;
    if (open && open !== pill) open.button.removeAttribute("aria-describedby");
    open = pill;
    pinned = tap;
    fill(pill);
    card.hidden = false;
    pill.button.setAttribute("aria-describedby", card.id);
    pill.el.classList.add("is-open");
    for (const other of pills.values())
      if (other !== pill) other.el.classList.remove("is-open");
    place();
  };
  const hide = () => {
    if (!open) return;
    open.button.removeAttribute("aria-describedby");
    open.el.classList.remove("is-open");
    open = null;
    pinned = false;
    card.hidden = true;
  };

  // A tap anywhere else lets go of a card a tap opened; so does a move.
  const away = (event: PointerEvent) => {
    if (!pinned || !open) return;
    if (open.el.contains(event.target as Node)) return;
    hide();
  };
  window.addEventListener("pointerdown", away, true);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) hide();
  };
  window.addEventListener("keydown", onKey);
  map.on("move", place);

  const make = (station: WindStation): Pill => {
    const el = document.createElement("div");
    el.className = "obs-mark";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "obs";
    button.dataset.stationId = station.id;
    const arrow = arrowSvg(null);
    const speed = document.createElement("b");
    const gust = document.createElement("sup");
    button.append(arrow.svg, speed, gust);
    el.append(button);
    const pill: Pill = {
      marker: new maplibregl.Marker({
        element: el,
        anchor: "center",
      }).setLngLat([station.lon, station.lat]),
      el,
      button,
      turn: arrow.turn,
      speed,
      gust,
      station,
      reading: null,
      key: "",
    };
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && !pinned) show(pill, false);
    });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" && !pinned) hide();
    });
    button.addEventListener("focus", () => {
      if (!pinned) show(pill, false);
    });
    button.addEventListener("blur", () => {
      if (!pinned) hide();
    });
    button.addEventListener("click", (event) => {
      // Not the map's own: a tap here reads no point's forecast.
      event.stopPropagation();
      if (open === pill && pinned) hide();
      else show(pill, true);
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    return pill;
  };

  return {
    update(stations, at, u) {
      now = at;
      units = u;
      const want = new Set<string>();
      for (const station of stations ?? []) {
        const r = latestReading(station, now);
        if (!r) continue;
        want.add(station.id);
        let pill = pills.get(station.id);
        if (!pill) {
          pill = make(station);
          pills.set(station.id, pill);
          pill.marker.addTo(map);
        }
        pill.station = station;
        pill.reading = r;
        const stale = isStale(r, now);
        const key = `${r.time}|${r.windKn}|${r.gustKn}|${r.from}|${units}|${stale}`;
        if (key === pill.key) continue;
        pill.key = key;
        const { speed, gust } = readingFigures(r, units);
        pill.speed.textContent = speed;
        pill.gust.textContent = gust;
        pill.gust.hidden = !gust;
        if (r.from === null) pill.turn.parentElement!.style.display = "none";
        else {
          pill.turn.parentElement!.style.display = "";
          pill.turn.setAttribute(
            "transform",
            `rotate(${Math.round(r.from + 180)})`,
          );
        }
        pill.el.classList.toggle("is-stale", stale);
        pill.button.setAttribute(
          "aria-label",
          readingWords(station, r, units, now),
        );
        if (open === pill) fill(pill);
      }
      for (const [id, pill] of pills) {
        if (want.has(id)) continue;
        if (open === pill) hide();
        pill.marker.remove();
        pills.delete(id);
      }
      place();
    },
    destroy() {
      hide();
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onKey);
      map.off("move", place);
      for (const pill of pills.values()) pill.marker.remove();
      pills.clear();
      card.remove();
    },
  };
}

/** A small arrow blowing downwind, turned from `from` (none for null). */
function arrowSvg(from: number | null) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "-6 -6 12 12");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "obs-arrow");
  const turn = document.createElementNS(SVG, "g");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ARROW);
  turn.append(path);
  svg.append(turn);
  if (from === null) svg.style.display = "none";
  else turn.setAttribute("transform", `rotate(${Math.round(from + 180)})`);
  return { svg, turn };
}
