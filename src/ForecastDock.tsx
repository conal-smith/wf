import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ChevronRight,
  Layers3,
  X,
} from "lucide-react";
import { Button } from "../ui/Button";
import { framePath, stemPath, type KeepOut } from "../ui/penPaths";
import { StarGlyphs } from "../ui/StarGlyphs";
// Only when asked for: the chart's Blend view.
const BlendChart = lazy(() => import("./BlendChart"));
import { ChartGlyph, glyphs } from "./chartGlyphs";
import type { GlyphDef } from "../shared/web/glyphSet";
import { StarToggle, WindArrow } from "./glyphs";
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
import { arrowsFree, hourStep } from "./hourKeys";
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
  timeSpoken,
  type StripColumn,
  type StripDay,
  type StripGeometry,
} from "./strip";
import {
  useBlend,
  useSpotWaves,
  useSpotWeather,
  type SpotWaves,
  type SpotWeather,
} from "./useBlend";
import { presentWeather } from "../force5/src/surface";
import { handoverColumns, variableValue } from "../force5/src/variables";
import {
  follow,
  isSheetDrag,
  settle,
  speed,
  step,
  SLOP,
  type Snap,
} from "./sheetSnap";
import type { ModelAvailability } from "../force5/src/manifests";
import { spotSquare } from "../force5/src/spotData";
import { useSpotSquares } from "./useSpotSquares";
import { pointSourceNote, type PointSources } from "../force5/src/pointSource";
import type { Prefs } from "../force5/src/prefs";
import {
  noStarsWhy,
  SHORE_LABEL,
  shoreAngle,
  starsText,
} from "../force5/src/stars";
import { dayNights } from "../force5/src/sun";
import { daylightOn } from "./ratings";
import { convert, type Units } from "../force5/src/units";
import { compass, type Spot } from "../force5/src/weather";
import { spotHref } from "../force5/src/siteNav";
import {
  handovers,
  leadOrder,
  modelName,
  starsFromAt,
  type Handover,
} from "../force5/src/lead";

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
  /** Close the dock: no spot or point chosen, the chart alone. */
  onClose: () => void;
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
  /**
   * The riding place a point borrows its waves, weather and sea from, or why
   * none (src/pointSource.ts); null for a riding place.
   */
  pointSource?: PointSources<Spot> | null;
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
  blend: 100,
  waves: 20,
  sky: 20,
  air: 20,
  rain: 20,
};
type Rows = typeof ROWS;
/**
 * A phone's: every row as tight as its figures allow, and tightest the ones
 * that stand blank through the night and on a calm day (the stars and the
 * wing). The dock is a strip along the foot of the chart,
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
};
/**
 * The rows of figures under the hours. The stars head both views; the
 * blend's chart stands in for the table's figures. A point in open water has
 * no stars or wing, and a week with no hour worth rating has neither row.
 */
const figureRows = (
  rows: Rows,
  view: DockView,
  isPoint: boolean,
  rated: boolean,
) =>
  (!isPoint && rated ? rows.stars : 0) +
  (view === "blend"
    ? rows.blend
    : rows.wind + rows.from + (!isPoint && rated ? rows.wing : 0));
/**
 * The water's temperature is not among them: it is one value for the week,
 * not a row across every hour, and it is said on the spot's own page, with
 * the station it was read at and how far off that is, where there is room
 * to say what a buoy 50 km out does and does not tell a rider.
 */
const MORE_ROWS = ["waves", "sky", "air", "rain"] as const;
type MoreRow = (typeof MORE_ROWS)[number];
/** The height of the rows under the hours, as a spot's dock draws them. */
const rowsUnderHours = (
  rows: Rows,
  view: DockView,
  isPoint: boolean,
  rated: boolean,
  more: boolean,
) =>
  figureRows(rows, view, isPoint, rated) +
  (more ? MORE_ROWS.reduce((h, k) => h + rows[k], 0) : 0);
/**
 * Each row's name as a glyph, with the name and unit in its title: the rows
 * read by their figures, and a word per row took a column of the dock's
 * width from the hours. The unit stays on screen beside the glyph, as the
 * wind's does, so a bare 0.7 or 12 says what it counts.
 */
const MORE_LABEL: Record<MoreRow, [GlyphDef, string, string?]> = {
  waves: [glyphs.waves, "Waves, m (height) and s (period)", "m"],
  sky: [glyphs.partly, "Sky"],
  air: [glyphs.air, "Air, °C", "°C"],
  rain: [glyphs.drop, "Rain, mm", "mm"],
};
/** The glyph set's (shared/web/glyphSet.ts): ink, with the weather's colour inside. */
const RowLabel = ({ glyph, title }: { glyph: GlyphDef; title: string }) => (
  <span className="dk-glyph" title={title}>
    <ChartGlyph glyph={glyph} size={14} />
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
  g,
  now,
  blend,
  more,
  waves,
  weather,
  isPoint,
  pointNote,
  rated,
}: {
  spot: Spot;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  hours: PlaceHour[] | undefined;
  /** Whether each column is in daylight at the place: its hatching. */
  daylight: readonly boolean[];
  units: Units;
  g: StripGeometry;
  now: number;
  blend: React.ReactNode | null;
  more: boolean;
  waves: SpotWaves;
  weather: SpotWeather;
  isPoint: boolean;
  /** For a point that has no riding place near to read its rows from, why. */
  pointNote: string | null;
  /** Whether any hour is worth rating: else the stars and wing rows are left out. */
  rated: boolean;
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
    /** The columns where the row's model hands over to the next. */
    handed?: ReadonlySet<number>,
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
              handed?.has(at) ? "handed" : "",
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
                  }${hour.model ? `, from ${modelName(hour.model)}` : ""}`}
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
        {more && (
          <MoreRows
            columns={columns}
            cells={cells}
            g={g}
            waves={waves}
            weather={weather}
            daylight={daylight}
            pointNote={pointNote}
          />
        )}
      </tbody>
    </table>
  );
});

/**
 * Where the stars hand over from one model to the next: a dashed ink line at
 * the edge of the first hour the new model rates, down through the stars and
 * the wind. It says nothing in words: the head's chip names the model that
 * rates the hour in hand, and each hour's stars say whose they are.
 */
function HandoverMark({
  columns,
  g,
  handover,
  top,
  height,
}: {
  columns: readonly StripColumn[];
  g: StripGeometry;
  handover: Handover;
  /** Where the hours start: the line runs from there to `height`. */
  top: number;
  height: number;
}) {
  const column = columns[handover.at];
  if (!column) return null;
  const x = g.x[handover.at];
  const seed = Math.floor(column.time / 3600000);
  return (
    <svg
      className="tt-under"
      width={g.total}
      height={height}
      aria-hidden="true"
      data-handover={handover.to}
    >
      {/* Named for a pointer that rests on it: the dock's head no longer
          says the model, so the line does, quietly. */}
      <title>{`${modelName(handover.to)} from ${dayShort(column.time)} ${clock(column.time)}`}</title>
      <path className="pen-handover" d={stemPath(x, top, height - 2, seed)} />
    </svg>
  );
}

/**
 * Now, as the red pen marks it: a line down the hours at the time, drawn
 * under the table so the figures it passes stay on top of it. The line is
 * the mark, with no words written by it: the hours over it say the time.
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
  if (x === null) return null;
  const seed = Math.floor(now / 60000);
  return (
    <svg
      className="tt-under"
      width={g.total}
      height={height}
      aria-hidden="true"
      data-now={clock(now)}
    >
      <path className="pen-now" d={stemPath(x, top - 1, height - 2, seed)} />
    </svg>
  );
}

/**
 * Boxes, in the pen layer's own pixels, of what the frame round the chosen
 * hour must not cross: any figure or glyph in the column or its neighbours
 * that reaches into the pen's lane along a border (on a phone, five star
 * places fill a column edge to edge).
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
  return out;
}

/**
 * Whether something between `target` and the sheet scrolls up and down and
 * has room to go the way a finger moving `dy` would take it: then the drag
 * is its, not the sheet's.
 */
function scrollsAlong(
  target: EventTarget | null,
  sheet: HTMLElement,
  dy: number,
): boolean {
  for (
    let el = target instanceof Element ? target : null;
    el && el !== sheet;
    el = el.parentElement
  ) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    if (
      dy > 0
        ? el.scrollTop > 0
        : el.scrollTop + el.clientHeight < el.scrollHeight - 1
    )
      return true;
  }
  return false;
}

/**
 * The rows below the fold: the waves, the sky, the air and the rain, one
 * native step per column (a code or an amount does not survive being
 * interpolated).
 */
function MoreRows({
  columns,
  cells,
  g,
  waves,
  weather,
  daylight,
  pointNote,
}: {
  columns: readonly StripColumn[];
  /** Whether each column is in daylight: the moon, not the sun, after dark. */
  daylight: readonly boolean[];
  cells: (
    key: string,
    render: (
      hour: PlaceHour | undefined,
      column: StripColumn,
      at: number,
    ) => React.ReactNode,
    handed?: ReadonlySet<number>,
  ) => React.ReactNode;
  g: StripGeometry;
  waves: SpotWaves;
  weather: SpotWeather;
  /** For a point that has no riding place near to read them from, why. */
  pointNote: string | null;
}) {
  const span = (key: string, text: string) => (
    <tr className={`tt-more tt-${key}`} key={key}>
      <td colSpan={columns.length} className="d0 more-note">
        <span>{text}</span>
      </td>
    </tr>
  );
  if (pointNote)
    return (
      <>
        {span("waves", pointNote)}
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
  // Each source runs as far as its own run, and the next takes over there:
  // every cell's title names the model it is from, and the first of the next
  // model's is marked, as the stars' hand-over is. MI SWAN's 2.8 km sea at a
  // beach and GFS-Wave's 9 km one offshore can differ by metres; the step
  // between them is the models', not the sea's.
  const wavesHanded = handoverColumns(waves.columns);
  const weatherHanded = handoverColumns(weather.columns);
  const by = (step: { model?: string } | null | undefined) =>
    step?.model ? ` · ${modelName(step.model)}` : "";
  const row = (
    key: MoreRow,
    render: (column: number) => React.ReactNode,
    handed: ReadonlySet<number>,
  ) => (
    <tr className={`tt-more tt-${key}`} key={key}>
      {cells(key, (_, __, column) => render(column), handed)}
    </tr>
  );
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
        ? row(
            "waves",
            (column) => {
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
                  title={`${height.toFixed(1)} m${typeof period === "number" ? ` at ${Math.round(period)} s` : ""}${typeof dir === "number" ? ` from ${compass(dir)}` : ""}${by(step)}`}
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
            },
            wavesHanded,
          )
        : span(
            "waves",
            waves.published
              ? "No wave model reaches this spot"
              : "Waves: reading…",
          )}
      {fields
        ? row(
            "sky",
            (column) => {
              const reading = presentWeather(at(column, fields.present));
              return reading ? (
                <span
                  title={`${reading.description}${by(weather.columns[column])}`}
                >
                  <WeatherGlyph
                    weather={reading}
                    size={18}
                    dark={!daylight[column]}
                  />
                </span>
              ) : (
                "–"
              );
            },
            weatherHanded,
          )
        : span(
            "sky",
            weather.published
              ? "No weather model reaches this spot"
              : "Weather: reading…",
          )}
      {fields
        ? row(
            "air",
            (column) => {
              const value = at(column, fields.air);
              return value === null ? (
                "–"
              ) : (
                <span
                  title={`${value.toFixed(1)} °C${by(weather.columns[column])}`}
                >
                  {Math.round(value)}°
                </span>
              );
            },
            weatherHanded,
          )
        : span("air", "")}
      {fields
        ? row(
            "rain",
            (column) => {
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
              const exact =
                Math.abs(covered.end - columns[column].time) <= 60000;
              return (
                <span
                  className={`rain-cell${own ? "" : " is-part"}`}
                  style={
                    {
                      "--rain": Math.min(1, value / RAIN_FULL_MM).toFixed(2),
                    } as React.CSSProperties
                  }
                  title={`${
                    own && exact
                      ? `${amount} mm in the ${covered.hours} h to here`
                      : `${amount} mm in the ${covered.hours} h to ${clock(covered.end)}${own ? "" : ", printed at the last column it covers"}`
                  }${by(series[covered.step])}`}
                >
                  {own ? amount : "·"}
                </span>
              );
            },
            weatherHanded,
          )
        : span("rain", "")}
    </>
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
    onClose,
    phone,
    view,
    onView,
    reducedMotion,
    reachable,
    onShowOnMap,
    isPoint,
    pointSource = null,
    more,
    onMore,
    marine,
    onCustomStars,
  } = props;
  const cw = phone ? 52 : 62;
  // A phone folds the label column away once the reader slides the hours,
  // for the room, and opens it again at the start of the week.
  const [labelsFolded, setLabelsFolded] = useState(false);
  const labels = phone ? 28 : 32;
  const label = phone && labelsFolded ? 0 : labels;
  const rows = phone ? PHONE_ROWS : ROWS;
  // A phone keeps its coarse columns nearly whole: "15 g17" has to fit.
  const g = useMemo(
    () => stripGeometry(columns, cw, phone ? cw - 4 : Math.round(cw * 0.8)),
    [columns, cw, phone],
  );
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
  // is read for it, and for the waves and weather rows, and nothing else. A
  // point has no series of its own, and so no blend: sampling every model's
  // frames at it cost megabytes against a riding place's kilobytes. Its waves,
  // weather and sea are a riding place's near it.
  const axis = useMemo(() => columns.map((c) => c.validTime), [columns]);
  const lender = isPoint ? (pointSource?.source?.spot ?? null) : spot;
  const square = useMemo(
    () => (lender ? [spotSquare(lender.lat, lender.lon)] : null),
    [lender?.lat, lender?.lon],
  );
  // The models the blend's chart reads: the rider's own pick of them, and
  // their model and ECMWF for the line the stars are, each only for its square
  // holding this spot (a model left out of the blend is not read).
  const starsFrom = starsFromAt(prefs.rider.starsFrom);
  const chartModels = useMemo(() => {
    const wanted = new Set([...prefs.blendModels, ...leadOrder(starsFrom)]);
    return models.filter((model) => wanted.has(model.id));
  }, [models, prefs.blendModels, starsFrom.model]);
  const blendModels = useSpotSquares(
    view === "blend" && !isPoint ? chartModels : NO_MODELS,
    square,
  );
  const marineModels = useSpotSquares(more ? marine : NO_MODELS, square);
  const named = isPoint ? undefined : spot.id;
  const blend = useBlend(
    view === "blend" && named ? blendModels : NO_MODELS,
    prefs.blendModels,
    named,
    axis,
    starsFrom,
  );
  /** Whose waves, weather and sea the rows show. */
  const lent = lender?.id;
  const pointNote =
    isPoint && pointSource && !pointSource.source
      ? pointSourceNote(pointSource)
      : null;
  // Which columns are dark at this place, by the same sun the stars go by.
  const daylight = useMemo(
    () => daylightOn(spot, axis),
    [spot.lat, spot.lon, axis],
  );
  // A week with no hour worth rating, a calm one or one still being rated
  // at night, leaves out the stars and the wing rather than draw them empty.
  const rated = !hours || hours.some((hour) => !!hour?.rating?.potential);
  // The one model each hour's stars come from (force5/src/lead.ts): the one
  // that rates the hour in hand, named in the head, and where the stars hand
  // over from one model to the next, marked on the hours. A point has no stars.
  const shifts = useMemo(
    () =>
      isPoint || !hours
        ? []
        : handovers(hours.map((hour) => hour?.model ?? null)),
    [hours, isPoint],
  );
  const waves = useSpotWaves(more ? marineModels : NO_MODELS, lent, axis);
  const weather = useSpotWeather(more ? marineModels : NO_MODELS, lent, axis);
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
  /** Whether the reader's own scroll is moving the strip, until it settles. */
  const sliding = useRef(false);
  /**
   * Whether a finger has been on the strip since the time last moved it: only
   * a slide folds the labels, never the browser settling the time's scroll
   * on an hour as the strip fills out.
   */
  const touched = useRef(false);
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
    sliding.current = false;
    touched.current = false;
    programmatic.current = { left: reach, until: performance.now() + 1500 };
    el.scrollTo({ left, behavior: animate ? "smooth" : "auto" });
  };
  // The hour the strip's own scroll chose is already where it is; any other
  // is scrolled to. The strip's word is taken once: left standing, an hour
  // read from a scroll long ago would keep the keys from ever scrolling back
  // to it.
  const selectedNow = useRef(selected);
  selectedNow.current = selected;
  // A strip that changes shape under the reader's own slide (the phone's
  // labels folding away) is left where their finger has it.
  const scrolledOn = useRef(track);
  useLayoutEffect(() => {
    const fromStrip = fromScroll.current === selected;
    fromScroll.current = -1;
    const reshaped = scrolledOn.current !== track;
    scrolledOn.current = track;
    if (fromStrip || (reshaped && sliding.current)) return;
    scrollTo(selected, true);
  }, [selected, track, view, more]);
  // A fresh place opens on the same hour, not wherever the last one was left.
  const placeKey = isPoint ? `${spot.lat},${spot.lon}` : spot.id;
  useLayoutEffect(() => {
    fromScroll.current = -1;
    scrollTo(selected, false);
  }, [placeKey]);

  const onScroll = () => {
    if (labelsFolded && wrap.current && wrap.current.scrollLeft < 1)
      setLabelsFolded(false);
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
      sliding.current = true;
      // Far enough from the start that the hours given back to the strip
      // still leave it short of the start, which would open the labels again.
      if (phone && touched.current && el.scrollLeft > labels)
        setLabelsFolded(true);
      const { g, track } = shape.current;
      const i = columnAtX(g, track.timeAt(el.scrollLeft));
      if (i !== selectedNow.current) fromScroll.current = i;
      onSelect(i, false);
      clearTimeout(scrollEnd.current);
      scrollEnd.current = window.setTimeout(() => {
        sliding.current = false;
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
  // The labels folded away, the strip widens to the left over their column:
  // scrolled back by as much, the hours stay under the reader's finger, the
  // hours behind the labels come into view, and the strip's new shape is
  // read before the scroll this sends.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !labelsFolded) return;
    el.scrollLeft -= labels;
    setWrapWidth(el.clientWidth);
  }, [labelsFolded]);

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

  // Left and Right step the hour wherever the focus is, unless it is in a
  // control whose own keys they are (src/hourKeys.ts): not only once an hour
  // has been clicked. Each press is one hour, from the hour in hand, at once:
  // the strip's own key scroll is not left to run, as a burst of its smooth
  // scrolls was read back as hours long after the keys had stopped. A page
  // over the map leaves the dock mounted but inert, and its keys alone.
  const keyed = useRef({ selected, count: columns.length, onSelect });
  keyed.current = { selected, count: columns.length, onSelect };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const step = hourStep(event);
      if (!step || event.defaultPrevented || !arrowsFree(event.target)) return;
      if (wrap.current?.closest("[inert]")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      const { selected, count, onSelect } = keyed.current;
      const next = Math.max(0, Math.min(count - 1, selected + step));
      if (next === selected) return;
      keyed.current.selected = next;
      onSelect(next, true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
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

  // The tools stand on the dock's top edge, so the blend (taller than the
  // table's rows) and the fold move them as the dock's height changes: the
  // button clicked was no longer under the pointer, and the next click went
  // to the chart where it had been, and picked that point in place of the
  // spot. While a mouse is on the tools they stay where the first click on
  // them found them, the dock growing or shrinking under them, and go back
  // to its edge once the pointer is off them. Holding the dock's height in
  // place of them kept it from shrinking, but the blend still grew it, and
  // the tools with it, on the first click (#91). A finger is held for as
  // well: on a phone the blend lifted them 53 px, and the next tap at the
  // same place went to the hours (#107). It has no pointer that moves off,
  // so they go back when it next comes down anywhere else. Held down there,
  // though, a finger's tools sat over the first hours' wind until that tap
  // (#130), and a tap on what they hid went to them: on a phone, or under a
  // finger, they are held above the dock's edge as it shrinks, and rise with
  // it as it grows. They are held by their foot, where the row of them is.
  // A phone's are none of this: they are the head of its sheet, in the dock
  // and not over the chart, and move with its edge as any sheet's head does.
  const dockRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  /** The tools' foot on the screen when a click on them was made, while held. */
  const pinned = useRef<number | null>(null);
  /**
   * Whether the held tools may come down over the hours: under a mouse on a
   * wide screen, which lets go of them as it moves off.
   */
  const overHours = useRef(false);
  const pin = () => {
    const el = toolsRef.current;
    if (!el) return;
    el.style.translate = "";
    if (pinned.current === null) return;
    let by = pinned.current - el.getBoundingClientRect().bottom;
    if (!overHours.current) by = Math.min(by, 0);
    if (by) el.style.translate = `0 ${by}px`;
  };
  const hold = (event: React.MouseEvent) => {
    const el = toolsRef.current;
    if (!el || !event.detail || phone) return;
    overHours.current = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    ).matches;
    // Where they stand now: a finger's may have risen since the last click.
    pinned.current = el.getBoundingClientRect().bottom;
  };
  const letGo = () => {
    pinned.current = null;
    pin();
  };
  // After the render a click asked for, and again as the dock's height
  // settles after it (the blend's chart comes in a moment later): both
  // before the frame is painted, so the tools are never seen to move.
  useLayoutEffect(pin);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const watch = new ResizeObserver(pin);
    watch.observe(el);
    // Off the tools by where the pointer is, not by a pointerleave: the
    // browser sends one when the dock moves under a still pointer, before
    // the tools are put back under it, and that let go of them at once.
    const away = (event: PointerEvent) => {
      const box = toolsRef.current?.getBoundingClientRect();
      if (pinned.current === null || !box) return;
      const { clientX: x, clientY: y } = event;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom)
        letGo();
    };
    window.addEventListener("pointermove", away);
    window.addEventListener("pointerdown", away, true);
    // A phone turned or a window resized moves the dock for no click of
    // theirs: where the tools were held is no longer where they were.
    window.addEventListener("resize", letGo);
    return () => {
      watch.disconnect();
      window.removeEventListener("pointermove", away);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", letGo);
    };
  }, []);

  /* ---- a phone's dock is a bottom sheet, swiped up and down ---- */
  // Three heights (src/sheetSnap.ts): peek, its head alone, so the chart has
  // the screen and the spot is kept; half, the hours and the wind under
  // them; and full, with the waves, sky, air and rain rows, which is the
  // fold's `more` and is remembered as it is. Pulled down from peek it
  // closes. A drag is the sheet's once it is mostly up or down: a sideways
  // one is the hours' own scroll, and the browser has that. The sheet's
  // tallest snap fits the shortest phone, so nothing in it scrolls up and
  // down; anything that ever does keeps a drag it can move with.
  const [peek, setPeek] = useState(false);
  const snap: Snap = peek ? "peek" : more ? "full" : "half";
  // A spot chosen opens on its hours, whatever the last was left at.
  useEffect(() => setPeek(false), [placeKey]);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** How far the sheet stands off its place, in px down, while it moves. */
  const offset = useRef(0);
  /** The sheet's top on the screen before a snap moved it, to glide from. */
  const glideFrom = useRef<number | null>(null);
  /**
   * Move the sheet from `from` px off its place to `to`, as a hand lets go
   * of it, or at once for a reader who asks for less motion.
   */
  const glide = (el: HTMLElement, from: number, to = 0, done?: () => void) => {
    const at = (px: number) => (px ? `0 ${px}px` : "");
    offset.current = to;
    el.style.transition = "none";
    el.style.translate = at(from);
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      el.style.transition = "";
      el.style.translate = at(to);
      if (!to) el.classList.remove("is-moving");
      done?.();
    };
    if (motion.current || from === to) return end();
    el.classList.add("is-moving");
    // The start laid out before the move to the end, so it is seen to move.
    void el.offsetHeight;
    el.style.transition = "translate 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.translate = at(to);
    el.addEventListener("transitionend", end, { once: true });
    window.setTimeout(end, 320);
  };
  /** Take the sheet to a snap, or close the dock, from wherever it stands. */
  const goTo = (target: Snap | "close") => {
    const el = dockRef.current;
    if (!el) return;
    if (target === "close")
      return glide(el, offset.current, el.offsetHeight + 8, onClose);
    if (target === snap) return glide(el, offset.current);
    glideFrom.current = el.getBoundingClientRect().top;
    setPeek(target === "peek");
    if (target !== "peek" && (target === "full") !== more)
      onMore(target === "full");
  };
  // The snap's new height is laid out: the sheet glides there from where
  // the finger, or the old height, left it.
  useLayoutEffect(() => {
    const el = dockRef.current;
    const from = glideFrom.current;
    if (!el || from === null) return;
    glideFrom.current = null;
    el.style.translate = "";
    glide(el, from - el.getBoundingClientRect().top);
  });
  /** The sheet's height at each snap, from its height now. */
  const heights = (): Record<Snap, number> => {
    const head =
      (dockRef.current?.offsetHeight ?? 0) -
      (bodyRef.current?.offsetHeight ?? 0);
    // The strip's rows, and the room under them for the pen's frame.
    const half =
      head +
      rows.day +
      rows.hour +
      rowsUnderHours(rows, view, isPoint, rated, false) +
      5;
    return {
      peek: head,
      half,
      full: half + MORE_ROWS.reduce((h, k) => h + ROWS[k], 0),
    };
  };
  const sheet = useRef({ snap, heights, goTo });
  sheet.current = { snap, heights, goTo };
  useEffect(() => {
    const el = dockRef.current;
    if (!phone || !el) return;
    let drag: {
      id: number;
      x: number;
      y: number;
      from: Snap;
      heights: Record<Snap, number>;
      on: boolean;
      samples: { t: number; y: number }[];
    } | null = null;
    /** When the last drag let go: the click that follows it is not a press. */
    let dropped = -Infinity;
    const down = (event: PointerEvent) => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      if ((event.target as Element).closest("input, select, textarea")) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: sheet.current.snap,
        heights: sheet.current.heights(),
        on: false,
        samples: [],
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.on) {
        if (Math.hypot(dx, dy) < SLOP) return;
        if (!isSheetDrag(dx, dy) || scrollsAlong(event.target, el, dy)) {
          drag = null;
          return;
        }
        drag.on = true;
        // The finger is the sheet's, not the strip's: the hours re-settling
        // as the sheet changes height are not the reader sliding them.
        touched.current = false;
        el.setPointerCapture(event.pointerId);
        el.classList.add("is-moving");
        el.style.transition = "none";
      }
      event.preventDefault();
      drag.samples.push({ t: event.timeStamp, y: event.clientY });
      if (drag.samples.length > 16) drag.samples.shift();
      const h = drag.heights;
      const room = drag.from === "peek" ? Infinity : h[drag.from] - h.peek;
      offset.current = follow(dy, h.full - h[drag.from], room);
      el.style.translate = `0 ${offset.current}px`;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { on, from, y, samples, heights } = drag;
      drag = null;
      if (!on) return;
      dropped = event.timeStamp;
      sheet.current.goTo(
        event.type === "pointercancel"
          ? from
          : settle(from, event.clientY - y, speed(samples), heights),
      );
    };
    const click = (event: MouseEvent) => {
      if (event.timeStamp - dropped > 400) return;
      dropped = -Infinity;
      event.preventDefault();
      event.stopPropagation();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
      el.classList.remove("is-moving");
      el.style.translate = el.style.transition = "";
    };
  }, [phone]);

  return (
    <section
      ref={dockRef}
      className={`dock${phone ? " is-sheet" : ""}${phone && peek ? " is-peek" : ""}`}
      aria-label={`Forecast for ${spot.name}`}
    >
      {/* A phone's sheet: swiped up for more of it and down for less, and
          off the screen from its head alone. Its handle is a button too, for
          a keyboard and a screen reader: a press tucks the hours away or
          brings them back, and Up and Down step through the three heights. */}
      {phone && (
        <Button
          variant="quiet"
          size="sm"
          icon
          className="dk-grab"
          aria-label={peek ? "Show the hours" : "Tuck the hours away"}
          aria-expanded={!peek}
          aria-controls="dk-body"
          title="Swipe up or down"
          onClick={() => goTo(peek ? (more ? "full" : "half") : "peek")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            event.stopPropagation();
            goTo(step(snap, event.key === "ArrowUp" ? 1 : -1));
          }}
        />
      )}
      {/* The spot's name, its star, whose forecast the stars are, the switch
          to the blend, the fold and the close. On a wide screen they stand on
          the chart just above the dock's top edge, in a box like the map's
          own controls, so the dock is no taller than its rows; on a phone
          they are the head of its sheet. The name is the way to the spot's
          own page, as a place's name is on any map: its water, its tides and
          its days in full are there. */}
      <div
        ref={toolsRef}
        id="dk-tools"
        className={`dk-tools${phone ? "" : " chart-box"}`}
        role="group"
        aria-label="This spot"
      >
        <div className="dk-id">
          {!isPoint && (
            <StarToggle
              on={starred}
              name={spot.name}
              onToggle={onToggleStar}
              size={phone ? 17 : 16}
            />
          )}
          <h2 className="dk-name">
            {isPoint ? (
              spot.name
            ) : (
              <a
                href={spotHref(spot.id)}
                aria-label={`${spot.name}, spot page`}
                title={`${spot.name}'s own page: the days in full, the tides and the water`}
                data-spot-page-link
              >
                <span>{spot.name}</span>
                <ChevronRight
                  className="dk-name-go"
                  size={phone ? 15 : 16}
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              </a>
            )}
          </h2>
          {/* A point's place name is a guess at where it is, so its
              coordinates stay; a riding place's name is enough on its own. */}
          {isPoint && spot.county && (
            <span className="dk-coords">{spot.county}</span>
          )}
          {/* Whose waves, weather and sea a point's rows are, once open. */}
          {isPoint && more && pointSource?.source && (
            <span className="dk-coords dk-lent">
              {pointSourceNote(pointSource)}
            </span>
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
        {/* The table or every model's wind drawn as a chart: its glyph and
            its name, on while the blend is shown. A point has no blend. */}
        {!isPoint && (
          <Button
            variant="quiet"
            size="sm"
            className="dk-tool dk-view"
            aria-label="Blend"
            title={view === "blend" ? "Back to the table" : "The models' blend"}
            pressed={view === "blend"}
            onClick={(event) => {
              hold(event);
              onView(view === "blend" ? "table" : "blend");
            }}
          >
            <ChartGlyph glyph={glyphs.blend} size={17} />
            <span className="dk-view-word" aria-hidden="true">
              Blend
            </span>
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
          onClick={(event) => {
            hold(event);
            onMore(!more);
          }}
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
        {/* Done with this place: the dock goes, and the chart has the screen
            (Escape, or a tap on the open chart, only lets go of the chart's
            focus on it). */}
        <Button
          variant="quiet"
          size="sm"
          icon
          className="dk-tool dk-close"
          aria-label={`Close the forecast for ${spot.name}`}
          title="Close"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.4} aria-hidden="true" />
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
        aria-valuetext={column ? timeSpoken(column.time) : ""}
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

      <div className="dk-body" id="dk-body" ref={bodyRef}>
        <div
          className={`dk-grid${label ? "" : " is-folded"}`}
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
                    glyph={glyphs.wind}
                    title={`Wind and gust, ${prefs.units}`}
                  />
                  <small>{prefs.units}</small>
                </div>
                <div aria-hidden="true" style={{ height: rows.from }}>
                  <RowLabel
                    glyph={glyphs.direction}
                    title="Where the wind goes"
                  />
                </div>
                {!isPoint && rated && (
                  <div aria-hidden="true" style={{ height: rows.wing }}>
                    <RowLabel glyph={glyphs.wing} title="Wing, m²" />
                  </div>
                )}
              </>
            )}
            {more &&
              MORE_ROWS.map((key) => (
                <div key={key} aria-hidden="true" style={{ height: ROWS[key] }}>
                  <RowLabel
                    glyph={MORE_LABEL[key][0]}
                    title={MORE_LABEL[key][1]}
                  />
                  {MORE_LABEL[key][2] && (
                    <small className="dk-unit">{MORE_LABEL[key][2]}</small>
                  )}
                </div>
              ))}
          </div>

          <div
            className="tt-wrap"
            ref={wrap}
            tabIndex={0}
            onWheel={() => (programmatic.current = null)}
            onPointerDown={() => (programmatic.current = null)}
            onTouchStart={() => {
              programmatic.current = null;
              touched.current = true;
            }}
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
            {shifts.map((handover) => (
              <HandoverMark
                key={handover.at}
                columns={columns}
                g={g}
                handover={handover}
                top={rows.day}
                height={
                  rows.day + rows.hour + figureRows(rows, view, isPoint, rated)
                }
              />
            ))}
            <StripTable
              spot={spot}
              columns={columns}
              days={days}
              hours={hours}
              daylight={daylight}
              units={prefs.units}
              g={g}
              now={now}
              blend={blendNode}
              more={more}
              waves={waves}
              weather={weather}
              isPoint={isPoint}
              pointNote={pointNote}
              rated={rated}
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
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
