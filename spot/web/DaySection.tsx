/**
 * One Irish day, as the broadsheet's table sets it: a header that sticks while
 * its hours scroll under it, naming the day and never rating it; then a row
 * per daylight hour, the dark folded either side;
 * then the tide and the light. Each row is figures, not words: the time, the
 * stars, the wind with its gust raised, where it comes from, the waves with
 * the way they come from, and the sky. The rows do not open: the hour's wind
 * against the rider's range is a frame of its own (RangeBar.tsx), and a tap on
 * it opens the hour's wind broken down, model by model. A phone has no room for
 * the frame, so there the wind figure opens it.
 *
 * The stars come from one model, the rider's choice: where its run ends and
 * the one after it takes over, a ruled line between the rows says so, and the
 * day's header names who rates it.
 *
 * A day off the screen draws only its header and a space its height: the
 * rows and the curve arrive as it scrolls near, or all at once when
 * the page is printed.
 */
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { modelName, type StarsFrom } from "../../force5/src/lead";
import {
  SHORE_LABEL,
  starsText,
  type HourRating,
} from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import { Figure, RatingTip, StarGlyphs } from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import { DayTide } from "./DayTide";
import { ShoreGlyph, SkyGlyph, WindArrow } from "./glyphs";
import {
  RangeAxis,
  RangeBar,
  RangeDetail,
  rangeWords,
  type Band,
  type StarsWhere,
} from "./RangeBar";
import {
  HOUR,
  clock,
  compass,
  darkRuns,
  dayLeadText,
  dayLeads,
  dayNames,
  foldText,
  gustJumps,
  handoverWords,
  placeChanges,
  skyEnd,
  windIn,
  type DaySun,
  type LeadChange,
  type SpotDay,
  type SpotRow,
  type TideTurn,
} from "./spot";
import { STARS_HREF } from "../../force5/src/siteNav";
import { rangeKeyWords } from "./TableKey";

const styles = tv({
  slots: {
    section: "relative flex scroll-mt-2 flex-col pt-5",
    head: "sticky top-0 z-panel flex flex-col gap-0.5 border-0 border-b-2 border-ink bg-ground paper-grain pt-2 pb-1.5",
    headLine: "flex flex-wrap items-center gap-x-2.5 gap-y-0.5",
    title: "m-0 font-display text-lead text-ink",
    when: ["ml-2 align-middle text-ink-muted", MONO_LABEL],
    dayFrom: ["ml-auto text-chart-magenta", MONO_LABEL],
    // Where the model the stars come from changes: ruled off in dashed ink,
    // as the mockup's handover (wingfoil-mockups/lead-model, section 2).
    handover: [
      "border-0 border-y border-dashed border-ink bg-chart-magenta/5 px-1 pt-2 pb-1.5",
      "font-body text-body whitespace-normal text-ink-2",
    ],
    handoverKicker: ["mr-1.5 font-semibold text-chart-magenta", MONO_LABEL],
    table: "w-full border-collapse font-mono tabular-nums",
    th: [
      "border-0 border-b border-ink px-1 pt-1.5 pb-1 text-left align-bottom whitespace-nowrap text-ink-muted",
      MONO_LABEL,
    ],
    row: "border-b border-line align-middle",
    cell: "h-10 px-1 whitespace-nowrap wide:h-9",
    time: "w-8 font-mono text-body font-semibold text-ink",
    now: "text-now",
    stars: "w-16",
    wind: "w-16",
    from: "w-14 text-ink",
    compass: "ml-1 text-eyebrow text-ink-muted",
    // A phone has no Shore column, and offshore is the one thing on the row a
    // rider must not miss: the shore's mark rides in From there instead.
    fromShore: "ml-1.5 wide:hidden",
    range: "w-31 max-wide:hidden",
    shore: "w-8 max-wide:hidden",
    wing: "w-14 max-wide:hidden",
    waves: "w-24 max-wide:hidden",
    wingText: "text-body font-semibold text-ink",
    wavesText: "text-caption text-ink-2",
    sky: "w-16",
    air: "ml-1 align-middle text-body font-medium text-ink",
    notYet: "font-body text-caption text-ink-muted italic",
    // Under the hour the Sky column first says "not yet", what that means.
    skyNote:
      "border-0 border-b border-line px-1 py-1 text-right font-body text-caption text-ink-muted",
    unit: "text-ink-muted",
    muted: "text-ink-muted",
    more: "border-b border-line",
    strong: "font-semibold text-ink",
    // Where the frame is hidden, the wind figure opens its card; where it
    // shows, the figure is only a figure.
    windTip: "wide:hidden",
    windPlain: "max-wide:hidden",
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
    tipFrom: ["text-chart-magenta", MONO_LABEL],
    tipContext: "font-body text-body text-ink-muted italic",
    tipFoot:
      "flex items-baseline justify-between gap-3 border-0 border-t border-line pt-1.5 font-mono text-caption text-ink-muted",
    tipLink:
      "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
  },
});

export interface DaySectionProps {
  day: SpotDay;
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
  /** The live wind models, for the hour's card. */
  models: readonly { id: string; name: string }[];
  /** The model the rider takes this spot's stars from, and the one after it. */
  starsFrom: StarsFrom;
  /** Where that model's run ends and the next takes over, on this day. */
  changes: readonly LeadChange[];
  /** Rate the stars from another model, picked in an hour's card. */
  onStarsFrom?: (model: string, where: StarsWhere) => void;
  /** The sky model stops on this day: say under it what "not yet" means. */
  skyStops?: boolean;
}

/** The theme's `wide` breakpoint (ui/theme.css), where the rows get shorter. */
const WIDE = "(min-width: 45rem)";

/**
 * The height a far day's rows, folds and tide will take, so the space it
 * keeps is the space it fills and nothing moves when it draws. Built from
 * the parts as they are set below: an hour is `h-10`, `wide:h-9` (40px, 36px
 * wide); the column heads 24px, 31px wide where the knot scale's 20px figure
 * shows; a fold 32px; the line where the sky stops 24px; and
 * DayTide's 124px curve over its four rows of light, 249px whatever the
 * tides. The rows are the day's own, so a three-hourly day keeps the space
 * of its four or five, not of twelve.
 */
function estimate(
  rows: readonly SpotRow[],
  wide: boolean,
  skyStops: boolean,
): number {
  const { before, light, after } = darkRuns(rows);
  const folds = Number(before.length > 0) + Number(after.length > 0);
  const head = light.length ? (wide ? 31 : 24) : 0;
  return (
    head +
    folds * 32 +
    light.length * (wide ? 36 : 40) +
    (skyStops ? 24 : 0) +
    249
  );
}

export function DaySection(props: DaySectionProps) {
  const { day, now, eager } = props;
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
    // Paper has no scroll: a printed week draws every day, and before the
    // print is laid out, not after.
    const print = () => flushSync(() => setNear(true));
    globalThis.addEventListener("beforeprint", print);
    return () => {
      watch.disconnect();
      globalThis.removeEventListener("beforeprint", print);
    };
  }, [shown]);

  const dayOfMonth = names.date.split(" ")[0];
  const wide = globalThis.matchMedia?.(WIDE).matches ?? true;
  const leads = dayLeads(day.rows, props.starsFrom);

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
          {leads.length > 0 && (
            <span className={s.dayFrom()} data-day-from>
              {dayLeadText(leads)}
            </span>
          )}
        </div>
      </header>
      {shown ? (
        <DayBody {...props} />
      ) : (
        <div
          className={s.placeholder()}
          style={{ height: estimate(day.rows, wide, !!props.skyStops) }}
          aria-busy="true"
        />
      )}
    </section>
  );
}

function DayBody({
  day,
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
  models,
  starsFrom,
  changes,
  onStarsFrom,
  skyStops,
}: DaySectionProps) {
  const s = styles();
  const names = dayNames(day.date, now);
  const [showNight, setShowNight] = useState(false);
  const { before, light, after } = darkRuns(day.rows);
  const nowHour = Math.floor(now / HOUR) * HOUR;

  const fold = (rows: SpotRow[], edge: "before" | "after") =>
    rows.length > 0 && (
      <tr className={s.more()}>
        <td colSpan={9} className="p-0">
          <button
            type="button"
            className={s.fold()}
            aria-expanded={showNight}
            data-night-toggle={edge}
            onClick={() => setShowNight((value) => !value)}
          >
            <span>
              {foldText(edge, rows, sun, light.length > 0)} · not rated
            </span>
            <span className={s.foldAction()}>
              {showNight ? "Hide" : "Show"}
            </span>
          </button>
        </td>
      </tr>
    );

  // The sky model stops days before the wind models do. Past its last hour a
  // column of dashes would read as readings missing hour by hour, so the
  // first row it no longer reaches says "not yet" (forecast) once, a line
  // under it on the day the sky stops says why, and the rest stay blank; a
  // dash is kept for a gap before that.
  const skyEnds = skyEnd(day.rows);
  const drawn = [
    ...(showNight ? before : []),
    ...light,
    ...(showNight ? after : []),
  ];
  const skyNote = drawn.find((row) => day.rows.indexOf(row) >= skyEnds)?.time;
  const placed = placeChanges(drawn, changes);
  const handoverRow = (change: LeadChange) => {
    const words = handoverWords(change, starsFrom);
    return (
      <tr key={`handover-${change.time}`} data-handover={change.to}>
        <td colSpan={9} className={s.handover()}>
          <b className={s.handoverKicker()}>{words.kicker}</b>
          {words.text}
        </td>
      </tr>
    );
  };
  // An hour's row with the handovers that come before it, and after the
  // last row drawn the ones that fall among rows folded away.
  const lastDrawn = drawn.at(-1)?.time;
  const rowWithChanges = (row: SpotRow) => (
    <Fragment key={row.time}>
      {placed.before.get(row.time)?.map(handoverRow)}
      {hourRow(row)}
      {skyStops && row.time === skyNote && (
        <tr data-sky-note>
          <td id={`sky-note-${day.date}`} colSpan={9} className={s.skyNote()}>
            Sky <span className={s.notYet()}>not yet</span>: the weather
            forecast does not reach this far ahead yet.
          </td>
        </tr>
      )}
      {row.time === lastDrawn && placed.end.map(handoverRow)}
    </Fragment>
  );

  const hourRow = (row: SpotRow) => {
    const { hour, rating } = row;
    const index = day.rows.indexOf(row);
    const wind = hour.wind;
    const jump = wind ? gustJumps(wind.wind_kn, wind.gust_kn) : false;
    const detail = wind && (
      <RangeDetail
        time={row.time}
        date={`${names.short} ${names.date}`}
        wind={wind}
        band={band}
        units={units}
        unitText={unitText}
        shore={row.shore}
        rainMm={hour.weather?.rain_mm}
        models={models}
        riderText={riderText}
        starsFrom={starsFrom}
        spotName={spotName}
        onStarsFrom={onStarsFrom}
      />
    );
    const tipLabel = wind
      ? `${clock(row.time)}: ${rangeWords(wind, band, units)} ${unitText}`
      : "";
    return (
      <tr
        key={row.time}
        className={s.row()}
        data-row={row.time}
        data-hour={new Date(row.time).toISOString()}
        data-daylight={hour.daylight ? "" : undefined}
        id={`hour-${row.time}`}
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
                starsFrom={starsFrom}
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
            <>
              <span className={s.windTip()}>
                <RatingTip label={tipLabel} detail={detail}>
                  <Figure
                    value={windIn(wind.wind_kn, units)}
                    sup={
                      wind.gust_kn === null
                        ? undefined
                        : windIn(wind.gust_kn, units)
                    }
                    alarm={jump}
                  />
                </RatingTip>
              </span>
              <span
                className={s.windPlain()}
                title={
                  jump
                    ? `Gust ${windIn(wind.gust_kn!, units)} ${unitText}, in red: well over the wind`
                    : undefined
                }
              >
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
              </span>
            </>
          ) : (
            <span className={s.muted()}>–</span>
          )}
        </td>
        <td className={s.cell({ className: s.from() })}>
          {wind && (
            <>
              <WindArrow from={wind.direction_deg} size={16} />
              <span className={s.compass()}>{wind.direction}</span>
              {facing !== null && (
                <span className={s.fromShore()}>
                  <ShoreGlyph from={wind.direction_deg} facing={facing} />
                </span>
              )}
            </>
          )}
        </td>
        <td className={s.cell({ className: s.range() })}>
          {wind && (
            <RatingTip label={tipLabel} detail={detail}>
              <RangeBar wind={wind} band={band} />
            </RatingTip>
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
              <span className={s.unit()}> m²</span>
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
          ) : index < skyEnds ? (
            <span className={s.muted()}>–</span>
          ) : row.time === skyNote ? (
            <span
              className={s.notYet()}
              title="The weather forecast does not reach this far ahead yet"
              aria-describedby={skyStops ? `sky-note-${day.date}` : undefined}
            >
              not yet<span className="sr-only"> forecast</span>
            </span>
          ) : (
            <span className="sr-only">not forecast yet</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <table className={s.table()}>
        <caption className="sr-only">
          {spotName}, {names.full}: by the hour, rated for {riderText}. Wind in{" "}
          {unitText}, gusts raised. Times are Irish.
        </caption>
        {/* Heads only over hours: a day already dark has just its fold,
              and heads over no rows, sized by their own words, would not
              line up with the days below. */}
        {drawn.length > 0 && (
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
              <th
                scope="col"
                className={s.th({ className: s.range() })}
                title={rangeKeyWords(unitText)}
              >
                <span className="sr-only">The wind against your range</span>
                <RangeAxis band={band} units={units} />
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
            </tr>
          </thead>
        )}
        <tbody>
          {fold(before, "before")}
          {showNight && before.map(rowWithChanges)}
          {light.map(rowWithChanges)}
          {fold(after, "after")}
          {showNight && after.map(rowWithChanges)}
        </tbody>
      </table>
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

/** Why these stars: the card the stars open. */
function HourTip({
  row,
  units,
  riderText,
  band,
  facing,
  date,
  starsFrom,
}: {
  row: SpotRow;
  units: Units;
  riderText: string;
  band: Band;
  facing: number | null;
  date: string;
  starsFrom: StarsFrom;
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
        <span className={s.tipFrom()} data-tip-from>
          Stars from <b className="font-semibold">{modelName(wind.lead)}</b>
          {wind.lead !== starsFrom.model &&
            ` · ${modelName(starsFrom.model)} does not reach this hour`}
        </span>
      )}
      {wind && (
        <ul className={s.tipList()}>
          <li className={s.tipItem()}>
            <WindArrow from={wind.direction_deg} size={12} />
            {wind.direction} {windIn(wind.wind_kn, units)}
            {wind.gust_kn !== null && ` g${windIn(wind.gust_kn, units)}`}
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
          {wind.models > 1 && wind.agreement && (
            <li className={s.tipContext()} data-tip-context>
              All {wind.models} models {windIn(wind.min_kn, units)}–
              {windIn(wind.max_kn, units)}, agree {wind.agreement}. Context, not
              counted.
            </li>
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
      {rating.potential > 0 ? (
        <>
          <b className="font-mono font-semibold">{wing} m²</b> wing
        </>
      ) : (
        "No stars"
      )}
      <span className="sr-only">. {starsText(rating)}</span>
    </>
  );
}
