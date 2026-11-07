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
import { arrowSvg, createMapCard, part } from "./mapCard";
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
  const card = createMapCard<Pill>(map, "obs-card", (pill, el) => {
    const r = pill.reading;
    if (!r) return;
    const { speed, gust } = readingFigures(r, units);
    const unit = units === "bft" ? "" : ` ${unitLabel(units)}`;
    const stale = isStale(r, now);
    el.replaceChildren();
    const head = part("div", "map-card-head");
    head.append(
      part("b", "map-card-name", pill.station.name),
      part(
        "span",
        "map-card-net",
        `${NETWORK_NAME[pill.station.network]} · ${stationKind(pill.station)}`,
      ),
    );
    const figures = part("div", "map-card-wind");
    figures.append(
      arrowSvg(r.from).svg,
      part("b", "map-card-speed", speed),
      ...(gust ? [part("span", "map-card-gust", `g${gust}`)] : []),
      part("span", "map-card-unit", unit.trim()),
      ...(r.from === null
        ? []
        : [part("span", "map-card-from", compass(r.from))]),
    );
    el.append(
      head,
      figures,
      part(
        "div",
        `map-card-when${stale ? " is-stale" : ""}`,
        `Measured ${measuredAt(r.time)}${stale ? ", over 3 hours ago" : ""}`,
      ),
      part("div", "map-card-credit", OBS_CREDIT[pill.station.network]),
    );
  });
  const show = (pill: Pill, tap: boolean) => {
    if (pill.reading) card.show(pill, tap);
  };

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
      if (event.pointerType === "mouse" && !card.pinned) show(pill, false);
    });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse" && !card.pinned) card.hide();
    });
    button.addEventListener("focus", () => {
      if (!card.pinned) show(pill, false);
    });
    button.addEventListener("blur", () => {
      if (!card.pinned) card.hide();
    });
    button.addEventListener("click", (event) => {
      // Not the map's own: a tap here reads no point's forecast.
      event.stopPropagation();
      if (card.open === pill && card.pinned) card.hide();
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
        if (card.open === pill) show(pill, card.pinned);
      }
      for (const [id, pill] of pills) {
        if (want.has(id)) continue;
        if (card.open === pill) card.hide();
        pill.marker.remove();
        pills.delete(id);
      }
      card.place();
    },
    destroy() {
      card.destroy();
      for (const pill of pills.values()) pill.marker.remove();
      pills.clear();
    },
  };
}
