/**
 * A place on the spot finder's list, and the same place in the card a pin
 * opens on its map: its picture from above with the ride rose on it, its
 * stars, its wind and the chosen day's wind as a bar, the hour marked.
 *
 * The picture is the spot page's own, cut from the chart's satellite
 * composites (spot/web/satellite.ts), loaded lazily as the card scrolls in;
 * the rose is the loupe's (force5/src/focus.ts), at the loupe's distance.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loupeRose, roseScale } from "../../force5/src/focus";
import { shoreAngle, type Rider } from "../../force5/src/stars";
import {
  beaufort,
  isForce,
  speedShort,
  speedWords,
  type Units,
} from "../../force5/src/units";
import { compass, windCss, type Spot } from "../../force5/src/weather";
import { BeaufortGlyph } from "../../ui/BeaufortGlyph";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { StarGlyphs } from "../../ui/StarGlyphs";
import { tv } from "../../ui/tv";
import {
  inFrame,
  loadSpotPictures,
  spotPicture,
  type SpotPictures,
} from "../../spot/web/satellite";
import type { PlaceHour } from "../ratings";
import type { TimelineHour } from "./finder";
import { Rose } from "./Rose";

export const cardStyles = tv({
  slots: {
    card: "group/card relative flex cursor-pointer flex-col",
    // A box on the page: the ink rule, a box's corner, a card's contact
    // shadow; lifted a little under the pointer, or when its pin is.
    picture: "relative aspect-16/10 overflow-hidden bg-sea-1",
    // On the list, a box of its own; in a pin's card, the card is the box.
    framed: [
      "rounded-surface border border-ink shadow-card",
      "transition duration-fast motion-reduce:transition-none",
      "group-hover/card:-translate-y-0.5 group-hover/card:shadow-float",
      "group-data-lit/card:-translate-y-0.5 group-data-lit/card:shadow-float",
    ],
    image: "absolute inset-0 block size-full object-cover",
    // The hairline inside the rule, over the picture's edge.
    rule: "pointer-events-none absolute inset-0 rounded-surface inset-shadow-frame",
    badge: "absolute top-2 left-2 z-popover px-2 py-1 shadow-marker",
    star: "absolute top-2 right-2 z-popover",
    meta: "flex items-baseline gap-2 px-1 pt-2",
    // The name is the card's press for the keys and a screen reader; a
    // pointer can press anywhere on the card.
    name: [
      "h-auto min-h-0 min-w-0 flex-1 justify-start overflow-hidden rounded-control p-0",
      "font-display text-prose font-semibold tracking-normal text-ink normal-case",
      "not-disabled:hover:bg-transparent pointer-coarse:min-h-0",
    ],
    nameText: "truncate",
    bar: "relative mx-1 mt-1.5 flex h-2.5 overflow-visible rounded-full bg-sunken inset-ring inset-ring-line",
  },
});

/** The list of pictures, read once a page; null until it is, and with none published. */
function useSpotPictures(): SpotPictures | null {
  const [pictures, setPictures] = useState<SpotPictures | null>(null);
  useEffect(() => {
    let live = true;
    void loadSpotPictures().then((p) => live && setPictures(p));
    return () => {
      live = false;
    };
  }, []);
  return pictures;
}

/** An element's size, kept current; null until it is measured. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width && height)
        setSize((s) =>
          s && s.width === width && s.height === height ? s : { width, height },
        );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * The place from above, north up, with the ride rose on it for the hour. No
 * picture published (or one that will not load): the rose on the sea's tint.
 */
export function SpotPicture({
  spot,
  hour,
  rider,
  units,
  flat = false,
  children,
}: {
  spot: Spot;
  hour: PlaceHour | null;
  rider: Rider;
  units: Units;
  /** In a card that is itself the box: no frame of its own. */
  flat?: boolean;
  children?: ReactNode;
}) {
  const s = cardStyles();
  const pictures = useSpotPictures();
  const picture = pictures ? spotPicture(pictures, spot) : null;
  const [failed, setFailed] = useState(false);
  const [ref, size] = useSize<HTMLDivElement>();
  const shown = picture && !failed ? picture : null;
  const place = size && shown ? inFrame(shown, size.width, size.height) : null;
  const short = size ? Math.min(size.width, size.height) : 0;
  // The loupe's distance, where the picture says how far that is, held to
  // a third of the frame so the place around it shows; a third of it with
  // no picture to measure against.
  const r = place
    ? Math.min(
        0.33 * short,
        roseScale(units).metres / place.metresPerScreenPixel,
      )
    : 0.33 * short;
  const loupe =
    hour && hour.windKn !== null
      ? loupeRose(rider, hour, spot.facing ?? null, units)
      : null;
  return (
    <div
      className={flat ? s.picture() : `${s.picture()} ${s.framed()}`}
      ref={ref}
    >
      {shown && (
        <img
          className={s.image()}
          src={shown.urls.high}
          width={shown.width}
          height={shown.height}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {size && (
        <Rose
          loupe={loupe}
          r={r}
          x={place ? place.x : size.width / 2}
          y={place ? place.y : size.height / 2}
        />
      )}
      {!flat && <span className={s.rule()} aria-hidden="true" />}
      {children}
    </div>
  );
}

/** The hour's stars on the picture, once it is rated; nothing until then. */
export function StarsBadge({ hour }: { hour: PlaceHour | null }) {
  if (!hour) return null;
  const stars = hour.rating ? hour.rating.stars : null;
  return (
    <Chip
      tone="glass"
      className={cardStyles().badge()}
      data-stars={stars ?? "dark"}
    >
      <StarGlyphs stars={stars} size={11} />
    </Chip>
  );
}

/** The red star a rider keeps a place with, on its picture. */
export function StarToggle({
  spot,
  on,
  onToggle,
  className,
}: {
  spot: Spot;
  on: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="raised"
      size="sm"
      icon
      pressed={on ? "worded" : false}
      className={className ?? cardStyles().star()}
      aria-label={`Star ${spot.name}`}
      title={on ? "Starred" : "Star"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
        <path
          className={on ? "fill-pen stroke-pen" : "fill-none stroke-pen"}
          d="M8 1.3 L10 6.1 L15.1 6.5 L11.2 9.8 L12.5 14.8 L8 12.1 L3.6 14.9 L4.8 9.9 L0.9 6.6 L6 6.1 Z"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </svg>
    </Button>
  );
}

/** "SW 16 g22": the wind as an arrow blowing downwind, in the rider's units. */
export function WindReading({
  hour,
  facing,
  units,
}: {
  hour: PlaceHour | null;
  facing: number | null;
  units: Units;
}) {
  if (!hour || hour.windKn === null) return null;
  const { windKn, gustKn, from } = hour;
  const force = isForce(units);
  const gust =
    gustKn !== null &&
    gustKn > windKn &&
    !(force && beaufort(gustKn) <= beaufort(windKn))
      ? gustKn
      : null;
  const off =
    from !== null && facing !== null
      ? ["offshore", "cross-off"].includes(shoreAngle(from, facing))
      : false;
  const words = `${from === null ? "" : `${compass(from)} `}${speedWords(windKn, units)}${
    gust === null ? "" : `, gusts ${speedWords(gust, units)}`
  }`;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono text-body font-semibold whitespace-nowrap text-ink"
      role="img"
      aria-label={words}
      data-wind
    >
      {from !== null && (
        <svg width={13} height={13} viewBox="-7 -7 14 14" aria-hidden="true">
          <g transform={`rotate(${Math.round(from + 180)})`}>
            <path
              className={off ? "fill-none stroke-pen" : "fill-none stroke-ink"}
              d="M0 5.5V-5.2M-3 -1.8L0 -5.6L3 -1.8"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      )}
      {force ? (
        <BeaufortGlyph force={beaufort(windKn)} size={14} label="" />
      ) : (
        speedShort(windKn, units)
      )}
      {gust !== null && (
        <small className="text-caption font-medium text-ink-muted">
          g
          {force ? (
            <BeaufortGlyph force={beaufort(gust)} size={10} label="" />
          ) : (
            speedShort(gust, units)
          )}
        </small>
      )}
    </span>
  );
}

/** The chosen day's wind at the place, hour by hour, the chosen hour marked. */
export function DayBar({
  day,
  row,
  selected,
  className,
}: {
  day: readonly TimelineHour[];
  row: readonly PlaceHour[] | undefined;
  selected: number;
  className?: string;
}) {
  const s = cardStyles();
  const width = day.reduce((sum, h) => sum + h.span, 0);
  let run = 0;
  let mark: number | null = null;
  for (const h of day) {
    if (h.at === selected) mark = (run + h.span / 2) / width;
    run += h.span;
  }
  return (
    <div className={s.bar({ className })} aria-hidden="true" data-day-bar>
      {day.map((h, i) => {
        const kn = row?.[h.at]?.windKn ?? null;
        return (
          <i
            key={h.at}
            className={`block h-full ${i === 0 ? "rounded-l-full" : ""} ${i === day.length - 1 ? "rounded-r-full" : ""}`}
            style={{
              flexGrow: h.span,
              background: kn === null ? undefined : windCss(kn),
            }}
          />
        );
      })}
      {mark !== null && (
        <span
          className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-pen"
          style={{ left: `${mark * 100}%` }}
          data-day-mark
        />
      )}
    </div>
  );
}

/** A card on the list. */
export function SpotCard({
  spot,
  hour,
  row,
  day,
  selected,
  rider,
  units,
  starred,
  lit,
  onToggleStar,
  onOpen,
  onHover,
}: {
  spot: Spot;
  hour: PlaceHour | null;
  row: readonly PlaceHour[] | undefined;
  day: readonly TimelineHour[];
  selected: number;
  rider: Rider;
  units: Units;
  starred: boolean;
  /** Its pin is under the pointer. */
  lit: boolean;
  onToggleStar: () => void;
  onOpen: () => void;
  onHover: (on: boolean) => void;
}) {
  const s = cardStyles();
  return (
    <article
      className={s.card()}
      data-spot-card={spot.id}
      data-lit={lit || undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover(false)}
      onClick={(e) => {
        if (!(e.target as Element).closest("button, a")) onOpen();
      }}
    >
      <SpotPicture spot={spot} hour={hour} rider={rider} units={units}>
        <StarsBadge hour={hour} />
        <StarToggle spot={spot} on={starred} onToggle={onToggleStar} />
      </SpotPicture>
      <div className={s.meta()}>
        <h3 className="m-0 flex min-w-0 flex-1">
          <Button variant="quiet" className={s.name()} onClick={onOpen}>
            <span className={s.nameText()}>{spot.name}</span>
          </Button>
        </h3>
        <WindReading hour={hour} facing={spot.facing ?? null} units={units} />
      </div>
      <DayBar day={day} row={row} selected={selected} />
    </article>
  );
}
