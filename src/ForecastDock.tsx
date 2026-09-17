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
  CloudRain,
  CloudSun,
  Cloudy,
  Gauge,
  Layers3,
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
import ForecastHeader, { type ModelBand } from "./ForecastHeader";
import ForecastSheet from "./ForecastSheet";
import RowLabel from "./RowLabel";
import WeatherGlyph from "./WeatherGlyph";
import {
  PLOT_PAD_BOTTOM,
  PLOT_PAD_TOP,
  areaPath,
  axisTicks,
  candleGroups,
  columnCentres,
  columnEdges,
  columnWeights,
  dayGroups,
  modelSupport,
  niceMax,
  valueScale,
  windGradientStops,
} from "./chart";
import {
  useBlend,
  useSpotSeaTemperature,
  useSpotTide,
  useSpotWaves,
  useSpotWeather,
} from "./useBlend";
import { usePointSeries } from "./usePointSeries";
import { candlesOver } from "../force5/src/blend";
import { dayNights } from "../force5/src/sun";
import {
  columnSources,
  framePosition,
  modelStretches,
  windTrackBackground,
  type DockColumn,
} from "../force5/src/timeline";
import type { ModelAvailability } from "../force5/src/manifests";
import { spotSeries } from "../force5/src/series";
import { MODELS, type ModelId } from "../force5/src/models";
import {
  VIEWS,
  rowOn,
  type ForecastView,
  type Prefs,
  type RowKey,
} from "../force5/src/prefs";
import { convert, unitLabel } from "../force5/src/units";
import {
  compass,
  dayLabel,
  freshness,
  nearestFrame,
  timeLabel,
  windColor,
  type FrameInfo,
  type Manifest,
  type Point,
  type Wind,
} from "../force5/src/weather";
import { tideAt } from "../force5/src/tides";
import {
  NETWORK_LABEL,
  observationAge,
  seaTemperatureText,
  sparklinePoints,
} from "../force5/src/seaTemperature";
import { precipIntervalHours, presentWeather } from "../force5/src/surface";
import { variableValue } from "../force5/src/variables";
import type { WaveFieldSet } from "../force5/src/waves";

interface Props {
  /** The run the map is drawing. It decides which columns have a map frame. */
  manifest: Manifest;
  /** The dock's own time axis, built from every model rather than from the map. */
  columns: readonly DockColumn[];
  /** The page's one availability sweep, shared with the blend and the columns. */
  models: readonly ModelAvailability[];
  modelsResolved: boolean;
  point: Point;
  prefs: Prefs;
  onPrefsChange: (prefs: Prefs) => void;
  /** The reader's place, as a valid time. The column is derived from it. */
  selectedTime: string;
  /** Put a model on the map at a given time, from the long-range chip. */
  onShowOnMap: (model: ModelId, validTime: string) => void;
  /** The time to keep in view; the map's own while a frame is failing. */
  scrollTime: string | null;
  onSelect: (validTime: string) => void;
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

/** A single long swell line: one wave train that travelled to get here. */
const SwellGlyph = () => (
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
    <path d="M2 14c5 0 5-6 10-6s5 6 10 6" />
  </svg>
);
/** Short chop under wind ticks: sea the local wind is raising right now. */
const WindSeaGlyph = () => (
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
    <path d="M2 16c1.7 0 1.7-3 3.3-3s1.7 3 3.4 3 1.6-3 3.3-3 1.7 3 3.3 3 1.7-3 3.4-3 1.6 3 3.3 3" />
    <path d="M4 7h9m3 0h4M4 10.5h5" />
  </svg>
);

const ROW_HELP: Record<RowKey, string> = {
  blend:
    "Every selected model on one chart. The band is where the models put the wind; the white line is the middle of them.",
  waveOverlay:
    "A faint band along the bottom of the chart for wave height, on its own nought-to-six-metre scale. It shares the chart's time axis, not its value axis.",
  wind: "The middle model at each hour — half the models sit above it, half below.",
  spread:
    "Half the gap between the highest and lowest model at that hour. Small means the models agree.",
  gust: "The strongest gust any selected model shows for that hour.",
  dir: "Where the wind blows from, averaged across the selected models. Arrows on the chart show the same thing.",
  waves:
    "Significant wave height and peak period; direction is where waves come from.",
  swell:
    "The swell part of the sea on its own: waves that were raised elsewhere and travelled here. Heights add in energy, not in metres, so swell and wind sea do not sum to the total.",
  windsea:
    "The sea the local wind is raising right now, separately from the swell.",
  weather:
    "The model's own present-weather code for the cell this spot sits in: clear, cloud, fog, drizzle, rain, showers, thunder or snow. A code is read, never averaged or blended between models, and each cell says which code it is and what it means.",
  air: "Air temperature two metres above the ground, in whole degrees. Each cell adds the dew point and the relative humidity at that hour.",
  rain: "Rain forecast for the interval ending at each column, in millimetres — an amount, not a rate, and not a total for the day. Each cell says which hours it covers.",
  cloud:
    "Total cloud cover through the whole column, as a percentage, with a three-level bar beside it for high, medium and low cloud.",
  pressure:
    "Pressure reduced to mean sea level, in whole hectopascals. Off by default: it is a synoptic reading rather than a launch decision.",
  sea: "Model skin temperature, approximate. Over sea this is the model's own surface field and a proxy for a sea temperature, not a measurement; over land it is the temperature of the ground, which on a sunny afternoon runs far above the air. It is shown only where no station is measuring the water.",
  tide: "Predicted tide height at the nearest station. Astronomical prediction only: no surge and no wind effect.",
};

/** The three wave rows, in the order the marine block stacks them. */
const WAVE_ROWS = ["waves", "swell", "windsea"] as const;
type WaveRowKey = (typeof WAVE_ROWS)[number];
const WAVE_ROW_LABEL: Record<WaveRowKey, string> = {
  waves: "Waves",
  swell: "Swell",
  windsea: "Wind sea",
};
const WAVE_ROW_GLYPH: Record<WaveRowKey, ReactNode> = {
  waves: <Waves size={18} aria-hidden="true" />,
  swell: <SwellGlyph />,
  windsea: <WindSeaGlyph />,
};

/**
 * The surface-weather rows, in the order the marine block stacks them under the
 * sea: what the sky is doing, then how warm, wet and cloudy it is, then the two
 * readings that are a synoptic detail or an approximation.
 */
const WEATHER_ROWS = [
  "weather",
  "air",
  "rain",
  "cloud",
  "pressure",
  "sea",
] as const;
type WeatherRowKey = (typeof WEATHER_ROWS)[number];
const WEATHER_ROW_LABEL: Record<WeatherRowKey, string> = {
  weather: "Weather",
  air: "Air temp",
  rain: "Rain",
  cloud: "Cloud",
  pressure: "Pressure",
  sea: "Sea temp",
};
const WEATHER_ROW_GLYPH: Record<WeatherRowKey, ReactNode> = {
  weather: <CloudSun size={18} aria-hidden="true" />,
  air: <ThermometerSun size={18} aria-hidden="true" />,
  rain: <CloudRain size={18} aria-hidden="true" />,
  cloud: <Cloudy size={18} aria-hidden="true" />,
  pressure: <Gauge size={18} aria-hidden="true" />,
  sea: <Thermometer size={18} aria-hidden="true" />,
};
/** The unit each row states once, on its glyph, rather than in every cell. */
const WEATHER_ROW_UNIT: Record<WeatherRowKey, string | undefined> = {
  weather: undefined,
  air: "°C",
  rain: "mm",
  cloud: "%",
  pressure: "hPa",
  sea: "°C",
};
/**
 * How much rain, in millimetres over one interval, saturates the cell's tint.
 * Four millimetres in three hours is properly wet; past that the tint stops
 * deepening, because the number is the reading and the tint is only a shape the
 * eye can scan.
 */
const RAIN_TINT_FULL_MM = 4;

/**
 * The observed Sea row's sparkline. Thirteen pixels inside a 24px row, drawn
 * beside the reading rather than under it, so the row keeps its budget and the
 * seven-day shape costs nothing in height.
 */
const SEA_SPARK = { width: 54, height: 13 } as const;

/** One column's wind reading and the run it was read from. */
export interface ColumnCell {
  validTime: string;
  model: string;
  /** Null where nothing covers the column; undefined while a frame loads. */
  wind: Wind | null | undefined;
  manifest: Manifest;
  /** That run's own frame at this time, for the gust window it declares. */
  frame: FrameInfo | null;
}

/** What one cell needs beyond its text: a tint, a muted style and a tooltip. */
interface WeatherCell {
  content: ReactNode;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}
const NO_READING: WeatherCell = { content: "—" };

/** Interpolate between actual timestamp centres, including mixed 3/6-hour columns. */
function timeX(
  content: HTMLElement,
  columns: readonly DockColumn[],
  time: number,
) {
  const position = framePosition(columns, time);
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
  columns,
  models,
  modelsResolved,
  point,
  prefs,
  onPrefsChange,
  selectedTime,
  scrollTime,
  onSelect,
  onShowOnMap,
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
  const resolved = modelsResolved;
  const tide = useSpotTide(point.id);
  const sea = useSpotSeaTemperature(point.id);
  // Everything that reads a time axis reads the dock's columns, not the map
  // model's frames: the columns outlive whichever run is on the map.
  const axis = useMemo(
    () => columns.map((column) => column.validTime),
    [columns],
  );
  const selected = useMemo(
    () =>
      columns.length ? nearestFrame(columns, Date.parse(selectedTime)) : 0,
    [columns, selectedTime],
  );
  const blend = useBlend(models, prefs.blendModels, point.id, axis);
  const waves = useSpotWaves(models, point.id, axis);
  const weather = useSpotWeather(models, point.id, axis);

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
      setNowX(timeX(element, columns, now));
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
  }, [
    columns,
    now,
    open,
    prefs.view,
    rows,
    tide.tide,
    sea.observed,
    blend.stats.length,
  ]);

  useLayoutEffect(() => {
    const container = scroll.current;
    if (!container) return;
    if (!columns.length || scrollTime === null) return;
    const scrollColumn = nearestFrame(columns, Date.parse(scrollTime));
    const centreNow =
      initialScroll.current && scrollColumn === nearestFrame(columns);
    initialScroll.current = false;
    const followTime = () => {
      const cell = container
        .querySelector<HTMLElement>(`[data-forecast-index="${scrollColumn}"]`)
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
          ? timeX(content.current, columns, Date.now())
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
  }, [scrollTime, series.key, columns]);

  const days = useMemo(() => dayGroups(axis, dayLabel), [axis]);
  const weights = useMemo(
    () => columnWeights(axis, manifest.stepHours),
    [axis, manifest.stepHours],
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
      axis.length
        ? dayNights(
            point.lat,
            point.lon,
            new Date(axis[0]),
            new Date(axis[axis.length - 1]),
          )
        : [],
    [axis, point.lat, point.lon],
  );

  /**
   * Which run answers for each column: the map model wherever it has a frame,
   * the column's own owner past that. Everything a cell says — the value, the
   * gust window, the tooltip — follows from this one list.
   */
  const sources = useMemo(
    () => columnSources(columns, manifest.frames, manifest.model),
    [columns, manifest],
  );
  const windById = useMemo(
    () =>
      new Map(
        models
          .filter((model) => model.wind !== null)
          .map((model) => [model.id, model.wind!] as const),
      ),
    [models],
  );
  /**
   * One cell per column. Inside the map model's range the value is the one the
   * map itself is drawn from; past it, a named spot falls back to the owning
   * run's precomputed series, which costs no download. A bare map point has no
   * precomputed series anywhere, so its far columns stay empty.
   */
  const cells = useMemo<ColumnCell[]>(() => {
    const seriesByModel = new Map<string, Map<string, Wind>>();
    const owned = (model: string) => {
      const cached = seriesByModel.get(model);
      if (cached) return cached;
      const run = windById.get(model);
      const points = run && point.id ? spotSeries(run, point.id) : null;
      const byTime = new Map<string, Wind>(
        (points ?? []).map((entry) => [entry.validTime, entry]),
      );
      seriesByModel.set(model, byTime);
      return byTime;
    };
    return columns.map((column, at) => {
      const source = sources[at] ?? { frame: null, model: column.model };
      const run =
        source.model === manifest.model
          ? manifest
          : (windById.get(source.model) ?? manifest);
      return {
        validTime: column.validTime,
        model: source.model,
        wind:
          source.frame === null
            ? (owned(source.model).get(column.validTime) ?? null)
            : series.values[source.frame],
        manifest: run,
        frame:
          source.frame === null
            ? (run.frames.find(
                (entry) => entry.validTime === column.validTime,
              ) ?? null)
            : manifest.frames[source.frame],
      };
    });
  }, [columns, sources, series.values, windById, point.id, manifest]);
  const columnWind = useMemo(() => cells.map((cell) => cell.wind), [cells]);
  /** One label per stretch of the axis, for the header's model band. */
  const bands = useMemo<ModelBand[]>(
    () =>
      modelStretches(sources).map((stretch) => {
        const run =
          stretch.model === manifest.model
            ? manifest
            : windById.get(stretch.model);
        return {
          ...stretch,
          label: run?.modelName ?? stretch.model,
          // An eighteen-hour-old run still owns its columns; the band is where
          // the reader is told it is not the latest one.
          older: run ? freshness(run, now) === "stale" : false,
        };
      }),
    [sources, manifest, windById, now],
  );
  /**
   * A column the map model cannot reach keeps the map on its last frame. The
   * reader is offered the run that does reach it, and nothing switches until
   * they ask.
   */
  const beyondMap = sources[selected]?.frame === null;
  const reachable =
    beyondMap && columns[selected]
      ? MODELS.find((entry) => entry.id === columns[selected].model)
      : undefined;

  // Value axis: whole ten-unit steps above the highest gust in the blend, so a
  // unit change visibly rescales the chart instead of relabelling it.
  const peak = blend.stats.reduce(
    (highest, hour) => Math.max(highest, hour.max ?? 0, hour.gust.max ?? 0),
    0,
  );
  const max = niceMax(convert(peak, units));
  const y = valueScale(max, geometry.chartHeight);
  // Three hours of wall clock, not a fixed number of columns: past the seam a
  // single column already covers six, and a fixed width would pair a
  // three-hour candle with a twelve-hour one.
  const groups = useMemo(() => candleGroups(axis), [axis]);
  // How many models are actually behind each column. Later days have fewer, and
  // the chart says so instead of looking confidently narrow.
  const support = useMemo(
    () => modelSupport(blend.lines, axis.length),
    [blend.lines, axis.length],
  );
  const candles = useMemo(
    () => (blend.stats.length ? candlesOver(blend.stats, groups) : []),
    [blend.stats, groups],
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

  const tideOffer = !named
    ? "named spots only"
    : tide.loading
      ? undefined
      : (tide.error ?? undefined);
  // A wave source that answered but cannot see this beach is a different thing
  // from no adapter at all, and the filter says which.
  const waveOffer = !named
    ? "named spots only"
    : !waves.published
      ? "no source yet"
      : waves.source
        ? undefined
        : "no wave data at this spot";
  const partitionOffer = (key: "swell" | "windsea") =>
    waveOffer ??
    (waves.source?.fields[key]
      ? undefined
      : key === "swell"
        ? "no swell partition here"
        : "no wind-sea partition here");
  // The same three states for the weather rows: no adapter published anything,
  // one did but cannot see this spot, or a row whose variable this source does
  // not declare. Each says which, rather than the row quietly disappearing.
  const weatherOffer = !named
    ? "named spots only"
    : !weather.published
      ? "no source yet"
      : weather.source
        ? undefined
        : "no weather data at this spot";
  const WEATHER_ROW_FIELD = {
    weather: "present",
    air: "air",
    rain: "rain",
    cloud: "cloud",
    pressure: "pressure",
    sea: "skin",
  } as const;
  const weatherRowOffer = (key: WeatherRowKey) =>
    weatherOffer ??
    (weather.source?.fields[WEATHER_ROW_FIELD[key]]
      ? undefined
      : "not in this model");
  /**
   * The Sea row has two possible sources, and they are not the same kind of
   * thing. An in-situ observation is a measurement of the water and wins wherever
   * a station is in range; the model's skin temperature is an approximation, and
   * the row says which of the two it is showing either way.
   */
  const observed = sea.observed;
  // Recomputed against the dock's own clock rather than taken from the load, so
  // "2 h ago" is still true in a tab that has been open since this morning.
  const observedAge = observed
    ? (now - Date.parse(observed.latest.time)) / 3600000
    : 0;
  const observedDepth =
    observed?.station.depth === null || observed?.station.depth === undefined
      ? "sensor depth not published"
      : `sensor ${observed.station.depth} m below the surface`;
  const seaHelp = observed
    ? `Measured water temperature from ${observed.station.name}, the nearest Marine Institute station reporting near this spot. A measurement, not a forecast: it is one reading for the whole row rather than a value per column, and the newest reading is as recent as the water gets. The line is the last seven days.`
    : `${ROW_HELP.sea}${sea.note ? ` ${sea.note}` : ""}`;
  const seaTitle = observed
    ? `${observed.latest.value.toFixed(1)} °C measured at ${
        observed.station.name
      } · ${NETWORK_LABEL[observed.station.network]} · ${observed.distanceKm.toFixed(
        1,
      )} km from ${point.name} · ${observedDepth} · ${dayLabel(
        observed.latest.time,
      )} ${timeLabel(observed.latest.time)} Irish time (${observationAge(
        observedAge,
      )}) · ${sea.manifest?.attribution ?? "Marine Institute observations"}`
    : undefined;

  const rowOffers: Record<RowKey, RowOffer> = {
    blend: { label: "Model blend" },
    waveOverlay: { label: "Wave band on the chart", unavailable: waveOffer },
    wind: { label: "Wind (median)" },
    spread: { label: "Spread" },
    gust: { label: "Gust" },
    dir: { label: "Direction row" },
    waves: { label: WAVE_ROW_LABEL.waves, unavailable: waveOffer },
    swell: {
      label: WAVE_ROW_LABEL.swell,
      unavailable: partitionOffer("swell"),
    },
    windsea: {
      label: WAVE_ROW_LABEL.windsea,
      unavailable: partitionOffer("windsea"),
    },
    ...(Object.fromEntries(
      WEATHER_ROWS.map((key) => [
        key,
        {
          label: WEATHER_ROW_LABEL[key],
          unavailable: weatherRowOffer(key),
        },
      ]),
    ) as Record<WeatherRowKey, RowOffer>),
    // An observation needs no weather model behind it, so the row is offered on
    // the strength of the observations alone where they cover this spot - and is
    // on by default there, because measured water is worth a row. Where they do
    // not, it is the model's approximation again, and off.
    sea: {
      label: WEATHER_ROW_LABEL.sea,
      unavailable: observed ? undefined : weatherRowOffer("sea"),
      defaultOn: !!observed,
    },
    tide: { label: "Tide", unavailable: tideOffer },
  };
  /** A row's own switch, or its default where the reader has not touched it. */
  const rowShown = (key: RowKey) =>
    rowOn(prefs, key, rowOffers[key].defaultOn) && !rowOffers[key].unavailable;

  const showTide = rows.tide && !tideOffer && !!tide.tide;
  const waveRows = WAVE_ROWS.filter(rowShown);
  const weatherRows = WEATHER_ROWS.filter(rowShown);
  /** The rows the weather model is actually credited for: an observed Sea is not. */
  const modelWeatherRows = weatherRows.filter(
    (key) => key !== "sea" || !observed,
  );
  const marineRows: RowKey[] = [...waveRows, ...weatherRows];
  const showMarine = showTide || marineRows.length > 0;
  /** The field set each wave row reads, from the source's own variable map. */
  const waveFieldSet = (key: WaveRowKey): WaveFieldSet | null =>
    (key === "waves"
      ? waves.source?.fields.total
      : waves.source?.fields[key]) ?? null;
  const waveCell = (key: WaveRowKey, column: number): ReactNode => {
    const set = waveFieldSet(key);
    const step = waves.columns[column];
    const height = set && step ? step.values[set.height] : null;
    // A null is a sea state the model did not resolve, not a flat calm.
    if (typeof height !== "number") return "—";
    const period = set!.period ? step!.values[set!.period] : null;
    const angle = set!.direction ? step!.values[set!.direction] : null;
    return (
      <span className="wave-cell">
        {typeof angle === "number" && (
          // Wave direction is the bearing they come from, so the arrow rotated
          // by that bearing travels the way the waves do — as on the wind rows.
          <ArrowDown
            className="wave-arrow"
            size={13}
            style={{ transform: `rotate(${angle}deg)` }}
            aria-hidden="true"
          />
        )}
        <b>{height.toFixed(1)}</b>
        {typeof period === "number" && <small>{Math.round(period)}s</small>}
      </span>
    );
  };
  const waveHelp = (key: WaveRowKey) =>
    [ROW_HELP[key], waves.source?.note].filter(Boolean).join(" ");

  /**
   * One surface-weather cell. Every row reads the same native step, so a column
   * the weather run does not reach is a dash on all of them at once rather than
   * a borrowed neighbouring hour, and a null is an absence the model published,
   * never a zero.
   */
  const weatherCell = (key: WeatherRowKey, column: number): WeatherCell => {
    const fields = weather.source?.fields;
    const step = weather.columns[column];
    if (!fields || !step) return NO_READING;
    const at = (name: string | null) => variableValue(step, name);
    const degrees = (value: number) => `${value.toFixed(1)} °C`;
    switch (key) {
      case "weather": {
        const code = at(fields.present);
        const reading = presentWeather(code);
        return reading
          ? {
              content: <WeatherGlyph weather={reading} />,
              title: `${reading.description} (WMO present-weather code ${reading.code}).`,
            }
          : NO_READING;
      }
      case "air": {
        const value = at(fields.air);
        if (value === null) return NO_READING;
        const dew = at(fields.dewPoint);
        const humidity = at(fields.humidity);
        return {
          content: Math.round(value),
          title: [
            `Air ${degrees(value)}`,
            dew === null ? null : `dew point ${degrees(dew)}`,
            humidity === null ? null : `humidity ${Math.round(humidity)} %`,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }
      case "rain": {
        const value = at(fields.rain);
        const hours = precipIntervalHours(step);
        if (value === null)
          return {
            content: "—",
            title:
              hours === null
                ? "The run hour has no interval to accumulate rain over."
                : "No rain amount is published for this interval.",
          };
        return {
          // Zero is a dry interval the model actually forecast, so it reads as a
          // zero; the dash above is the absence of any interval at all.
          content: value < 0.05 ? "0" : value.toFixed(1),
          className: "rain-cell",
          style: {
            "--rain-tint": Math.min(1, value / RAIN_TINT_FULL_MM).toFixed(2),
          } as React.CSSProperties,
          title: `${value.toFixed(1)} mm${
            hours === null
              ? ""
              : ` in the ${hours} hour${hours === 1 ? "" : "s"} to ${timeLabel(
                  step.validTime,
                )}`
          }.`,
        };
      }
      case "cloud": {
        const total = at(fields.cloud);
        if (total === null) return NO_READING;
        const levels = (
          [
            ["high", fields.cloudHigh],
            ["medium", fields.cloudMid],
            ["low", fields.cloudLow],
          ] as const
        ).map(([name, field]) => ({ name, value: at(field) }));
        const stacked = levels.every((level) => level.value !== null);
        return {
          content: (
            <span className="cloud-cell">
              <b>{Math.round(total)}</b>
              {stacked && (
                <i className="cloud-bars" aria-hidden="true">
                  {levels.map((level) => (
                    <s
                      key={level.name}
                      style={
                        {
                          "--cover": `${Math.round(level.value!)}%`,
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </i>
              )}
            </span>
          ),
          title: `Total cloud ${Math.round(total)} %${
            stacked
              ? `, of which ${levels
                  .map((level) => `${level.name} ${Math.round(level.value!)} %`)
                  .join(", ")}`
              : ""
          }.`,
        };
      }
      case "pressure": {
        const value = at(fields.pressure);
        return value === null
          ? NO_READING
          : {
              content: Math.round(value),
              title: `${value.toFixed(1)} hPa at mean sea level.`,
            };
      }
      case "sea": {
        const value = at(fields.skin);
        return value === null
          ? NO_READING
          : {
              content: Math.round(value),
              className: "proxy-cell",
              title: `Model skin temperature ${degrees(value)}, approximate — not a measured sea temperature. No observation is in range of this spot.`,
            };
      }
    }
  };
  /** The day's highest air temperature, per day group, where the run reaches it. */
  const dayMax = useMemo(() => {
    const field = weather.source?.fields.air;
    if (!field) return {} as Record<string, number>;
    const highest: Record<string, number> = {};
    for (const day of days)
      for (let column = day.start; column < day.start + day.count; column++) {
        const value = variableValue(weather.columns[column], field);
        if (value !== null)
          highest[day.date] = Math.max(highest[day.date] ?? value, value);
      }
    return highest;
  }, [days, weather]);
  const waveOverlayValues = useMemo(
    () =>
      rows.waveOverlay && waves.source
        ? waves.columns.map((step) => {
            const value = step?.values[waves.source!.fields.total.height];
            return typeof value === "number" ? value : null;
          })
        : null,
    [rows.waveOverlay, waves.source, waves.columns],
  );
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
    columns.map((column, at) => (
      <td
        key={`${key}-${column.validTime}`}
        className={selected === at ? "selected-hour" : ""}
      >
        {pick(at)}
      </td>
    ));
  const spread = (column: number) => {
    const value = blend.stats[column]?.spread;
    if (value === null || value === undefined) return "—";
    const half = convert(value, units) / 2;
    return `±${units === "m/s" ? half.toFixed(1) : Math.round(half)}`;
  };

  /**
   * The distinct cadences the columns actually use, for the caption: "3/6" for
   * the sample axis, "1/3/6" once HARMONIE is hourly. Read from the times
   * themselves, because no one run's `stepHours` describes the whole axis.
   */
  const cadences = useMemo(() => {
    const counts = new Map<number, number>();
    for (let i = 1; i < axis.length; i++) {
      const hours = Math.round(
        (Date.parse(axis[i]) - Date.parse(axis[i - 1])) / 3600000,
      );
      if (hours > 0) counts.set(hours, (counts.get(hours) ?? 0) + 1);
    }
    // A gap that happens once is the seam between two runs, not a cadence.
    return [...counts]
      .filter(([, seen]) => seen > 1)
      .map(([hours]) => hours)
      .sort((a, b) => a - b);
  }, [axis]);
  const caption = `${point.name}: ${cadences.join("/") || 3}-hour wind forecast, in ${units}. Times are local to Ireland.${
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

  // The scrubber indexes the dock's columns. Elapsed run hours meant nothing
  // once the axis spans two runs initialised at different times.
  const sliderMax = Math.max(1, columns.length - 1);
  const selectColumn = (at: number) => {
    const column = columns[Math.max(0, Math.min(columns.length - 1, at))];
    if (column) onSelect(column.validTime);
  };

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
            disabled={selected === 0}
            onClick={() => selectColumn(selected - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <div className="slider-track">
            <input
              type="range"
              style={{
                background: windTrackBackground(columnWind, columns.length),
              }}
              title="Track colours show forecast wind speed at the selected location"
              min="0"
              max={sliderMax}
              value={selected}
              disabled={busy}
              aria-label="Forecast time"
              aria-valuetext={`${dayLabel(axis[selected])} ${timeLabel(
                axis[selected],
              )}`}
              onChange={(event) => selectColumn(Number(event.target.value))}
            />
          </div>
          <button
            className="step-button"
            aria-label="Next forecast"
            disabled={selected === columns.length - 1}
            onClick={() => selectColumn(selected + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        {reachable && (
          <button
            className="map-reach-chip"
            onClick={() => onShowOnMap(reachable.id, axis[selected])}
          >
            <Layers3 size={13} aria-hidden="true" />
            <span>Show {reachable.name} on the map</span>
          </button>
        )}
      </div>
      {open && (
        <section className="forecast-sheet glass" aria-label="Spot forecast">
          <div
            ref={scroll}
            className="forecast-scroll"
            tabIndex={0}
            aria-label="Forecast times; scroll horizontally for more"
          >
            <div className="forecast-content" ref={content}>
              <table className="forecast-table">
                <caption className="sr-only">{caption}</caption>
                <ForecastHeader
                  columns={columns}
                  weights={weights}
                  point={point}
                  days={days}
                  bands={bands}
                  selected={selected}
                  onSelect={onSelect}
                  showSun
                  dayMax={dayMax}
                />
                {view === "table" ? (
                  <ForecastSheet
                    cells={cells}
                    units={units}
                    selected={selected}
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
                        <td className="chart-cell" colSpan={columns.length}>
                          <div className="chart-holder" ref={holder}>
                            {geometry.chartWidth > 0 &&
                              chartReady &&
                              (view === "blend" ? (
                                <BlendChart
                                  width={geometry.chartWidth}
                                  height={geometry.chartHeight}
                                  centres={centres}
                                  columns={columns}
                                  groups={groups}
                                  support={support}
                                  stats={blend.stats}
                                  lines={blend.lines}
                                  directions={blend.directions}
                                  nights={nights}
                                  units={units}
                                  max={max}
                                  waves={waveOverlayValues}
                                  reducedMotion={reducedMotion}
                                />
                              ) : (
                                <CandleChart
                                  width={geometry.chartWidth}
                                  height={geometry.chartHeight}
                                  edges={edges}
                                  columns={columns}
                                  candles={candles}
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
                        {columns.map((entry, column) => {
                          const value = blend.stats[column]?.median ?? null;
                          return (
                            <td
                              key={entry.validTime}
                              className={`wind-cell ${selected === column ? "selected-hour" : ""}`}
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
                        {columns.map((entry, column) => {
                          const value = blend.stats[column]?.gust.max ?? null;
                          return (
                            <td
                              key={entry.validTime}
                              className={`gust-cell ${selected === column ? "selected-hour" : ""}`}
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
                    {marineRows.map((key) => {
                      // A measurement is one reading, not a forecast per hour:
                      // the observed Sea row spans its columns with the latest
                      // reading at the left instead of implying a value at every
                      // one of them.
                      if (key === "sea" && observed) {
                        const text = seaTemperatureText(observed, observedAge);
                        const spark = sparklinePoints(
                          observed.series,
                          SEA_SPARK.width,
                          SEA_SPARK.height,
                        );
                        return (
                          <tr
                            key={key}
                            className="marine-row weather-row observed-row"
                            data-row="sea"
                          >
                            <th scope="row">
                              <RowLabel
                                glyph={WEATHER_ROW_GLYPH.sea}
                                label={WEATHER_ROW_LABEL.sea}
                                help={seaHelp}
                              />
                            </th>
                            <td
                              className="observed-cell"
                              colSpan={columns.length}
                              title={seaTitle}
                            >
                              <span className="observed-reading">
                                <b>{text.value}</b>
                                <small>{`· ${text.detail}`}</small>
                                {spark && (
                                  <svg
                                    className="observed-spark"
                                    width={SEA_SPARK.width}
                                    height={SEA_SPARK.height}
                                    aria-hidden="true"
                                  >
                                    <polyline points={spark} />
                                  </svg>
                                )}
                              </span>
                            </td>
                          </tr>
                        );
                      }
                      const wave = (WAVE_ROWS as readonly RowKey[]).includes(
                        key,
                      )
                        ? (key as WaveRowKey)
                        : null;
                      const surface = wave ? null : (key as WeatherRowKey);
                      return (
                        <tr
                          key={key}
                          className={`marine-row${wave ? " wave-row" : " weather-row"}`}
                          data-row={key}
                        >
                          <th scope="row">
                            <RowLabel
                              glyph={
                                wave
                                  ? WAVE_ROW_GLYPH[wave]
                                  : WEATHER_ROW_GLYPH[surface!]
                              }
                              label={rowOffers[key].label}
                              help={
                                wave
                                  ? waveHelp(wave)
                                  : key === "sea"
                                    ? seaHelp
                                    : ROW_HELP[key]
                              }
                              unit={wave ? "m" : WEATHER_ROW_UNIT[surface!]}
                            />
                          </th>
                          {columns.map((entry, column) => {
                            const cell: WeatherCell = wave
                              ? { content: waveCell(wave, column) }
                              : weatherCell(surface!, column);
                            return (
                              <td
                                key={entry.validTime}
                                className={
                                  [
                                    selected === column ? "selected-hour" : "",
                                    cell.className ?? "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ") || undefined
                                }
                                style={cell.style}
                                title={cell.title}
                              >
                                {cell.content}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {/* The tide keeps its own row even under the wave rows: the
                        underlay is a picture, and this is where the heights are
                        actually readable. */}
                    {showTide && (
                      <tr className="marine-row tide-row">
                        <th scope="row">
                          <RowLabel
                            glyph={<TideGlyph />}
                            label="Tide"
                            help={`${ROW_HELP.tide} ${tide.tide!.curve.datum}.`}
                          />
                        </th>
                        {columns.map((entry, column) => (
                          <td key={entry.validTime}>
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
            {waves.source && (
              <>
                {" · "}
                {waves.source.manifest.modelName} waves,{" "}
                {waves.source.manifest.provider}
              </>
            )}
            {weather.source && modelWeatherRows.length > 0 && (
              <>
                {" · "}
                {weather.source.manifest.modelName},{" "}
                {weather.source.manifest.provider}
              </>
            )}
            {observed && (
              <>{" · Sea temperature: Marine Institute observations"}</>
            )}
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
