import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  CloudRain,
  CloudSun,
  Layers3,
  Navigation2,
  Thermometer,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import { loopPath } from "../ui/penPaths";
// Only when asked for: the chart's Blend view.
const BlendChart = lazy(() => import("./BlendChart"));
import { SeaTempGlyph, StarToggle, WindArrow, WingGlyph } from "./glyphs";
import {
  axisTicks,
  candleGroups,
  modelSupport,
  niceMax,
  valueScale,
} from "./chart";
import type { PlaceHour } from "./ratings";
import WeatherGlyph from "./WeatherGlyph";
import {
  clock,
  columnAtX,
  dayBest,
  dayLong,
  dayStep,
  dayShort,
  hourLabel,
  rainColumns,
  stripGeometry,
  stripTrack,
  type DayBest,
  type StripColumn,
  type StripDay,
  type StripGeometry,
} from "./strip";
import {
  useBlend,
  useSpotSeaTemperature,
  useSpotWaves,
  useSpotWeather,
  type SpotWaves,
  type SpotWeather,
  type SeaTemperatureState,
} from "./useBlend";
import { presentWeather } from "../force5/src/surface";
import { variableValue } from "../force5/src/variables";
import { seaTemperatureText } from "../force5/src/seaTemperature";
import type { ModelAvailability } from "../force5/src/manifests";
import { spotSquare } from "../force5/src/spotData";
import { useSpotSquares } from "./useSpotSquares";
import type { Prefs } from "../force5/src/prefs";
import {
  SESSION_LABEL,
  SHORE_LABEL,
  shoreAngle,
  starsText,
} from "../force5/src/stars";
import { dayNights } from "../force5/src/sun";
import { daylightOn } from "./ratings";
import { eventsBetween, tideAt, type SpotTide } from "../force5/src/tides";
import { convert, type Units } from "../force5/src/units";
import { compass, type Spot } from "../force5/src/weather";
import { spotHref } from "../force5/src/siteNav";

export type DockView = "table" | "blend";

interface Props {
  spot: Spot;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  hours: PlaceHour[] | undefined;
  /** The selected column. */
  selected: number;
  /** Move the time; `final` once a gesture has come to rest. */
  onSelect: (column: number, final: boolean) => void;
  now: number;
  prefs: Prefs;
  models: readonly ModelAvailability[];
  /**
   * Ask for every wind model's manifest: the blend chart and the model list
   * read them, and the map's stars, from the published blend, do not.
   */
  onWantModels?: () => void;
  starred: boolean;
  onToggleStar: () => void;
  tide: SpotTide | null;
  phone: boolean;
  view: DockView;
  onView: (view: DockView) => void;
  reducedMotion: boolean;
  /** The run that reaches the selected hour, when the map's run does not. */
  reachable: { id: string; name: string } | null;
  onShowOnMap: () => void;
  /** A point tapped on the map rather than a riding place. */
  isPoint: boolean;
  /** Its forecast is still being read out of the map's frames. */
  pointPending?: boolean;
  /** The waves, weather and sea rows, opened by the head's chevron. */
  more: boolean;
  onMore: (more: boolean) => void;
  /** The wave and weather manifests, once the rows have been opened. */
  marine: readonly ModelAvailability[];
}

const ROWS = {
  day: 20,
  hour: 18,
  stars: 20,
  wind: 20,
  from: 20,
  wing: 20,
  tide: 40,
  blend: 100,
  waves: 20,
  sky: 20,
  air: 20,
  rain: 20,
  sea: 20,
};
/** The table's rows under the hours: a point in open water has no stars or wing. */
const tableRows = (isPoint: boolean) =>
  (isPoint ? 0 : ROWS.stars + ROWS.wing) + ROWS.wind + ROWS.from;
const MORE_ROWS = ["waves", "sky", "air", "rain", "sea"] as const;
type MoreRow = (typeof MORE_ROWS)[number];
/**
 * Each row's name as a glyph, with the name and unit in its title: the rows
 * read by their figures, and a word per row took a column of the dock's
 * width from the hours.
 */
type RowGlyph = LucideIcon | typeof WingGlyph;
const MORE_LABEL: Record<MoreRow, [RowGlyph, string]> = {
  waves: [Waves, "Waves, m"],
  sky: [CloudSun, "Sky"],
  air: [Thermometer, "Air, °C"],
  rain: [CloudRain, "Rain, mm"],
  sea: [SeaTempGlyph, "Sea, °C"],
};
const RowLabel = ({
  glyph: Glyph,
  title,
}: {
  glyph: RowGlyph;
  title: string;
}) => (
  <span className="dk-glyph" title={title}>
    <Glyph size={14} strokeWidth={1.6} aria-hidden="true" />
  </span>
);
/** Rain, in millimetres over one step, that saturates a cell's tint. */
const RAIN_FULL_MM = 4;
/**
 * Pixels per star for an hour's cell: the row's size where the column is wide
 * enough, else as large as five stars and their gaps fit with a little air.
 */
const starSize = (width: number, full: number) =>
  Math.max(4, Math.min(full < 60 ? 8.6 : 9.5, (width - 6) / 5.4));

/**
 * The fewest stars the pen will loop. A day whose best is one star still has
 * a best stretch, and it is usually the longest (a whole day of barely
 * anything), so looping every day's best gave the weakest days the biggest
 * rings. A loop says "go then"; a window that is not worth riding gets none.
 * The spot page's pen keeps the same rule.
 */
const LOOP_MIN_STARS = 2;

/** The mono face's advance at the tide labels' 9.5px, for laying them out. */
const TIDE_CHAR = 5.75;

const range = (cols: readonly StripColumn[], best: DayBest) =>
  best.from === best.to
    ? clock(cols[best.from].time)
    : `${clock(cols[best.from].time)}–${clock(cols[best.to].time)}`;

/**
 * Where the wind goes, as one arrow and no letters: red where it blows off
 * the beach, so the one warning the old shore glyph gave is kept. The words
 * are for a screen reader only.
 */
function FromCell({ from, facing }: { from: number; facing: number | null }) {
  const angle = facing === null ? null : shoreAngle(from, facing);
  const off = angle === "offshore" || angle === "cross-off";
  return (
    <span
      className={`from-cell${off ? " is-off" : ""}`}
      role="img"
      aria-label={`From ${compass(from)}${angle ? `, ${SHORE_LABEL[angle]}` : ""}`}
    >
      <WindArrow from={from} size={13} />
    </span>
  );
}

/** The strip's table: built when the data changes, never when the time does. */
const StripTable = memo(function StripTable({
  spot,
  columns,
  days,
  hours,
  daylight,
  units,
  tide,
  g,
  now,
  blend,
  more,
  waves,
  weather,
  sea,
  isPoint,
}: {
  spot: Spot;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  hours: PlaceHour[] | undefined;
  /** Whether each column is in daylight at the place: its hatching. */
  daylight: readonly boolean[];
  units: Units;
  tide: SpotTide | null;
  g: StripGeometry;
  now: number;
  blend: React.ReactNode | null;
  more: boolean;
  waves: SpotWaves;
  weather: SpotWeather;
  sea: SeaTemperatureState;
  isPoint: boolean;
}) {
  const facing = spot.facing ?? null;
  const full = Math.max(...g.w, 0);
  const cells = (
    key: string,
    render: (
      hour: PlaceHour | undefined,
      column: StripColumn,
      at: number,
    ) => React.ReactNode,
  ) =>
    columns.map((column, at) => {
      const hour = hours?.[at];
      // The sun's, not the ratings': a night column is hatched from the
      // first paint, before (and whether or not) its hours are worked out.
      const night = !daylight[at];
      const first = at === 0 || columns[at - 1].date !== column.date;
      return (
        <td
          key={`${key}-${column.validTime}`}
          data-i={at}
          className={
            [
              night ? "night" : "",
              column.time + 3600000 <= now ? "past" : "",
              first ? "d0" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {render(hour, column, at)}
        </td>
      );
    });
  const speed = (kn: number | null) =>
    kn === null ? "" : Math.round(convert(kn / 1.94384449, units));
  return (
    <table className="tt" style={{ width: g.total }}>
      <colgroup>
        {columns.map((c, at) => (
          <col key={c.validTime} style={{ width: g.w[at] }} />
        ))}
      </colgroup>
      <tbody>
        <tr className="tt-day">
          {days.map((day) => {
            const best = hours
              ? dayBest(
                  hours.map((h) => h.rating),
                  day,
                )
              : null;
            const end = day.start + day.count - 1;
            const width = g.x[end] + g.w[end] - g.x[day.start];
            // What the day's heading has room for, before it runs into the
            // next day's: the name, its best stars, then when. A day of two or
            // three coarse steps keeps its name and stars and drops the
            // "best"; a single column keeps the weekday. The cell clips
            // whatever is left, and its title still says it all.
            const fit =
              width >= 190
                ? "all"
                : width >= 120
                  ? "stars"
                  : width >= 66
                    ? "name"
                    : "day";
            const starred = best && best.stars > 0;
            return (
              <td
                key={day.date}
                colSpan={day.count}
                className={`d0 fit-${fit}`}
                title={`${dayLong(day.noon)} ${Number(day.date.slice(8))}${
                  starred
                    ? ` · best ${range(columns, best)}, ${best.stars} of 5 stars`
                    : ""
                }`}
              >
                <span>
                  <b>
                    {dayShort(day.noon)}
                    <small> {Number(day.date.slice(8))}</small>
                  </b>
                  {starred && (
                    <>
                      <em>
                        <StarGlyphs
                          stars={best.stars}
                          potential={hours![best.from]!.rating!.potential}
                          size={8}
                        />
                      </em>
                    </>
                  )}
                </span>
              </td>
            );
          })}
        </tr>
        <tr className="tt-hour">
          {cells("h", (_, column) => hourLabel(column.time))}
        </tr>
        {blend ? (
          <tr className="tt-blend">
            <td colSpan={columns.length} className="d0 blend-cell">
              {blend}
            </td>
          </tr>
        ) : (
          <>
            {!isPoint && (
              <tr className="tt-stars">
                {cells("s", (hour, column, at) =>
                  hour?.rating ? (
                    // Just the stars: a card on hover covered the chart for
                    // a reading the head and the ? already give.
                    <StarGlyphs
                      className="hour-stars"
                      stars={hour.rating.stars}
                      potential={hour.rating.potential}
                      size={starSize(g.w[at], full)}
                      slots="potential"
                      label={`${clock(column.time)}: ${
                        hour.rating.potential
                          ? starsText(hour.rating)
                          : `No stars, ${SESSION_LABEL[hour.rating.session].toLowerCase()}`
                      }`}
                    />
                  ) : null,
                )}
              </tr>
            )}
            <tr className="tt-wind">
              {cells("w", (hour) =>
                hour && hour.windKn !== null ? (
                  <>
                    <span className="kn">{speed(hour.windKn)}</span>
                    {hour.gustKn !== null && (
                      <span className="gu"> g{speed(hour.gustKn)}</span>
                    )}
                  </>
                ) : (
                  "–"
                ),
              )}
            </tr>
            <tr className="tt-from">
              {cells("f", (hour) =>
                hour && hour.from !== null ? (
                  <FromCell from={hour.from} facing={facing} />
                ) : null,
              )}
            </tr>
            {!isPoint && (
              <tr className="tt-wing">
                {cells("g", (hour) =>
                  hour?.rating?.potential
                    ? (hour.rating.wing.own ?? hour.rating.wing.recommended)
                    : "",
                )}
              </tr>
            )}
          </>
        )}
        <tr className="tt-tide">
          <td colSpan={columns.length} className="d0">
            <TideRow
              tide={tide}
              columns={columns}
              days={days}
              g={g}
              daylight={daylight}
            />
          </td>
        </tr>
        {more && (
          <MoreRows
            columns={columns}
            cells={cells}
            g={g}
            waves={waves}
            weather={weather}
            sea={sea}
            isPoint={isPoint}
          />
        )}
      </tbody>
    </table>
  );
});

/** Where a time falls along the strip, between its columns' centres. */
function xOf(
  columns: readonly StripColumn[],
  day: StripDay,
  g: StripGeometry,
  t: number,
) {
  const a = day.start;
  const b = day.start + day.count - 1;
  const centre = (i: number) => g.x[i] + g.w[i] / 2;
  const step = (i: number, j: number) => columns[j].time - columns[i].time;
  if (t <= columns[a].time) {
    const span = day.count > 1 ? step(a, a + 1) : 3600000;
    return centre(a) - ((columns[a].time - t) / span) * g.w[a];
  }
  if (t >= columns[b].time) {
    const span = day.count > 1 ? step(b - 1, b) : 3600000;
    return centre(b) + ((t - columns[b].time) / span) * g.w[b];
  }
  for (let i = a; i < b; i++)
    if (t <= columns[i + 1].time)
      return (
        centre(i) +
        ((t - columns[i].time) / step(i, i + 1)) * (centre(i + 1) - centre(i))
      );
  return centre(b);
}

/**
 * The rows below the fold: the sea, the sky, the air and the rain, one native
 * step per column (a code or an amount does not survive being interpolated),
 * and the water's measured temperature where a station is in range.
 */
function MoreRows({
  columns,
  cells,
  g,
  waves,
  weather,
  sea,
  isPoint,
}: {
  columns: readonly StripColumn[];
  cells: (
    key: string,
    render: (
      hour: PlaceHour | undefined,
      column: StripColumn,
      at: number,
    ) => React.ReactNode,
  ) => React.ReactNode;
  g: StripGeometry;
  waves: SpotWaves;
  weather: SpotWeather;
  sea: SeaTemperatureState;
  isPoint: boolean;
}) {
  const span = (key: string, text: string) => (
    <tr className={`tt-more tt-${key}`} key={key}>
      <td colSpan={columns.length} className="d0 more-note">
        {text}
      </td>
    </tr>
  );
  if (isPoint)
    return (
      <>
        {span("waves", "Waves, weather and the sea: riding places only")}
        {MORE_ROWS.slice(1).map((key) => (
          <tr className={`tt-more tt-${key}`} key={key}>
            <td colSpan={columns.length} className="d0" />
          </tr>
        ))}
      </>
    );
  const set = waves.source?.fields.total ?? null;
  const fields = weather.source?.fields;
  const at = (column: number, name: string | null | undefined) =>
    variableValue(weather.columns[column], name);
  const row = (key: MoreRow, render: (column: number) => React.ReactNode) => (
    <tr className={`tt-more tt-${key}`} key={key}>
      {cells(key, (_, __, column) => render(column))}
    </tr>
  );
  const observed = sea.observed;
  // The rain's intervals, against the columns: see `rainColumns`.
  const series = weather.source?.series ?? [];
  const rain = fields?.rain
    ? rainColumns(
        columns.map((c) => c.time),
        series,
      )
    : [];
  return (
    <>
      {waves.source && set
        ? row("waves", (column) => {
            const step = waves.columns[column];
            const height = step ? step.values[set.height] : null;
            if (typeof height !== "number") return "–";
            const period = set.period ? step!.values[set.period] : null;
            const dir = set.direction ? step!.values[set.direction] : null;
            // A coarse column holds the arrow and the height; the period
            // stays in the title rather than running into the next cell.
            const roomy = g.w[column] >= 58;
            return (
              <span
                className="wave-cell"
                title={`${height.toFixed(1)} m${typeof period === "number" ? ` at ${Math.round(period)} s` : ""}${typeof dir === "number" ? ` from ${compass(dir)}` : ""}`}
              >
                {typeof dir === "number" && (
                  <ArrowDown
                    size={11}
                    strokeWidth={1.6}
                    style={{ transform: `rotate(${dir}deg)` }}
                    aria-label={`from ${compass(dir)}`}
                  />
                )}
                <b>{height.toFixed(1)}</b>
                {roomy && typeof period === "number" && (
                  <small>{Math.round(period)}s</small>
                )}
              </span>
            );
          })
        : span(
            "waves",
            waves.published
              ? "No wave model reaches this spot"
              : "Waves: reading…",
          )}
      {fields
        ? row("sky", (column) => {
            const reading = presentWeather(at(column, fields.present));
            return reading ? (
              <span title={reading.description}>
                <WeatherGlyph weather={reading} size={14} />
              </span>
            ) : (
              "–"
            );
          })
        : span(
            "sky",
            weather.published
              ? "No weather model reaches this spot"
              : "Weather: reading…",
          )}
      {fields
        ? row("air", (column) => {
            const value = at(column, fields.air);
            return value === null ? "–" : `${Math.round(value)}°`;
          })
        : span("air", "")}
      {fields
        ? row("rain", (column) => {
            // A total belongs to its interval, and to no other hour. Every
            // other row may borrow the nearest step for a column between two,
            // but a three-hour total read into each of three hourly columns
            // says three times the rain. So the interval's last column prints
            // it and the others in it carry its tint and a dot; the title
            // says which interval either way, since the steps need not fall
            // on the columns' hours.
            const covered = rain[column];
            const value = covered
              ? variableValue(series[covered.step], fields.rain)
              : null;
            if (!covered || value === null) return "–";
            const amount = value < 0.05 ? "0" : value.toFixed(1);
            const own = covered.own;
            const exact = Math.abs(covered.end - columns[column].time) <= 60000;
            return (
              <span
                className={`rain-cell${own ? "" : " is-part"}`}
                style={
                  {
                    "--rain": Math.min(1, value / RAIN_FULL_MM).toFixed(2),
                  } as React.CSSProperties
                }
                title={
                  own && exact
                    ? `${amount} mm in the ${covered.hours} h to here`
                    : `${amount} mm in the ${covered.hours} h to ${clock(covered.end)}${own ? "" : ", printed at the last column it covers"}`
                }
              >
                {own ? amount : "·"}
              </span>
            );
          })
        : span("rain", "")}
      {observed
        ? (() => {
            const text = seaTemperatureText(observed);
            return span("sea", `${text.value} measured · ${text.detail}`);
          })()
        : fields?.skin
          ? row("sea", (column) => {
              const value = at(column, fields.skin);
              return value === null ? (
                "–"
              ) : (
                <span
                  className="proxy"
                  title="The model's skin temperature: approximate, not a measurement"
                >
                  ~{Math.round(value)}°
                </span>
              );
            })
          : span("sea", sea.loading ? "" : "No sea temperature here")}
    </>
  );
}

/**
 * The tide under the hours: a curve per day, its turns named. Each turn gets
 * a dot on the curve and a short label, "High 17:35", in a band of its own:
 * the highs along the top of the row and the lows along the foot, so the two
 * never meet however close the curve brings them. Where the three- and
 * six-hourly columns narrow, two turns can stand a column apart; a label that
 * would run into the one before it in its band tries the other side of its
 * dot, and failing that is left out. The dot stays, and its title (and the
 * row's) carries the time and the height in full.
 *
 * Behind it, the night's columns are hatched as the cells over them are, so
 * the dark hours run down the dock as one band from the hours to the foot.
 */
function TideRow({
  tide,
  columns,
  days,
  g,
  daylight,
}: {
  tide: SpotTide | null;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  g: StripGeometry;
  daylight: readonly boolean[];
}) {
  const H = ROWS.tide;
  const width = g.total;
  const hatch = `tide-hatch-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  // One rect per run of dark columns, edge to edge, as the cells above it.
  const dark: { x: number; w: number }[] = [];
  columns.forEach((_, at) => {
    if (daylight[at]) return;
    const last = dark[dark.length - 1];
    if (last && last.x + last.w === g.x[at]) last.w += g.w[at];
    else dark.push({ x: g.x[at], w: g.w[at] });
  });
  const night = dark.length > 0 && (
    <g className="tide-night" aria-hidden="true">
      <defs>
        <pattern
          id={hatch}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect className="tide-hatch" width="1" height="4" />
        </pattern>
      </defs>
      {dark.map((run) => (
        <rect
          key={run.x}
          x={run.x}
          y="0"
          width={run.w}
          height={H}
          fill={`url(#${hatch})`}
        />
      ))}
    </g>
  );
  if (!tide)
    return (
      <svg width={width} height={H} className="tide-row" aria-hidden="true">
        {night}
        <text className="tide-none" x="8" y="24">
          No tide station near
        </text>
      </svg>
    );
  const curve = tide.curve;
  const lo = Math.min(...curve.curve);
  const hi = Math.max(...curve.curve);
  const y = (h: number) => H - 6 - ((h - lo) / (hi - lo || 1)) * (H - 14);
  const paths: React.ReactNode[] = [];
  const turns: {
    key: string;
    X: number;
    Y: number;
    high: boolean;
    text: string;
    full: string;
  }[] = [];
  days.forEach((day) => {
    const first = columns[day.start];
    const last = columns[day.start + day.count - 1];
    const half =
      day.count > 1 ? (columns[day.start + 1].time - first.time) / 2 : 1800000;
    const halfEnd =
      day.count > 1
        ? (last.time - columns[day.start + day.count - 2].time) / 2
        : 1800000;
    const a = first.time - half;
    const b = last.time + halfEnd;
    let d = "";
    for (let t = a; t <= b; t += 600000) {
      const h = tideAt(curve, t);
      if (h === null) continue;
      d += `${d ? "L" : "M"}${xOf(columns, day, g, t).toFixed(1)} ${y(h).toFixed(1)}`;
    }
    if (!d) return;
    const x0 = xOf(columns, day, g, a);
    const x1 = xOf(columns, day, g, b);
    paths.push(
      <g key={day.date}>
        <path
          className="tide-fill"
          d={`${d}L${x1.toFixed(1)} ${H}L${x0.toFixed(1)} ${H}Z`}
        />
        <path className="tide-line" d={d} />
      </g>,
    );
    for (const event of eventsBetween(curve, a, b)) {
      // A turn on the stroke of a day's edge falls in both days' spans.
      if (turns.some((turn) => turn.key === event.time)) continue;
      const t = Date.parse(event.time);
      const high = event.kind === "high";
      const word = high ? "High" : "Low";
      turns.push({
        key: event.time,
        X: xOf(columns, day, g, t),
        Y: y(event.height),
        high,
        text: clock(t),
        full: `${word} tide ${clock(t)} · ${event.height.toFixed(1)} m`,
      });
    }
  });
  // Lay each band's labels out left to right: beside the dot after it, else
  // before it, else not at all.
  const placed = new Map<string, { x: number; anchor: "start" | "end" }>();
  for (const high of [true, false]) {
    let edge = -Infinity;
    for (const turn of turns
      .filter((t) => t.high === high)
      .sort((p, q) => p.X - q.X)) {
      const w = turn.text.length * TIDE_CHAR;
      const after = turn.X + 5;
      const before = turn.X - 5 - w;
      // Nor over another turn's dot where that dot reaches into the band.
      const clear = (from: number) =>
        !turns.some(
          (o) =>
            o !== turn &&
            o.X > from - 4 &&
            o.X < from + w + 4 &&
            (high ? o.Y < 16 : o.Y > H - 14),
        );
      if (after >= edge + 8 && after + w <= width && clear(after)) {
        placed.set(turn.key, { x: after, anchor: "start" });
        edge = after + w;
      } else if (before >= Math.max(0, edge + 8) && clear(before)) {
        placed.set(turn.key, { x: turn.X - 5, anchor: "end" });
        edge = turn.X - 5;
      }
    }
  }
  return (
    <svg
      width={width}
      height={H}
      className="tide-row"
      role="img"
      aria-label={`Tide at ${tide.station.name}, metres above chart datum`}
    >
      {night}
      {paths}
      {turns.map((turn) => {
        const label = placed.get(turn.key);
        return (
          <g key={turn.key}>
            <title>{turn.full}</title>
            <circle
              className={turn.high ? "tide-hw" : "tide-lw"}
              cx={turn.X.toFixed(1)}
              cy={turn.Y.toFixed(1)}
              r="2.6"
            />
            {label && (
              <text
                className="tide-label"
                x={label.x.toFixed(1)}
                y={turn.high ? 10 : H - 2}
                textAnchor={label.anchor}
              >
                {turn.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const NO_MODELS: readonly ModelAvailability[] = [];

export default function ForecastDock(props: Props) {
  const {
    spot,
    columns,
    days,
    hours,
    selected,
    onSelect,
    now,
    prefs,
    models,
    onWantModels,
    starred,
    onToggleStar,
    tide,
    phone,
    view,
    onView,
    reducedMotion,
    reachable,
    onShowOnMap,
    isPoint,
    more,
    onMore,
    marine,
  } = props;
  const cw = phone ? 52 : 62;
  const label = phone ? 28 : 32;
  // A phone keeps its coarse columns nearly whole: "15 g17" has to fit.
  const g = useMemo(
    () => stripGeometry(columns, cw, phone ? cw - 4 : Math.round(cw * 0.8)),
    [columns, cw, phone],
  );
  const centre = (i: number) => (g.x[i] ?? 0) + (g.w[i] ?? cw) / 2;
  const wrap = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  useEffect(() => {
    if (view === "blend" && !isPoint) onWantModels?.();
  }, [view, isPoint]);
  const penClip = `pen-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  // The scroll that brings each hour under the cursor, and where the cursor
  // stands at a scroll: still in the middle through the week, walking out to
  // the ends so the first hour sits against the labels (see `stripTrack`).
  const track = useMemo(() => stripTrack(g, wrapWidth), [g, wrapWidth]);
  const cursor = useRef<HTMLDivElement>(null);
  const placeCursor = () => {
    const el = wrap.current;
    if (el && cursor.current)
      cursor.current.style.left = `${label + track.cursorAt(el.scrollLeft)}px`;
  };
  const column = columns[selected];

  // The blend, only while it is the view: the chart reads every member. The
  // manifests carry no spot data, so each model's one square holding this spot
  // is read for it, and for the waves and weather rows, and nothing else.
  const axis = useMemo(() => columns.map((c) => c.validTime), [columns]);
  const square = useMemo(
    () => (isPoint ? null : [spotSquare(spot.lat, spot.lon)]),
    [isPoint, spot.lat, spot.lon],
  );
  const blendModels = useSpotSquares(
    view === "blend" ? models : NO_MODELS,
    square,
  );
  const marineModels = useSpotSquares(more ? marine : NO_MODELS, square);
  const blend = useBlend(
    view === "blend" && !isPoint ? blendModels : NO_MODELS,
    prefs.blendModels,
    spot.id,
    axis,
  );
  // Which columns are dark at this place, by the same sun the stars go by.
  const daylight = useMemo(
    () => daylightOn(spot, axis),
    [spot.lat, spot.lon, axis],
  );
  const named = isPoint ? undefined : spot.id;
  const waves = useSpotWaves(more ? marineModels : NO_MODELS, named, axis);
  const weather = useSpotWeather(more ? marineModels : NO_MODELS, named, axis);
  const sea = useSpotSeaTemperature(more ? named : undefined);
  // The top of the blend's scale, shared by the chart and its tick labels
  // in the label column (which stay put while the hours scroll).
  const blendMax = useMemo(() => {
    const peak = blend.stats.reduce(
      (top, hour) => Math.max(top, hour.max ?? 0, hour.gust.max ?? 0),
      0,
    );
    return niceMax(convert(peak, prefs.units));
  }, [blend.stats, prefs.units]);
  const blendNode = useMemo(() => {
    if (view !== "blend") return null;
    if (!blend.lines.length)
      return <p className="blend-empty">Reading the models…</p>;
    const nights = dayNights(
      spot.lat,
      spot.lon,
      new Date(axis[0]),
      new Date(axis[axis.length - 1]),
    );
    return (
      <Suspense fallback={<p className="blend-empty">Reading the models…</p>}>
        <BlendChart
          width={g.total}
          height={ROWS.blend}
          centres={columns.map((_, i) => g.x[i] + g.w[i] / 2)}
          columns={columns}
          groups={candleGroups(axis)}
          support={modelSupport(blend.lines, axis.length)}
          stats={blend.stats}
          lines={blend.lines}
          directions={blend.directions}
          nights={nights}
          units={prefs.units}
          max={blendMax}
          reducedMotion={reducedMotion}
        />
      </Suspense>
    );
  }, [
    view,
    blend,
    blendMax,
    columns,
    g,
    prefs.units,
    reducedMotion,
    spot.lat,
    spot.lon,
  ]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWrapWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ---- the strip scrolls the time, and the time scrolls the strip ---- */
  const fromScroll = useRef(-1);
  /**
   * Where the strip is being scrolled to by the time, not by the reader:
   * until it gets there its scroll events say nothing about the time. The
   * reader's own wheel, touch or key takes over at once.
   */
  const programmatic = useRef<{ left: number; until: number } | null>(null);
  const scrollFrame = useRef(0);
  const scrollEnd = useRef(0);
  const scrollTo = (index: number, smooth: boolean) => {
    const el = wrap.current;
    if (!el) return;
    // The column's centre under the cursor.
    const left = track.scrollFor(index);
    if (Math.abs(el.scrollLeft - left) < 1) return placeCursor();
    const animate = smooth && !reducedMotion;
    clearTimeout(scrollEnd.current);
    // Where the browser will actually stop: the strip's own end, at most.
    const reach = Math.min(left, el.scrollWidth - el.clientWidth);
    programmatic.current = { left: reach, until: performance.now() + 1500 };
    el.scrollTo({ left, behavior: animate ? "smooth" : "auto" });
  };
  useLayoutEffect(() => {
    if (fromScroll.current === selected) return;
    scrollTo(selected, true);
  }, [selected, track, view, more]);
  // A fresh place opens on the same hour, not wherever the last one was left.
  const placeKey = isPoint ? `${spot.lat},${spot.lon}` : spot.id;
  useLayoutEffect(() => {
    fromScroll.current = -1;
    scrollTo(selected, false);
  }, [placeKey]);

  const onScroll = () => {
    placeCursor();
    const going = programmatic.current;
    if (going) {
      const el = wrap.current;
      if (el && Math.abs(el.scrollLeft - going.left) < 2)
        programmatic.current = null;
      if (performance.now() < going.until) return;
      programmatic.current = null;
    }
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const el = wrap.current;
      if (!el) return;
      const i = columnAtX(g, track.timeAt(el.scrollLeft));
      fromScroll.current = i;
      onSelect(i, false);
      clearTimeout(scrollEnd.current);
      scrollEnd.current = window.setTimeout(() => {
        onSelect(i, true);
      }, 180);
    });
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(scrollFrame.current);
      clearTimeout(scrollEnd.current);
    },
    [],
  );

  // The wheel moves the hours: the dock scrolls one way only, so an up or
  // down turn of a mouse wheel goes through time without Shift. A trackpad's
  // own sideways swipe, and a phone's, are left to the browser.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || !event.deltaY)
        return;
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += event.deltaY * unit;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The cursor, where the scroll has put it; and the selected column, marked
  // in place rather than by re-rendering the table.
  useLayoutEffect(placeCursor);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.querySelectorAll("td.c-sel").forEach((td) =>
      td.classList.remove("c-sel"),
    );
    el.querySelectorAll(`td[data-i="${selected}"]`).forEach((td) =>
      td.classList.add("c-sel"),
    );
  });

  const ratings = hours?.map((h) => h.rating);

  // The red pen: a loop round each day's best stretch worth riding, round the
  // stars and the wind. It keeps below the hours' rule: the loop's own
  // wobble and overshoot (ui/penPaths.ts) reach a sixth past its radii, so
  // the radii are held inside the two rows and the sheet is clipped at the
  // rule for the odd stroke that still reaches it.
  const loopTop = ROWS.day + ROWS.hour;
  const loops = useMemo(() => {
    if (!ratings || view !== "table") return [];
    const top = loopTop;
    const bottom = top + ROWS.stars + ROWS.wind;
    return days.flatMap((day, d) => {
      const best = dayBest(
        ratings,
        day,
        now,
        columns.map((c) => c.time),
      );
      if (!best || best.stars < LOOP_MIN_STARS) return [];
      const x0 = g.x[best.from];
      const x1 = g.x[best.to] + g.w[best.to];
      return [
        {
          key: `${day.date}-${best.from}`,
          d: loopPath(
            (x0 + x1) / 2,
            (top + bottom) / 2 + 1,
            (x1 - x0) / 2 + 4,
            (bottom - top) / 2 - 2,
            d * 13 + best.from,
          ),
          delay: d * 90,
        },
      ];
    });
  }, [ratings, days, columns, g, now, view]);

  const tideDot = useMemo(() => {
    if (!tide || !column) return null;
    const h = tideAt(tide.curve, column.time);
    if (h === null) return null;
    const lo = Math.min(...tide.curve.curve);
    const hi = Math.max(...tide.curve.curve);
    const top =
      ROWS.day +
      ROWS.hour +
      (view === "blend" ? ROWS.blend : tableRows(isPoint));
    return {
      x: centre(selected),
      y: top + ROWS.tide - 6 - ((h - lo) / (hi - lo || 1)) * (ROWS.tide - 14),
    };
  }, [tide, column, selected, g, view]);

  return (
    <section className="dock" aria-label={`Forecast for ${spot.name}`}>
      <div className="dk-head">
        {!isPoint && (
          <StarToggle
            on={starred}
            name={spot.name}
            onToggle={onToggleStar}
            size={19}
          />
        )}
        <h2 className="dk-name">{spot.name}</h2>
        {/* A point's place name is a guess at where it is, so its
            coordinates stay; a riding place's name is enough on its own. */}
        {isPoint && spot.county && (
          <span className="dk-coords">{spot.county}</span>
        )}
        <div className="dk-acts">
          <Segmented
            className="dk-view"
            aria-label="Show the hours as"
            options={[
              { value: "table", label: "Table" },
              { value: "blend", label: "Blend", disabled: isPoint },
            ]}
            value={view}
            onChange={onView}
          />
          {!isPoint && (
            <Button
              variant="primary"
              size="sm"
              href={spotHref(spot.id)}
              data-spot-page-link
            >
              Spot page →
            </Button>
          )}
          {/* The dock's one fold: the waves, the sky, the air, the rain and
              the sea, under the rows that are always there. Up to open, as a
              sheet along the foot of the screen grows upwards. */}
          <Button
            variant="pill"
            size="sm"
            icon
            className="dk-chev"
            aria-label={
              more ? "Hide waves, sky and sea" : "Show waves, sky and sea"
            }
            title={more ? "Fewer rows" : "More rows"}
            aria-expanded={more}
            onClick={() => onMore(!more)}
          >
            <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden="true">
              <path
                d={more ? "M1 1.5L7 7.5L13 1.5" : "M1 7.5L7 1.5L13 7.5"}
                fill="none"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>
      </div>

      {/* The time, for a keyboard and a screen reader: the hours scrolling
          under the cursor are the slider a finger and a mouse use, and this
          steps them. Out of sight; its focus ring is drawn on the hours. */}
      <input
        type="range"
        className="sr-only dk-time"
        aria-label="Forecast time"
        min={0}
        max={Math.max(0, columns.length - 1)}
        step={1}
        value={selected}
        aria-valuetext={
          column ? `${dayLong(column.time)} ${clock(column.time)}` : ""
        }
        onChange={(event) => onSelect(Number(event.target.value), true)}
        onKeyDown={(event) => {
          // A day at a time with Page Up and Page Down, to the same hour.
          if (event.key !== "PageUp" && event.key !== "PageDown") return;
          event.preventDefault();
          onSelect(
            dayStep(columns, days, selected, event.key === "PageUp" ? 1 : -1),
            true,
          );
        }}
      />

      {reachable && (
        <div className="map-reach" role="status">
          <button
            type="button"
            className="map-reach-chip"
            onClick={onShowOnMap}
          >
            <Layers3 size={13} strokeWidth={1.5} aria-hidden="true" />
            <span>Show {reachable.name} on the map</span>
          </button>
        </div>
      )}

      <div className="dk-body">
        <div
          className="dk-grid"
          style={{ gridTemplateColumns: `${label}px minmax(0, 1fr)` }}
        >
          <div className="dk-labs">
            <div aria-hidden="true" style={{ height: ROWS.day }} />
            <div aria-hidden="true" style={{ height: ROWS.hour }} />
            {view === "blend" ? (
              <div
                aria-hidden="true"
                className="dk-lab-blend"
                style={{ height: ROWS.blend }}
              >
                {/* No name: the chart is plainly the wind. Its unit, and
                      its gridlines numbered here where they stay put while
                      the hours scroll, on the chart's own scale. */}
                <small>{prefs.units}</small>
                {blend.lines.length > 0 &&
                  axisTicks(blendMax)
                    .slice(1)
                    .map((tick) => [
                      tick,
                      valueScale(blendMax, ROWS.blend)(tick),
                    ])
                    .map(([tick, top]) => (
                      <b key={tick} style={{ top }}>
                        {tick}
                      </b>
                    ))}
              </div>
            ) : (
              <>
                {/* The stars need no name: they are stars. */}
                {!isPoint && (
                  <div aria-hidden="true" style={{ height: ROWS.stars }} />
                )}
                {/* The wind keeps its unit, which the reader chooses. */}
                <div
                  aria-hidden="true"
                  className="dk-lab-wind"
                  style={{ height: ROWS.wind }}
                >
                  <RowLabel
                    glyph={Wind}
                    title={`Wind and gust, ${prefs.units}`}
                  />
                  <small>{prefs.units}</small>
                </div>
                <div aria-hidden="true" style={{ height: ROWS.from }}>
                  <RowLabel glyph={Navigation2} title="Where the wind goes" />
                </div>
                {!isPoint && (
                  <div aria-hidden="true" style={{ height: ROWS.wing }}>
                    <RowLabel glyph={WingGlyph} title="Wing, m²" />
                  </div>
                )}
              </>
            )}
            {/* The tide's curve needs no name, nor its times a unit. */}
            <div aria-hidden="true" style={{ height: ROWS.tide }} />
            {more &&
              MORE_ROWS.map((key) => (
                <div key={key} aria-hidden="true" style={{ height: ROWS[key] }}>
                  <RowLabel
                    glyph={MORE_LABEL[key][0]}
                    title={MORE_LABEL[key][1]}
                  />
                </div>
              ))}
          </div>

          <div
            className="tt-wrap"
            ref={wrap}
            tabIndex={0}
            onWheel={() => (programmatic.current = null)}
            onPointerDown={() => (programmatic.current = null)}
            onTouchStart={() => (programmatic.current = null)}
            onKeyDown={() => (programmatic.current = null)}
            aria-label="The week hour by hour: scroll sideways to move through time"
            onScroll={onScroll}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button, a")) return;
              const td = target.closest<HTMLElement>("td[data-i]");
              if (td) onSelect(Number(td.dataset.i), true);
            }}
          >
            <StripTable
              spot={spot}
              columns={columns}
              days={days}
              hours={hours}
              daylight={daylight}
              units={prefs.units}
              tide={tide}
              g={g}
              now={now}
              blend={blendNode}
              more={more}
              waves={waves}
              weather={weather}
              sea={sea}
              isPoint={isPoint}
            />
            {/* Where the scroll comes to rest: one mark per hour, at the
                  scroll that puts it under the cursor. The hours' own cells
                  cannot be the snap points, because at the ends of the strip
                  the cursor is not in the middle (see stripTrack). */}
            <div className="tt-snaps" aria-hidden="true">
              {columns.map((c, i) => (
                <i key={c.validTime} style={{ left: track.scrollFor(i) }} />
              ))}
            </div>
            <svg
              className="tt-pen"
              width={g.total}
              height={
                ROWS.day +
                ROWS.hour +
                (view === "blend" ? ROWS.blend : tableRows(isPoint)) +
                ROWS.tide +
                (more ? MORE_ROWS.reduce((h, k) => h + ROWS[k], 0) : 0)
              }
              aria-hidden="true"
            >
              <clipPath id={penClip}>
                <rect x="0" y={loopTop + 1} width={g.total} height="400" />
              </clipPath>
              <g clipPath={`url(#${penClip})`}>
                {loops.map((loop) => (
                  <path
                    key={`${spot.id}-${loop.key}`}
                    className="pen-loop"
                    d={loop.d}
                    pathLength={1}
                    style={{ animationDelay: `${loop.delay}ms` }}
                  />
                ))}
              </g>
              {tideDot && (
                <circle
                  className="tide-dot"
                  cx={tideDot.x}
                  cy={tideDot.y}
                  r="3.4"
                />
              )}
            </svg>
          </div>
          {/* The hour the map shows. No flag with the day and time: the
                day's heading stays in sight above it, and the hour cell under
                the line is inked. The line starts at the hours. */}
          <div
            ref={cursor}
            className="dk-cur"
            style={{ top: ROWS.day }}
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  );
}
