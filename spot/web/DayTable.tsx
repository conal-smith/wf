/**
 * One Irish day, hour by hour, as a rider reads a surf report: when, how many
 * stars, the wind and its gusts, where from and how it meets the shore, what
 * the gusts make it ride like, the wing, the sea and the sky. Daylight is the
 * table; the dark hours either side fold away, dimmed and never rated, and
 * every row opens to say why it got the stars it did.
 */
import { ChevronDown, Moon } from "lucide-react";
import { Fragment, useState } from "react";
import {
  SESSION_LABEL,
  SHORE_LABEL,
  starsText,
  type HourRating,
} from "../../force5/src/stars";
import { presentWeather } from "../../force5/src/surface";
import type { Units } from "../../force5/src/units";
import { StarGlyphs, ratingTitle } from "../../src/StarsRows";
import WeatherGlyph from "../../src/WeatherGlyph";
import { RING, tv } from "../../ui/tv";
import { AGREEMENT_WORDS, AgreementDots, FromArrow, WindBar } from "./parts";
import {
  clock,
  compass,
  darkRuns,
  dayNames,
  windIn,
  type SpotDay,
  type SpotRow,
} from "./spot";

const styles = tv({
  slots: {
    section: "flex scroll-mt-24 flex-col gap-3",
    head: "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
    title: "m-0 text-lead",
    summary:
      "flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-muted tabular-nums",
    scroller:
      "overflow-x-auto rounded-surface border border-line bg-card shadow-control",
    table: "w-full border-collapse font-sans text-body tabular-nums",
    th: "px-2 py-2 text-left text-eyebrow whitespace-nowrap uppercase text-ink-muted first:pl-4 last:pr-3 max-wide:px-1 max-wide:first:pl-3 max-wide:last:pr-2",
    row: "border-t border-line align-middle",
    cell: "px-2 py-2 first:pl-4 last:pr-3 max-wide:px-1 max-wide:first:pl-3 max-wide:last:pr-2",
    time: "w-16 max-wide:w-12 text-left text-prose font-semibold whitespace-nowrap",
    now: "block text-eyebrow uppercase text-now",
    stars: "w-24 whitespace-nowrap text-ink",
    none: "text-ink-muted",
    wind: "w-32 min-w-28 max-wide:w-20 max-wide:min-w-18",
    windLine: "flex items-baseline gap-1 whitespace-nowrap",
    windNumber: "text-prose font-semibold text-ink",
    gust: "text-body text-ink-muted",
    dir: "w-28 whitespace-nowrap max-wide:w-16",
    dirLine: "flex items-center gap-1 text-ink",
    shore: "block text-caption text-ink-muted",
    muted: "text-ink-muted",
    wing: "w-14 whitespace-nowrap text-ink max-wide:w-8",
    session: "w-32 whitespace-nowrap text-ink-2",
    waves: "w-28 whitespace-nowrap text-ink-2",
    wavesLine: "flex items-center gap-1",
    weather: "w-20 whitespace-nowrap text-ink-2 max-wide:hidden",
    weatherLine: "flex items-center gap-1.5",
    rain: "w-16 whitespace-nowrap text-ink-2",
    models: "w-16",
    open: "w-10 text-right max-wide:w-8",
    toggle: [
      "inline-flex size-control-sm items-center justify-center rounded-full border-0 bg-transparent text-ink-muted",
      "cursor-pointer transition-transform duration-fast not-disabled:hover:bg-sunken not-disabled:hover:text-ink motion-reduce:transition-none",
      "aria-expanded:rotate-180",
      RING,
    ],
    detail: "border-t border-line bg-solid",
    detailCell: "px-4 py-3",
    detailGrid: "grid gap-x-6 gap-y-2 text-body text-ink-2 wide:grid-cols-2",
    detailHead: "m-0 text-label text-ink",
    reasons: "m-0 flex list-disc flex-col gap-1 pl-4",
    night: [
      "flex w-full items-center gap-2 border-0 bg-transparent px-4 py-2 text-left font-sans text-body text-ink-muted",
      "cursor-pointer not-disabled:hover:bg-sunken not-disabled:hover:text-ink",
      RING,
    ],
    nightAction:
      "ml-auto text-label text-quiet underline underline-offset-4 decoration-line-strong",
    hidden: "max-wide:hidden",
  },
  variants: {
    dark: {
      true: {
        row: "bg-sunken/40 text-ink-muted",
        time: "font-normal text-ink-muted",
      },
    },
  },
});

export interface DayTableProps {
  day: SpotDay;
  spotName: string;
  now: number;
  units: Units;
  unitText: string;
  /** Who the stars are for, in words: "Riding, ~80 kg". */
  riderText: string;
}

/** Columns hidden on a phone; their readings are in the row's details there. */
const COLUMNS = 12;

export function DayTable({
  day,
  spotName,
  now,
  units,
  unitText,
  riderText,
}: DayTableProps) {
  const s = styles();
  const names = dayNames(day.date, now);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const [showNight, setShowNight] = useState(false);
  const { before, light, after } = darkRuns(day.rows);
  const nowHour = Math.floor(now / 3600000) * 3600000;
  const toggle = (time: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(time)) next.delete(time);
      else next.add(time);
      return next;
    });

  const nightToggle = (rows: SpotRow[], edge: "before" | "after") =>
    rows.length > 0 && (
      <tr className={s.row()}>
        <td colSpan={COLUMNS} className="p-0">
          <button
            type="button"
            className={s.night()}
            aria-expanded={showNight}
            data-night-toggle={edge}
            onClick={() => setShowNight((value) => !value)}
          >
            <Moon size={14} aria-hidden="true" />
            <span>
              {edge === "before"
                ? `Dark until ${clock(rows.at(-1)!.time + rows.at(-1)!.step * 3600000)}`
                : `Dark from ${clock(rows[0].time)}`}{" "}
              · {rows.length} {rows.length === 1 ? "row" : "rows"}, not rated
            </span>
            <span className={s.nightAction()}>
              {showNight ? "Hide" : "Show"}
            </span>
          </button>
        </td>
      </tr>
    );

  const hourRow = (row: SpotRow) => {
    const { hour, rating } = row;
    const wind = hour.wind;
    const dark = !hour.daylight;
    const r = styles({ dark });
    const expanded = open.has(row.time);
    const weather = presentWeather(hour.weather?.weather_code);
    const detailId = `hour-detail-${row.time}`;
    return (
      <Fragment key={row.time}>
        <tr
          id={`hour-${row.time}`}
          className={r.row()}
          data-hour={new Date(row.time).toISOString()}
          data-daylight={dark ? undefined : ""}
          tabIndex={-1}
        >
          <th scope="row" className={r.cell({ className: r.time() })}>
            {row.time === nowHour && <span className={s.now()}>Now</span>}
            {clock(row.time)}
          </th>
          <td
            className={s.cell({ className: s.stars() })}
            title={rating ? ratingTitle(rating) : "Dark: not rated"}
            data-stars={rating ? rating.stars : undefined}
          >
            {rating ? (
              rating.potential ? (
                <StarGlyphs
                  stars={rating.stars}
                  potential={rating.potential}
                  size={13}
                />
              ) : (
                <span
                  className={s.none()}
                  role="img"
                  aria-label={`No stars: ${SESSION_LABEL[rating.session].toLowerCase()}`}
                >
                  –
                </span>
              )
            ) : (
              <span className="sr-only">
                {dark ? "Dark, not rated" : "No wind reading"}
              </span>
            )}
          </td>
          <td className={s.cell({ className: s.wind() })}>
            {wind ? (
              <span className="flex flex-col gap-1">
                <span className={s.windLine()}>
                  <span className={s.windNumber()}>
                    {windIn(wind.wind_kn, units)}
                  </span>
                  {wind.gust_kn !== null && (
                    <span className={s.gust()}>
                      <span aria-hidden="true">g</span>
                      <span className="sr-only">gusting </span>
                      {windIn(wind.gust_kn, units)}
                    </span>
                  )}
                </span>
                <WindBar knots={wind.wind_kn} gust={wind.gust_kn} />
              </span>
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.dir() })}>
            {wind && (
              <>
                <span className={s.dirLine()}>
                  <FromArrow from={wind.direction_deg} />
                  {wind.direction}
                </span>
                {row.shore && <span className={s.shore()}>{row.shore}</span>}
              </>
            )}
          </td>
          <td className={s.cell({ className: [s.wing(), s.hidden()] })}>
            {rating && rating.liftKn >= 1 ? (
              windIn(rating.rideKn, units)
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.wing() })}>
            {rating?.potential ? (
              `${rating.wing.own ?? rating.wing.recommended}`
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: [s.session(), s.hidden()] })}>
            {rating ? SESSION_LABEL[rating.session] : ""}
          </td>
          <td className={s.cell({ className: [s.waves(), s.hidden()] })}>
            {hour.waves?.height_m != null ? (
              <span className={s.wavesLine()}>
                {hour.waves.height_m.toFixed(1)} m
                {hour.waves.period_s != null && (
                  <span className={s.muted()}>{hour.waves.period_s} s</span>
                )}
                {hour.waves.direction_deg != null && (
                  <FromArrow from={hour.waves.direction_deg} size={12} />
                )}
              </span>
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: s.weather() })}>
            <span className={s.weatherLine()}>
              {weather && <WeatherGlyph weather={weather} size={16} />}
              {hour.weather?.air_c != null && `${hour.weather.air_c}°`}
            </span>
          </td>
          <td className={s.cell({ className: [s.rain(), s.hidden()] })}>
            {hour.weather?.rain_mm ? (
              `${hour.weather.rain_mm} mm`
            ) : (
              <span className={s.muted()}>–</span>
            )}
          </td>
          <td className={s.cell({ className: [s.models(), s.hidden()] })}>
            {wind && (
              <AgreementDots
                agreement={wind.agreement}
                models={wind.models}
                min={wind.min_kn}
                max={wind.max_kn}
              />
            )}
          </td>
          <td className={s.cell({ className: s.open() })}>
            <button
              type="button"
              className={s.toggle()}
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={`Details for ${clock(row.time)}`}
              onClick={() => toggle(row.time)}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </td>
        </tr>
        {expanded && (
          <tr id={detailId} className={s.detail()}>
            <td colSpan={COLUMNS} className={s.detailCell()}>
              <HourDetail row={row} units={units} unitText={unitText} />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <section
      id={`day-${day.date}`}
      className={s.section()}
      aria-labelledby={`day-title-${day.date}`}
      data-day={day.date}
    >
      <div className={s.head()}>
        <h3 id={`day-title-${day.date}`} className={s.title()}>
          {names.relative === "Today" || names.relative === "Tomorrow"
            ? `${names.relative}, ${names.full}`
            : names.full}
        </h3>
        <p className={s.summary()}>
          {day.potential > 0 && (
            <StarGlyphs stars={day.stars} potential={day.potential} size={12} />
          )}
          {day.best ? (
            <span>
              Best {clock(day.best.from)}–{clock(day.best.to)} on a{" "}
              {day.best.wing} m²
            </span>
          ) : (
            <span>
              {day.hasWind ? "No two-hour window" : "Beyond the forecast"}
            </span>
          )}
          {day.rows.some((row) => row.step === 3) && <span>3-hourly</span>}
        </p>
      </div>
      <div className={s.scroller()}>
        <table className={s.table()}>
          <caption className="sr-only">
            {spotName}, {names.full}: forecast by the hour, rated for{" "}
            {riderText}. Wind in {unitText}. Times are Irish.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={s.th()}>
                Time
              </th>
              <th scope="col" className={s.th()}>
                Rating
              </th>
              <th scope="col" className={s.th()}>
                Wind {unitText}
              </th>
              <th scope="col" className={s.th()}>
                From
              </th>
              <th
                scope="col"
                className={s.th({ className: s.hidden() })}
                title="The wind lifted toward the gusts, as a foil rides it"
              >
                Rides like
              </th>
              <th scope="col" className={s.th()} title="Wing size, m²">
                Wing
              </th>
              <th scope="col" className={s.th({ className: s.hidden() })}>
                Session
              </th>
              <th scope="col" className={s.th({ className: s.hidden() })}>
                Waves
              </th>
              <th scope="col" className={s.th({ className: s.hidden() })}>
                Sky
              </th>
              <th scope="col" className={s.th({ className: s.hidden() })}>
                Rain
              </th>
              <th scope="col" className={s.th({ className: s.hidden() })}>
                Models
              </th>
              <th scope="col" className={s.th()}>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {nightToggle(before, "before")}
            {showNight && before.map(hourRow)}
            {light.map(hourRow)}
            {nightToggle(after, "after")}
            {showNight && after.map(hourRow)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Everything one row's stars rest on, said in sentences. */
function HourDetail({
  row,
  units,
  unitText,
}: {
  row: SpotRow;
  units: Units;
  unitText: string;
}) {
  const s = styles();
  const { hour, rating } = row;
  const wind = hour.wind;
  const weather = presentWeather(hour.weather?.weather_code);
  return (
    <div className={s.detailGrid()} data-hour-detail>
      <div className="flex flex-col gap-1">
        <p className={s.detailHead()}>
          {rating
            ? ratingSentence(rating)
            : hour.daylight
              ? "No wind reading."
              : "Dark: not rated."}
        </p>
        {rating && rating.reasons.length > 0 && (
          <ul className={s.reasons()}>
            {rating.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {rating && rating.liftKn >= 1 && (
          <p className="m-0">
            Rides like {windIn(rating.rideKn, units)} {unitText} with the gusts.
          </p>
        )}
        {rating?.potential ? (
          <p className="m-0">
            {rating.wing.own === null
              ? `A ${rating.wing.recommended} m² wing would suit.`
              : `Your ${rating.wing.own} m² wing${
                  rating.wing.fit === "fits"
                    ? ""
                    : ` (${rating.wing.fit}: about ${rating.wing.recommended} m² would suit)`
                }.`}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {wind && (
          <p className="m-0">
            {wind.models} model{wind.models === 1 ? "" : "s"}:{" "}
            {windIn(wind.min_kn, units)}–{windIn(wind.max_kn, units)} {unitText}
            {wind.gust_max_kn !== null &&
              `, gusts to ${windIn(wind.gust_max_kn, units)}`}
            , from {compass(wind.direction_deg)} ({wind.direction_deg}°)
            {row.shore && `, ${SHORE_LABEL[row.shore]}`}.{" "}
            {wind.agreement && `${AGREEMENT_WORDS[wind.agreement]}.`}
          </p>
        )}
        {hour.waves?.height_m != null && (
          <p className="m-0">
            Waves {hour.waves.height_m.toFixed(1)} m
            {hour.waves.period_s != null && ` at ${hour.waves.period_s} s`}
            {hour.waves.direction_deg != null &&
              ` from ${compass(hour.waves.direction_deg)}`}
            .
          </p>
        )}
        {hour.weather && (
          <p className="m-0">
            {[
              weather?.description,
              hour.weather.air_c != null && `${hour.weather.air_c} °C`,
              hour.weather.rain_mm != null && `${hour.weather.rain_mm} mm rain`,
              hour.weather.cloud_pct != null &&
                `${hour.weather.cloud_pct}% cloud`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

const ratingSentence = (rating: HourRating) =>
  `${starsText(rating)} · ${SESSION_LABEL[rating.session]}${
    rating.shore ? ` · ${SHORE_LABEL[rating.shore]}` : ""
  }`;
