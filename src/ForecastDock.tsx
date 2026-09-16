import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUpDown,
  CandlestickChart,
  ChartArea,
  ChevronLeft,
  ChevronRight,
  Navigation,
  Pause,
  Play,
  SlidersHorizontal,
  Table2,
  Thermometer,
  ThermometerSun,
  Waves,
  Wind as WindIcon,
  WindArrowDown,
  X,
} from "lucide-react";
import BlendChart from "./BlendChart";
import CandleChart from "./CandleChart";
import DisplayFilter, { type RowOffer } from "./DisplayFilter";
import ForecastHeader from "./ForecastHeader";
import ForecastSheet from "./ForecastSheet";
import RowLabel from "./RowLabel";
import {
  PLOT_PAD_BOTTOM,
  PLOT_PAD_TOP,
  areaPath,
  axisTicks,
  columnCentres,
  columnEdges,
  columnWeights,
  dayGroups,
  niceMax,
  valueScale,
  windGradientStops,
} from "./chart";
import { useBlend, useModelAvailability, useSpotTide } from "./useBlend";
import { usePointSeries } from "./usePointSeries";
import { candles as candleColumns } from "../force5/src/blend";
import { dayNights } from "../force5/src/sun";
import { framePosition, windTrackBackground } from "../force5/src/timeline";
import {
  VIEWS,
  type ForecastView,
  type Prefs,
  type RowKey,
} from "../force5/src/prefs";
import { convert, unitLabel } from "../force5/src/units";
import {
  compass,
  dayLabel,
  nearestFrame,
  timeLabel,
  windColor,
  type Manifest,
  type Point,
} from "../force5/src/weather";
import { tideAt } from "../force5/src/tides";

interface Props {
  manifest: Manifest;
  point: Point;
  prefs: Prefs;
  onPrefsChange: (prefs: Prefs) => void;
  /** The displayed forecast column. */
  index: number;
  requestedIndex: number;
  scrollIndex: number;
  onSelect: (index: number) => void;
  open: boolean;
  onClose: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  /** A model switch is in flight: the time controls must not move. */
  busy: boolean;
  playDisabled: boolean;
  reducedMotion: boolean;
}

const VIEW_LABEL: Record<ForecastView, string> = {
  table: "Table",
  blend: "Blend",
  candles: "Candles",
};
const VIEW_GLYPH: Record<ForecastView, ReactNode> = {
  table: <Table2 size={15} aria-hidden="true" />,
  blend: <ChartArea size={15} aria-hidden="true" />,
  candles: <CandlestickChart size={15} aria-hidden="true" />,
};

const TideGlyph = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2 15c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 5 4" />
    <path d="M12 3v6m0-6-2.2 2.4M12 3l2.2 2.4" />
  </svg>
);

const ROW_HELP: Record<RowKey, string> = {
  blend:
    "Every selected model on one chart. The band is where the models put the wind; the white line is the middle of them.",
  wind: "The middle model at each hour — half the models sit above it, half below.",
  spread:
    "Half the gap between the highest and lowest model at that hour. Small means the models agree.",
  gust: "The strongest gust any selected model shows for that hour.",
  dir: "Where the wind blows from, averaged across the selected models. Arrows on the chart show the same thing.",
  waves: "Significant wave height — the average of the highest third of waves.",
  sea: "Sea surface temperature at the nearest available source.",
  air: "Air temperature two metres above the ground.",
  tide: "Predicted tide height at the nearest station. Astronomical prediction only: no surge and no wind effect.",
};

/** Interpolate between actual timestamp centres, including mixed 3/6-hour columns. */
function timeX(content: HTMLElement, manifest: Manifest, time: number) {
  const position = framePosition(manifest.frames, time);
  if (position === null) return null;
  const centre = (index: number) => {
    const cell = content
      .querySelector(`[data-forecast-index="${index}"]`)
      ?.closest("th");
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    return rect.left + rect.width / 2 - content.getBoundingClientRect().left;
  };
  const left = centre(Math.floor(position)),
    right = centre(Math.ceil(position));
  return left === null || right === null
    ? null
    : left + (right - left) * (position % 1);
}

interface Geometry {
  /** Width of the sticky row-label column, in pixels. */
  label: number;
  /** Width and height of the plot box, measured rather than assumed. */
  chartWidth: number;
  chartHeight: number;
  /** Where the marine block sits inside the scrolling content. */
  marineTop: number;
  marineHeight: number;
}
const NO_GEOMETRY: Geometry = {
  label: 0,
  chartWidth: 0,
  chartHeight: 0,
  marineTop: 0,
  marineHeight: 0,
};
const sameGeometry = (a: Geometry, b: Geometry) =>
  a.label === b.label &&
  a.chartWidth === b.chartWidth &&
  a.chartHeight === b.chartHeight &&
  a.marineTop === b.marineTop &&
  a.marineHeight === b.marineHeight;

export default function ForecastDock({
  manifest,
  point,
  prefs,
  onPrefsChange,
  index,
  requestedIndex,
  scrollIndex,
  onSelect,
  open,
  onClose,
  playing,
  onTogglePlay,
  busy,
  playDisabled,
  reducedMotion,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const marine = useRef<HTMLTableSectionElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const initialScroll = useRef(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [nowX, setNowX] = useState<number | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(NO_GEOMETRY);

  const { units, rows } = prefs;
  const series = usePointSeries(manifest, point);
  const { models, resolved } = useModelAvailability();
  const tide = useSpotTide(point.id);
  const axis = useMemo(
    () => manifest.frames.map((frame) => frame.validTime),
    [manifest],
  );
  const blend = useBlend(models, prefs.blendModels, point.id, axis);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);

  // One measurement pass for the Now line and both overlays: the charts are
  // sized from the real column geometry, never from an assumed column width.
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const update = () => {
      setNowX(timeX(element, manifest, now));
      const box = element.getBoundingClientRect();
      const label =
        element.querySelector("thead th")?.getBoundingClientRect().width ?? 0;
      const plot = holder.current?.getBoundingClientRect();
      const block = marine.current?.getBoundingClientRect();
      const next: Geometry = {
        label,
        chartWidth: plot?.width ?? Math.max(0, box.width - label),
        chartHeight: plot?.height ?? 0,
        marineTop: block ? block.top - box.top : 0,
        marineHeight: block?.height ?? 0,
      };
      setGeometry((previous) =>
        sameGeometry(previous, next) ? previous : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (holder.current) observer.observe(holder.current);
    if (marine.current) observer.observe(marine.current);
    return () => observer.disconnect();
  }, [manifest, now, open, prefs.view, rows, tide.tide, blend.stats.length]);

  useLayoutEffect(() => {
    const container = scroll.current;
    if (!container) return;
    const centreNow =
      initialScroll.current && scrollIndex === nearestFrame(manifest.frames);
    initialScroll.current = false;
    const followTime = () => {
      const cell = container
        .querySelector<HTMLElement>(`[data-forecast-index="${scrollIndex}"]`)
        ?.closest("th");
      const labels = container.querySelector("thead th");
      if (!cell || !labels) return;
      // offsetLeft on the button is relative to its table cell, often zero.
      // Compare viewport rectangles instead, allowing for sticky row labels.
      const viewport = container.getBoundingClientRect();
      const target = cell.getBoundingClientRect();
      const labelWidth = labels.getBoundingClientRect().width;
      const available = container.clientWidth - labelWidth;
      const currentX =
        centreNow && content.current
          ? timeX(content.current, manifest, Date.now())
          : null;
      const targetCentre =
        currentX !== null && content.current
          ? content.current.getBoundingClientRect().left + currentX
          : target.left + target.width / 2;
      const left =
        container.scrollLeft +
        targetCentre -
        viewport.left -
        labelWidth -
        available / 2;
      container.scrollLeft = Math.max(
        0,
        Math.min(left, container.scrollWidth - container.clientWidth),
      );
    };
    followTime();
    const observer = new ResizeObserver(followTime);
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [scrollIndex, series.key, manifest]);

  const frames = manifest.frames;
  const days = useMemo(() => dayGroups(frames, dayLabel), [frames]);
  const weights = useMemo(
    () => columnWeights(frames, manifest.stepHours),
    [frames, manifest.stepHours],
  );
  const centres = useMemo(
    () => columnCentres(weights, geometry.chartWidth),
    [weights, geometry.chartWidth],
  );
  const edges = useMemo(
    () => columnEdges(weights, geometry.chartWidth),
    [weights, geometry.chartWidth],
  );
  const nights = useMemo(
    () =>
      frames.length
        ? dayNights(
            point.lat,
            point.lon,
            new Date(frames[0].validTime),
            new Date(frames[frames.length - 1].validTime),
          )
        : [],
    [frames, point.lat, point.lon],
  );

  // Value axis: whole ten-unit steps above the highest gust in the blend, so a
  // unit change visibly rescales the chart instead of relabelling it.
  const peak = blend.stats.reduce(
    (highest, hour) => Math.max(highest, hour.max ?? 0, hour.gust.max ?? 0),
    0,
  );
  const max = niceMax(convert(peak, units));
  const y = valueScale(max, geometry.chartHeight);
  const columnsPerCandle = Math.max(1, Math.round(3 / manifest.stepHours));
  const candles = useMemo(
    () =>
      blend.stats.length ? candleColumns(blend.stats, columnsPerCandle) : [],
    [blend.stats, columnsPerCandle],
  );

  const named = !!point.id;
  const chartReady = blend.lines.length > 0;
  const chartUnavailable = !named
    ? "Choose a named spot for the model blend"
    : resolved && !chartReady
      ? "No model publishes a precomputed series for this spot yet"
      : null;
  const view: ForecastView = chartUnavailable ? "table" : prefs.view;
  const setView = (next: ForecastView) =>
    onPrefsChange({ ...prefs, view: next });

  const waveSources = models.filter(
    (model) => model.entry.kind === "wave" && model.available,
  );
  const tideOffer = !named
    ? "named spots only"
    : tide.loading
      ? undefined
      : (tide.error ?? undefined);
  const rowOffers: Record<RowKey, RowOffer> = {
    blend: { label: "Model blend" },
    wind: { label: "Wind (median)" },
    spread: { label: "Spread" },
    gust: { label: "Gust" },
    dir: { label: "Direction row" },
    waves: {
      label: "Waves",
      unavailable: waveSources.length ? undefined : "no source yet",
    },
    sea: { label: "Sea temp", unavailable: "no source yet" },
    air: { label: "Air temp", unavailable: "no source yet" },
    tide: { label: "Tide", unavailable: tideOffer },
  };

  const showTide = rows.tide && !tideOffer && !!tide.tide;
  const marineRows = (["waves", "sea", "air"] as const).filter(
    (key) => rows[key] && !rowOffers[key].unavailable,
  );
  const showMarine = showTide || marineRows.length > 0;
  const tideValues = useMemo(
    () =>
      tide.tide
        ? axis.map((iso) => tideAt(tide.tide!.curve, iso))
        : axis.map(() => null),
    [tide.tide, axis],
  );
  const tideRange = tideValues.reduce<{ lo: number; hi: number }>(
    (range, value) =>
      value === null
        ? range
        : { lo: Math.min(range.lo, value), hi: Math.max(range.hi, value) },
    { lo: Infinity, hi: -Infinity },
  );

  const tidePath = areaPath(
    centres,
    tideValues,
    tideScale(tideRange, geometry.marineHeight),
    geometry.marineHeight,
  );

  const blendCells = (pick: (column: number) => ReactNode, key: string) =>
    frames.map((frame, column) => (
      <td
        key={`${key}-${frame.hour}`}
        className={index === column ? "selected-hour" : ""}
      >
        {pick(column)}
      </td>
    ));
  const spread = (column: number) => {
    const value = blend.stats[column]?.spread;
    if (value === null || value === undefined) return "—";
    const half = convert(value, units) / 2;
    return `±${units === "m/s" ? half.toFixed(1) : Math.round(half)}`;
  };

  const caption = `${point.name}: ${
    manifest.stepRanges ? "3/6" : manifest.stepHours
  }-hour wind forecast, in ${units}. Times are local to Ireland.${
    manifest.gustAvailable === false
      ? ` Gust speed unavailable for this ${manifest.modelName} run.`
      : ""
  }`;
  const toolbarCaption = [
    named
      ? chartReady
        ? `${blend.contributing.length} model${blend.contributing.length === 1 ? "" : "s"}`
        : "1 model"
      : "Map point",
    tide.tide ? `${tide.tide.station.name} tide` : null,
    chartUnavailable && named ? "table only" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sliderMax = manifest.stepRanges
    ? frames.at(-1)!.hour
    : Math.max(1, frames.length - 1);
  const sliderValue = manifest.stepRanges
    ? frames[requestedIndex].hour
    : requestedIndex;

  return (
    <>
      <div className="dock-toolbar">
        <button
          className="play-button"
          aria-label={playing ? "Pause forecast" : "Play forecast"}
          disabled={playDisabled}
          onClick={onTogglePlay}
        >
          {playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <div className="dock-place">
          <strong>{point.name}</strong>
          <small>
            {point.county && <span>{point.county}</span>}
            {toolbarCaption}
          </small>
        </div>
        <div className="dock-views" role="group" aria-label="Forecast view">
          {VIEWS.map((entry) => {
            const disabled = entry !== "table" && !!chartUnavailable;
            return (
              <button
                key={entry}
                data-view={entry}
                aria-pressed={view === entry}
                disabled={disabled}
                title={disabled ? chartUnavailable! : VIEW_LABEL[entry]}
                onClick={() => setView(entry)}
              >
                {VIEW_GLYPH[entry]}
                <span>{VIEW_LABEL[entry]}</span>
              </button>
            );
          })}
        </div>
        <button
          ref={filterButton}
          className={`dock-filter${filterOpen ? " pressed" : ""}`}
          aria-label="Display options"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((value) => !value)}
        >
          <SlidersHorizontal size={16} />
        </button>
        {open && (
          <button
            className="grid-close"
            aria-label="Close forecast panel"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="timeline">
        <div className="timeline-controls">
          <button
            className="step-button"
            aria-label="Previous forecast"
            disabled={requestedIndex === 0}
            onClick={() => onSelect(requestedIndex - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <div className="slider-track">
            <input
              type="range"
              style={{
                background: windTrackBackground(
                  series.values,
                  frames.length,
                  frames.map((frame) => frame.hour),
                ),
              }}
              title="Track colours show forecast wind speed at the selected location"
              min="0"
              max={sliderMax}
              value={sliderValue}
              disabled={busy}
              aria-label="Forecast time"
              aria-valuetext={`${dayLabel(frames[requestedIndex].validTime)} ${timeLabel(
                frames[requestedIndex].validTime,
              )}`}
              onChange={(event) =>
                onSelect(
                  manifest.stepRanges
                    ? nearestFrame(
                        frames,
                        Date.parse(manifest.runTime) +
                          Number(event.target.value) * 3600000,
                      )
                    : Number(event.target.value),
                )
              }
              onKeyDown={(event) => {
                if (!manifest.stepRanges) return;
                const delta = {
                  ArrowRight: 1,
                  ArrowUp: 1,
                  ArrowLeft: -1,
                  ArrowDown: -1,
                  PageUp: 4,
                  PageDown: -4,
                }[event.key];
                if (delta !== undefined) {
                  event.preventDefault();
                  onSelect(
                    Math.max(
                      0,
                      Math.min(frames.length - 1, requestedIndex + delta),
                    ),
                  );
                }
              }}
            />
          </div>
          <button
            className="step-button"
            aria-label="Next forecast"
            disabled={requestedIndex === frames.length - 1}
            onClick={() => onSelect(requestedIndex + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {open && (
        <section className="forecast-sheet glass" aria-label="Spot forecast">
          <div
            ref={scroll}
            className="forecast-scroll"
            tabIndex={0}
            aria-label="Hourly wind forecast; scroll horizontally for more times"
          >
            <div className="forecast-content" ref={content}>
              <table className="forecast-table">
                <caption className="sr-only">{caption}</caption>
                <ForecastHeader
                  manifest={manifest}
                  point={point}
                  days={days}
                  index={index}
                  onSelect={onSelect}
                  showSun
                />
                {view === "table" ? (
                  <ForecastSheet
                    manifest={manifest}
                    units={units}
                    index={index}
                    values={series.values}
                  />
                ) : (
                  <tbody className="chart-body">
                    {rows.blend && (
                      <tr className="chart-row">
                        <th scope="row" className="chart-gutter">
                          <span
                            className="axis-scale"
                            role="img"
                            aria-label={`Wind scale, 0 to ${max} ${unitLabel(units)}`}
                            style={{
                              top: PLOT_PAD_TOP,
                              bottom: PLOT_PAD_BOTTOM,
                              backgroundImage: `linear-gradient(to top, ${windGradientStops(
                                max,
                                units,
                              )
                                .map(
                                  (stop) =>
                                    `${stop.colour} ${(stop.offset * 100).toFixed(1)}%`,
                                )
                                .join(", ")})`,
                            }}
                          />
                          <span className="axis-ticks" aria-hidden="true">
                            {axisTicks(max).map((tick) => (
                              <i key={tick} style={{ top: y(tick) }}>
                                {tick}
                              </i>
                            ))}
                          </span>
                        </th>
                        <td className="chart-cell" colSpan={frames.length}>
                          <div className="chart-holder" ref={holder}>
                            {geometry.chartWidth > 0 &&
                              chartReady &&
                              (view === "blend" ? (
                                <BlendChart
                                  width={geometry.chartWidth}
                                  height={geometry.chartHeight}
                                  centres={centres}
                                  frames={frames}
                                  stats={blend.stats}
                                  lines={blend.lines}
                                  directions={blend.directions}
                                  nights={nights}
                                  units={units}
                                  max={max}
                                  reducedMotion={reducedMotion}
                                />
                              ) : (
                                <CandleChart
                                  width={geometry.chartWidth}
                                  height={geometry.chartHeight}
                                  edges={edges}
                                  frames={frames}
                                  candles={candles}
                                  columnsPerCandle={columnsPerCandle}
                                  nights={nights}
                                  units={units}
                                  max={max}
                                />
                              ))}
                            {!chartReady && (
                              <p className="chart-empty" role="status">
                                Reading the models…
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {rows.spread && (
                      <tr className="blend-row">
                        <th scope="row">
                          <RowLabel
                            glyph={<ArrowUpDown size={18} aria-hidden="true" />}
                            label="Spread"
                            help={ROW_HELP.spread}
                            unit={units}
                          />
                        </th>
                        {blendCells(spread, "spread")}
                      </tr>
                    )}
                    {rows.dir && (
                      <tr className="blend-row">
                        <th scope="row">
                          <RowLabel
                            glyph={<Navigation size={18} aria-hidden="true" />}
                            label="Direction"
                            help={ROW_HELP.dir}
                          />
                        </th>
                        {blendCells((column) => {
                          const angle = blend.directions[column];
                          return angle === null || angle === undefined ? (
                            "—"
                          ) : (
                            <span className="direction-cell">
                              <ArrowDown
                                size={16}
                                style={{ transform: `rotate(${angle}deg)` }}
                                aria-hidden="true"
                              />
                              {compass(angle)}
                            </span>
                          );
                        }, "dir")}
                      </tr>
                    )}
                    {rows.wind && (
                      <tr className="blend-row">
                        <th scope="row">
                          <RowLabel
                            glyph={<WindIcon size={18} aria-hidden="true" />}
                            label="Wind"
                            help={ROW_HELP.wind}
                            unit={units}
                          />
                        </th>
                        {frames.map((frame, column) => {
                          const value = blend.stats[column]?.median ?? null;
                          return (
                            <td
                              key={frame.hour}
                              className={`wind-cell ${index === column ? "selected-hour" : ""}`}
                              style={
                                {
                                  "--wind-colour":
                                    value === null
                                      ? "transparent"
                                      : `rgba(${windColor(convert(value, "kn")).join(",")}, 0.65)`,
                                } as React.CSSProperties
                              }
                            >
                              {value === null
                                ? "—"
                                : Math.round(convert(value, units))}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                    {rows.gust && (
                      <tr className="blend-row">
                        <th scope="row">
                          <RowLabel
                            glyph={
                              <WindArrowDown size={18} aria-hidden="true" />
                            }
                            label="Gust"
                            help={ROW_HELP.gust}
                            unit={units}
                          />
                        </th>
                        {frames.map((frame, column) => {
                          const value = blend.stats[column]?.gust.max ?? null;
                          return (
                            <td
                              key={frame.hour}
                              className={`gust-cell ${index === column ? "selected-hour" : ""}`}
                              style={
                                {
                                  "--wind-colour":
                                    value === null
                                      ? "transparent"
                                      : `rgba(${windColor(convert(value, "kn")).join(",")}, 0.65)`,
                                } as React.CSSProperties
                              }
                            >
                              {value === null
                                ? "—"
                                : Math.round(convert(value, units))}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                )}
                {showMarine && (
                  <tbody className="marine-rows" ref={marine}>
                    {marineRows.map((key) => (
                      <tr key={key} className="marine-row">
                        <th scope="row">
                          <RowLabel
                            glyph={
                              key === "waves" ? (
                                <Waves size={18} aria-hidden="true" />
                              ) : key === "sea" ? (
                                <Thermometer size={18} aria-hidden="true" />
                              ) : (
                                <ThermometerSun size={18} aria-hidden="true" />
                              )
                            }
                            label={rowOffers[key].label}
                            help={ROW_HELP[key]}
                          />
                        </th>
                        {frames.map((frame) => (
                          <td key={frame.hour}>—</td>
                        ))}
                      </tr>
                    ))}
                    {showTide && marineRows.length === 0 && (
                      <tr className="marine-row tide-row">
                        <th scope="row">
                          <RowLabel
                            glyph={<TideGlyph />}
                            label="Tide"
                            help={`${ROW_HELP.tide} ${tide.tide!.curve.datum}.`}
                          />
                        </th>
                        {frames.map((frame, column) => (
                          <td key={frame.hour}>
                            <span className="sr-only">
                              {tideValues[column] === null
                                ? "—"
                                : `${tideValues[column]!.toFixed(2)} m`}
                            </span>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                )}
              </table>
              {showTide && geometry.marineHeight > 0 && (
                <svg
                  className="tide-underlay"
                  aria-hidden="true"
                  width={geometry.chartWidth}
                  height={geometry.marineHeight}
                  style={{ left: geometry.label, top: geometry.marineTop }}
                >
                  <path className="tide-fill" d={tidePath} />
                  <path className="tide-stroke" d={tidePath} />
                </svg>
              )}
              {nowX !== null && (
                <div
                  className="forecast-now"
                  style={{ left: nowX }}
                  role="img"
                  aria-label={`Now: ${dayLabel(new Date(now).toISOString())} ${timeLabel(
                    new Date(now).toISOString(),
                  )}, Irish time`}
                  data-time={new Date(now).toISOString()}
                >
                  <span>Now</span>
                </div>
              )}
            </div>
          </div>
          {view === "table" && (series.pending || series.failures > 0) && (
            <div className="sheet-loading" role="status">
              {series.pending
                ? "Loading forecast hours…"
                : "Some hours could not be loaded."}
              {!series.pending && (
                <button onClick={series.retry}>Retry missing hours</button>
              )}
            </div>
          )}
          <p className="forecast-credits">
            {(blend.manifests.length
              ? blend.manifests.map((entry) => entry.modelName)
              : [manifest.modelName]
            ).join(", ")}
            {tide.tide && (
              <>
                {" · "}
                {tide.tide.station.name} tide, {tide.tide.curve.datum}
                {", "}
                {tide.manifest?.attribution ?? "Marine Institute"}
              </>
            )}
            {" · "}
            <span>Speed colours show wind speed only, not suitability.</span>
          </p>
        </section>
      )}
      {filterOpen && (
        <DisplayFilter
          prefs={prefs}
          onChange={onPrefsChange}
          rows={rowOffers}
          models={models.filter((model) => model.entry.kind === "wind")}
          onClose={() => {
            setFilterOpen(false);
            // After the dialog has actually left the top layer: closing one
            // drops focus, so the trigger has to take it back afterwards.
            requestAnimationFrame(() =>
              filterButton.current?.focus({ preventScroll: true }),
            );
          }}
        />
      )}
    </>
  );
}

/** Tide heights fill the marine block, padded so the curve never touches it. */
function tideScale(
  range: { lo: number; hi: number },
  height: number,
): (value: number) => number {
  const lo = Number.isFinite(range.lo) ? range.lo : 0;
  const hi = Number.isFinite(range.hi) ? range.hi : lo + 1;
  const span = hi - lo || 1;
  const top = 3;
  const bottom = Math.max(top + 1, height - 2);
  return (value: number) =>
    bottom - Math.max(0, Math.min(1, (value - lo) / span)) * (bottom - top);
}
