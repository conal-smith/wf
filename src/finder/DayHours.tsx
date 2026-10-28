/**
 * A day on a card (today, or the day chosen from the next ones), an hour a
 * column (a step of the run's, a few days out), from the hour before first
 * light to the hour after last light: the hour ("now" for this one, in the pen's red),
 * the sky, the wind and its gust, the wind's arrow (red where it blows off
 * the beach). Along their foot, the day's stars as one line in the stars'
 * own pinks and purples, running from hour to hour, as the other days'
 * lines do (src/finder/NextDays.tsx): the colour is the stars, at a glance.
 * Behind the columns, faintly, the day's wind as a band in the chart's
 * colours for knots, the gusts paler over it, at the row's own height. The
 * hours gone are faded; the dark at either end is shaded. (First and last
 * light, and high and low water, were named under the row until the
 * owner's ruling of 2026-10-28 took them off the card.)
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
import { Skeleton } from "../../ui/Skeleton";
import { starsLabel } from "../../ui/StarGlyphs";
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
  starColour,
  starsAt,
  steppedScroll,
  type DayRow,
} from "./finder";
import { hovers, useHover, useHoverLine } from "./hover";
import { ShoreArrow, Speed, gustShown } from "./marks";
import type { Readings } from "./useReadings";

/** An hour's width, on a desktop and on a phone. */
const COLUMN = { wide: 54, phone: 50 };
/**
 * The narrowest an hour may be drawn so the whole day fits the row: room for
 * its figures inside the column's padding. A row that would scroll by less
 * than a column is drawn this tight instead, so no first or last hour sits
 * under an edge's fade and its ‹ or ›.
 */
const TIGHT = 46;
/** The columns' height, which the band behind them shares. */
const ROW_HEIGHT = 100;
/** The ‹ and ›: a small control's height (ui/theme.css `control-sm`). */
const NAV = 30;
/** The stars' line along the foot of the hours: its thickness, and its room under it. */
const STARS_LINE = 5;
const STARS_BELOW = 4;

const styles = tv({
  slots: {
    root: "relative",
    scroller:
      "scrollbar-none -mx-0.5 overflow-x-auto overscroll-x-contain px-0.5 pb-1",
    track: "relative flex",
    band: "pointer-events-none absolute top-0 left-0 opacity-40",
    dark: "pointer-events-none absolute top-0 hatch rounded-control bg-ink/7",
    // Over the band where the hours are gone or dark: it pales the wind's
    // colours there, so the figures over them keep their contrast (4.5:1 in
    // ink-2 over any wind) rather than being faded with them.
    veil: "pointer-events-none absolute top-0 bg-card/50",
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
    // Ink over the band: 10px over a wind's colour at 40% is under 4.5:1 in
    // anything lighter (ink-muted came to 3.7:1 over 9 kn's blue).
    gust: "h-3.5 text-eyebrow leading-none text-ink",
    // A gone or dark hour's figures and hour: a step lighter, over the veil,
    // never faded by opacity (that took a gust to 1.7:1).
    dim: "text-ink-2",
    // While the hour's wind is being worked out: the shapes of its figures.
    pending: "h-2.5 w-5",
    pendingGust: "h-2 w-4",
    // What the shapes are waiting for, said once over the row's middle: it
    // takes no room, so nothing moves when it goes.
    pendingWords: [
      "pointer-events-none absolute inset-x-0 z-panel flex justify-center",
      "font-body text-caption text-ink-muted italic",
    ],
    pendingTag: "rounded-control bg-card px-2 py-0.5",
    // The day's stars along the foot of the hours, under the presses.
    stars: "pointer-events-none absolute left-0",
    pendingLine: "absolute flex",
    pendingBar: "h-1.25 w-full rounded-full",
    faded: "opacity-45",
    off: "opacity-35",
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

/**
 * An hour whose model gives a wind and no gust: a dash where the gust goes,
 * as in the dock's table, so it never reads as a calm hour.
 */
const NO_GUST = "no gust forecast";

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
        hour.gustKn === null
          ? `, ${NO_GUST}`
          : gust === null
            ? ""
            : `, gusts ${speedWords(gust, units)}`
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
  // The place's hours not yet worked out (src/useRatings.ts): the shapes of
  // the figures hold their room until they come.
  const pending = row === undefined;
  const times = useMemo(() => hours.map((h) => h.time), [hours]);
  // The room the row has, measured: a short October day on a wide card
  // spreads its hours across it rather than stopping short of the edge.
  const [view, setView] = useState(0);
  const fit = Math.floor(view / hours.length);
  const cw = Math.max(
    fit >= TIGHT ? TIGHT : phone ? COLUMN.phone : COLUMN.wide,
    fit,
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
    // From the scroller's edge: the hours stand in from it by its padding.
    const inset = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    const to = centredScroll(
      inset + index * cw,
      cw,
      el.clientWidth,
      el.scrollWidth,
    );
    // The ends where it is going: a row that has come to fit its view does
    // not scroll at all, and so never says so (`measure`), which left a ›
    // over its last hour.
    setEnds(rowEnds(to, el.clientWidth, el.scrollWidth));
    // A smooth scroll says where it has got to as it goes (`measure`).
    if (smooth && !reducedMotion) {
      el.scrollTo({ left: to, behavior: "smooth" });
      return;
    }
    el.scrollLeft = to;
    left.current = to;
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
  // The hours gone, to the edge of the first that is not.
  const goneTo = hours.findIndex((h) => !h.gone);
  const veilBefore = Math.max(
    darkBefore,
    (goneTo < 0 ? hours.length : goneTo) * cw,
  );

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
    <div
      className={s.root()}
      data-day-hours
      data-pending={pending || undefined}
    >
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
          {/* The hours gone and the dark, over the band: paled, then the
            dark shaded. */}
          {veilBefore > 0 && (
            <span
              className={s.veil()}
              style={{ left: 0, width: veilBefore, height: ROW_HEIGHT }}
              aria-hidden="true"
            />
          )}
          {darkAfter < width && (
            <span
              className={s.veil()}
              style={{
                left: darkAfter,
                width: width - darkAfter,
                height: ROW_HEIGHT,
              }}
              aria-hidden="true"
            />
          )}
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
          {pending ? (
            <span
              className={s.pendingLine()}
              style={{
                left: 4,
                width: width - 8,
                top: ROW_HEIGHT - STARS_LINE - STARS_BELOW,
              }}
            >
              <Skeleton className={s.pendingBar()} />
            </span>
          ) : (
            <svg
              className={s.stars()}
              width={width}
              height={STARS_LINE}
              style={{ top: ROW_HEIGHT - STARS_LINE - STARS_BELOW }}
              aria-hidden="true"
              data-stars-line
            >
              <defs>
                <linearGradient
                  id={`${id}s`}
                  x1={0}
                  x2={width}
                  gradientUnits="userSpaceOnUse"
                >
                  {hours.map((h) => {
                    const hour = h.at === null ? null : (row?.[h.at] ?? null);
                    return (
                      <stop
                        key={h.time}
                        offset={x(h.time) / width}
                        style={{
                          stopColor:
                            (!h.dark && starColour(starsAt(hour))) ||
                            "var(--color-line)",
                        }}
                      />
                    );
                  })}
                </linearGradient>
              </defs>
              <rect
                x={4}
                width={width - 8}
                height={STARS_LINE}
                rx={STARS_LINE / 2}
                fill={`url(#${id}s)`}
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
            // The marks fade with the hour; its words are set a step lighter.
            const fade = h.dark ? s.off() : h.gone ? s.faded() : undefined;
            const dim = h.dark || h.gone ? s.dim() : undefined;
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
                    h.now
                      ? s.nowLabel()
                      : s.label({ className: h.dark ? s.dim() : undefined })
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
                    <b className={s.knots({ className: dim })}>
                      <Speed knots={hour.windKn} units={units} size={14} />
                    </b>
                    <small
                      className={s.gust({ className: dim })}
                      title={hour.gustKn === null ? NO_GUST : undefined}
                      data-no-gust={hour.gustKn === null || undefined}
                    >
                      {hour.gustKn === null
                        ? "g–"
                        : gust !== null && (
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
                ) : pending && !h.dark ? (
                  <>
                    <Skeleton className={s.pending()} />
                    <Skeleton className={s.pendingGust()} />
                  </>
                ) : null}
              </Button>
            );
          })}
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
      {pending && (
        <span
          className={s.pendingWords()}
          style={{ top: ROW_HEIGHT / 2 - 10 }}
          data-pending-words
        >
          <span className={s.pendingTag()}>Loading the forecast…</span>
        </span>
      )}
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
