/**
 * A place on the spot finder: its name, how far it is and its county on one
 * line with the star a rider keeps it by; under them its picture from above,
 * the card's width, with the ride rose on it; then today (or the day
 * chosen), hour by hour (src/finder/DayHours.tsx), and the other five of its
 * six days (src/finder/NextDays.tsx). The approved mock-up was
 * backlog/mockups/2026-10-25-spot-list-cards.html, its "7e"; the picture
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
import { spotHref } from "../../force5/src/siteNav";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { ChartGlyph } from "../../shared/web/ChartGlyph";
import { waves as wavesGlyph } from "../../shared/web/glyphSet";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Skeleton } from "../../ui/Skeleton";
import { MONO_LABEL, tv } from "../../ui/tv";
import {
  inFrame,
  loadSpotPictures,
  spotPicture,
  type SpotPictures,
} from "../../spot/web/satellite";
import type { PlaceHour } from "../ratings";
import { clock, type StripColumn } from "../strip";
import WeatherGlyph from "../WeatherGlyph";
import { DayHours } from "./DayHours";
import {
  middayColumn,
  type DayPlan,
  type DayRow,
  type WeekBest,
} from "./finder";
import { NextDays } from "./NextDays";
import { Rose } from "./Rose";
import type { Readings } from "./useReadings";

export const cardStyles = tv({
  slots: {
    // A box on the page: the ink rule, its hairline, a card's contact
    // shadow; lifted a little under the pointer.
    card: [
      "group/card relative flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-surface border border-ink bg-card px-3 pt-2.5 pb-3 inset-shadow-frame shadow-card",
      "transition duration-fast motion-reduce:transition-none",
      "hover:-translate-y-px hover:shadow-float",
    ],
    head: "flex items-center gap-2",
    // The picture is the chart's press: the card's width, under the name.
    pictureButton: [
      "group/pic relative block h-auto w-full overflow-visible rounded-control border-0 p-0",
      "not-disabled:hover:bg-transparent pointer-coarse:min-h-0",
    ],
    picture: "relative aspect-2/1 overflow-hidden bg-sea-1 wide:aspect-5/2",
    framed:
      "rounded-control border border-ink group-hover/pic:outline-2 group-hover/pic:outline-offset-1 group-hover/pic:outline-ink",
    image: "absolute inset-0 block size-full object-cover",
    go: "pointer-events-none absolute bottom-1 left-1 px-1.5 py-0 text-eyebrow uppercase opacity-0 transition-opacity duration-fast group-hover/pic:opacity-100",
    at: "pointer-events-none absolute right-1 bottom-1 px-1.5 py-0 text-eyebrow font-semibold",
    // The name and where it is, on one line: the name gives way first.
    names: "flex min-w-0 flex-1 items-baseline gap-2",
    name: "m-0 min-w-0 truncate font-display text-lead text-ink",
    nameLink:
      "rounded-control text-ink no-underline not-disabled:hover:text-chart-magenta",
    meta: "shrink-0 font-mono text-caption whitespace-nowrap text-ink-muted",
    star: "self-start",
    section: "flex flex-col gap-1",
    heading: [
      "flex items-center justify-between gap-x-2 gap-y-0.5",
      "max-wide:flex-wrap",
    ],
    kicker: [MONO_LABEL, "font-semibold text-ink"],
    // As tall as the sky's glyph before it comes, so the hours under the
    // line do not move down when it does.
    facts: [
      "flex min-h-5 items-center gap-x-2.5 gap-y-0.5 font-mono text-caption text-ink-2",
      "max-wide:flex-wrap",
    ],
    fact: "inline-flex items-center gap-1 whitespace-nowrap",
    // A card while the places are read: the shapes of its parts, each the
    // height the card's own will be, so nothing moves when it lands.
    ghostPicture: "aspect-2/1 min-h-0 w-full wide:aspect-5/2",
    ghostName: "h-4 w-40 max-w-full",
    ghostWords: "m-0 font-body text-prose text-ink-muted italic",
    ghostMeta: "w-24",
    // The star's room, as the star button stands (a touch's size under a finger).
    ghostStar: "size-control-sm shrink-0 pointer-coarse:size-touch",
    ghostFacts: "h-5 w-32",
    ghostHours: "mb-1 min-h-25",
    ghostDays: "min-h-32.75",
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
      variant="raised"
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

/**
 * The day's line over its hours: the sky and the air, and the sea. A reading
 * the place has none of is left out, not written as a blank. (High and low
 * water and first and last light were taken off the card on the owner's
 * ruling of 2026-10-28: the dark at either end of the hours says the light.)
 */
function DayFacts({
  day: today,
  readings,
  strip,
  now,
}: {
  day: DayRow;
  readings: Readings;
  strip: readonly StripColumn[];
  now: number;
}) {
  const s = cardStyles();
  const lit = today.hours.flatMap((h) =>
    h.at !== null && !h.dark ? [h.at] : [],
  );
  const at = middayColumn(strip, lit, now);
  const sky = at === null ? null : (readings.sky[at] ?? null);
  const air = at === null ? null : (readings.air[at] ?? null);
  const sea = at === null ? null : (readings.sea[at] ?? null);
  return (
    <span className={s.facts()} data-day-facts>
      {(sky || air !== null) && (
        <span className={s.fact()} data-air>
          {sky && <WeatherGlyph weather={sky} size={15} />}
          {air !== null && `${Math.round(air)}°`}
        </span>
      )}
      {sea && (
        <span className={s.fact()} data-sea>
          <ChartGlyph glyph={wavesGlyph} size={13} className="text-depth" />
          {sea.height.toFixed(1)} m
          {sea.period !== null && ` · ${Math.round(sea.period)} s`}
        </span>
      )}
    </span>
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
    strip,
    day,
    dayName,
    isToday,
    days,
    readings,
    picked,
    shown,
    roseAt,
    now,
    rider,
    units,
    starred,
    phone,
    reducedMotion,
    onToggleStar,
    onPick,
    onChooseDay,
    onChart,
    order,
    best,
  } = props;
  const s = cardStyles();
  const [next, nextSize] = useSize<HTMLElement>();
  const href = spotHref(spot.id);
  const where = [
    km === null ? null : km < 0.5 ? "under 1 km" : `${Math.round(km)} km`,
    spot.county ? `Co. ${spot.county}` : null,
  ]
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
        if ((event.target as Element).closest("button, a")) return;
        // A press that was a drag across today's hours is not a press.
        if (window.getSelection()?.toString()) return;
        window.location.assign(href);
      }}
    >
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
          <Chip tone="glass" className={s.go()} aria-hidden="true">
            Chart
          </Chip>
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
      {day && (
        <section
          className={s.section()}
          aria-label={dayName.long}
          aria-busy={row === undefined || undefined}
          data-day-shown={day.date}
        >
          <div className={s.heading()}>
            <span className={s.kicker()} data-day-name>
              {dayName.short}
            </span>
            <DayFacts day={day} readings={readings} strip={strip} now={now} />
          </div>
          <DayHours
            row={row}
            day={day}
            name={dayName.long}
            readings={readings}
            facing={spot.facing ?? null}
            shown={shown}
            units={units}
            phone={phone}
            reducedMotion={reducedMotion}
            onPick={onPick}
            order={order}
            hoverKey={spot.id}
          />
        </section>
      )}
      {/* The six days but the one above, today among them when another is
        chosen: "Other days" to a screen reader, and no heading on the card,
        where it is plain what they are. */}
      <section
        className={s.section()}
        aria-label="Other days"
        aria-busy={row === undefined || undefined}
        ref={next}
      >
        <NextDays
          row={row}
          strip={strip}
          plans={days}
          readings={readings}
          facing={spot.facing ?? null}
          units={units}
          now={now}
          width={nextSize?.width ?? null}
          onChoose={onChooseDay}
          hoverKey={`${spot.id}/days`}
        />
      </section>
    </article>
  );
}

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
      <Skeleton shape="block" className={s.ghostPicture()} />
      <div className={s.section()}>
        <div className={s.heading()}>
          <span className={s.kicker()}>Today</span>
          <Skeleton className={s.ghostFacts()} />
        </div>
        <Skeleton shape="block" className={s.ghostHours()} />
      </div>
      <div className={s.section()}>
        <Skeleton shape="block" className={s.ghostDays()} />
      </div>
    </div>
  );
}
