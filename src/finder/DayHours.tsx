/**
 * A day on a card (today, or the day chosen from the next ones), an hour a
 * column (a step of the run's, a few days out), from the hour before first
 * light to the hour after last light: the hour ("now" for this one, in the pen's red),
 * the sky, the wind and its gust, the wind's arrow (red where it blows off
 * the beach), and the hour's five stars, the earned ones in the stars' own
 * colours. Behind the columns, faintly, the day's wind as a band in the
 * chart's colours for knots, the gusts paler over it, at the row's own
 * height. The hours gone are faded; the dark at either end is shaded, and
 * first and last light are named under it, with high and low water under
 * the hour each falls in. First and last light keep to the row's view as it
 * scrolls, rather than being cut by its edge.
 *
 * The row is wider than the card: it scrolls sideways, with no bar, and
 * opens with the hour shown (now, or the day's early afternoon, until one is
 * picked) in its middle. Its edges fade where there is more, with a ‹ and a
 * › to step through it. Pressing an hour picks it for every card at once
 * (src/finder/finder.ts `pickHour`); pressing the hour the day stands at
 * goes back. A mouse over the row draws a dotted line at its time on every
 * card's row, and writes the time beside it here (src/finder/hover.ts).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { Units } from "../../force5/src/units";
import { speedWords } from "../../force5/src/units";
import { compass } from "../../force5/src/weather";
import { Button } from "../../ui/Button";
import { StarGlyphs, starsLabel } from "../../ui/StarGlyphs";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import { clock, hourLabel } from "../strip";
import WeatherGlyph from "../WeatherGlyph";
import { windBand } from "./band";
import {
  centredScroll,
  hourOf,
  rowEnds,
  rowPosition,
  rowTime,
  starsAt,
  steppedScroll,
  type DayRow,
} from "./finder";
import { hovers, useHover, useHoverLine } from "./hover";
import { ShoreArrow, Speed, TideMark, gustShown } from "./marks";
import type { Readings } from "./useReadings";

/** An hour's width, on a desktop and on a phone. */
const COLUMN = { wide: 54, phone: 50 };
/** The columns' height, which the band behind them shares. */
const ROW_HEIGHT = 100;
/** The ‹ and ›: a small control's height (ui/theme.css `control-sm`). */
const NAV = 30;

const styles = tv({
  slots: {
    root: "relative",
    scroller:
      "scrollbar-none -mx-0.5 overflow-x-auto overscroll-x-contain px-0.5 pb-8",
    track: "relative flex",
    band: "pointer-events-none absolute top-0 left-0 opacity-40",
    dark: "pointer-events-none absolute top-0 hatch rounded-control bg-ink/7",
    hour: [
      "relative z-popover h-25 shrink-0 flex-col items-center justify-start gap-0.5 rounded-control border-0 px-0.5 pt-1 pb-1.5",
      "font-mono tracking-normal text-ink normal-case",
      "not-disabled:hover:bg-sunken/70",
      // Between the hours, a hairline.
      "not-first-of-type:before:absolute not-first-of-type:before:top-1.5 not-first-of-type:before:bottom-2 not-first-of-type:before:left-0 not-first-of-type:before:border-l not-first-of-type:before:border-line/40",
    ],
    shown: "inset-ring-2 inset-ring-ink",
    label: "text-eyebrow text-ink-muted",
    nowLabel: "text-eyebrow font-semibold text-pen-ink",
    nowTick:
      "absolute top-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-pen",
    sky: "flex h-4 items-center justify-center",
    knots: "text-body leading-none font-semibold",
    gust: "h-3.5 text-eyebrow leading-none text-ink-muted",
    // Where there is no gust worth a figure, its room stays.
    stars: "mt-auto flex h-2.5 items-center",
    faded: "opacity-45",
    off: "opacity-35",
    tide: "pointer-events-none absolute flex -translate-x-1/2 items-center gap-0.5 font-mono text-eyebrow whitespace-nowrap text-ink-2",
    // First and last light, under the row from one to the other: each holds
    // to the view's edge as the row scrolls, not cut off by it.
    lights:
      "pointer-events-none absolute flex justify-between gap-3 font-mono text-eyebrow whitespace-nowrap text-ink-muted",
    light: "sticky",
    // The time under a mouse, a dotted line on every card's row; the time
    // written beside it on the row the mouse is over.
    hoverLine:
      "pointer-events-none absolute top-0 left-0 z-panel w-0 border-0 border-l border-dotted border-ink",
    hoverTime:
      "absolute top-0 left-1 rounded-control bg-inverse px-1 font-mono text-eyebrow leading-4 whitespace-nowrap text-ink-inverse",
    fade: "pointer-events-none absolute top-0 z-panel w-8.5 from-card to-transparent transition-opacity duration-fast",
    // Stood by its top, not pulled up by half: a pressed control nudges down
    // with a translate of its own, which would otherwise undo the other.
    // On a touch screen the row is swiped, and the steps stay small over
    // it: the press reaches past the drawn button to a touch's size.
    nav: [
      "absolute z-panel shadow-marker",
      "pointer-coarse:min-h-0 pointer-coarse:min-w-0 pointer-coarse:before:absolute pointer-coarse:before:-inset-2",
    ],
  },
});

/** "14:00, SW 19 knots, gusts 39, 4 of 5 stars": an hour, said. */
function hourWords(
  time: number,
  hour: PlaceHour | null,
  units: Units,
  isNow: boolean,
): string {
  const parts = [isNow ? `Now, ${clock(time)}` : clock(time)];
  if (hour?.windKn != null) {
    const gust = gustShown(hour.windKn, hour.gustKn, units);
    parts.push(
      `${hour.from === null ? "" : `${compass(hour.from)} `}${speedWords(hour.windKn, units)}${
        gust === null ? "" : `, gusts ${speedWords(gust, units)}`
      }`,
    );
  }
  if (hour?.rating) parts.push(starsLabel(hour.rating.stars));
  return parts.join(", ");
}

export function DayHours({
  row,
  day,
  name,
  readings,
  facing,
  shown,
  units,
  phone,
  reducedMotion,
  onPick,
  order,
  hoverKey,
}: {
  row: readonly PlaceHour[] | undefined;
  day: DayRow;
  /** The day, said: "Today", "Tuesday". */
  name: string;
  readings: Readings;
  facing: number | null;
  /** The hour ringed: the one picked, or the hour the day stands at. */
  shown: number;
  units: Units;
  phone: boolean;
  reducedMotion: boolean;
  onPick: (time: number) => void;
  /** The card's place in the list, which moves it in the page. */
  order: number;
  /** The row's own key for the time hovered (its card's). */
  hoverKey: string;
}) {
  const s = styles();
  const id = useId().replace(/[^\w-]/g, "");
  const { hours, firstLight, lastLight } = day;
  const times = useMemo(() => hours.map((h) => h.time), [hours]);
  // The room the row has, measured: a short October day on a wide card
  // spreads its hours across it rather than stopping short of the edge.
  const [view, setView] = useState(0);
  const cw = Math.max(
    phone ? COLUMN.phone : COLUMN.wide,
    Math.floor(view / hours.length),
  );
  const from = hours[0].time;
  const width = hours.length * cw;
  // Where a time stands along the row: an hour's middle at its column's.
  const x = (time: number) => rowPosition(times, time) * cw + cw / 2;

  // The wind behind the hours: each hour the forecast has, at its middle,
  // out to the edges of the first and last of them and no further (an hour
  // the forecast has nothing for has no wind to draw).
  const band = useMemo(() => {
    const points = hours.flatMap((h) => {
      const hour = h.at === null ? null : row?.[h.at];
      return hour?.windKn != null
        ? [{ x: x(h.time), mean: hour.windKn, gust: hour.gustKn }]
        : [];
    });
    if (!points.length) return null;
    return windBand(points, {
      x0: Math.max(0, points[0].x - cw / 2),
      x1: Math.min(width, points[points.length - 1].x + cw / 2),
      top: 10,
      base: ROW_HEIGHT - 2,
    });
  }, [row, hours, width, cw]);

  // High and low water, under the hour each falls in.
  const tides = useMemo(
    () =>
      readings.tides.flatMap((event) => {
        const time = Date.parse(event.time);
        const at = Math.floor(rowPosition(times, time));
        return at >= 0 && at < hours.length
          ? [{ time, high: event.kind === "high", at }]
          : [];
      }),
    [readings.tides, times],
  );

  /* ---- the scroll ---- */
  const scroller = useRef<HTMLDivElement>(null);
  // Where the row was left: a card moved up or down the list as the stars
  // come in is taken out of the page and put back, which loses its scroll.
  const left = useRef(0);
  const [ends, setEnds] = useState({ before: false, after: true });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    left.current = el.scrollLeft;
    setView(el.clientWidth);
    setEnds(rowEnds(el.scrollLeft, el.clientWidth, el.scrollWidth));
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && Math.abs(el.scrollLeft - left.current) > 1)
      el.scrollLeft = left.current;
  }, [order]);
  const centre = (smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    const index = Math.max(
      0,
      Math.min(hours.length - 1, Math.round(rowPosition(times, hourOf(shown)))),
    );
    const to = centredScroll(index * cw, cw, el.clientWidth, el.scrollWidth);
    // A smooth scroll says where it has got to as it goes (`measure`).
    if (smooth && !reducedMotion) {
      el.scrollTo({ left: to, behavior: "smooth" });
      return;
    }
    el.scrollLeft = to;
    left.current = to;
    setEnds(rowEnds(to, el.clientWidth, el.scrollWidth));
  };
  // Open with the hour shown in the middle, before the first paint, at the
  // width the row has.
  useLayoutEffect(() => {
    if (scroller.current) setView(scroller.current.clientWidth);
  }, []);
  const opened = useRef(false);
  useLayoutEffect(() => {
    centre(opened.current);
    opened.current = true;
  }, [shown, cw, from]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const step = (direction: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({
      left: steppedScroll(
        el.scrollLeft,
        direction,
        el.clientWidth,
        el.scrollWidth,
      ),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const darkBefore = Math.max(0, x(firstLight));
  const darkAfter = Math.min(width, x(lastLight));

  /* ---- the time under a mouse ---- */
  const hover = useHover();
  const line = useRef<HTMLSpanElement>(null);
  const tag = useRef<HTMLSpanElement>(null);
  useHoverLine((at) => {
    const el = line.current;
    const label = tag.current;
    if (!el || !label) return;
    const position = at ? rowPosition(times, at.time) : NaN;
    // Not on this row: another day's, or past its ends.
    if (!(position >= -0.5 && position <= hours.length - 0.5)) {
      el.hidden = true;
      return;
    }
    const left = position * cw + cw / 2;
    el.hidden = false;
    el.style.transform = `translateX(${left.toFixed(1)}px)`;
    label.hidden = at!.over !== hoverKey;
    label.textContent = clock(at!.time);
    // Beside the line, on whichever side has the room.
    label.style.translate = left > width - 48 ? "calc(-100% - 8px) 0" : "";
  });
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    if (!hover || !hovers(event)) return;
    const box = event.currentTarget.getBoundingClientRect();
    hover.set({
      time: rowTime(times, (event.clientX - box.left - cw / 2) / cw),
      over: hoverKey,
    });
  };

  return (
    <div className={s.root()} data-day-hours>
      <div
        ref={scroller}
        className={s.scroller()}
        onScroll={measure}
        role="group"
        aria-label={`${name}'s hours`}
        data-hours-scroll
      >
        <div
          className={s.track()}
          style={{ width }}
          onPointerMove={follow}
          onPointerLeave={() => hover?.set(null)}
        >
          {darkBefore > 0 && (
            <span
              className={s.dark()}
              style={{ left: 0, width: darkBefore, height: ROW_HEIGHT }}
              aria-hidden="true"
            />
          )}
          {darkAfter < width && (
            <span
              className={s.dark()}
              style={{
                left: darkAfter,
                width: width - darkAfter,
                height: ROW_HEIGHT,
              }}
              aria-hidden="true"
            />
          )}
          {band && (
            <svg
              className={s.band()}
              width={width}
              height={ROW_HEIGHT}
              viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
              aria-hidden="true"
              data-wind-band
            >
              <defs>
                <linearGradient
                  id={`${id}m`}
                  x1={band.x0}
                  x2={band.x1}
                  gradientUnits="userSpaceOnUse"
                >
                  {band.stops.map((stop, i) => (
                    <stop key={i} offset={stop.offset} stopColor={stop.mean} />
                  ))}
                </linearGradient>
                <linearGradient
                  id={`${id}g`}
                  x1={band.x0}
                  x2={band.x1}
                  gradientUnits="userSpaceOnUse"
                >
                  {band.stops.map((stop, i) => (
                    <stop
                      key={i}
                      offset={stop.offset}
                      stopColor={stop.gust}
                      stopOpacity={0.5}
                    />
                  ))}
                </linearGradient>
              </defs>
              {band.gusts && <path d={band.gusts} fill={`url(#${id}g)`} />}
              <path d={band.area} fill={`url(#${id}m)`} />
              {band.gustLine && (
                <path
                  className="fill-none stroke-ink"
                  d={band.gustLine}
                  strokeOpacity={0.28}
                  strokeDasharray="2 2"
                />
              )}
              <path
                className="fill-none stroke-ink"
                d={band.line}
                strokeOpacity={0.7}
                strokeWidth={1.2}
              />
            </svg>
          )}
          {hours.map((h) => {
            const hour = h.at === null ? null : (row?.[h.at] ?? null);
            const sky = h.at === null ? null : readings.sky[h.at];
            const isShown = h.time === hourOf(shown);
            const gust =
              hour?.windKn != null
                ? gustShown(hour.windKn, hour.gustKn, units)
                : null;
            const fade = h.dark ? s.off() : h.gone ? s.faded() : undefined;
            return (
              <Button
                key={h.time}
                variant="quiet"
                className={s.hour({
                  className: isShown ? s.shown() : undefined,
                })}
                style={{ width: cw }}
                pressed={isShown ? "worded" : false}
                aria-label={hourWords(h.time, hour, units, h.now)}
                title={clock(h.time)}
                data-hour={h.time}
                data-now={h.now || undefined}
                data-gone={h.gone || undefined}
                data-dark={h.dark || undefined}
                data-stars={hour?.rating ? hour.rating.stars : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  onPick(h.time);
                }}
              >
                {h.now && <span className={s.nowTick()} aria-hidden="true" />}
                <span
                  className={
                    h.now ? s.nowLabel() : s.label({ className: fade })
                  }
                >
                  {h.now ? "now" : hourLabel(h.time)}
                </span>
                <span className={s.sky({ className: fade })}>
                  {sky && (
                    <WeatherGlyph
                      weather={sky}
                      size={16}
                      dark={hour ? !hour.daylight : h.dark}
                    />
                  )}
                </span>
                {hour?.windKn != null ? (
                  <>
                    <b className={s.knots({ className: fade })}>
                      <Speed knots={hour.windKn} units={units} size={14} />
                    </b>
                    <small className={s.gust({ className: fade })}>
                      {gust !== null && (
                        <>
                          g<Speed knots={gust} units={units} size={10} />
                        </>
                      )}
                    </small>
                    <span className={fade}>
                      {hour.from !== null && (
                        <ShoreArrow
                          from={hour.from}
                          facing={facing}
                          size={12}
                        />
                      )}
                    </span>
                  </>
                ) : null}
                <span className={s.stars({ className: fade })}>
                  {!h.dark && (
                    <StarGlyphs
                      stars={starsAt(hour)}
                      coloured
                      size={7.5}
                      label=""
                    />
                  )}
                </span>
              </Button>
            );
          })}
          {tides.map((tide) => (
            <span
              key={tide.time}
              className={s.tide()}
              style={{ left: tide.at * cw + cw / 2, top: ROW_HEIGHT + 2 }}
              title={`${tide.high ? "High" : "Low"} water ${clock(tide.time)}`}
              data-tide={tide.high ? "high" : "low"}
            >
              <TideMark high={tide.high} />
              {clock(tide.time)}
              <span className="sr-only">
                {tide.high ? " high water" : " low water"}
              </span>
            </span>
          ))}
          <span
            className={s.lights()}
            style={{
              left: Math.max(0, x(firstLight) + 3),
              right: Math.max(0, width - x(lastLight) + 3),
              top: ROW_HEIGHT + 16,
            }}
          >
            <span className={s.light({ className: "left-1" })} data-first-light>
              first light {clock(firstLight)}
            </span>
            <span className={s.light({ className: "right-1" })} data-last-light>
              last light {clock(lastLight)}
            </span>
          </span>
          <span
            ref={line}
            className={s.hoverLine()}
            style={{ height: ROW_HEIGHT }}
            hidden
            aria-hidden="true"
            data-hover-line
          >
            <span ref={tag} className={s.hoverTime()} hidden data-hover-time />
          </span>
        </div>
      </div>
      <span
        className={s.fade({ className: "left-0 bg-linear-to-r" })}
        style={{ height: ROW_HEIGHT, opacity: ends.before ? 1 : 0 }}
        aria-hidden="true"
      />
      <span
        className={s.fade({ className: "right-0 bg-linear-to-l" })}
        style={{ height: ROW_HEIGHT, opacity: ends.after ? 1 : 0 }}
        aria-hidden="true"
      />
      <Button
        variant="raised"
        size="sm"
        icon
        aria-label="Earlier hours"
        className={s.nav({
          className: ["-left-1", ends.before ? "" : "hidden"],
        })}
        style={{ top: ROW_HEIGHT / 2 - NAV / 2 }}
        data-hours-step="-1"
        onClick={(event) => {
          event.stopPropagation();
          step(-1);
        }}
      >
        <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <Button
        variant="raised"
        size="sm"
        icon
        aria-label="Later hours"
        className={s.nav({
          className: ["-right-1", ends.after ? "" : "hidden"],
        })}
        style={{ top: ROW_HEIGHT / 2 - NAV / 2 }}
        data-hours-step="1"
        onClick={(event) => {
          event.stopPropagation();
          step(1);
        }}
      >
        <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
      </Button>
    </div>
  );
}
