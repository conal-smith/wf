/**
 * The finder's map: the chart (force5/src/WindMap.tsx) in a plain style, its
 * light base with the wind in ink at the chosen hour, as the chart's Ink
 * layer draws it, from the frame the chart has already loaded; and a pin
 * with its stars for each place on the list. A pin is an ink pill for four
 * or five stars, paper for one to three and dashed for none: shape and fill
 * for the reading, never a wind colour. Press one for its card on the map.
 */
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { WindMap } from "../../force5/src";
import type { LightState } from "../../force5/src/lights";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { ChartLayers, MapControls } from "../../force5/src/WindMap";
import { spotHref } from "../../force5/src/siteNav";
import type { Frame, Spot } from "../../force5/src/weather";
import { Button } from "../../ui/Button";
import { StarGlyphs } from "../../ui/StarGlyphs";
import { tv } from "../../ui/tv";
import type { LatLon } from "../lastView";
import type { PlaceHour } from "../ratings";
import type { Listed, TimelineHour } from "./finder";
import {
  DayBar,
  SpotPicture,
  StarToggle,
  StarsBadge,
  WindReading,
} from "./SpotCard";

/** The plain style: the land, the sea, the coast and the names, no more. */
const PLAIN: ChartLayers = {
  tints: false,
  soundings: false,
  relief: false,
  names: true,
  foil: false,
  currents: false,
};
const NO_LIGHTS = new Map<string, LightState>();
const NO_NAMES = new Set<string>();
const NO_SPOTS: Spot[] = [];
const nothing = () => {};

const styles = tv({
  slots: {
    box: "relative size-full overflow-hidden bg-sea-4",
    pins: "pointer-events-none absolute inset-0 z-popover",
    pin: [
      "pointer-events-auto absolute h-auto min-h-0 -translate-x-1/2 -translate-y-1/2 gap-1 rounded-full border-ink px-2 py-0.5",
      "font-mono text-body font-semibold tracking-normal normal-case",
      "transition duration-fast motion-reduce:transition-none",
      "hover:z-panel hover:scale-115",
      "pointer-coarse:min-h-0 pointer-coarse:min-w-0",
    ],
    zoom: "absolute top-3 right-3 z-panel flex flex-col rounded-surface border border-ink bg-card paper-float p-0.5 shadow-float inset-shadow-frame",
    zoomButton: "rounded-control",
    card: [
      "absolute z-panel w-68 overflow-hidden rounded-dialog border border-ink bg-card shadow-sheet inset-shadow-frame",
      "max-wide:inset-x-3 max-wide:bottom-19 max-wide:w-auto",
    ],
    cardBody: "px-2.5 pt-1 pb-3",
    cardMeta: "flex items-baseline gap-2 pt-1",
    cardName:
      "m-0 min-w-0 flex-1 truncate font-display text-prose font-semibold",
    go: "mt-2.5 flex gap-2",
    close: "absolute top-2 right-2 z-popover",
    star: "absolute top-2 right-12 z-popover",
  },
  variants: {
    stars: {
      top: { pin: "bg-inverse sheen-ink text-ink-inverse shadow-control" },
      mid: { pin: "bg-card text-ink shadow-marker" },
      none: {
        pin: "border-dashed bg-card text-ink-muted font-medium shadow-none",
      },
    },
    lit: { true: { pin: "z-panel scale-115" } },
  },
  compoundVariants: [
    {
      stars: ["mid", "none"],
      lit: true,
      class: { pin: "outline-2 outline-ink" },
    },
  ],
});

/** The map's projection, read again as it moves: a frame at a time. */
function useMoved(map: MapControls["map"] | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const moved = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          setTick((t) => t + 1);
        });
    };
    map.on("move", moved);
    map.on("resize", moved);
    moved();
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", moved);
      map.off("resize", moved);
    };
  }, [map]);
}

export default function FinderMap({
  frame,
  list,
  around,
  aroundKey,
  hover,
  onHover,
  open,
  onOpen,
  hours,
  day,
  selected,
  rider,
  units,
  starred,
  onToggleStar,
  onInChart,
  reducedMotion,
  phone,
}: {
  frame: Frame | null;
  list: readonly Listed[];
  /** Where to look with nothing on the list: the rider, or the chart's centre. */
  around: LatLon;
  /** What the list is (its scope and places): the map frames it again when this changes. */
  aroundKey: string;
  hover: string | null;
  onHover: (id: string | null) => void;
  open: string | null;
  onOpen: (id: string | null) => void;
  hours: ReadonlyMap<string, PlaceHour[]>;
  day: readonly TimelineHour[];
  selected: number;
  rider: Rider;
  units: Units;
  starred: readonly string[];
  onToggleStar: (id: string) => void;
  onInChart: (spot: Spot) => void;
  reducedMotion: boolean;
  phone: boolean;
}) {
  const s = styles();
  const [controls, setControls] = useState<MapControls | null>(null);
  const map = controls?.map ?? null;
  const box = useRef<HTMLDivElement>(null);
  useMoved(map);

  // The list framed, as it changes: the places on it, or round the rider.
  const listRef = useRef(list);
  listRef.current = list;
  const framed = useRef(false);
  useEffect(() => {
    if (!map) return;
    const places = listRef.current.map((l) => l.spot);
    const duration = framed.current && !reducedMotion ? 600 : 0;
    framed.current = true;
    if (!places.length) {
      map.easeTo({ center: [around.lon, around.lat], zoom: 9, duration });
      return;
    }
    const lons = places.map((p) => p.lon);
    const lats = places.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: phone ? 48 : 64, maxZoom: 11, duration },
    );
  }, [map, aroundKey]);

  const openSpot = list.find((l) => l.spot.id === open) ?? null;
  // A card opened for a place off the map brings it into view; on a phone,
  // where the card takes the foot of the map, into the part above it.
  useEffect(() => {
    if (!map || !openSpot) return;
    const p = map.project([openSpot.spot.lon, openSpot.spot.lat]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (
      phone
        ? p.y > h * 0.4 || p.y < 0
        : p.x < 0 || p.y < 0 || p.x > w || p.y > h
    )
      map.easeTo({
        center: [openSpot.spot.lon, openSpot.spot.lat],
        offset: phone ? [0, -h * 0.28] : [0, 0],
        duration: reducedMotion ? 0 : 500,
      });
  }, [map, open]);

  const size = map
    ? { w: map.getContainer().clientWidth, h: map.getContainer().clientHeight }
    : null;
  const at = (spot: Spot) => (map ? map.project([spot.lon, spot.lat]) : null);

  return (
    <div className={s.box()} ref={box} data-finder-map>
      <WindMap
        plain
        label="Map of the spots on the list, with the wind at the hour chosen"
        frame={frame}
        spots={NO_SPOTS}
        lights={NO_LIGHTS}
        named={NO_NAMES}
        lightLabel={() => ""}
        selectedId={null}
        focus={null}
        focusStyle="off"
        units={units}
        rose={null}
        mark={null}
        picked={null}
        windStyle="ink"
        layers={PLAIN}
        foil={null}
        reducedMotion={reducedMotion}
        bottomInset={0}
        phone={phone}
        onSelect={nothing}
        onPick={() => onOpen(null)}
        onReady={setControls}
      />
      <div className={s.pins()}>
        {size &&
          // The best drawn last, over any pin it stands close to.
          [...list].reverse().map(({ spot, hour }) => {
            const p = at(spot);
            if (
              !p ||
              p.x < -24 ||
              p.y < -24 ||
              p.x > size.w + 24 ||
              p.y > size.h + 24
            )
              return null;
            const stars = hour?.rating ? hour.rating.stars : null;
            const kind =
              stars === null || stars === 0
                ? "none"
                : stars >= 4
                  ? "top"
                  : "mid";
            return (
              <Button
                key={spot.id}
                variant="quiet"
                className={s.pin({ stars: kind, lit: hover === spot.id })}
                style={{ left: p.x, top: p.y }}
                aria-label={`${spot.name}: ${stars === null ? "not rated" : `${stars} star${stars === 1 ? "" : "s"}`}`}
                aria-expanded={open === spot.id}
                data-pin={spot.id}
                data-lit={hover === spot.id || undefined}
                onPointerEnter={(e) =>
                  e.pointerType === "mouse" && onHover(spot.id)
                }
                onPointerLeave={(e) =>
                  e.pointerType === "mouse" && onHover(null)
                }
                onClick={() => onOpen(open === spot.id ? null : spot.id)}
              >
                <StarGlyphs
                  stars={1}
                  slots="potential"
                  size={10}
                  tone={kind === "top" ? "inverse" : undefined}
                  label=""
                />
                {stars ?? "–"}
              </Button>
            );
          })}
      </div>
      <div className={s.zoom()} role="group" aria-label="Zoom">
        <Button
          variant="quiet"
          size="sm"
          icon
          className={s.zoomButton()}
          aria-label="Zoom in"
          onClick={() => controls?.zoomIn()}
        >
          <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon
          className={s.zoomButton()}
          aria-label="Zoom out"
          onClick={() => controls?.zoomOut()}
        >
          <Minus size={15} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>
      {openSpot && size && (
        <PinCard
          item={openSpot}
          place={at(openSpot.spot)}
          size={size}
          phone={phone}
          row={hours.get(openSpot.spot.id)}
          day={day}
          selected={selected}
          rider={rider}
          units={units}
          starred={starred.includes(openSpot.spot.id)}
          onToggleStar={() => onToggleStar(openSpot.spot.id)}
          onClose={() => onOpen(null)}
          onInChart={() => onInChart(openSpot.spot)}
        />
      )}
    </div>
  );
}

/** The width of a pin's card, in pixels: `w-68`. */
const CARD_W = 272;

function PinCard({
  item,
  place,
  size,
  phone,
  row,
  day,
  selected,
  rider,
  units,
  starred,
  onToggleStar,
  onClose,
  onInChart,
}: {
  item: Listed;
  place: { x: number; y: number } | null;
  size: { w: number; h: number };
  phone: boolean;
  row: readonly PlaceHour[] | undefined;
  day: readonly TimelineHour[];
  selected: number;
  rider: Rider;
  units: Units;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
  onInChart: () => void;
}) {
  const s = styles();
  const { spot, hour } = item;
  // Over the pin when it is low on the map, under it when it is high; on a
  // phone, across the foot of the screen.
  const position =
    phone || !place
      ? undefined
      : {
          left: Math.max(
            12,
            Math.min(size.w - CARD_W - 12, place.x - CARD_W / 2),
          ),
          ...(place.y > size.h / 2
            ? { bottom: size.h - place.y + 20 }
            : { top: place.y + 22 }),
        };
  return (
    <section
      className={s.card()}
      style={position}
      aria-label={spot.name}
      data-pin-card={spot.id}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <SpotPicture spot={spot} hour={hour} rider={rider} units={units} flat>
        <StarsBadge hour={hour} />
        <StarToggle
          spot={spot}
          on={starred}
          onToggle={onToggleStar}
          className={s.star()}
        />
        <Button
          variant="raised"
          size="sm"
          icon
          className={s.close()}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </SpotPicture>
      <div className={s.cardBody()}>
        <div className={s.cardMeta()}>
          <h3 className={s.cardName()}>{spot.name}</h3>
          <WindReading hour={hour} facing={spot.facing ?? null} units={units} />
        </div>
        <DayBar day={day} row={row} selected={selected} className="mx-0" />
        <div className={s.go()}>
          <Button
            variant="pill"
            size="sm"
            className="flex-1"
            href={spotHref(spot.id)}
          >
            Open spot
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={onInChart}
          >
            In the chart
          </Button>
        </div>
      </div>
    </section>
  );
}
