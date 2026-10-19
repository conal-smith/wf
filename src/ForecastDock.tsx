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
  ArrowUpRight,
  ChartSpline,
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
import { arrowPath, framePath, stemPath, type KeepOut } from "../ui/penPaths";
import { StarGlyphs } from "../ui/StarGlyphs";
// Only when asked for: the chart's Blend view.
const BlendChart = lazy(() => import("./BlendChart"));
import { SeaTempGlyph, StarToggle, WindArrow, WingGlyph } from "./glyphs";
import {
  axisTicks,
  candleGroups,
  modelSupport,
  niceMax,
  timeToX,
  valueScale,
} from "./chart";
import type { PlaceHour } from "./ratings";
import WeatherGlyph from "./WeatherGlyph";
import { wheelHours, type WheelHours } from "./wheelHours";
import {
  clock,
  columnAtX,
  dayLong,
  dayStep,
  dayShort,
  hourLabel,
  rainColumns,
  stripGeometry,
  stripTrack,
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
  noStarsWhy,
  SHORE_LABEL,
  shoreAngle,
  starsText,
} from "../force5/src/stars";
import { dayNights } from "../force5/src/sun";
import { daylightOn } from "./ratings";
import {
  eventsBetween,
  tideAt,
  tideStationLine,
  type SpotTide,
} from "../force5/src/tides";
import { convert, type Units } from "../force5/src/units";
import { compass, type Spot } from "../force5/src/weather";
import { spotHref } from "../force5/src/siteNav";

export type DockView = "table" | "blend";

interface Props {
  /** The place whose week the dock shows. With none chosen there is no dock. */
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
  /** Why the spot has no tide curve (a lake, no station near), when it has none. */
  tideNote?: string | null;
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
  /** Open "Your star rating", from the chip a rider's own stars put in the head. */
  onCustomStars?: () => void;
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
type Rows = typeof ROWS;
/**
 * A phone's: every row as tight as its figures allow, and tightest the ones
 * that stand blank through the night and on a calm day (the stars and the
 * wing) and the tide's band. The dock is a strip along the foot of the chart,
 * and every pixel of it is one the chart does not have. dock.css sets the
 * same heights on the cells.
 */
const PHONE_ROWS: Rows = {
  ...ROWS,
  day: 16,
  hour: 16,
  stars: 14,
  wind: 17,
  from: 15,
  wing: 15,
  tide: 22,
};
/**
 * The rows between the hours and the tide. The stars head both views; the
 * blend's chart stands in for the table's figures. A point in open water has
 * no stars or wing, and a week with no hour worth rating has neither row.
 */
const rowsAboveTide = (
  rows: Rows,
  view: DockView,
  isPoint: boolean,
  rated: boolean,
) =>
  (!isPoint && rated ? rows.stars : 0) +
  (view === "blend"
    ? rows.blend
    : rows.wind + rows.from + (!isPoint && rated ? rows.wing : 0));
const MORE_ROWS = ["waves", "sky", "air", "rain", "sea"] as const;
type MoreRow = (typeof MORE_ROWS)[number];
/** The height of the rows under the hours, as a spot's dock draws them. */
const rowsUnderHours = (
  rows: Rows,
  view: DockView,
  isPoint: boolean,
  rated: boolean,
  more: boolean,
) =>
  rowsAboveTide(rows, view, isPoint, rated) +
  rows.tide +
  (more ? MORE_ROWS.reduce((h, k) => h + rows[k], 0) : 0);
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

/** The mono face's advance at the tide labels' 9.5px, for laying them out. */
const TIDE_CHAR = 5.75;

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
  tideNote,
  g,
  now,
  blend,
  more,
  waves,
  weather,
  sea,
  isPoint,
  rated,
  tideHeight,
}: {
  spot: Spot;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  hours: PlaceHour[] | undefined;
  /** Whether each column is in daylight at the place: its hatching. */
  daylight: readonly boolean[];
  units: Units;
  tide: SpotTide | null;
  tideNote: string | null;
  g: StripGeometry;
  now: number;
  blend: React.ReactNode | null;
  more: boolean;
  waves: SpotWaves;
  weather: SpotWeather;
  sea: SeaTemperatureState;
  isPoint: boolean;
  /** Whether any hour is worth rating: else the stars and wing rows are left out. */
  rated: boolean;
  tideHeight: number;
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
            const end = day.start + day.count - 1;
            const width = g.x[end] + g.w[end] - g.x[day.start];
            // A day's heading is its name and date and nothing more: the
            // hours under it are what a rider goes by. A single column keeps
            // the weekday; the cell clips whatever is left, and its title
            // still says it all.
            const fit = width >= 66 ? "name" : "day";
            return (
              <td
                key={day.date}
                colSpan={day.count}
                className={`d0 fit-${fit}`}
                title={`${dayLong(day.noon)} ${Number(day.date.slice(8))}`}
              >
                <span>
                  <b>
                    {dayShort(day.noon)}
                    <small> {Number(day.date.slice(8))}</small>
                  </b>
                </span>
              </td>
            );
          })}
        </tr>
        <tr className="tt-hour">
          {cells("h", (_, column) => hourLabel(column.time))}
        </tr>
        {/* The stars, in either view: the blend's chart is the same hours
            the stars and the chart's lights are rated from. */}
        {!isPoint && rated && (
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
                      : ["No stars", noStarsWhy(hour.rating)]
                          .filter(Boolean)
                          .join(", ")
                  }`}
                />
              ) : null,
            )}
          </tr>
        )}
        {blend ? (
          <tr className="tt-blend">
            <td colSpan={columns.length} className="d0 blend-cell">
              {blend}
            </td>
          </tr>
        ) : (
          <>
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
            {!isPoint && rated && (
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
              note={tideNote}
              columns={columns}
              days={days}
              g={g}
              daylight={daylight}
              height={tideHeight}
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

/** The pen's handwriting at the time now: Kalam's advance at 13px, near enough. */
const HAND_CHAR = 6.4;

/**
 * Now, as the red pen marks it: a line down the hours at the time, drawn
 * under the table so the figures it passes stay on top of it, and the time
 * written over it in the day row with an arrow down to the line. The time
 * goes to the right of the line, else to its left, wherever no day's name
 * stands, and when the strip is scrolled so the day's sticky name stands over
 * the line, after the name, the arrow reaching back to the line.
 */
function NowMark({
  columns,
  g,
  now,
  top,
  height,
}: {
  columns: readonly StripColumn[];
  g: StripGeometry;
  now: number;
  /** Where the hours start: the line runs from there to the foot. */
  top: number;
  height: number;
}) {
  // Between the columns' centres: a column is its hour, so 14:20 is a third
  // of the way from 14's centre to 15's.
  const x = useMemo(
    () =>
      timeToX(
        columns,
        now,
        columns.map((_, i) => g.x[i] + g.w[i] / 2),
      ),
    [columns, now, g],
  );
  const text = clock(now);
  const width = text.length * HAND_CHAR;
  // Which side, and how far from the line the time is written.
  const [place, setPlace] = useState<{ side: 1 | -1; reach: number }>({
    side: 1,
    reach: 16,
  });
  // The scrolling strip, whose day names the time keeps clear of: found from
  // the mark itself, since a child's effects run before its parent's ref is set.
  const mark = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const el = mark.current?.parentElement;
    if (!el || x === null) return;
    const lay = () => {
      // The days' names where they stand now, in the strip's own pixels.
      const origin = el.getBoundingClientRect().left - el.scrollLeft;
      const names = [
        ...el.querySelectorAll<HTMLElement>("tr.tt-day td > span"),
      ].map((span) => {
        const r = span.getBoundingClientRect();
        return { left: r.left - origin, right: r.right - origin };
      });
      const hit = (a: number, b: number) =>
        a < 0 ||
        b > g.total ||
        names.some((n) => a < n.right + 3 && b > n.left - 3);
      const span = (side: 1 | -1, reach: number) =>
        side === 1
          ? ([x + reach, x + reach + 3 + width] as const)
          : ([x - reach - 3 - width, x - reach] as const);
      let next: { side: 1 | -1; reach: number } = { side: 1, reach: 16 };
      if (hit(...span(1, 16))) {
        if (!hit(...span(-1, 16))) next = { side: -1, reach: 16 };
        else {
          // A name over the line or just after it: write after the name.
          const over = names.filter(
            (n) => n.right > x - width && n.left < x + 16 + width,
          );
          const after = Math.max(...over.map((n) => n.right)) + 4;
          next = { side: 1, reach: Math.max(16, after - x) };
        }
      }
      setPlace((old) =>
        old.side === next.side && Math.abs(old.reach - next.reach) < 1
          ? old
          : next,
      );
    };
    lay();
    el.addEventListener("scroll", lay, { passive: true });
    return () => el.removeEventListener("scroll", lay);
  }, [x, width, g]);
  if (x === null) return null;
  const seed = Math.floor(now / 60000);
  const arrow = arrowPath(x, top - 2, place.side, seed, place.reach);
  return (
    <svg
      ref={mark}
      className="tt-under"
      width={g.total}
      height={height}
      aria-hidden="true"
    >
      <path className="pen-now" d={stemPath(x, top - 1, height - 2, seed)} />
      <path className="pen-now-arrow" d={arrow.d} />
      <text
        className="pen-now-time"
        x={arrow.from.x + place.side * 2}
        // Low enough in a phone's shorter day row for its tops to show.
        y={Math.max(arrow.from.y + 4, 11)}
        textAnchor={place.side === 1 ? "start" : "end"}
      >
        {text}
      </text>
    </svg>
  );
}

/**
 * Boxes, in the pen layer's own pixels, of what the frame round the chosen
 * hour must not cross: the tide's times and dots, which are placed freely
 * and straddle the hours, and any figure or glyph in the column or its
 * neighbours that reaches into the pen's lane along a border (on a phone,
 * five star places fill a column edge to edge).
 */
function keepOut(
  wrap: HTMLElement,
  pen: SVGSVGElement,
  g: StripGeometry,
  at: number,
): KeepOut[] {
  const origin = pen.getBoundingClientRect();
  const lanes = [g.x[at], g.x[at] + g.w[at]];
  const out: KeepOut[] = [];
  const add = (el: Element, pad: number) => {
    const b = el.getBoundingClientRect();
    if (!b.width) return;
    out.push({
      x: b.left - origin.left - pad,
      y: b.top - origin.top - pad,
      w: b.width + pad * 2,
      h: b.height + pad * 2,
    });
  };
  for (let k = at - 1; k <= at + 1; k++)
    wrap
      .querySelectorAll(
        `td[data-i="${k}"] svg, td[data-i="${k}"] b, td[data-i="${k}"] span:not(:has(*))`,
      )
      .forEach((el) => {
        const b = el.getBoundingClientRect();
        const left = b.left - origin.left;
        const right = b.right - origin.left;
        if (lanes.some((x) => left < x + 2.5 && right > x - 2.5)) add(el, 1.5);
      });
  wrap
    .querySelectorAll(".tide-row text, .tide-row circle")
    .forEach((el) => add(el, el.tagName === "text" ? 2 : 1.6));
  return out;
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
 * a dot on the curve and a short label, its time and its height ("17:35
 * 4.1m", the height in a lighter ink), in a band of its own:
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
  note,
  columns,
  days,
  g,
  daylight,
  height: H,
}: {
  tide: SpotTide | null;
  note: string | null;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  g: StripGeometry;
  daylight: readonly boolean[];
  height: number;
}) {
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
  if (!tide) {
    // The strip is a week wide and opens scrolled to the hour, so the reason
    // is written all along it, not only at its start.
    const text = note ?? "No tide station near";
    const every = Math.max(360, text.length * 6.5 + 80);
    const at = Array.from(
      { length: Math.max(1, Math.ceil((width - 8) / every)) },
      (_, i) => 8 + i * every,
    );
    return (
      <svg width={width} height={H} className="tide-row" aria-hidden="true">
        {night}
        {at.map((x) => (
          <text key={x} className="tide-none" x={x} y={H / 2 + 4}>
            {text}
          </text>
        ))}
      </svg>
    );
  }
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
    time: string;
    height: string;
    /** The label as it is laid out: the time, a space and the height. */
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
      const height = `${event.height.toFixed(1)}m`;
      turns.push({
        key: event.time,
        X: xOf(columns, day, g, t),
        Y: y(event.height),
        high,
        time: clock(t),
        height,
        text: `${clock(t)} ${height}`,
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
      aria-label={`Tide at ${tideStationLine(tide)}, metres above chart datum`}
    >
      {/* The station credited, and how far it is: a tapped point's is
          whichever is nearest, not one the reader chose. */}
      <title>{`Tide at ${tideStationLine(tide)}`}</title>
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
                {turn.time} <tspan className="tide-height">{turn.height}</tspan>
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
    tideNote = null,
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
    onCustomStars,
  } = props;
  const cw = phone ? 52 : 62;
  const label = phone ? 28 : 32;
  const rows = phone ? PHONE_ROWS : ROWS;
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
  // The scroll that brings each hour to the strip's cursor, and where that
  // point stands at a scroll: still in the middle through the week, walking
  // out to the ends so the first hour sits against the labels (see
  // `stripTrack`). It is not drawn: the pen's frame marks the hour there.
  const track = useMemo(() => stripTrack(g, wrapWidth), [g, wrapWidth]);
  const shape = useRef({ g, track });
  shape.current = { g, track };
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
  const named = isPoint ? undefined : spot.id;
  const blend = useBlend(
    view === "blend" && named ? blendModels : NO_MODELS,
    prefs.blendModels,
    named,
    axis,
  );
  // Which columns are dark at this place, by the same sun the stars go by.
  const daylight = useMemo(
    () => daylightOn(spot, axis),
    [spot.lat, spot.lon, axis],
  );
  // A week with no hour worth rating, a calm one or one still being rated
  // at night, leaves out the stars and the wing rather than draw them empty.
  const rated = !hours || hours.some((hour) => !!hour?.rating?.potential);
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
  /** The wheel's hold on the strip (src/wheelHours.ts), let go when the time moves it. */
  const wheeling = useRef<WheelHours | null>(null);
  const scrollFrame = useRef(0);
  const scrollEnd = useRef(0);
  const scrollTo = (index: number, smooth: boolean) => {
    const el = wrap.current;
    if (!el) return;
    // The column's centre under the cursor.
    const left = track.scrollFor(index);
    // Where the browser will actually stop: the strip's own end, at most.
    const reach = Math.min(left, el.scrollWidth - el.clientWidth);
    // Already there, unless a scroll asked for a moment ago is still carrying
    // the strip somewhere else: the opening hour, set just after the strip
    // filled out and asked for its first, must stop that one where it stands.
    const going = programmatic.current;
    const elsewhere = !!going && Math.abs(going.left - reach) >= 1;
    const here = Math.abs(el.scrollLeft - left) < 1;
    if (here && !elsewhere) return;
    const animate = smooth && !reducedMotion && !here;
    wheeling.current?.letGo();
    clearTimeout(scrollEnd.current);
    programmatic.current = { left: reach, until: performance.now() + 1500 };
    el.scrollTo({ left, behavior: animate ? "smooth" : "auto" });
  };
  // The hour the strip's own scroll chose is already where it is; any other
  // is scrolled to. The strip's word is taken once: left standing, an hour
  // read from a scroll long ago would keep the keys from ever scrolling back
  // to it.
  const selectedNow = useRef(selected);
  selectedNow.current = selected;
  useLayoutEffect(() => {
    const fromStrip = fromScroll.current === selected;
    fromScroll.current = -1;
    if (fromStrip) return;
    scrollTo(selected, true);
  }, [selected, track, view, more]);
  // A fresh place opens on the same hour, not wherever the last one was left.
  const placeKey = isPoint ? `${spot.lat},${spot.lon}` : spot.id;
  useLayoutEffect(() => {
    fromScroll.current = -1;
    scrollTo(selected, false);
  }, [placeKey]);

  const onScroll = () => {
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
      // A frame late, the strip may have filled out and the time been set
      // and scrolled to since the scroll that asked for it (the browser
      // re-snapping as the columns arrive does that on load): read nothing
      // from it then, and read the strip as it is now, not as it was.
      if (!el || programmatic.current) return;
      const { g, track } = shape.current;
      const i = columnAtX(g, track.timeAt(el.scrollLeft));
      if (i !== selectedNow.current) fromScroll.current = i;
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
  // down turn of a mouse wheel or a trackpad goes through time without Shift
  // (src/wheelHours.ts). A sideways swipe, and a phone's, are the browser's.
  const motion = useRef(reducedMotion);
  motion.current = reducedMotion;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const wheel = wheelHours(el, {
      snap: (left) => {
        const { g, track } = shape.current;
        return track.scrollFor(columnAtX(g, track.timeAt(left)));
      },
      reducedMotion: () => motion.current,
    });
    wheeling.current = wheel;
    return () => {
      wheel.detach();
      wheeling.current = null;
    };
  }, []);

  // The selected column, marked in place rather than by re-rendering the
  // table, and the pen's frame round it: twice round, on the column's own
  // border so it hides none of its figures, lifting over any that reach the
  // border. A new hour is drawn in as a hand would draw it; while the hours
  // are run through, each is simply there, and the pen catches up when they
  // stop.
  const tableHeight =
    rows.day + rows.hour + rowsUnderHours(rows, view, isPoint, rated, more);
  const pen = useRef<SVGSVGElement>(null);
  const frames = useRef<(SVGPathElement | null)[]>([]);
  const framed = useRef({ at: -1, when: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.querySelectorAll("td.c-sel").forEach((td) =>
      td.classList.remove("c-sel"),
    );
    el.querySelectorAll(`td[data-i="${selected}"]`).forEach((td) =>
      td.classList.add("c-sel"),
    );
    const [first, second] = frames.current;
    if (!pen.current || !first || !second || g.w[selected] === undefined)
      return;
    const keep = view === "blend" ? [] : keepOut(el, pen.current, g, selected);
    const x = g.x[selected] + 1;
    const w = g.w[selected] - 2;
    const y = rows.day - 1;
    const h = tableHeight + 1.5 - y;
    first.setAttribute("d", framePath(x, y, w, h, 6, selected + 3, keep));
    second.setAttribute(
      "d",
      framePath(x - 1.1, y - 0.4, w + 2.2, h + 1.4, 8, selected + 41, keep),
    );
    const moved = framed.current.at !== selected;
    const at = performance.now();
    const quick = at - framed.current.when < 250;
    if (moved) framed.current = { at: selected, when: at };
    if (!moved || reducedMotion || !first.animate) return;
    for (const [path, delay] of [
      [first, 0],
      [second, 380],
    ] as const) {
      path.getAnimations().forEach((a) => a.cancel());
      if (!quick)
        path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: 600,
          delay,
          easing: "cubic-bezier(0.5, 0.1, 0.3, 1)",
          fill: "backwards",
        });
    }
  });

  const tideDot = useMemo(() => {
    if (!tide || !column) return null;
    const h = tideAt(tide.curve, column.time);
    if (h === null) return null;
    const lo = Math.min(...tide.curve.curve);
    const hi = Math.max(...tide.curve.curve);
    const top =
      rows.day + rows.hour + rowsAboveTide(rows, view, isPoint, rated);
    return {
      x: centre(selected),
      y: top + rows.tide - 6 - ((h - lo) / (hi - lo || 1)) * (rows.tide - 14),
    };
  }, [tide, column, selected, g, view, isPoint, rated, rows]);

  return (
    <section className="dock" aria-label={`Forecast for ${spot.name}`}>
      {/* The dock is its hours and nothing else: the spot's name, its star,
          the switch to the blend, its page and the fold stand on the chart
          just above the dock's top edge, in a box like the map's own
          controls, so the dock is no taller than its rows. A phone keeps
          only the glyphs: the light the pen has looped on the chart says
          which spot it is, and the name is there for a screen reader. */}
      <div className="dk-tools chart-box" role="group" aria-label="This spot">
        <div className="dk-id">
          {!isPoint && (
            <StarToggle
              on={starred}
              name={spot.name}
              onToggle={onToggleStar}
              size={phone ? 17 : 16}
            />
          )}
          <h2 className="dk-name">{spot.name}</h2>
          {/* A point's place name is a guess at where it is, so its
              coordinates stay; a riding place's name is enough on its own. */}
          {isPoint && spot.county && (
            <span className="dk-coords">{spot.county}</span>
          )}
        </div>
        {/* The stars are the rider's own: said once, where they are read,
            and the way to change them. */}
        {prefs.rider.custom && !isPoint && (
          <Button
            variant="quiet"
            size="sm"
            className="dk-tool dk-custom"
            aria-label="Custom star rating: edit"
            title="Your own star rating: edit"
            onClick={onCustomStars}
            data-custom-stars
          >
            <svg
              width="11"
              height="11"
              viewBox="-5 -5 10 10"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z"
              />
            </svg>
            <span className="dk-tool-word">Custom</span>
          </Button>
        )}
        {/* The table or every model's wind drawn as a chart: one glyph, on
            while the blend is shown. A point has no blend. */}
        {!isPoint && (
          <Button
            variant="quiet"
            size="sm"
            icon
            className="dk-tool dk-view"
            aria-label="Blend"
            title={view === "blend" ? "Back to the table" : "The models' blend"}
            pressed={view === "blend"}
            onClick={() => onView(view === "blend" ? "table" : "blend")}
          >
            <ChartSpline size={16} strokeWidth={1.4} aria-hidden="true" />
          </Button>
        )}
        {!isPoint && (
          <Button
            variant="quiet"
            size="sm"
            icon
            className="dk-tool"
            aria-label="Spot page"
            title="The spot's own page"
            href={spotHref(spot.id)}
            data-spot-page-link
          >
            <ArrowUpRight size={17} strokeWidth={1.4} aria-hidden="true" />
          </Button>
        )}
        {/* The dock's one fold: the waves, the sky, the air, the rain and
            the sea, under the rows that are always there. Up to open, as a
            sheet along the foot of the screen grows upwards. */}
        <Button
          variant="quiet"
          size="sm"
          icon
          className="dk-tool dk-chev"
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

      {/* The time, for a keyboard and a screen reader: the hours scrolling
          through the pen's frame are the slider a finger and a mouse use, and
          this steps them. Out of sight; its focus ring is drawn on the hours. */}
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
            <div aria-hidden="true" style={{ height: rows.day }} />
            <div aria-hidden="true" style={{ height: rows.hour }} />
            {/* The stars need no name: they are stars. */}
            {!isPoint && rated && (
              <div aria-hidden="true" style={{ height: rows.stars }} />
            )}
            {view === "blend" ? (
              <div
                aria-hidden="true"
                className="dk-lab-blend"
                style={{ height: rows.blend }}
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
                      valueScale(blendMax, rows.blend)(tick),
                    ])
                    .map(([tick, top]) => (
                      <b key={tick} style={{ top }}>
                        {tick}
                      </b>
                    ))}
              </div>
            ) : (
              <>
                {/* The wind keeps its unit, which the reader chooses. */}
                <div
                  aria-hidden="true"
                  className="dk-lab-wind"
                  style={{ height: rows.wind }}
                >
                  <RowLabel
                    glyph={Wind}
                    title={`Wind and gust, ${prefs.units}`}
                  />
                  <small>{prefs.units}</small>
                </div>
                <div aria-hidden="true" style={{ height: rows.from }}>
                  <RowLabel glyph={Navigation2} title="Where the wind goes" />
                </div>
                {!isPoint && rated && (
                  <div aria-hidden="true" style={{ height: rows.wing }}>
                    <RowLabel glyph={WingGlyph} title="Wing, m²" />
                  </div>
                )}
              </>
            )}
            {/* The tide's curve needs no name, nor its times a unit. */}
            <div aria-hidden="true" style={{ height: rows.tide }} />
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
            <NowMark
              columns={columns}
              g={g}
              now={now}
              top={rows.day}
              height={tableHeight}
            />
            <StripTable
              spot={spot}
              columns={columns}
              days={days}
              hours={hours}
              daylight={daylight}
              units={prefs.units}
              tide={tide}
              tideNote={tideNote}
              g={g}
              now={now}
              blend={blendNode}
              more={more}
              waves={waves}
              weather={weather}
              sea={sea}
              isPoint={isPoint}
              rated={rated}
              tideHeight={rows.tide}
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
              ref={pen}
              className="tt-pen"
              width={g.total}
              height={tableHeight}
              aria-hidden="true"
            >
              <path
                ref={(el) => void (frames.current[0] = el)}
                className="pen-frame"
                pathLength={1}
              />
              <path
                ref={(el) => void (frames.current[1] = el)}
                className="pen-frame is-second"
                pathLength={1}
              />
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
        </div>
      </div>
    </section>
  );
}
