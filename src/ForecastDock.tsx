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
import { ArrowDown, Layers3, SlidersHorizontal } from "lucide-react";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import { loopPath } from "../ui/penPaths";
// Both only when asked for: the chart's Blend view and the display options.
const BlendChart = lazy(() => import("./BlendChart"));
const DisplayFilter = lazy(() => import("./DisplayFilter"));
import { InfoPop } from "./InfoPop";
import { HourStars, riderLine } from "./RatingDetail";
import {
  FacingCompass,
  ShoreGlyph,
  StarToggle,
  StarsHelp,
  WindArrow,
} from "./glyphs";
import { candleGroups, modelSupport, niceMax } from "./chart";
import type { PlaceHour } from "./ratings";
import WeatherGlyph from "./WeatherGlyph";
import {
  clock,
  columnAtX,
  dayBest,
  dayLong,
  dayShort,
  hourLabel,
  irishDate,
  stripGeometry,
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
import type { Prefs } from "../force5/src/prefs";
import type { Rider } from "../force5/src/stars";
import { dayNights } from "../force5/src/sun";
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
  onPrefsChange: (prefs: Prefs) => void;
  models: readonly ModelAvailability[];
  starred: boolean;
  onToggleStar: () => void;
  tide: SpotTide | null;
  folded: boolean;
  onFold: (folded: boolean) => void;
  phone: boolean;
  view: DockView;
  onView: (view: DockView) => void;
  reducedMotion: boolean;
  /** The run that reaches the selected hour, when the map's run does not. */
  reachable: { id: string; name: string } | null;
  onShowOnMap: () => void;
  /** What the map is drawing, for the small print. */
  mapModel: string;
  /** A point tapped on the map rather than a riding place. */
  isPoint: boolean;
  /** Its forecast is still being read out of the map's frames. */
  pointPending?: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  /** The waves, weather and sea rows, below their own fold. */
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
  more: 22,
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
const MORE_LABEL: Record<MoreRow, [string, string]> = {
  waves: ["Waves", "m"],
  sky: ["Sky", ""],
  air: ["Air", "°C"],
  rain: ["Rain", "mm"],
  sea: ["Sea", "°C"],
};
/** Rain, in millimetres over one step, that saturates a cell's tint. */
const RAIN_FULL_MM = 4;
/** Star cells' colours on the day slider: magenta by how many. */
/**
 * Pixels per star for an hour's cell: the row's size where the column is wide
 * enough, else as large as five stars and their gaps fit with a little air.
 */
const starSize = (width: number, full: number) =>
  Math.max(4, Math.min(full < 60 ? 8.6 : 9.5, (width - 6) / 5.4));

const STAR_TINT = [0.08, 0.16, 0.3, 0.5, 0.72, 0.95];

const range = (cols: readonly StripColumn[], best: DayBest) =>
  best.from === best.to
    ? clock(cols[best.from].time)
    : `${clock(cols[best.from].time)}–${clock(cols[best.to].time)}`;
const shortRange = (cols: readonly StripColumn[], best: DayBest) =>
  best.from === best.to
    ? clock(cols[best.from].time)
    : `${hourLabel(cols[best.from].time)}–${hourLabel(cols[best.to].time)}`;

/** "today", "tomorrow", or the day's name. */
function relativeDay(day: StripDay, now: number) {
  if (day.date === irishDate(now)) return "today";
  if (day.date === irishDate(now + 86400000)) return "tomorrow";
  return dayLong(day.noon);
}

/** "Best today 13:00–16:00 · ★★★★ · 6.5 m", or what there is instead. */
function DockBest({
  columns,
  hours,
  day,
  now,
}: {
  columns: readonly StripColumn[];
  hours: PlaceHour[] | undefined;
  day: StripDay | undefined;
  now: number;
}) {
  if (!day || !hours) return <span className="dk-best" />;
  const when = relativeDay(day, now);
  const ratings = hours.map((h) => h.rating);
  const best = dayBest(
    ratings,
    day,
    now,
    columns.map((c) => c.time),
  );
  const Day = when[0].toUpperCase() + when.slice(1);
  if (!best) return <span className="dk-best">{Day}: done</span>;
  if (!best.stars) return <span className="dk-best">{Day}: no stars</span>;
  const r = ratings[best.from]!;
  return (
    <span className="dk-best">
      Best {when} {range(columns, best)} ·{" "}
      <StarGlyphs stars={best.stars} potential={r.potential} size={10} /> ·{" "}
      {r.wing.own ?? r.wing.recommended} m
    </span>
  );
}

/** The strip's table: built when the data changes, never when the time does. */
const StripTable = memo(function StripTable({
  spot,
  columns,
  days,
  hours,
  units,
  rider,
  tide,
  g,
  spacer,
  spacerEnd,
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
  units: Units;
  rider: Rider;
  tide: SpotTide | null;
  g: StripGeometry;
  spacer: number;
  spacerEnd: number;
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
      const night = !hour || !hour.daylight;
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
  const sp = <td className="sp" aria-hidden="true" />;
  const speed = (kn: number | null) =>
    kn === null ? "" : Math.round(convert(kn / 1.94384449, units));
  return (
    <table className="tt" style={{ width: spacer + spacerEnd + g.total }}>
      <colgroup>
        <col style={{ width: spacer }} />
        {columns.map((c, at) => (
          <col key={c.validTime} style={{ width: g.w[at] }} />
        ))}
        <col style={{ width: spacerEnd }} />
      </colgroup>
      <tbody>
        <tr className="tt-day">
          {sp}
          {days.map((day) => {
            const best = hours
              ? dayBest(
                  hours.map((h) => h.rating),
                  day,
                )
              : null;
            return (
              <td key={day.date} colSpan={day.count} className="d0">
                <span>
                  <b>
                    {dayShort(day.noon)} {Number(day.date.slice(8))}
                  </b>
                  {best && best.stars > 0 && (
                    <>
                      <StarGlyphs
                        stars={best.stars}
                        potential={hours![best.from]!.rating!.potential}
                        size={8}
                      />
                      <i>best {shortRange(columns, best)}</i>
                    </>
                  )}
                </span>
              </td>
            );
          })}
          {sp}
        </tr>
        <tr className="tt-hour">
          {sp}
          {cells("h", (_, column) => hourLabel(column.time))}
          {sp}
        </tr>
        {blend ? (
          <tr className="tt-blend">
            {sp}
            <td colSpan={columns.length} className="d0 blend-cell">
              {blend}
            </td>
            {sp}
          </tr>
        ) : (
          <>
            {!isPoint && (
              <tr className="tt-stars">
                {sp}
                {cells("s", (hour, column, at) =>
                  hour?.rating ? (
                    <HourStars
                      hour={hour}
                      time={column.time}
                      facing={facing}
                      rider={rider}
                      size={starSize(g.w[at], full)}
                      slots="potential"
                    />
                  ) : null,
                )}
                {sp}
              </tr>
            )}
            <tr className="tt-wind">
              {sp}
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
              {sp}
            </tr>
            <tr className="tt-from">
              {sp}
              {cells("f", (hour) =>
                hour && hour.from !== null ? (
                  <span className="from-cell">
                    <WindArrow from={hour.from} size={12} />
                    <span className="cmp">{compass(hour.from)}</span>
                    <ShoreGlyph from={hour.from} facing={facing} size={14} />
                  </span>
                ) : null,
              )}
              {sp}
            </tr>
            {!isPoint && (
              <tr className="tt-wing">
                {sp}
                {cells("g", (hour) =>
                  hour?.rating?.potential
                    ? (hour.rating.wing.own ?? hour.rating.wing.recommended)
                    : "",
                )}
                {sp}
              </tr>
            )}
          </>
        )}
        <tr className="tt-tide">
          {sp}
          <td colSpan={columns.length} className="d0">
            <TideRow tide={tide} columns={columns} days={days} g={g} />
          </td>
          {sp}
        </tr>
        {more && (
          <MoreRows
            columns={columns}
            cells={cells}
            sp={sp}
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
  sp,
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
  sp: React.ReactNode;
  waves: SpotWaves;
  weather: SpotWeather;
  sea: SeaTemperatureState;
  isPoint: boolean;
}) {
  const span = (key: string, text: string) => (
    <tr className={`tt-more tt-${key}`} key={key}>
      {sp}
      <td colSpan={columns.length} className="d0 more-note">
        {text}
      </td>
      {sp}
    </tr>
  );
  if (isPoint)
    return (
      <>
        {span("waves", "Waves, weather and the sea: riding places only")}
        {MORE_ROWS.slice(1).map((key) => (
          <tr className={`tt-more tt-${key}`} key={key}>
            {sp}
            <td colSpan={columns.length} className="d0" />
            {sp}
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
      {sp}
      {cells(key, (_, __, column) => render(column))}
      {sp}
    </tr>
  );
  const observed = sea.observed;
  return (
    <>
      {waves.source && set
        ? row("waves", (column) => {
            const step = waves.columns[column];
            const height = step ? step.values[set.height] : null;
            if (typeof height !== "number") return "–";
            const period = set.period ? step!.values[set.period] : null;
            const dir = set.direction ? step!.values[set.direction] : null;
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
                {typeof period === "number" && (
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
            const value = at(column, fields.rain);
            if (value === null) return "–";
            return (
              <span
                className="rain-cell"
                style={
                  {
                    "--rain": Math.min(1, value / RAIN_FULL_MM).toFixed(2),
                  } as React.CSSProperties
                }
              >
                {value < 0.05 ? "0" : value.toFixed(1)}
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

/** The tide under the hours: a curve per day, its turns named, in metres. */
function TideRow({
  tide,
  columns,
  days,
  g,
}: {
  tide: SpotTide | null;
  columns: readonly StripColumn[];
  days: readonly StripDay[];
  g: StripGeometry;
}) {
  const H = ROWS.tide;
  const width = g.total;
  if (!tide)
    return (
      <svg width={width} height={H} className="tide-row" aria-hidden="true">
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
  const marks: React.ReactNode[] = [];
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
    const end = day.start + day.count - 1;
    const dayEnd = g.x[end] + g.w[end];
    for (const event of eventsBetween(curve, a, b)) {
      const t = Date.parse(event.time);
      const X = xOf(columns, day, g, t);
      const Y = y(event.height);
      const high = event.kind === "high";
      const right = X < dayEnd - 130;
      marks.push(
        <g key={event.time}>
          <circle
            className={high ? "tide-hw" : "tide-lw"}
            cx={X.toFixed(1)}
            cy={Y.toFixed(1)}
            r="2.6"
          />
          <text
            className="tide-label"
            x={(X + (right ? 6 : -6)).toFixed(1)}
            y={(high ? Y + 13 : Y - 5).toFixed(1)}
            textAnchor={right ? "start" : "end"}
          >
            {high ? "High" : "Low"} tide {clock(t)} · {event.height.toFixed(1)}{" "}
            m
          </text>
        </g>,
      );
    }
  });
  return (
    <svg
      width={width}
      height={H}
      className="tide-row"
      role="img"
      aria-label={`Tide at ${tide.station.name}, metres above chart datum`}
    >
      {paths}
      {marks}
    </svg>
  );
}

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
    onPrefsChange,
    models,
    starred,
    onToggleStar,
    tide,
    folded,
    onFold,
    phone,
    view,
    onView,
    reducedMotion,
    reachable,
    onShowOnMap,
    isPoint,
    playing,
    onTogglePlay,
    more,
    onMore,
    marine,
  } = props;
  const cw = phone ? 52 : 62;
  // A phone keeps its coarse columns nearly whole: "15 g17" has to fit.
  const g = useMemo(
    () => stripGeometry(columns, cw, phone ? cw - 4 : Math.round(cw * 0.8)),
    [columns, cw, phone],
  );
  const centre = (i: number) => (g.x[i] ?? 0) + (g.w[i] ?? cw) / 2;
  const wrap = useRef<HTMLDivElement>(null);
  const scrub = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const spacer = Math.max(0, wrapWidth / 2 - (g.w[0] ?? cw) / 2);
  const spacerEnd = Math.max(0, wrapWidth / 2 - (g.w.at(-1) ?? cw) / 2);
  const column = columns[selected];
  const selectedDay = days.find(
    (d) => selected >= d.start && selected < d.start + d.count,
  );
  const selectedDayIndex = selectedDay ? days.indexOf(selectedDay) : 0;

  // The blend, only while it is the view: the chart reads every member.
  const axis = useMemo(() => columns.map((c) => c.validTime), [columns]);
  const blend = useBlend(
    view === "blend" && !isPoint ? models : [],
    prefs.blendModels,
    spot.id,
    axis,
  );
  const named = isPoint ? undefined : spot.id;
  const waves = useSpotWaves(more ? marine : [], named, axis);
  const weather = useSpotWeather(more ? marine : [], named, axis);
  const sea = useSpotSeaTemperature(more ? named : undefined);
  const blendNode = useMemo(() => {
    if (view !== "blend") return null;
    if (!blend.lines.length)
      return <p className="blend-empty">Reading the models…</p>;
    const peak = blend.stats.reduce(
      (top, hour) => Math.max(top, hour.max ?? 0, hour.gust.max ?? 0),
      0,
    );
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
          max={niceMax(convert(peak, prefs.units))}
          reducedMotion={reducedMotion}
        />
      </Suspense>
    );
  }, [view, blend, columns, g, prefs.units, reducedMotion, spot.lat, spot.lon]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWrapWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [folded]);

  /* ---- the strip scrolls the time, and the time scrolls the strip ---- */
  const fromScroll = useRef(-1);
  /**
   * Where the strip is being scrolled to by the time, not by the reader:
   * until it gets there its scroll events say nothing about the time. The
   * reader's own wheel, touch or key takes over at once.
   */
  const programmatic = useRef<{ left: number; until: number } | null>(null);
  const dragging = useRef(false);
  const scrollFrame = useRef(0);
  const scrollEnd = useRef(0);
  const scrollTo = (index: number, smooth: boolean) => {
    const el = wrap.current;
    if (!el) return;
    // The column's centre under the cursor in the middle of the strip.
    const left = centre(index) - (g.w[0] ?? cw) / 2;
    if (Math.abs(el.scrollLeft - left) < 1) return;
    const animate = smooth && !reducedMotion;
    clearTimeout(scrollEnd.current);
    // Where the browser will actually stop: the strip's own end, at most.
    const reach = Math.min(left, el.scrollWidth - el.clientWidth);
    programmatic.current = { left: reach, until: performance.now() + 1500 };
    el.scrollTo({ left, behavior: animate ? "smooth" : "auto" });
  };
  useLayoutEffect(() => {
    if (fromScroll.current === selected) return;
    scrollTo(selected, !dragging.current);
  }, [selected, g, spacer, folded, view, more]);
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
      if (!el) return;
      const i = columnAtX(g, el.scrollLeft + (g.w[0] ?? cw) / 2);
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

  // Shift and the wheel move the hours where the system does not already
  // turn it sideways; a plain vertical wheel is left to the page.
  useEffect(() => {
    const el = wrap.current;
    const days = scrub.current;
    if (!el || !days) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.deltaX || !event.deltaY) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    // A sideways swipe over the day slider moves the strip as well.
    const onDaysWheel = (event: WheelEvent) => {
      const dx =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.shiftKey
            ? event.deltaY
            : 0;
      if (!dx) return;
      event.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    days.addEventListener("wheel", onDaysWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      days.removeEventListener("wheel", onDaysWheel);
    };
  }, [folded]);

  // The selected column, marked in place rather than by re-rendering the table.
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

  /* ---- the day slider: drag along it, or step with the keys ---- */
  const pad = phone ? 4 : 8;
  const columnAt = (clientX: number) => {
    const blocks = scrub.current?.querySelectorAll<HTMLElement>(".sc-day");
    if (!blocks?.length) return selected;
    for (let d = 0; d < blocks.length; d++) {
      const r = blocks[d].getBoundingClientRect();
      if (clientX < r.right || d === blocks.length - 1) {
        const day = days[d];
        const f = (clientX - r.left - pad) / Math.max(1, r.width - 2 * pad);
        return (
          day.start +
          Math.max(0, Math.min(day.count - 1, Math.floor(f * day.count)))
        );
      }
    }
    return selected;
  };
  const [handLeft, setHandLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const blocks = scrub.current?.querySelectorAll<HTMLElement>(".sc-day");
    const day = selectedDay;
    if (!blocks?.length || !day) return setHandLeft(null);
    const block = blocks[selectedDayIndex];
    const at = selected - day.start;
    setHandLeft(
      block.offsetLeft +
        pad +
        (block.clientWidth - 2 * pad) * ((at + 0.5) / day.count),
    );
  });

  const ratings = hours?.map((h) => h.rating);
  const flag = column ? `${dayShort(column.time)} ${clock(column.time)}` : "";
  const facing = spot.facing ?? null;

  // The red pen: a loop round each day's best stretch, from the stars to the wind.
  const loops = useMemo(() => {
    if (!ratings || view !== "table") return [];
    const top = ROWS.day + ROWS.hour;
    const bottom = top + ROWS.stars + ROWS.wind;
    return days.flatMap((day, d) => {
      const best = dayBest(
        ratings,
        day,
        now,
        columns.map((c) => c.time),
      );
      if (!best || !best.stars) return [];
      const x0 = spacer + g.x[best.from];
      const x1 = spacer + g.x[best.to] + g.w[best.to];
      return [
        {
          key: `${day.date}-${best.from}`,
          d: loopPath(
            (x0 + x1) / 2,
            (top + bottom) / 2,
            (x1 - x0) / 2 + 6,
            (bottom - top) / 2 + 6,
            d * 13 + best.from,
          ),
          delay: d * 90,
        },
      ];
    });
  }, [ratings, days, columns, spacer, g, now, view]);

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
      x: spacer + centre(selected),
      y: top + ROWS.tide - 6 - ((h - lo) / (hi - lo || 1)) * (ROWS.tide - 14),
    };
  }, [tide, column, selected, spacer, g, view]);

  const label = phone ? 52 : 64;
  return (
    <section
      className={`dock${folded ? " is-folded" : ""}`}
      aria-label={`Forecast for ${spot.name}`}
    >
      {phone && (
        <button
          type="button"
          className="dock-grab"
          aria-label={folded ? "Open the hours" : "Fold the hours"}
          aria-expanded={!folded}
          onClick={() => onFold(!folded)}
        />
      )}
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
        {!isPoint && <FacingCompass facing={facing} size={20} />}
        {spot.county && (
          <span className={`dk-county${isPoint ? " is-point" : ""}`}>
            {spot.county}
          </span>
        )}
        <DockBest
          columns={columns}
          hours={isPoint ? undefined : hours}
          day={days[selectedDayIndex]}
          now={now}
        />
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
          <InfoPop label="About these figures">
            {!isPoint && (
              <>
                <p>
                  Solid stars: the hour as forecast for you. Outlined: what the
                  wind alone would give. Dark hours aren&rsquo;t rated.
                </p>
                <p className="ip-fig">{riderLine(prefs.rider)}</p>
              </>
            )}
            {isPoint ? (
              <p className="ip-small">
                A point on the map, not a riding place, so it has no beach to
                rate against and no stars. Read from {props.mapModel} alone; the
                hours it does not reach stay empty.
              </p>
            ) : (
              <p className="ip-small">
                Wind: the models&rsquo; middle, each counted once
                {prefs.blendModels.length
                  ? ` (${prefs.blendModels.length} in the blend)`
                  : ""}
                . The map draws {props.mapModel}.
              </p>
            )}
            <p className="ip-small">
              {tide
                ? `Tide: Marine Institute, ${tide.station.name} (${tide.distanceKm.toFixed(1)} km), metres above ${tide.curve.datum}. Prediction only: no surge.`
                : "No tide station near."}
            </p>
            {spot.note && <p className="ip-small">{spot.note}</p>}
            {!!spot.locationSources?.length && (
              <p className="ip-small ip-sources">
                {spot.locationSources
                  .filter((source) => /^https?:\/\//.test(source.url))
                  .map((source, i) => (
                    <a
                      key={`${source.url}/${i}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      title={`${source.name} · ${source.licence}`}
                    >
                      Source
                      {spot.locationSources!.length > 1 ? ` ${i + 1}` : ""}
                    </a>
                  ))}
              </p>
            )}
          </InfoPop>
          <button
            ref={filterButton}
            type="button"
            className="dk-settings"
            aria-label="Display options"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <SlidersHorizontal size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
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
          {!phone && (
            <button
              type="button"
              className="dk-chev"
              aria-label={folded ? "Open the hours" : "Fold the hours"}
              aria-expanded={!folded}
              onClick={() => onFold(!folded)}
            >
              <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden="true">
                <path
                  d="M1 1.5L7 7.5L13 1.5"
                  fill="none"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="scrub-row">
        <button
          type="button"
          className="play"
          aria-label={playing ? "Pause forecast" : "Play forecast"}
          aria-pressed={playing}
          onClick={onTogglePlay}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {playing ? (
              <path d="M3 2v8M9 2v8" strokeWidth="2.2" strokeLinecap="round" />
            ) : (
              <path d="M3 1.6L10.4 6L3 10.4Z" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        <div className={`scrub${days.length > 8 ? " many" : ""}`} ref={scrub}>
          <input
            type="range"
            className="scrub-input"
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
              // A day at a time, as the mockup's slider steps.
              if (event.key !== "PageUp" && event.key !== "PageDown") return;
              event.preventDefault();
              const to =
                days[
                  Math.max(
                    0,
                    Math.min(
                      days.length - 1,
                      selectedDayIndex + (event.key === "PageUp" ? 1 : -1),
                    ),
                  )
                ];
              const offset = selected - (selectedDay?.start ?? 0);
              onSelect(to.start + Math.min(offset, to.count - 1), true);
            }}
          />
          <div
            className="sc-days"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
            onPointerDown={(event) => {
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              onSelect(columnAt(event.clientX), false);
            }}
            onPointerMove={(event) => {
              if (dragging.current) onSelect(columnAt(event.clientX), false);
            }}
            onPointerUp={() => {
              if (!dragging.current) return;
              dragging.current = false;
              onSelect(selected, true);
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            {days.map((day, d) => {
              const best = ratings ? dayBest(ratings, day) : null;
              return (
                <div
                  key={day.date}
                  className={`sc-day${d === selectedDayIndex ? " on" : ""}`}
                >
                  <div className="sc-h">
                    <b>
                      {dayShort(day.noon).slice(0, 2)}
                      <span className="d3">{dayShort(day.noon).slice(2)}</span>
                    </b>
                    <span className="dt">{Number(day.date.slice(8))}</span>
                    {best && (
                      <>
                        <span className="st">
                          <StarGlyphs
                            stars={best.stars}
                            potential={ratings![best.from]!.potential}
                            size={9}
                          />
                        </span>
                        {best.stars > 0 && (
                          <span className="bw">
                            best {shortRange(columns, best)}
                          </span>
                        )}
                        <span className="sn">
                          <StarGlyphs
                            stars={best.stars}
                            potential={ratings![best.from]!.potential}
                            size={7}
                            slots="potential"
                          />
                        </span>
                      </>
                    )}
                  </div>
                  <div
                    className="sc-strip"
                    style={{
                      gridTemplateColumns: `repeat(${day.count}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: day.count }, (_, k) => {
                      const at = day.start + k;
                      const r = ratings?.[at];
                      const h = hours?.[at];
                      return (
                        <i
                          key={at}
                          className={
                            [
                              !h || !h.daylight ? "night" : "",
                              columns[at].time + 3600000 <= now ? "past" : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          style={
                            r
                              ? ({
                                  "--tint": STAR_TINT[r.stars],
                                } as React.CSSProperties)
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {handLeft !== null && (
              <div
                className={`sc-hand${selectedDayIndex === days.length - 1 && column && column.hour > 15 ? " flip" : ""}`}
                style={{ left: handLeft }}
                aria-hidden="true"
              >
                <span className="sc-flag">{flag}</span>
              </div>
            )}
          </div>
        </div>
      </div>

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

      {!folded && (
        <div className="dk-body">
          <div
            className="dk-grid"
            style={{ gridTemplateColumns: `${label}px minmax(0, 1fr)` }}
          >
            <div className="dk-labs">
              <div aria-hidden="true" style={{ height: ROWS.day }} />
              <div aria-hidden="true" style={{ height: ROWS.hour }} />
              {view === "blend" ? (
                <div aria-hidden="true" style={{ height: ROWS.blend }}>
                  Blend<small>{prefs.units}</small>
                </div>
              ) : (
                <>
                  {!isPoint && (
                    <div aria-hidden="true" style={{ height: ROWS.stars }}>
                      Stars
                    </div>
                  )}
                  <div aria-hidden="true" style={{ height: ROWS.wind }}>
                    Wind<small>{prefs.units}</small>
                  </div>
                  <div aria-hidden="true" style={{ height: ROWS.from }}>
                    From
                  </div>
                  {!isPoint && (
                    <div aria-hidden="true" style={{ height: ROWS.wing }}>
                      Wing<small>m²</small>
                    </div>
                  )}
                </>
              )}
              <div aria-hidden="true" style={{ height: ROWS.tide }}>
                Tide<small>m</small>
              </div>
              {more &&
                MORE_ROWS.map((key) => (
                  <div
                    key={key}
                    aria-hidden="true"
                    style={{ height: ROWS[key] }}
                  >
                    {MORE_LABEL[key][0]}
                    <small>{MORE_LABEL[key][1]}</small>
                  </div>
                ))}
              <button
                type="button"
                className="dk-more"
                aria-expanded={more}
                aria-label={
                  more ? "Hide waves, sky and sea" : "Show waves, sky and sea"
                }
                onClick={() => onMore(!more)}
              >
                {more ? "Less" : "More"}
                <svg
                  width="10"
                  height="6"
                  viewBox="0 0 14 9"
                  aria-hidden="true"
                >
                  <path
                    d={more ? "M1 7.5L7 1.5L13 7.5" : "M1 1.5L7 7.5L13 1.5"}
                    fill="none"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {view === "table" && !isPoint && (
              // The "?" sits on the Stars label, outside the hidden labels.
              <span
                className="dk-stars-q"
                style={{ top: ROWS.day + ROWS.hour }}
              >
                <StarsHelp />
              </span>
            )}
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
                units={prefs.units}
                rider={prefs.rider}
                tide={tide}
                g={g}
                spacer={spacer}
                spacerEnd={spacerEnd}
                now={now}
                blend={blendNode}
                more={more}
                waves={waves}
                weather={weather}
                sea={sea}
                isPoint={isPoint}
              />
              <svg
                className="tt-pen"
                width={spacer + spacerEnd + g.total}
                height={
                  ROWS.day +
                  ROWS.hour +
                  (view === "blend" ? ROWS.blend : tableRows(isPoint)) +
                  ROWS.tide +
                  (more ? MORE_ROWS.reduce((h, k) => h + ROWS[k], 0) : 0)
                }
                aria-hidden="true"
              >
                {loops.map((loop) => (
                  <path
                    key={`${spot.id}-${loop.key}`}
                    className="pen-loop"
                    d={loop.d}
                    pathLength={1}
                    style={{ animationDelay: `${loop.delay}ms` }}
                  />
                ))}
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
            <div
              className="dk-cur"
              style={{ left: label + wrapWidth / 2 }}
              aria-hidden="true"
            >
              <span>{flag}</span>
            </div>
          </div>
        </div>
      )}
      {filterOpen && (
        <Suspense fallback={null}>
          <DisplayFilter
            prefs={prefs}
            onChange={onPrefsChange}
            models={models.filter((model) => model.entry.kind === "wind")}
            onClose={() => {
              setFilterOpen(false);
              requestAnimationFrame(() =>
                filterButton.current?.focus({ preventScroll: true }),
              );
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
