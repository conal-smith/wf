/**
 * A place on the spot finder: its name, how far it is and its county on one
 * line with the star a rider keeps it by; under them its picture from above,
 * the card's width, with the ride rose on it; then today (or the day
 * chosen), hour by hour (src/finder/DayHours.tsx), and the other five of its
 * six days (src/finder/NextDays.tsx). The approved mock-up was
 * the spot list cards mock-up, its "7e"; the picture
 * went to the card's width, and the name over it, on the owner's ruling of
 * 2026-10-28 (it was too small to read the place from).
 *
 * Pressing the picture opens the chart at the place, at the hour the rose on
 * it shows; pressing anywhere else on the card opens the place's own page.
 *
 * The picture is the spot page's own, cut from the chart's satellite
 * composites (spot/web/satellite.ts), loaded lazily as the card scrolls in;
 * the rose is the loupe's (force5/src/focus.ts), at the loupe's distance,
 * for the hour picked on the day's row, or the hour the day stands at.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loupeRose, roseScale } from "../../force5/src/focus";
import { speedShort } from "../../force5/src/units";
import { windCss } from "../../force5/src/windCss";
import { spotHref } from "../../force5/src/siteNav";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Skeleton } from "../../ui/Skeleton";
import { tv } from "../../ui/tv";
import {
  inFrame,
  lift,
  loadSpotPictures,
  spotPicture,
  type SpotPictures,
} from "../../spot/web/satellite";
import type { PlaceHour } from "../ratings";
import { clock, type StripColumn } from "../strip";
import { type DayPlan, type DayRow, type WeekBest } from "./finder";
import { Rose } from "./Rose";
import type { Readings } from "./useReadings";

export const cardStyles = tv({
  slots: {
    // A row on a quiet card (the Spot finder mock-up, 2026-10-31): the
    // picture small and square, so the 10 m satellite stays sharp, beside the
    // name and today's wind and stars as two gradients.
    card: [
      "group/card relative grid min-w-0 cursor-pointer grid-cols-card gap-x-3.5 rounded-surface bg-sunken p-2.5",
      "transition duration-fast motion-reduce:transition-none hover:inset-shadow-frame",
    ],
    pictureButton: [
      "group/pic relative block h-auto w-full self-start overflow-visible rounded-control border-0 p-0",
      "not-disabled:hover:bg-transparent pointer-coarse:min-h-0",
    ],
    picture: "relative aspect-square overflow-hidden rounded-control bg-sea-1",
    framed:
      "rounded-control group-hover/pic:outline-2 group-hover/pic:outline-offset-1 group-hover/pic:outline-ink",
    image: "absolute inset-0 block size-full object-cover",
    go: "pointer-events-none absolute bottom-1 left-1 px-1.5 py-0 text-eyebrow opacity-0 transition-opacity duration-fast group-hover/pic:opacity-100",
    at: "pointer-events-none absolute right-1 bottom-1 px-1.5 py-0 text-eyebrow font-semibold",
    km: "pointer-events-none absolute top-1.5 left-1.5 px-1.5 py-0 text-eyebrow font-semibold",
    body: "flex min-w-0 flex-col gap-2",
    head: "flex items-center gap-2",
    names: "flex min-w-0 flex-1 flex-col",
    name: "m-0 min-w-0 truncate font-body text-prose font-semibold text-ink",
    nameLink:
      "rounded-control text-ink no-underline not-disabled:hover:text-chart-magenta",
    meta: "truncate font-body text-body text-ink-muted",
    star: "self-start",
    bars: "grid grid-cols-bars items-center gap-x-1.5 gap-y-1",
    barName: "font-body text-caption font-medium text-ink-muted",
    bar: "relative h-2.5 cursor-pointer rounded-full",
    windBar: "h-4.5",
    barNum:
      "pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-body text-caption font-semibold text-photo-shade",
    tick: "pointer-events-none absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-pen",
    hours: "relative h-3.5 font-body text-caption text-ink-muted",
    hour: "absolute -translate-x-1/2",
    // A card while the places are read: the shapes of its parts, each the
    // size the card's own will be, so nothing moves when it lands.
    ghostPicture: "aspect-square min-h-0 w-full",
    ghostName: "h-4 w-40 max-w-full",
    ghostWords: "m-0 font-body text-prose text-ink-muted italic",
    ghostMeta: "w-24",
    ghostStar: "size-control-sm shrink-0 pointer-coarse:size-touch",
    ghostBar: "h-4.5 min-h-0 w-full rounded-full",
    ghostThin: "h-2.5 min-h-0 w-full rounded-full",
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
export function useSize<T extends HTMLElement>() {
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
  className,
  children,
}: {
  spot: Spot;
  hour: PlaceHour | null;
  rider: Rider;
  units: Units;
  className?: string;
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
      className={s.picture({ className })}
      ref={ref}
      data-spot-picture
      data-rose-from={loupe ? Math.round(loupe.rose.windFrom) : undefined}
    >
      {shown && (
        <img
          className={s.image({ className: lift(shown) })}
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
      {children}
    </div>
  );
}

/** The red star a rider keeps a place with. */
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
      variant="outline"
      size="sm"
      icon
      pressed={on ? "worded" : false}
      className={className}
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

export interface SpotCardProps {
  spot: Spot;
  km: number | null;
  row: readonly PlaceHour[] | undefined;
  strip: readonly StripColumn[];
  /** The day drawn hour by hour: today, or the one chosen. */
  day: DayRow | null;
  /** The day, as its heading says it ("Today", "Tue 28") and said in full. */
  dayName: { short: string; long: string };
  /** Whether the day is today (not one chosen). */
  isToday: boolean;
  /** The other five of the six days. */
  days: readonly (DayPlan | null)[];
  readings: Readings;
  /** The hour picked on the day's row, or null for the hour it stands at. */
  picked: number | null;
  /** The hour ringed on the day's row: the one picked, or the one it stands at. */
  shown: number;
  /** The strip's column the picture's rose is for, or null with none. */
  roseAt: number | null;
  now: number;
  rider: Rider;
  units: Units;
  starred: boolean;
  phone: boolean;
  reducedMotion: boolean;
  onToggleStar: () => void;
  onPick: (time: number) => void;
  /** Show a day hour by hour, on every card. */
  onChooseDay: (date: string) => void;
  /** The chart, at this place, at the hour the rose shows. */
  onChart: () => void;
  /** Its place in the list. */
  order: number;
  /** Its best of the six days, which put it there. */
  best: WeekBest;
}

/** A card on the list. */
export function SpotCard(props: SpotCardProps) {
  const {
    spot,
    km,
    row,
    day,
    isToday,
    picked,
    shown,
    roseAt,
    rider,
    units,
    starred,
    onToggleStar,
    onPick,
    onChart,
    best,
  } = props;
  const s = cardStyles();
  const href = spotHref(spot.id);
  const where = [spot.county ? `Co. ${spot.county}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className={s.card()}
      data-spot-card={spot.id}
      data-best={best.stars}
      data-best-day={best.day ?? undefined}
      aria-label={spot.name}
      onClick={(event) => {
        if ((event.target as Element).closest("button, a, [data-bar]")) return;
        window.location.assign(href);
      }}
    >
      <Button
        variant="quiet"
        className={s.pictureButton()}
        aria-label={`${spot.name} on the chart`}
        onClick={(event) => {
          event.stopPropagation();
          onChart();
        }}
        data-to-chart
      >
        <SpotPicture
          spot={spot}
          hour={roseAt === null ? null : (row?.[roseAt] ?? null)}
          rider={rider}
          units={units}
          className={s.framed()}
        >
          {km !== null && (
            <Chip tone="glass" className={s.km()} data-km>
              {km < 0.5 ? "<1 km" : `${Math.round(km)} km`}
            </Chip>
          )}
          {(picked !== null || !isToday) && (
            <Chip
              tone="glass"
              className={s.at()}
              data-picked-hour={picked !== null || undefined}
              data-rose-hour
            >
              {clock(shown)}
            </Chip>
          )}
        </SpotPicture>
      </Button>
      <div className={s.body()}>
        <div className={s.head()}>
          <div className={s.names()}>
            <h3 className={s.name()}>
              <a className={s.nameLink()} href={href}>
                {spot.name}
              </a>
            </h3>
            {where && <span className={s.meta()}>{where}</span>}
          </div>
          <StarToggle
            spot={spot}
            on={starred}
            onToggle={onToggleStar}
            className={s.star()}
          />
        </div>
        {day && (
          <DayBars
            day={day}
            row={row}
            shown={shown}
            units={units}
            onPick={onPick}
          />
        )}
      </div>
    </article>
  );
}

const STARS_CSS = [
  "var(--color-line)",
  "var(--color-stars-1)",
  "var(--color-stars-2)",
  "var(--color-stars-3)",
  "var(--color-stars-4)",
  "var(--color-stars-5)",
];

/**
 * Today's hours, first light to last, as two gradients: the wind in its own
 * colours with its speed every three hours, and the stars in theirs. A red
 * tick marks the hour shown; a press on either picks the hour under it, on
 * every card (as the old card's hours did).
 */
function DayBars({
  day,
  row,
  shown,
  units,
  onPick,
}: {
  day: DayRow;
  row: readonly PlaceHour[] | undefined;
  shown: number;
  units: Units;
  onPick: (time: number) => void;
}) {
  const s = cardStyles();
  const hours = day.hours;
  if (!hours.length) return null;
  const n = hours.length;
  const pos = (i: number) => `${(((i + 0.5) / n) * 100).toFixed(1)}%`;
  const at = (i: number) => {
    const k = hours[i].at;
    return k === null ? null : (row?.[k] ?? null);
  };
  const wind = `linear-gradient(90deg, ${hours
    .map((_, i) => {
      const h = at(i);
      return `${h?.windKn == null ? "var(--color-line)" : windCss(h.windKn)} ${pos(i)}`;
    })
    .join(", ")})`;
  const stars = `linear-gradient(90deg, ${hours
    .map((_, i) => `${STARS_CSS[at(i)?.rating?.stars ?? 0]} ${pos(i)}`)
    .join(", ")})`;
  const shownAt = hours.findIndex(
    (h, i) => h.time <= shown && (hours[i + 1]?.time ?? Infinity) > shown,
  );
  const pick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.min(
      n - 1,
      Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * n)),
    );
    onPick(hours[i].time);
  };
  const tick =
    shownAt < 0 ? null : (
      <i className={s.tick()} style={{ left: pos(shownAt) }} data-shown-tick />
    );
  return (
    <div
      className={s.bars()}
      aria-busy={row === undefined || undefined}
      data-day-bars={day.date}
    >
      <span className={s.barName()}>Wind</span>
      <div
        className={s.bar({ className: s.windBar() })}
        style={{ background: wind }}
        onClick={pick}
        data-bar="wind"
      >
        {hours.map((h, i) => {
          const p = at(i);
          return hourOfDay(h.time) % 3 === 0 && p?.windKn != null ? (
            <b key={h.time} className={s.barNum()} style={{ left: pos(i) }}>
              {speedShort(p.windKn, units)}
            </b>
          ) : null;
        })}
        {tick}
      </div>
      <span className={s.barName()}>Stars</span>
      <div
        className={s.bar()}
        style={{ background: stars }}
        onClick={pick}
        data-bar="stars"
      >
        {tick}
      </div>
      <span />
      <div className={s.hours()} aria-hidden="true">
        {hours.map((h, i) =>
          hourOfDay(h.time) % 3 === 0 ? (
            <span key={h.time} className={s.hour()} style={{ left: pos(i) }}>
              {clock(h.time).slice(0, 2)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** The Irish hour of a moment, 0 to 23. */
const hourOfDay = (time: number) => Number(clock(time).slice(0, 2));

/**
 * A card's shape while the places themselves are read, with what is loading
 * said on the first (`words`). It is hidden from a screen reader: the list
 * that holds it says it is busy.
 */
export function CardSkeleton({ words }: { words?: string }) {
  const s = cardStyles();
  return (
    <div
      className={s.card({ className: "cursor-default" })}
      aria-hidden="true"
      data-card-skeleton
    >
      <Skeleton shape="block" className={s.ghostPicture()} />
      <div className={s.body()}>
        <div className={s.head()}>
          <div className={s.names()}>
            {words ? (
              <p className={s.ghostWords()}>{words}</p>
            ) : (
              <Skeleton className={s.ghostName()} />
            )}
            <Skeleton className={s.ghostMeta()} />
          </div>
          <Skeleton shape="circle" className={s.ghostStar()} />
        </div>
        <div className={s.bars()}>
          <span className={s.barName()}>Wind</span>
          <Skeleton shape="block" className={s.ghostBar()} />
          <span className={s.barName()}>Stars</span>
          <Skeleton shape="block" className={s.ghostThin()} />
          <span />
          <div className={s.hours()} />
        </div>
      </div>
    </div>
  );
}
