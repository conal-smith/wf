/**
 * One Irish day, as the broadsheet's table sets it: a header that sticks while
 * its hours scroll under it, with the day's best stars and window; then a row per daylight hour, the dark folded either side;
 * then the tide and the light. Each row is figures, not words: the time, the
 * stars, the wind with its gust raised, where it comes from, the sky and the
 * chance it rides, and the waves with the way they come from. A tap opens the hour's second line, with the session, the
 * wing, what it rides like, the waves, the models' spread and every reason a
 * star came off. The pen loops the day's best window.
 *
 * A day off the screen draws only its header and a space its height: the
 * rows, the curve and the loop arrive as it scrolls near.
 */
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import {
  SESSION_LABEL,
  SHORE_LABEL,
  starsText,
  type HourRating,
} from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import { Figure, PenNote, RatingTip, StarGlyphs } from "../../ui";
import { penStyles } from "../../ui/Pen";
import { loopPath } from "../../ui/penPaths";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import { DayTide } from "./DayTide";
import { ShoreGlyph, SkyGlyph, WindArrow } from "./glyphs";
import { RangeAxis, RangeBar, type Band } from "./RangeBar";
import {
  HOUR,
  clock,
  compass,
  darkRuns,
  dayNames,
  gustJumps,
  windIn,
  windowHours,
  type DaySun,
  type DayWindow,
  type SpotDay,
  type SpotRow,
  type TideTurn,
} from "./spot";
import { STARS_HREF } from "../../force5/src/siteNav";

const styles = tv({
  slots: {
    section: "relative flex scroll-mt-2 flex-col pt-5",
    head: "sticky top-0 z-panel flex flex-col gap-0.5 border-0 border-b-2 border-ink bg-ground paper-grain pt-2 pb-1.5",
    headLine: "flex flex-wrap items-center gap-x-2.5 gap-y-0.5",
    title: "m-0 font-display text-lead text-ink",
    when: ["ml-2 align-middle text-ink-muted", MONO_LABEL],
    best: "inline-flex items-center gap-1.5 font-mono text-caption font-medium text-ink tabular-nums",
    none: "font-mono text-caption text-ink-muted",
    wrap: "relative",
    pen: "pointer-events-none absolute inset-0 size-full overflow-visible",
    table: "w-full border-collapse font-mono tabular-nums",
    th: [
      "border-0 border-b border-ink px-1 pt-1.5 pb-1 text-left align-bottom whitespace-nowrap text-ink-muted",
      MONO_LABEL,
    ],
    row: [
      "cursor-pointer border-b border-line align-middle outline-none",
      "hover:bg-chart-magenta/5 focus-visible:bg-chart-magenta/5",
      "aria-expanded:border-transparent",
    ],
    cell: "h-10 px-1 whitespace-nowrap wide:h-9",
    time: "w-8 font-mono text-body font-semibold text-ink",
    now: "text-now",
    stars: "w-16",
    wind: "w-16",
    from: "w-14 text-ink",
    compass: "ml-1 text-eyebrow text-ink-muted",
    range: "w-28 max-wide:hidden",
    shore: "w-8 max-wide:hidden",
    wing: "w-14 max-wide:hidden",
    waves: "w-24 max-wide:hidden",
    wingText: "text-body font-semibold text-ink",
    wavesText: "text-caption text-ink-2",
    sky: "w-16",
    air: "ml-1 align-middle text-body font-medium text-ink",
    rides: "w-12 text-right",
    unit: "text-ink-muted",
    muted: "text-ink-muted",
    chance:
      "relative inline-block min-w-10 border border-line px-1 py-0.5 text-center text-caption font-semibold text-ink",
    chanceBar: "absolute inset-y-0 left-0 bg-wash/22",
    chanceText: "relative",
    more: "border-b border-line",
    moreCell: "px-1 pt-0 pb-2.5",
    moreBody:
      "flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-caption text-ink-muted",
    moreItem: "inline-flex items-center gap-1.5",
    strong: "font-semibold text-ink",
    session: "font-display text-prose text-ink italic",
    reason: "basis-full font-body text-body text-pen-ink italic",
    fold: [
      "flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-1 py-2 text-left font-mono text-caption text-ink-muted",
      "pointer-coarse:min-h-touch not-disabled:hover:bg-sunken not-disabled:hover:text-ink",
      RING,
    ],
    foldAction: ["ml-auto text-ink underline underline-offset-4", MONO_LABEL],
    placeholder: "w-full",
    tip: "flex flex-col gap-2",
    tipHead: "flex items-center justify-between gap-3",
    tipWhen: ["text-ink-muted", MONO_LABEL],
    tipVerdict: "m-0 font-body text-prose text-ink",
    tipList:
      "m-0 flex list-none flex-col gap-1 p-0 font-mono text-caption text-ink-2",
    tipItem: "flex items-center gap-1.5",
    tipReason: "font-body text-body text-pen-ink italic",
    tipFoot:
      "flex items-baseline justify-between gap-3 border-0 border-t border-line pt-1.5 font-mono text-caption text-ink-muted",
    tipLink:
      "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
  },
});

export interface DaySectionProps {
  day: SpotDay;
  window: DayWindow | null;
  /** The week's best: the pen says so beside the day's name. */
  weekBest: boolean;
  now: number;
  units: Units;
  unitText: string;
  /** "Riding · ~80 kg": who the stars are for. */
  riderText: string;
  band: Band;
  facing: number | null;
  turns: readonly TideTurn[];
  sun: DaySun;
  tideCeiling: number;
  stationNote: string | null;
  width: number;
  /** Draw the rows now, rather than when the day scrolls near. */
  eager: boolean;
  spotName: string;
}

/** Roughly how tall a day's rows and tide are, for the space a far day keeps. */
const estimate = (rows: number) => rows * 40 + 220;

export function DaySection(props: DaySectionProps) {
  const { day, window, weekBest, now, eager } = props;
  const s = styles();
  const names = dayNames(day.date, now);
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(eager);
  const shown = near || eager;

  useLayoutEffect(() => {
    if (shown) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          watch.disconnect();
        }
      },
      { rootMargin: "900px 0px" },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [shown]);

  const dayOfMonth = names.date.split(" ")[0];
  const light = day.rows.filter((row) => row.hour.daylight).length;

  return (
    <section
      ref={ref}
      id={`day-${day.date}`}
      className={s.section()}
      aria-labelledby={`day-title-${day.date}`}
      data-day={day.date}
    >
      <header className={s.head()}>
        <div className={s.headLine()}>
          <h2 id={`day-title-${day.date}`} className={s.title()}>
            {names.long} {dayOfMonth}
            {(names.relative === "Today" || names.relative === "Tomorrow") && (
              <span className={s.when()}> {names.relative}</span>
            )}
          </h2>
          {window ? (
            <span className={s.best()} data-day-best>
              <StarGlyphs
                stars={window.stars}
                potential={window.potential}
                size={10}
              />
              {windowHours(window)}
            </span>
          ) : (
            <span className={s.none()}>
              {day.rows.some((row) => row.rating) ? "no stars" : "dark"}
            </span>
          )}
          {weekBest && (
            <PenNote as="span" size="sm">
              best of the week
            </PenNote>
          )}
        </div>
      </header>
      {shown ? (
        <DayBody {...props} />
      ) : (
        <div
          className={s.placeholder()}
          style={{ height: estimate(light) }}
          aria-busy="true"
        />
      )}
    </section>
  );
}

function DayBody({
  day,
  window,
  now,
  units,
  unitText,
  riderText,
  band,
  facing,
  turns,
  sun,
  tideCeiling,
  stationNote,
  width,
  spotName,
}: DaySectionProps) {
  const s = styles();
  const names = dayNames(day.date, now);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [showNight, setShowNight] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState<string | null>(null);
  const { before, light, after } = darkRuns(day.rows);
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const toggle = (time: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(time)) next.delete(time);
      else next.add(time);
      return next;
    });

  // The pen's loop round the window: measured once the rows are laid out, and
  // again whenever something moves them (the width, a second line opening,
  // the night unfolding, the web fonts arriving).
  const openKey = [...open].join();
  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box || !window) {
      setLoop(null);
      return;
    }
    const draw = () => {
      const first = box.querySelector<HTMLElement>(
        `[data-row="${day.rows[window.first].time}"]`,
      );
      const last = box.querySelector<HTMLElement>(
        `[data-row="${day.rows[window.last].time}"]`,
      );
      const stars = last?.querySelector<HTMLElement>("[data-stars]");
      if (!first || !last || !stars) return setLoop(null);
      const top = first.offsetTop;
      const bottom = last.offsetTop + last.offsetHeight;
      const right = stars.offsetLeft + stars.offsetWidth;
      const cx = right / 2;
      const cy = (top + bottom) / 2;
      setLoop(
        loopPath(
          cx,
          cy,
          right / 2 + 6,
          (bottom - top) / 2 + 4,
          day.rows[window.first].time / HOUR,
        ),
      );
    };
    draw();
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) draw();
    });
    return () => {
      live = false;
    };
  }, [window, width, openKey, showNight, day.rows]);

  const fold = (rows: SpotRow[], edge: "before" | "after") =>
    rows.length > 0 && (
      <tr className={s.more()}>
        <td colSpan={10} className="p-0">
          <button
            type="button"
            className={s.fold()}
            aria-expanded={showNight}
            data-night-toggle={edge}
            onClick={() => setShowNight((value) => !value)}
          >
            <span>
              {edge === "before"
                ? `Dark till ${clock(rows.at(-1)!.time + rows.at(-1)!.step * HOUR)}`
                : `Dark from ${clock(rows[0].time)}`}{" "}
              · not rated
            </span>
            <span className={s.foldAction()}>
              {showNight ? "Hide" : "Show"}
            </span>
          </button>
        </td>
      </tr>
    );

  const hourRow = (row: SpotRow) => {
    const { hour, rating } = row;
    const wind = hour.wind;
    const isOpen = open.has(row.time);
    const jump = wind ? gustJumps(wind.wind_kn, wind.gust_kn) : false;
    return (
      <Fragment key={row.time}>
        <tr
          className={s.row()}
          data-row={row.time}
          data-hour={new Date(row.time).toISOString()}
          data-daylight={hour.daylight ? "" : undefined}
          id={`hour-${row.time}`}
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={() => toggle(row.time)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggle(row.time);
          }}
        >
          <th
            scope="row"
            className={s.cell({
              className: [s.time(), row.time === nowHour ? s.now() : ""],
            })}
            data-now={row.time === nowHour ? "" : undefined}
          >
            {clock(row.time).slice(0, 2)}
            <span className="sr-only">:00</span>
          </th>
          <td
            className={s.cell({ className: s.stars() })}
            data-stars={rating ? rating.stars : undefined}
          >
            <RatingTip
              label={`${clock(row.time)}: ${
                rating
                  ? starsText(rating)
                  : hour.daylight
                    ? "no wind reading"
                    : "dark, not rated"
              }`}
              detail={
                <HourTip
                  row={row}
                  units={units}
                  riderText={riderText}
                  band={band}
                  facing={facing}
                  date={names.short}
                />
              }
            >
              <StarGlyphs
                stars={rating ? rating.stars : null}
                potential={rating?.potential}
                size={9.5}
              />
            </RatingTip>
          </td>
          <td className={s.cell({ className: s.wind() })}>
            {wind ? (
              <Figure
                value={windIn(wind.wind_kn, units)}
                sup={
                  wind.gust_kn === null
                    ? undefined
                    : windIn(wind.gust_kn, units)
                }
                alarm={jump}
                label={`${windIn(wind.wind_kn, units)} ${unitText}${
                  wind.gust_kn === null
                    ? ""
                    : `, gusting ${windIn(wind.gust_kn, units)}`
                }`}
              />
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.from() })}>
            {wind && (
              <>
                <WindArrow from={wind.direction_deg} size={16} />
                <span className={s.compass()}>{wind.direction}</span>
              </>
            )}
          </td>
          <td className={s.cell({ className: s.range() })}>
            {wind && (
              <RangeBar wind={wind} ensemble={hour.ensemble} band={band} />
            )}
          </td>
          <td className={s.cell({ className: s.shore() })}>
            {wind && facing !== null ? (
              <ShoreGlyph from={wind.direction_deg} facing={facing} />
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: [s.wing(), s.wingText()] })}>
            {rating?.potential ? (
              <>
                {rating.wing.own ?? rating.wing.recommended}
                <span className={s.unit()}> m</span>
              </>
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: [s.waves(), s.wavesText()] })}>
            {hour.waves?.height_m != null ? (
              <>
                {hour.waves.direction_deg != null && (
                  <span title={`From ${compass(hour.waves.direction_deg)}`}>
                    <WindArrow from={hour.waves.direction_deg} size={14} />
                    <span className="sr-only">
                      from {compass(hour.waves.direction_deg)}
                    </span>
                  </span>
                )}{" "}
                {hour.waves.height_m.toFixed(1)}
                <span className={s.unit()}>m</span>
                {hour.waves.period_s != null && (
                  <>
                    {" "}
                    {hour.waves.period_s}
                    <span className={s.unit()}>s</span>
                  </>
                )}
              </>
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.sky() })}>
            {hour.weather ? (
              <>
                <SkyGlyph weather={hour.weather} />
                {hour.weather.air_c != null && (
                  <span className={s.air()}>{hour.weather.air_c}°</span>
                )}
              </>
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.rides() })} data-chance>
            {row.chance === null ? (
              <span className={s.muted()}>–</span>
            ) : (
              <Chance value={row.chance} />
            )}
          </td>
        </tr>
        {isOpen && (
          <tr className={s.more()} data-hour-detail>
            <td colSpan={10} className={s.moreCell()}>
              <HourMore
                row={row}
                units={units}
                unitText={unitText}
                band={band}
                facing={facing}
              />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <>
      <div ref={wrap} className={s.wrap()}>
        <table className={s.table()}>
          <caption className="sr-only">
            {spotName}, {names.full}: by the hour, rated for {riderText}. Wind
            in {unitText}, gusts raised. Times are Irish.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={s.th()}>
                IST
              </th>
              <th scope="col" className={s.th()}>
                <a href={STARS_HREF} className={s.tipLink()}>
                  Stars
                </a>
              </th>
              <th scope="col" className={s.th()}>
                Wind <span className="normal-case">{unitText}</span>
              </th>
              <th scope="col" className={s.th()}>
                From
              </th>
              <th scope="col" className={s.th({ className: s.range() })}>
                <span className="sr-only">The models&rsquo; spread</span>
                <RangeAxis band={band} />
              </th>
              <th scope="col" className={s.th({ className: s.shore() })}>
                Shore
              </th>
              <th scope="col" className={s.th({ className: s.wing() })}>
                Wing
              </th>
              <th scope="col" className={s.th({ className: s.waves() })}>
                Waves
              </th>
              <th scope="col" className={s.th()}>
                Sky
              </th>
              <th
                scope="col"
                className={s.th({ className: "text-right" })}
                title="The chance it rides: the share of ensemble members windy enough for you"
              >
                Rides
              </th>
            </tr>
          </thead>
          <tbody>
            {fold(before, "before")}
            {showNight && before.map(hourRow)}
            {light.map(hourRow)}
            {fold(after, "after")}
            {showNight && after.map(hourRow)}
          </tbody>
        </table>
        {loop && (
          <svg className={s.pen()} aria-hidden="true" focusable="false">
            <path
              className={penStyles().stroke()}
              d={loop}
              pathLength={1}
              strokeDasharray="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <DayTide
        date={day.date}
        turns={turns}
        sun={sun}
        now={now}
        width={width}
        ceiling={tideCeiling}
        stationNote={stationNote}
      />
    </>
  );
}

/** The chance it rides, as a figure in a box with its share washed in. */
function Chance({ value }: { value: number }) {
  const s = styles();
  return (
    <span
      className={s.chance()}
      title="Chance it rides: the share of ensemble members windy enough for you"
    >
      <span className={s.chanceBar()} style={{ width: `${value}%` }} />
      <span className={s.chanceText()}>{value}%</span>
    </span>
  );
}

/** The hour's second line: what the row has no room for. */
function HourMore({
  row,
  units,
  unitText,
  band,
  facing,
}: {
  row: SpotRow;
  units: Units;
  unitText: string;
  band: Band;
  facing: number | null;
}) {
  const s = styles();
  const { hour, rating } = row;
  const wind = hour.wind;
  const ensemble = hour.ensemble;
  if (!rating && !wind)
    return (
      <p className="m-0 font-body text-body text-ink-muted">No wind reading.</p>
    );
  return (
    <div className={s.moreBody()}>
      {rating && (
        <span className={s.moreItem()}>
          <i className={s.session()}>{SESSION_LABEL[rating.session]}</i>
          {rating.potential > 0 && (
            <>
              on a{" "}
              <b className={s.strong()}>
                {rating.wing.own ?? rating.wing.recommended} m
              </b>
            </>
          )}
        </span>
      )}
      {rating && (
        <span className={s.moreItem()}>
          rides like{" "}
          <b className={s.strong()}>{windIn(rating.rideKn, units)}</b>{" "}
          {unitText}
        </span>
      )}
      {wind && (
        <span className={s.moreItem()}>
          {facing !== null && (
            <ShoreGlyph from={wind.direction_deg} facing={facing} size={16} />
          )}
          {row.shore ? SHORE_LABEL[row.shore] : "facing unknown"}
        </span>
      )}
      <span className={s.moreItem()}>
        waves{" "}
        {hour.waves?.height_m != null ? (
          <>
            <b className={s.strong()}>{hour.waves.height_m.toFixed(1)}</b> m
            {hour.waves.period_s != null && ` ${hour.waves.period_s} s`}
            {hour.waves.direction_deg != null && (
              <WindArrow from={hour.waves.direction_deg} size={12} />
            )}
          </>
        ) : (
          "–"
        )}
      </span>
      {wind && (
        <span className={s.moreItem()}>
          <RangeBar wind={wind} ensemble={ensemble} band={band} />
        </span>
      )}
      {wind && (
        <span className={s.moreItem()} data-spread>
          {wind.models > 1 && (
            <>
              {wind.models} models{" "}
              <b className={s.strong()}>
                {windIn(wind.min_kn, units)}–{windIn(wind.max_kn, units)}
              </b>
            </>
          )}
          {ensemble && (
            <>
              {wind.models > 1 && " · "}
              {ensemble.members} members{" "}
              <b className={s.strong()}>
                {windIn(ensemble.p10_kn, units)}–
                {windIn(ensemble.p90_kn, units)}
              </b>
            </>
          )}{" "}
          {unitText}
        </span>
      )}
      {hour.weather?.rain_mm ? (
        <span className={s.moreItem()}>
          rain <b className={s.strong()}>{hour.weather.rain_mm}</b> mm
        </span>
      ) : null}
      {rating?.reasons.map((reason) => (
        <span key={reason} className={s.reason()}>
          − {reason}
        </span>
      ))}
    </div>
  );
}

/** Why these stars: the card the stars open. */
function HourTip({
  row,
  units,
  riderText,
  band,
  facing,
  date,
}: {
  row: SpotRow;
  units: Units;
  riderText: string;
  band: Band;
  facing: number | null;
  date: string;
}) {
  const s = styles();
  const { hour, rating } = row;
  const wind = hour.wind;
  return (
    <div className={s.tip()} data-hour-tip>
      <div className={s.tipHead()}>
        <span className={s.tipWhen()}>
          {date} · {clock(row.time)}
        </span>
        <StarGlyphs
          stars={rating ? rating.stars : null}
          potential={rating?.potential}
          size={12}
        />
      </div>
      <p className={s.tipVerdict()}>{verdict(rating, hour.daylight)}</p>
      {wind && (
        <ul className={s.tipList()}>
          <li className={s.tipItem()}>
            <WindArrow from={wind.direction_deg} size={12} />
            {wind.direction} {windIn(wind.wind_kn, units)}
            {wind.gust_kn !== null && ` g${windIn(wind.gust_kn, units)}`}
            {rating && rating.liftKn >= 0.95 && (
              <>
                {" "}
                → rides like{" "}
                <b className={s.strong()}>{windIn(rating.rideKn, units)}</b>
              </>
            )}
          </li>
          <li className={s.tipItem()}>
            {facing !== null && (
              <ShoreGlyph from={wind.direction_deg} facing={facing} size={15} />
            )}
            {row.shore
              ? SHORE_LABEL[row.shore]
              : "facing unknown: the wind alone"}
          </li>
          {rating?.reasons.map((reason) => (
            <li key={reason} className={s.tipReason()}>
              − {reason}
            </li>
          ))}
          {rating &&
            !rating.reasons.length &&
            rating.stars === rating.potential && (
              <li className={s.muted()}>Nothing taken off</li>
            )}
        </ul>
      )}
      <p className={s.tipFoot()}>
        <span>
          Rated for {riderText} · best {band.sweetLow}–{band.sweetHigh} kn
        </span>
        <a className={s.tipLink()} href={STARS_HREF}>
          How?
        </a>
      </p>
    </div>
  );
}

function verdict(rating: HourRating | null, daylight: boolean) {
  if (!rating) return daylight ? "No wind reading." : "Dark: not rated.";
  const wing = rating.wing.own ?? rating.wing.recommended;
  return (
    <>
      <i className="font-display italic">{SESSION_LABEL[rating.session]}</i>
      {rating.potential > 0 && (
        <>
          {" "}
          on a <b className="font-mono font-semibold">{wing} m</b>
        </>
      )}
      <span className="sr-only">. {starsText(rating)}</span>
    </>
  );
}
