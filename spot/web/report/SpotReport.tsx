/**
 * A riding place as a spot report, after the approved mock-up
 * (the approved mock-up): what it is like now on quiet
 * cards beside the chart's loupe on the satellite picture, the spots around
 * it, the week as a row of day cards, one graph where every row shares the
 * clock (or the table), and the spot's own notes. Two faces, sentence-case
 * labels, one big figure and one short line per card, the stars as stars.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MIN_ARROW_MS,
  currentFigure,
  currentText,
  currentUnits,
  type CurrentReading,
} from "../../../force5/src/currentReading";
import { loupeRose, roseScale } from "../../../force5/src/focus";
import { modelName } from "../../../force5/src/lead";
import { modelEntry, modelHue } from "../../../force5/src/manifests";
import { POINT_SOURCE_KM } from "../../../force5/src/pointSource";
import { rainTint, DRY_MM_PER_HOUR } from "../../../force5/src/rain";
import { shoreFacing } from "../../../force5/src/shoreFacing";
import { shoreAngle, type ShoreAngle } from "../../../force5/src/stars";
import { CHART_HREF, spotHref } from "../../../force5/src/siteNav";
import { LEVEL_LABEL, MET_WARNINGS_PAGE } from "../../../force5/src/warnings";
import { BEACHES_PAGE } from "../../../force5/src/waterQuality";
import type { Rider } from "../../../force5/src/stars";
import { unitLabel, type Units } from "../../../force5/src/units";
import {
  NETWORK_LABEL,
  observationAge,
  type SeaTemperatureNetwork,
} from "../../../force5/src/seaTemperature";
import { windCss } from "../../../force5/src/windCss";
import {
  measuredAt,
  measuredNow,
  pairStation,
  pairedName,
  type MeasuredReading,
  type Paired,
  type WindReading,
} from "../../../force5/src/windObs";
import { useWindObs } from "../../../shared/web/useWindObs";
import type {
  NearbySpot,
  RidingSpot,
  SpotForecast,
  SpotSea,
} from "../../../mcp/api/forecast";
import {
  useSpotCurrents,
  type SpotCurrents,
} from "../../../shared/web/useSpotCurrents";
import { NoticeMark, Segmented } from "../../../ui";
import type { NightHours } from "../../../force5/src/prefs";
import {
  afterDark,
  fold,
  keptSpans,
  unfolded,
  type Fold,
} from "../../../shared/web/afterDark";
import { RatingTip } from "../../../ui/RatingTip";
import { starsText } from "../../../force5/src/stars";
import { warningName } from "../Warnings";
import { noticeWords, restrictionShort } from "../WaterQuality";
import { RING, tv } from "../../../ui/tv";
import { SkyGlyph } from "../glyphs";
import { lift, pictureCredit, type PictureTide } from "../satellite";
import {
  REPORT_DAYS,
  HOUR,
  clock,
  compass,
  daySun,
  dayNames,
  dublinDate,
  dublinHour,
  dublinMidnight,
  groupDays,
  gustShown,
  windSay,
  leadChanges,
  spotRows,
  tideCurve,
  tideHeightAt,
  tideTurns,
  type DaySun,
  type SpotRow,
} from "../spot";
import { useSpotPicture } from "../useSpotPicture";
import { useWidth } from "../useWidth";
import { launchBed, launchDepth, type LaunchBed } from "./launch";
import {
  GUST_WORDS,
  gustReading,
  modelSeries,
  rainPerHour,
  rowIndexAt,
  rowRain,
  type GustReading,
  type ModelSeries,
} from "./detail";
import { useNearby, type NearbyReading } from "./nearby";
import { ClimateSections, useSheltered } from "./ClimateSections";
import { WAVE_BLEND, waveLeadOrder } from "../../../force5/src/waves";
import {
  PART_ROWS,
  partOf,
  waveHandovers,
  waveWeek,
  windBlend,
  type PartRow,
  type WaveRow,
  type WaveWeek,
  type WindBlendAt,
} from "./blends";
import { spotSquare } from "../../../force5/src/spotData";
import { useWaveBlend } from "../../../shared/web/useWaveBlend";
import { waveBlendHours, type WavePartHour } from "../../../force5/src/waveBlend";
import { PhotoLoupe } from "./PhotoLoupe";
import {
  besideMark,
  dayCard,
  deepUntil,
  hoursMinutes,
  lightLeft,
  rowAt,
  smoothPath,
  standIn,
  type DayCard,
} from "./report";

const styles = tv({
  slots: {
    main: "flex flex-col pb-12",
    title: "flex flex-wrap items-end justify-between gap-3 pt-7 pb-5",
    name: "m-0 font-display text-headline font-semibold text-ink wide:text-name",
    acts: "flex items-center gap-2",
    label: "font-body text-body font-medium text-ink-muted",
    sectionHead: "mb-3.5 flex flex-wrap items-center justify-between gap-2.5",
    h2: "m-0 font-body text-lead font-semibold text-ink",
    section: "pt-9",
    link: [
      "font-body text-body font-medium text-ink underline underline-offset-4 decoration-line",
      RING,
    ],
    nearRow: "flex gap-2.5 overflow-x-auto pb-0.5",
    near: [
      "grid shrink-0 grid-cols-near items-center gap-x-2.5 gap-y-0.5 rounded-control bg-sunken on-card py-2 pr-3.5 pl-2 text-ink no-underline",
      "transition-colors duration-fast hover:bg-line",
      RING,
    ],
    // The spot you are on, as the chosen day: a plain ring inside the card.
    nearHere: "inset-ring-2 inset-ring-ink",
    nearImg: "row-span-2 size-10 rounded-control object-cover",
    nearName: "font-body text-body font-semibold whitespace-nowrap",
    nearLine:
      "flex items-center gap-2 font-body text-body whitespace-nowrap text-ink-2",
    now: "grid gap-3 rail:grid-cols-now rail:gap-4 xwide:grid-cols-now-wide",
    column: "flex min-w-0 flex-col gap-5",
    cards: "grid grid-cols-2 content-start gap-3",
    card: "min-w-0 rounded-surface bg-sunken on-card p-4 wide:px-5",
    wide: "col-span-2",
    big: "my-2 flex flex-wrap items-baseline gap-1.5 font-body text-big-sm text-ink wide:text-big",
    unit: "font-body text-prose font-medium text-ink-2",
    gust: "font-body text-lead font-semibold text-gust",
    line: "font-body text-prose text-ink-2",
    off: "text-pen",
    bar: "mt-1 mb-2 h-1.5 overflow-hidden rounded-full bg-line",
    barFill: "block h-full rounded-full bg-depth",
    photo: "aspect-square w-full self-start",
    seg: "absolute top-2.5 left-2.5",
    foot: [
      "absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-photo-pill px-3.5 py-1.5",
      "font-body text-body font-semibold whitespace-nowrap text-photo-line",
    ],
    footGust: "text-caption text-photo-gust",
    side: "hidden flex-col gap-2 xwide:flex",
    // A card a day, as many as the forecast reaches: they share the width
    // while they fit, and scroll sideways past it.
    week: "flex gap-2 overflow-x-auto",
    day: [
      "grid min-w-29.5 flex-1 shrink-0 content-start gap-2 rounded-surface border-0 bg-sunken on-card p-3.5 text-left text-ink",
      "cursor-pointer transition-colors duration-fast hover:bg-line",
      RING,
    ],
    dayOn: "inset-ring-2 inset-ring-ink",
    dayName: "font-body text-prose font-semibold",
    dayDate: "ml-1 font-normal text-ink-muted",
    range: "font-body text-prose font-semibold",
    small: "font-body text-caption font-normal text-ink-muted",
    spark: "block h-7 w-full",
    dayFoot:
      "flex items-center justify-between font-body text-caption text-ink-muted",
    tools: [
      "my-4 flex flex-wrap items-center justify-between gap-2.5",
      // On a phone the readout stays in view over the graph, which is
      // taller than the screen, as the hours are scrubbed through.
      "max-wide:sticky max-wide:top-0 max-wide:z-2 max-wide:my-0 max-wide:bg-ground max-wide:py-3",
    ],
    // The readings in a grid of cells that keep their places as the hours
    // are scrubbed: even cells, the longer readings two wide, four to a row
    // on a phone.
    readout: [
      "grid w-full grid-flow-row-dense grid-cols-4 items-start gap-x-3 gap-y-1.5",
      "wide:grid-cols-readout wide:gap-x-5 wide:gap-y-2.5",
    ],
    // As wide as the widest hour it says ("Wed 16:00"), so "Now" and every
    // hour after it hold the same place.
    chip: "inline-block min-w-24 justify-self-start rounded-full bg-inverse px-3 py-1 text-center font-body text-body font-semibold whitespace-nowrap text-ink-inverse tabular-nums",
    chipNow: "bg-pen text-ground",
    ro: "grid min-w-0 gap-px",
    roWide: "col-span-2",
    // On a phone, where the stars take two cells, the sea's two follow the
    // models' and the wing, the current, the rain and the launch fill in
    // after, so no cell is left empty between them.
    roLater: "max-wide:order-1",
    roLabel:
      "truncate font-body text-caption font-medium whitespace-nowrap text-ink-muted wide:text-body",
    // Where the wind at Now was measured: quiet, on the label's own line, so
    // the cell is the height it always is.
    roSource: "font-normal",
    // One line of a fixed height, whatever it holds: a figure, a dash, the
    // stars or a notice, so no row grows or shrinks with the hour.
    roValue:
      "block h-5 truncate font-body text-body leading-5 font-semibold whitespace-nowrap text-ink tabular-nums wide:h-6 wide:text-prose wide:leading-6",
    roMarks: "flex h-5 min-w-0 items-center gap-1.5 overflow-hidden wide:h-6",
    // The band names in a column of their own beside the hours, narrower on
    // a phone, so no name ever sits over an hour's figures.
    gbox: "relative grid grid-cols-graph-narrow rounded-surface bg-sunken on-card py-1.5 wide:grid-cols-graph",
    gl: "relative",
    // A band's name, in a strip as tall as its band. On a phone, where the
    // readout stays over the graph, the name keeps clear of the readout's
    // foot (`top`, set to the readout's height) while any of its band is
    // still in view, rather than going under it.
    glBand: "absolute inset-x-0",
    glName: [
      "block h-4 pl-2 font-body text-caption leading-4 font-medium whitespace-nowrap text-ink-muted wide:pl-4",
      "max-wide:sticky",
    ],
    graph:
      "relative overflow-x-auto overscroll-x-contain border-0 border-l border-line",
    // Where the readout's foot meets the graph scrolling under it.
    toolsEdge: "pointer-events-none absolute inset-x-0 top-full h-px bg-line",
    // The week's two sections, Wind and then Waves, each under a heading
    // with the models it reads beside it.
    weekHead:
      "mt-6 mb-1 flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1",
    h3: "m-0 font-body text-lead font-semibold text-ink",
    weekSub: "font-body text-body text-ink-muted",
    // On a phone the one readout's two panes, Wind and Waves, in the same
    // place: the one the page is at shows, the other waits unseen, so the
    // readout is as tall for either and nothing under it moves.
    pane: [
      "col-start-1 row-start-1 transition-opacity duration-fast motion-reduce:transition-none",
    ],
    // The swells and the wind sea: three to a row on a phone, each two
    // cells wide in the desktop's grid.
    parts:
      "col-span-4 grid grid-cols-3 gap-x-3 gap-y-1.5 wide:contents",
    // A blend in the phone's readout: each model's value at the hour, and
    // the blend's apart after a line.
    strip: "flex items-end justify-between gap-1.5",
    bl: "grid min-w-0 shrink gap-0.5",
    blName:
      "flex min-w-0 items-center gap-1 font-body text-caption font-medium whitespace-nowrap text-ink-muted",
    blValue:
      "font-body text-body leading-5 font-semibold whitespace-nowrap text-ink tabular-nums",
    blNone: "font-normal text-ink-muted",
    blSum: "text-prose",
    blBlend: "shrink-0 border-0 border-l border-line pl-2",
    // The card beside the pointer over a section, on a desktop.
    card2: [
      "pointer-events-none absolute z-6 rounded-control bg-ground px-3.5 py-3 shadow-float inset-ring-1 inset-ring-line",
      "font-body text-body text-ink",
    ],
    cardHead:
      "mb-2 flex justify-between gap-2 font-body text-body font-semibold text-ink",
    sky: "pointer-events-none absolute left-0 flex items-center gap-1 font-body text-caption text-ink-2",
    // The key under the graph: its groups in a row, each a small heading
    // over its marks, every mark drawn at one size; two to a row on a phone.
    legend: [
      "grid grid-cols-2 gap-x-6 gap-y-5 px-1 pt-5 font-body text-caption text-ink-2",
      "wide:flex wide:flex-wrap wide:gap-x-14 wide:px-4",
    ],
    kGroup: "grid min-w-0 content-start gap-2",
    kHead: "font-medium text-ink-muted",
    kList: "m-0 grid list-none gap-1.5 p-0",
    kItem: "flex min-w-0 items-start gap-2.5",
    kMark: "mt-0.5 h-3 w-5 shrink-0 overflow-visible",
    kWords: "min-w-0",
    kFigure:
      "ml-auto min-w-6 pl-2 text-right font-semibold text-ink tabular-nums",
    table:
      "w-full border-collapse overflow-hidden rounded-surface bg-sunken on-card font-body text-body",
    th: "px-3 pt-3 pb-2.5 text-left font-medium whitespace-nowrap text-ink-muted",
    td: "border-0 border-t border-line px-3 py-2.5 whitespace-nowrap",
    narrow: "hidden wide:table-cell",
    guide: "grid gap-3 wide:grid-cols-2 cards:grid-cols-4",
    gd: "rounded-surface bg-sunken on-card p-4 wide:px-5",
    gdHead: "m-0 mb-1.5 font-body text-prose font-semibold text-ink",
    gdText: "m-0 font-body text-prose text-ink-2",
    smallPrint: "grid gap-1 pt-8 font-body text-caption text-ink-muted",
  },
});

const STAR =
  "M12 2.6l2.75 5.6 6.15.9-4.45 4.35 1.05 6.1L12 16.65l-5.5 2.9 1.05-6.1L3.1 9.1l6.15-.9z";
const STAR_FILL = [
  "fill-line",
  "fill-stars-1",
  "fill-stars-2",
  "fill-stars-3",
  "fill-stars-4",
  "fill-stars-5",
];

/** The star rating, as stars: filled in the rating's colour, the rest faint. */
export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span
      className="inline-flex items-center gap-px align-middle"
      role="img"
      aria-label={`${n} of 5 stars`}
      data-stars={n}
    >
      {[1, 2, 3, 4, 5].map((k) => (
        <svg
          key={k}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d={STAR} className={k <= n ? STAR_FILL[n] : STAR_FILL[0]} />
        </svg>
      ))}
    </span>
  );
}

/** The rider's wind units, for every figure the report writes. */
const UnitsContext = createContext<Units>("kn");
function useSpeed() {
  const units = useContext(UnitsContext);
  return {
    /** "16", or "F4" in Force. */
    say: (kn: number) => windSay(kn, units),
    /** The gust worth writing beside a wind, or null. */
    gust: (kn: number, gust: number | null) => gustShown(kn, gust, units),
    /** "kn", "mph"…; nothing in Force, whose figures say it. */
    unit: units === "bft" ? "" : unitLabel(units),
  };
}

const isOff = (shore: ShoreAngle | null | undefined) =>
  shore === "offshore" || shore === "cross-off";
const shoreWord = (shore: ShoreAngle | null | undefined) =>
  !shore ? null : shore === "cross" ? "cross-shore" : shore;
/** The shore a measured wind blows at, where the shore and the wind say. */
const measuredShore = (m: MeasuredReading, facing: number | null) =>
  facing === null || m.reading.from === null
    ? null
    : shoreAngle(m.reading.from, facing);

/**
 * A point on the open water, where the report is a point's
 * (spot/web/point.ts): the riding places around it, nearest first, and the
 * one it borrows its waves, weather, sea and tide from, if one is near.
 */
export interface ReportPoint {
  nearby: readonly NearbySpot[];
  lender: RidingSpot | null;
}

export function SpotReport({
  spot,
  forecast,
  rider,
  units,
  nightHours = "show",
  now,
  at = null,
  blendModels = [],
  waveModel = null,
  point = null,
  actions,
  notices,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
  rider: Rider;
  units: Units;
  /**
   * Whether the week shows the hours after dark (Settings): hidden, its
   * graph is each day's hours from first light to last, the days side by
   * side (shared/web/afterDark.ts).
   */
  nightHours?: NightHours;
  now: number;
  /**
   * The hour the week opens at (`?at=`), as if the rider had put the pointer
   * on it; null, or an hour the week does not hold, opens it on now.
   */
  at?: number | null;
  /** The models the rider blends (Settings): the Wind blend band's lines. */
  blendModels?: readonly string[];
  /**
   * The wave model the rider reads the waves from (Settings), handed on past
   * its run; null for the finest model at each hour.
   */
  waveModel?: string | null;
  /** A point on the open water's report: no shore, so no stars. */
  point?: ReportPoint | null;
  actions?: React.ReactNode;
  notices?: React.ReactNode;
}) {
  const s = styles();
  const facing = point ? null : shoreFacing(spot.id);
  // A point has no shore to rate the wind against, so its hours have no
  // stars: rated on the wind alone, they would say a beach's verdict about
  // water nobody launches from.
  const rows = useMemo(
    () =>
      spotRows(forecast.hours, now, facing, rider).map((row) =>
        point ? { ...row, rating: null } : row,
      ),
    [forecast.hours, now, facing, rider, point],
  );
  const days = useMemo(
    () =>
      groupDays(rows)
        .filter((d) => d.hasWind)
        .slice(0, REPORT_DAYS)
        .map((day) => ({
          day,
          sun: daySun(spot.lat, spot.lon, day.date),
          midnight: dublinMidnight(day.date),
        })),
    [rows, spot.lat, spot.lon],
  );
  const cards = useMemo(
    () => days.map(({ day, midnight }) => dayCard(day, now, midnight)),
    [days, now],
  );
  const turns = useMemo(() => tideTurns(forecast), [forecast]);
  const tideAt = useMemo(() => (t: number) => tideHeightAt(turns, t), [turns]);
  const [bed, setBed] = useState<LaunchBed | null>(null);
  useEffect(() => {
    // A point has no launch, so no water at one.
    if (point) return;
    let current = true;
    void launchBed(spot, facing).then((b) => current && setBed(b));
    return () => {
      current = false;
    };
  }, [spot, facing, point]);
  const depthAt = useMemo(
    () => (t: number) => (bed ? launchDepth(bed, tideAt, t) : null),
    [bed, tideAt],
  );
  const picture = useSpotPicture(spot);
  // The nearest weather station or buoy, whose readings stand beside the
  // forecast: its name and distance go wherever they are shown.
  const obs = useWindObs();
  const paired = useMemo(
    () => (obs ? pairStation(spot, obs.stations) : null),
    [obs, spot.lat, spot.lon],
  );
  // The wind now as that station measured it, while fresh: the Wind now
  // card and the readout at Now both say it, so they never disagree.
  const nowMeasured = useMemo(() => measuredNow(paired, now), [paired, now]);
  const [firstNow] = useState(now);
  const nearby = useNearby(forecast.nearby, rider, firstNow);
  // The rows after dark, where the rider has hidden them: from last light
  // to first light at the spot.
  const dark = useMemo(
    () =>
      nightHours === "hide"
        ? afterDark(
            spot,
            rows.map((row) => row.time),
          )
        : null,
    [nightHours, rows, spot.lat, spot.lon],
  );
  // The hour the address opens the week at, while the rows hold it: the
  // row it falls in, focused as a pointer resting on it would focus it. One
  // after dark, hidden, opens on the next first light.
  const [opening] = useState(() => {
    const row = at === null ? null : rowIndexAt(rows, at);
    if (row === null || !dark) return row;
    const lit = dark.findIndex((night, i) => i >= row && !night);
    return lit < 0 ? null : lit;
  });
  const [focus, setFocus] = useState<number | null>(
    opening === null ? null : rows[opening].time,
  );
  const [view, setView] = useState<"graph" | "table">("graph");
  const [dayAt, setDayAt] = useState(() => {
    if (opening === null) return 0;
    const date = dublinDate(rows[opening].time);
    return Math.max(
      0,
      days.findIndex(({ day }) => day.date === date),
    );
  });
  // The current, the place's own (a point's too: the nearest water in the
  // currents' frames), on the rows' hours.
  const currentPlace = useMemo(
    () => ({ id: point ? undefined : spot.id, lat: spot.lat, lon: spot.lon }),
    [point, spot.id, spot.lat, spot.lon],
  );
  const axis = useMemo(
    () => rows.map((row) => new Date(row.time).toISOString()),
    [rows],
  );
  const current = useSpotCurrents(true, currentPlace, axis);
  const rain = useMemo(() => rainPerHour(forecast.hours), [forecast.hours]);
  const models = useMemo(
    () => (point ? [] : modelSeries(rows, blendModels)),
    [rows, blendModels, point],
  );
  const [scrollTo, setScrollTo] = useState<{ day: number; at: number } | null>(
    null,
  );
  // The models' blend, said in the Wind blend band alone: the headline wind
  // and the stars stay the one model's own.
  const blend = useMemo(
    () => windBlend(rows),
    [rows],
  );
  // The waves: one model's own at each hour, the rider's or the finest, with
  // the published wave blend beside them where it has the place (a point's
  // are the riding place's it borrows them from).
  const waveFrom = point ? point.lender : spot;
  const squares = useMemo(
    () => (waveFrom ? [spotSquare(waveFrom.lat, waveFrom.lon)] : null),
    [waveFrom?.lat, waveFrom?.lon],
  );
  const { blend: waveBlend } = useWaveBlend(squares);
  const waves = useMemo(
    () =>
      waveWeek(
        rows,
        waveBlend && waveFrom ? waveBlendHours(waveBlend, waveFrom.id) : null,
        waveLeadOrder(waveModel),
        waveModel === WAVE_BLEND,
      ),
    [rows, waveBlend, waveFrom?.id, waveModel],
  );
  // No Waves section on water the open sea's waves do not reach (a lake, a
  // harbour), as the spot's year has none, or where no wave model reaches.
  const sheltered = useSheltered(point ? null : spot.id);
  const seaShown =
    sheltered === false && waves.rows.some((r) => r !== null) ? waves : null;

  const nowRow = rowAt(rows, now);
  const shown = focus === null ? nowRow : rowAt(rows, focus);
  const scale = useMemo(() => roseScale(units), [units]);
  // At Now the picture's rose says the wind the station measured, as the
  // Wind now card and the readout do; a reading with no direction has no
  // rose to draw, so the forecast's stands then.
  const loupeMeasured =
    shown !== null && shown === nowRow && nowMeasured?.reading.from != null
      ? nowMeasured
      : null;
  const loupe = loupeMeasured
    ? loupeRose(
        rider,
        {
          windKn: loupeMeasured.reading.windKn,
          gustKn: loupeMeasured.reading.gustKn,
          from: loupeMeasured.reading.from,
          daylight: shown!.hour.daylight,
        },
        facing,
        units,
      )
    : shown?.hour.wind
      ? loupeRose(
          rider,
          {
            windKn: shown.hour.wind.wind_kn,
            gustKn: shown.hour.wind.gust_kn,
            from: shown.hour.wind.direction_deg,
            daylight: shown.hour.daylight,
          },
          facing,
          units,
        )
      : null;
  const loupeShore = loupeMeasured
    ? measuredShore(loupeMeasured, facing)
    : shown?.shore;
  const heights = turns.map((t) => t.height);
  const tideNow = tideAt(now);
  const tideNowAt: PictureTide =
    tideNow !== null &&
    heights.length &&
    tideNow > (Math.max(...heights) + Math.min(...heights)) / 2
      ? "high"
      : "low";
  const [tidePicked, setTide] = useState<PictureTide | null>(null);
  const tide = tidePicked ?? tideNowAt;

  return (
    <UnitsContext.Provider value={units}>
      <main className={s.main()}>
        <section className={s.title()}>
          <div className="grid gap-1.5">
            <h1 className={s.name()}>{spot.name}</h1>
            {point && <PointLine point={point} />}
          </div>
          <div className={s.acts()}>{actions}</div>
        </section>
        {nearby.length > 0 && (
          <section className="xwide:hidden" aria-label="Nearby">
            <div className={s.sectionHead({ className: "mb-2.5" })}>
              <span className={s.label()}>Nearby</span>
              <a className={s.link()} href={CHART_HREF}>
                All spots on the chart
              </a>
            </div>
            <div className={s.nearRow()}>
              <NearbyCards
                here={point ? null : spot}
                at={spot}
                readings={nearby}
              />
            </div>
          </section>
        )}

        <section className={s.section({ className: "pt-5" })} aria-label="Now">
          {/* With no picture (a point on the water never has one) the cards
              take the room: one column, the template left out rather than
              overridden, since a later class does not undo an earlier one
              that the stylesheet happens to place after it. */}
          <div
            className={
              !picture
                ? "grid gap-3 rail:gap-4"
                : s.now({
                    className: nearby.length
                      ? undefined
                      : "xwide:grid-cols-now",
                  })
            }
          >
            {/* The warnings and notices above the cards, in their column. */}
            <div className={s.column()}>
              {notices}
              <NowCards
                forecast={forecast}
                sea={forecast.sea_temperature}
                row={nowRow}
                now={now}
                sun={days[0]?.sun ?? null}
                tideNow={tideNow}
                turns={turns}
                depthAt={depthAt}
                hasBed={!!bed}
                rated={!point}
                facing={facing}
                measured={nowMeasured}
              />
            </div>
            {picture && (
              <PhotoLoupe
                picture={picture}
                tide={tide}
                loupe={loupe}
                facing={facing}
                scale={scale}
                className={s.photo()}
              >
                <Segmented
                  aria-label="Tide in the picture"
                  size="sm"
                  className={s.seg()}
                  value={tide}
                  onChange={(t) => setTide(t)}
                  options={[
                    { value: "high", label: "High tide" },
                    { value: "low", label: "Low tide" },
                  ]}
                />
                <span
                  className={s.foot()}
                  data-loupe-foot
                  data-measured={loupeMeasured?.paired.station.id}
                >
                  {loupe ? (
                    <>
                      {loupe.reading.replace(/ g(\d+)$/, "")}
                      {/ g\d+$/.test(loupe.reading) && (
                        <span className={s.footGust()}>
                          g{loupe.reading.match(/ g(\d+)$/)![1]}
                        </span>
                      )}
                      <span>·</span>
                      <span
                        className={loupe.warn ? "text-photo-red" : undefined}
                      >
                        {shoreWord(loupeShore) ?? loupe.relation.toLowerCase()}
                      </span>
                    </>
                  ) : (
                    "No wind reading"
                  )}
                </span>
              </PhotoLoupe>
            )}
            {nearby.length > 0 && (
              <aside className={s.side()} aria-label="Nearby">
                <div className={s.sectionHead({ className: "m-0" })}>
                  <span className={s.label()}>Nearby</span>
                  <a className={s.link()} href={CHART_HREF}>
                    All on the chart
                  </a>
                </div>
                <NearbyCards
                  here={point ? null : spot}
                  at={spot}
                  readings={nearby.slice(0, 6)}
                  column
                />
              </aside>
            )}
          </div>
        </section>

        <section className={s.section()} aria-labelledby="the-week">
          <div className={s.sectionHead()}>
            <h2 className={s.h2()} id="the-week">
              The days ahead
            </h2>
            <Segmented
              aria-label="View"
              size="sm"
              value={view}
              onChange={(v) => setView(v)}
              options={[
                { value: "graph", label: "Graph" },
                { value: "table", label: "Table" },
              ]}
            />
          </div>
          <div className={s.week()} role="group" aria-label="Days">
            {cards.map((card, i) => (
              <DayButton
                key={card.date}
                card={card}
                rated={!point}
                on={i === dayAt}
                onClick={() => {
                  setDayAt(i);
                  setScrollTo({ day: i, at: Date.now() });
                }}
              />
            ))}
          </div>
          {view === "graph" ? (
            <Graph
              rows={rows}
              days={days}
              now={now}
              turns={turns}
              bed={bed}
              depthAt={depthAt}
              onFocus={setFocus}
              scrollTo={scrollTo}
              opening={opening}
              dark={dark}
              rider={rider}
              rated={!point}
              models={models}
              blend={blend}
              waves={seaShown}
              waveModel={waveModel}
              current={current}
              rain={rain}
              measured={paired}
              nowMeasured={nowMeasured}
            />
          ) : (
            <HourTable
              forecast={forecast}
              rows={days[dayAt]?.day.rows ?? []}
              date={days[dayAt]?.day.date ?? ""}
              now={now}
              depthAt={depthAt}
              rider={rider}
              rated={!point}
              rain={rain}
            />
          )}
        </section>

        {point ? (
          <PointGuide point={point} />
        ) : (
          <section className={s.section()} aria-labelledby="the-spot">
            <div className={s.sectionHead()}>
              <h2 className={s.h2()} id="the-spot">
                The spot
              </h2>
            </div>
            <div className={s.guide()}>
              <div className={s.gd()}>
                <h3 className={s.gdHead()}>Water</h3>
                <p className={s.gdText()}>
                  {bed && Number.isFinite(bed.z)
                    ? `1 m deep at the launch above ${(bed.z + 1).toFixed(1)} m of tide.`
                    : bed
                      ? "Deep water at the launch at every tide."
                      : "No survey of the seabed reaches this launch yet."}
                </p>
              </div>
              {forecast.shore_note && (
                <div className={s.gd()}>
                  <h3 className={s.gdHead()}>The shore</h3>
                  <p className={s.gdText()}>{forecast.shore_note}</p>
                </div>
              )}
            </div>
          </section>
        )}
        {!point && <ClimateSections spotId={spot.id} units={units} />}
        <div className={s.smallPrint()}>
          <p className="m-0">
            Model forecasts, not a safety statement. Look at the water before
            you go out. Times are Irish.
          </p>
          <p className="m-0" data-warnings-source>
            Weather warnings: Met Éireann,{" "}
            <a
              className={s.link({ className: "text-caption" })}
              href={MET_WARNINGS_PAGE}
            >
              met.ie/warnings
            </a>
            .{" "}
            <span data-water-quality-source>
              Bathing water notices: the EPA,{" "}
              <a
                className={s.link({ className: "text-caption" })}
                href={BEACHES_PAGE}
              >
                beaches.ie
              </a>
              .
              {forecast.water_quality.status === "not-monitored" &&
                " No bathing water is monitored near here."}
            </span>
            {picture && ` ${pictureCredit(picture.attribution)}`}
          </p>
        </div>
      </main>
    </UnitsContext.Provider>
  );
}

const km = (distance: number) =>
  distance < 10 ? distance.toFixed(1) : String(Math.round(distance));

/**
 * Under a point's name: that it is open water, and the riding place nearest
 * it, however far, with the way to its page, where the stars are.
 */
function PointLine({ point }: { point: ReportPoint }) {
  const s = styles();
  const nearest = point.nearby[0];
  return (
    <p className={s.line({ className: "m-0" })} data-point-line>
      Open water
      {nearest && (
        <>
          {" · "}nearest riding spot{" "}
          <a
            className={s.link({ className: "text-prose" })}
            href={spotHref(nearest.id)}
            data-nearest-spot={nearest.id}
          >
            {nearest.name}
          </a>
          , {km(nearest.distance_km)} km
        </>
      )}
    </p>
  );
}

/**
 * A point's notes, in place of a spot's: why it has no stars, and whose
 * waves, weather and tide it reads, the wind being its own.
 */
function PointGuide({ point }: { point: ReportPoint }) {
  const s = styles();
  const nearest = point.nearby[0];
  const lent = point.lender
    ? point.nearby.find((n) => n.id === point.lender!.id)
    : undefined;
  return (
    <section className={s.section()} aria-labelledby="the-point">
      <div className={s.sectionHead()}>
        <h2 className={s.h2()} id="the-point">
          This point
        </h2>
      </div>
      <div className={s.guide()}>
        <div className={s.gd()} data-point-no-stars>
          <h3 className={s.gdHead()}>No stars</h3>
          <p className={s.gdText()}>
            Stars rate the wind against a shore you launch from, and open water
            has none. Read the wind, the gusts and the sea for yourself
            {nearest ? (
              <>
                , or see the stars at{" "}
                <a className={s.link()} href={spotHref(nearest.id)}>
                  {nearest.name}
                </a>
                .
              </>
            ) : (
              "."
            )}
          </p>
        </div>
        <div className={s.gd()}>
          <h3 className={s.gdHead()}>Where the figures come from</h3>
          <p className={s.gdText()}>
            {point.lender
              ? `The wind is this point's own. The waves, the weather and the tide are ${point.lender.name}'s${lent ? `, ${km(lent.distance_km)} km away` : ""}.`
              : `The wind and the current are this point's own. No riding place is within ${POINT_SOURCE_KM} km to lend it waves, weather or a tide.`}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The spots around, the one you are on first as "Here". A point on the water
 * is no spot, so it has no card of its own (`here` null): its row is the
 * riding places around it, nearest first. `at` is where the page stands.
 */
function NearbyCards({
  here,
  at,
  readings,
  column = false,
}: {
  here: RidingSpot | null;
  at: { lat: number; lon: number };
  readings: NearbyReading[];
  column?: boolean;
}) {
  const speed = useSpeed();
  const s = styles();
  const cards = here
    ? [
        {
          id: here.id,
          name: here.name,
          distanceKm: 0,
          windKn: null,
          best: null,
        } as NearbyReading,
        ...readings,
      ]
    : readings;
  return (
    <>
      {cards.map((r, i) => (
        <a
          key={r.id}
          className={s.near({
            className: [
              here && i === 0 && s.nearHere(),
              column && "grid-cols-near",
            ]
              .filter(Boolean)
              .join(" "),
          })}
          href={spotHref(r.id)}
          aria-current={here && i === 0 ? "page" : undefined}
          data-nearby={r.id}
        >
          <NearThumb id={r.id} lat={at.lat} lon={at.lon} />
          <span className={s.nearName()}>{r.name}</span>
          <span className={s.nearLine()}>
            {here && i === 0
              ? "Here"
              : r.windKn === null
                ? `${r.distanceKm} km`
                : `${speed.say(r.windKn)} ${speed.unit}`.trim()}
            {r.best !== null && <Stars n={r.best} size={11} />}
          </span>
        </a>
      ))}
    </>
  );
}

/** A nearby spot's picture, small: the picture set's, at the spot's id. */
function NearThumb({ id, lat, lon }: { id: string; lat: number; lon: number }) {
  const picture = useSpotPicture(
    useMemo(() => ({ id, lat, lon }), [id, lat, lon]),
  );
  const s = styles();
  if (!picture) return <span className={s.nearImg({ className: "bg-line" })} />;
  return (
    <img
      className={s.nearImg({ className: lift(picture) })}
      src={picture.urls.high}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

function NowCards({
  forecast,
  sea,
  row,
  now,
  sun,
  tideNow,
  turns,
  depthAt,
  hasBed,
  rated,
  facing,
  measured,
}: {
  forecast: SpotForecast;
  sea: SpotSea | null;
  row: SpotRow | null;
  now: number;
  sun: DaySun | null;
  tideNow: number | null;
  turns: ReturnType<typeof tideTurns>;
  depthAt: (t: number) => number | null;
  hasBed: boolean;
  /** False at a point on the open water, which has no shore and no stars. */
  rated: boolean;
  /** The way the shore faces, or null where it has none. */
  facing: number | null;
  /**
   * The paired station's latest reading, fresh (`measuredNow`), or null: the
   * card says it, and where it is from, in place of the forecast's, as the
   * readout at Now does.
   */
  measured: MeasuredReading | null;
}) {
  const speed = useSpeed();
  const s = styles();
  // The wind now: the station's, while it has one fresh, else the forecast's.
  const wind = measured
    ? {
        kn: measured.reading.windKn,
        gust: measured.reading.gustKn,
        from: measured.reading.from,
      }
    : row?.hour.wind
      ? {
          kn: row.hour.wind.wind_kn,
          gust: row.hour.wind.gust_kn,
          from: row.hour.wind.direction_deg as number | null,
        }
      : null;
  const shore = measured ? measuredShore(measured, facing) : row?.shore;
  const waves = row?.hour.waves ?? null;
  const depth = depthAt(now);
  const until = deepUntil(depthAt, now);
  const left = sun ? lightLeft(now, sun) : null;
  const nextTurn = turns.find((t) => t.time > now);
  const taken = row && !row.rating ? standIn(row) : null;
  const watered = (row?.water?.ids ?? [])
    .map((id) => forecast.water_quality.items.find((item) => item.id === id))
    .find((item) => item?.replaces_ratings);
  return (
    <div className={s.cards()} data-now>
      <div className={s.card({ className: s.wide() })}>
        <span className={s.label()} data-now-wind-label>
          Wind now
          {measured && (
            <span className={s.roSource()} data-now-source>
              {" "}
              · {pairedName(measured.paired)},{" "}
              {measuredAt(measured.reading.time)}
            </span>
          )}
        </span>
        {wind ? (
          <>
            <div
              className={s.big()}
              data-now-wind
              data-measured={measured ? measured.paired.station.id : undefined}
            >
              {speed.say(wind.kn)}
              {speed.gust(wind.kn, wind.gust) !== null && (
                <span className={s.gust()}>
                  g{speed.say(speed.gust(wind.kn, wind.gust)!)}
                </span>
              )}
              {speed.unit && <span className={s.unit()}>{speed.unit}</span>}
            </div>
            <div
              className={s.line({
                className: isOff(shore) ? s.off() : undefined,
              })}
              data-now-direction
            >
              {wind.from !== null && compass(wind.from)}
              {wind.from !== null && shoreWord(shore) && " · "}
              {shoreWord(shore)}
            </div>
          </>
        ) : (
          <div className={s.line({ className: "mt-2" })}>
            No model reaches this spot just now.
          </div>
        )}
      </div>
      {!rated ? (
        <div className={s.card()} data-your-stars="none">
          <span className={s.label()}>Your stars</span>
          <div className={s.line({ className: "my-3.5 min-h-7" })}>
            No stars on open water
          </div>
          <div className={s.line()}>Stars rate the wind at a shore</div>
        </div>
      ) : (
        <div className={s.card()} data-your-stars>
          <span className={s.label()}>Your stars</span>
          <div className="my-3.5 flex min-h-7 items-center">
            {row?.rating ? (
              <Stars n={row.rating.stars} size={22} />
            ) : taken ? (
              <NoticeMark level={taken.level} size="md">
                {taken.level === "water" && watered
                  ? restrictionShort(watered)
                  : taken.word}
              </NoticeMark>
            ) : (
              <span className={s.line()}>No stars now</span>
            )}
          </div>
          <div className={s.line()}>
            {row?.rating
              ? `${row.rating.wing.own ?? row.rating.wing.recommended} m² wing`
              : taken
                ? "No stars while it lasts"
                : row?.hour.daylight
                  ? "Too little wind"
                  : "Dark"}
          </div>
        </div>
      )}
      {hasBed && depth !== null ? (
        <div className={s.card()}>
          <span className={s.label()}>Water at the launch</span>
          <div className={s.big()}>
            {depth.toFixed(1)}
            <span className={s.unit()}>m</span>
          </div>
          <div className={s.bar()}>
            <span
              className={s.barFill()}
              style={{ width: `${Math.min(100, (depth / 3) * 100)}%` }}
            />
          </div>
          <div className={s.line()}>
            {depth < 1
              ? "Under 1 m now"
              : until
                ? `Deep enough until ${clock(until)}`
                : "Deep enough"}
          </div>
        </div>
      ) : (
        <div className={s.card()}>
          <span className={s.label()}>Tide</span>
          <div className={s.big()}>
            {tideNow === null ? "–" : tideNow.toFixed(1)}
            <span className={s.unit()}>m</span>
          </div>
          <div className={s.line()}>
            {nextTurn
              ? `${nextTurn.tide === "high" ? "High" : "Low"} at ${clock(nextTurn.time)}`
              : "No tide station near"}
          </div>
        </div>
      )}
      <div className={s.card()}>
        <span className={s.label()}>Sea</span>
        <div className={s.big()}>
          {waves?.height_m == null ? "–" : waves.height_m.toFixed(1)}
          <span className={s.unit()}>m</span>
        </div>
        <div className={s.line()}>
          {waves?.period_s
            ? `${waves.period_s} s`
            : waves
              ? ""
              : "No wave model here"}
          {sea && (
            <span
              data-sea-temperature
              title={`Measured ${observationAge((now - Date.parse(sea.time)) / 3600000)} at the ${sea.station} ${NETWORK_LABEL[sea.network as SeaTemperatureNetwork] ?? "station"}, ${sea.distance_km < 10 ? sea.distance_km.toFixed(1) : Math.round(sea.distance_km)} km from here`}
            >
              {waves?.period_s ? " · " : ""}water {sea.celsius.toFixed(1)} °C
            </span>
          )}
        </div>
      </div>
      <div className={s.card()}>
        <span className={s.label()}>Light left</span>
        {left !== null ? (
          <>
            <div className={s.big()}>
              {hoursMinutes(left).h}
              <span className={s.unit()}>h</span>
              {String(hoursMinutes(left).m).padStart(2, "0")}
              <span className={s.unit()}>min</span>
            </div>
            <div className={s.line()}>
              {sun?.sunset ? `Sunset ${clock(sun.sunset)}` : ""}
            </div>
          </>
        ) : (
          <>
            <div className={s.big()}>Dark</div>
            <div className={s.line()}>
              {sun?.firstLight && now < sun.firstLight
                ? `First light ${clock(sun.firstLight)}`
                : "Until morning"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DayButton({
  card,
  rated,
  on,
  onClick,
}: {
  card: DayCard;
  /** False at a point on the open water: the day has no stars to show. */
  rated: boolean;
  on: boolean;
  onClick: () => void;
}) {
  const speed = useSpeed();
  const s = styles();
  const gid = `spark-${card.date}`;
  const pts = card.spark
    .filter((p) => p.hour >= 5 && p.hour <= 20)
    .map(
      (p) =>
        [
          ((p.hour - 5) / 15) * 100,
          26 - (Math.min(p.kn, 32) / 32) * 22,
        ] as const,
    );
  return (
    <button
      type="button"
      className={s.day({ className: on ? s.dayOn() : undefined })}
      aria-pressed={on}
      onClick={onClick}
      data-day-card={card.date}
    >
      <span className={s.dayName()}>
        {card.label}
        <span className={s.dayDate()}>{card.day}</span>
      </span>
      {card.notice && !card.best ? (
        <NoticeMark level={card.notice.level}>{card.notice.word}</NoticeMark>
      ) : !rated ? null : (
        <span className="inline-flex items-center gap-1.5">
          <Stars n={card.best} />
          {card.notice && (
            <>
              <NoticeMark level={card.notice.level} />
              <span className="sr-only">
                {card.notice.word}, no stars for some hours
              </span>
            </>
          )}
        </span>
      )}
      <span className={s.range()}>
        {card.lo === null || card.hi === null
          ? "–"
          : `${speed.say(card.lo)}–${speed.say(card.hi)}`}{" "}
        <span className={s.small()}>{speed.unit}</span>
      </span>
      <svg
        className={s.spark()}
        viewBox="0 0 100 26"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gid}>
            {card.spark
              .filter((p) => p.hour >= 5 && p.hour <= 20)
              .map((p, i) => (
                <stop
                  key={i}
                  offset={`${((p.hour - 5) / 15) * 100}%`}
                  stopColor={windCss(p.kn)}
                />
              ))}
          </linearGradient>
        </defs>
        {pts.length > 1 && (
          <path
            d={`${smoothPath(pts)}L100,26L0,26Z`}
            fill={`url(#${gid})`}
            fillOpacity={0.85}
          />
        )}
      </svg>
      <span className={s.dayFoot()}>
        {card.offshore ? (
          <span className="font-medium text-pen">Offshore</span>
        ) : (
          <span />
        )}
        <span>
          {card.sure === "high"
            ? "Sure"
            : card.sure === "moderate"
              ? "Fairly sure"
              : card.sure === "low"
                ? "Unsure"
                : ""}
        </span>
      </span>
    </button>
  );
}

/**
 * The week graph is two sections on the same hours, Wind and then Waves, each
 * a stack of bands: its name, its height and the gap under it. The wind's
 * blend sits under its direction; a point on the water reads one model at a
 * time, so it has no blend. The stars' strip keeps its place without stars,
 * so the wind band starts where it always does.
 */
const WIND_BANDS = [
  ["stars", 8, 12],
  ["wind", 118, 8],
  ["dir", 40, 12],
  ["blend", 64, 14],
  ["gusts", 20, 12],
  ["sky", 28, 12],
  ["rain", 34, 14],
  ["tide", 74, 12],
  ["current", 38, 14],
] as const;
type WindBand = (typeof WIND_BANDS)[number][0];
const WIND_NAME: Record<WindBand, string> = {
  stars: "Stars",
  wind: "Wind",
  dir: "Direction",
  blend: "Wind blend",
  gusts: "Gusts",
  sky: "Sky",
  rain: "Rain",
  tide: "Tide",
  current: "Current",
};

/**
 * The waves' bands: the blended height with the models' spread, where the
 * sea comes from with its height, its peak period, every wave model's own
 * line and the blend's, and then the swells and the wind sea, each a band
 * only where the lead model has it somewhere in the week.
 */
const WAVE_BANDS = [
  ["waves", 92, 12],
  ["wdir", 40, 4],
  ["period", 18, 14],
  ["wblend", 84, 14],
  ["swell1", 38, 12],
  ["swell2", 38, 12],
  ["swell3", 38, 12],
  ["windsea", 38, 14],
] as const;
type WaveBand = (typeof WAVE_BANDS)[number][0];
const WAVE_NAME: Record<WaveBand, string> = {
  waves: "Waves",
  wdir: "Direction",
  period: "Period",
  wblend: "Wave blend",
  ...(Object.fromEntries(PART_ROWS) as Record<PartRow, string>),
};

interface Stack<K extends string> {
  at: Partial<Record<K, readonly [number, number]>>;
  /** Where the hours run along the foot. */
  axis: number;
  height: number;
}

/** Where each band of a section sits, the hours' axis under the last, and the height. */
function stack<K extends string>(
  bands: readonly (readonly [K, number, number])[],
  top: number,
  keep: (band: K) => boolean,
): Stack<K> {
  const at: Partial<Record<K, readonly [number, number]>> = {};
  let y = top;
  let gap = 0;
  for (const [band, h, g] of bands) {
    if (!keep(band)) continue;
    at[band] = [y, h];
    y += h + g;
    gap = g;
  }
  const axis = y - gap + 8;
  return { at, axis, height: axis + 22 };
}

/** An arrow pointing up, turned to a bearing: the wind's, the sea's, the water's. */
const ARROW = "M0 6V-6M-3.5 -2.5L0 -6.5l3.5 4";

/**
 * The models whose lines are dashed as well as coloured: the global ones.
 * Several lines in one band all cross, and two hues side by side (ECMWF's
 * purple, ICON-EU's blue) are too close for a colour-blind rider, so the
 * coarse global models are dashed and the fine regional ones solid; every
 * value is named in the readout and the card besides.
 */
const DASHED = new Set([
  "ecmwf",
  "gfs",
  "aifs",
  "ecmwf-ens",
  "gefs",
  "icon",
  "arpege",
  "gfs-wave",
  "ecmwf-wave",
]);
const DASH = "5 3";

/**
 * Each wave model's own colour in the wave blend (ui/theme.css): five hues
 * told apart side by side on both themes, the global two also dashed. A
 * model with no colour of its own yet is drawn in the second ink.
 */
const WAVE_HUE: Record<string, { stroke: string; fill: string }> = {
  "met-office-wave": {
    stroke: "stroke-wave-met-office",
    fill: "fill-wave-met-office",
  },
  "ibi-wave": { stroke: "stroke-wave-ibi", fill: "fill-wave-ibi" },
  "mi-swan": { stroke: "stroke-wave-swan", fill: "fill-wave-swan" },
  "gfs-wave": { stroke: "stroke-wave-gfs", fill: "fill-wave-gfs" },
  "ecmwf-wave": { stroke: "stroke-wave-ecmwf", fill: "fill-wave-ecmwf" },
};
const waveHue = (id: string) =>
  WAVE_HUE[id] ?? { stroke: "stroke-ink-2", fill: "fill-ink-2" };

/** A model's name where the readout has a quarter of a phone's width for it. */
const SHORT: Record<string, string> = {
  harmonie: "HARM",
  "icon-eu": "ICON",
  "met-office-wave": "Met Off",
  "ibi-wave": "IBI",
  "mi-swan": "SWAN",
  "gfs-wave": "GFS",
  "ecmwf-wave": "ECMWF",
};
const shortName = (id: string) => SHORT[id] ?? modelName(id);
/** A wave model's name, as Settings and the layers list give it. */
const waveModelName = (id: string) =>
  id === WAVE_BLEND
    ? "Blend"
    : (modelEntry(id)?.name ?? (id === "ibi-wave" ? "Copernicus IBI" : id));
/** Where a wave model's run is said to end, on its line: "Met Office ends". */
const waveEndName = (id: string) => waveModelName(id).replace(/ Wave$/, "");

/** Whether the page is laid out for a desktop (the theme's `wide`), kept current. */
function useWide() {
  const query = "(min-width: 45rem)";
  const [wide, setWide] = useState(() =>
    typeof matchMedia === "undefined" ? true : matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const list = matchMedia(query);
    const changed = () => setWide(list.matches);
    changed();
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, []);
  return wide;
}

type Section = "wind" | "waves";

function Graph({
  rows,
  days,
  now,
  turns,
  bed,
  depthAt,
  onFocus,
  scrollTo,
  opening,
  dark,
  rider,
  rated,
  models,
  blend,
  waves,
  waveModel,
  current,
  rain,
  measured = null,
  nowMeasured = null,
}: {
  rows: SpotRow[];
  days: { day: { date: string }; sun: DaySun; midnight: number }[];
  now: number;
  turns: ReturnType<typeof tideTurns>;
  bed: LaunchBed | null;
  depthAt: (t: number) => number | null;
  onFocus: (t: number | null) => void;
  scrollTo: { day: number; at: number } | null;
  /** The row the address opens on (`?at=`), held as a pointer would hold it. */
  opening: number | null;
  /**
   * Which rows are after dark, where the rider hides them (Settings); null
   * where the night is shown, shaded.
   */
  dark: readonly boolean[] | null;
  rider: Rider;
  /** False at a point on the open water: no stars, so no star row or tint. */
  rated: boolean;
  /** The models the rider blends, each its own wind (`modelSeries`). */
  models: readonly ModelSeries[];
  /** Their blend at each row's time (`windBlend`). */
  blend: ReadonlyMap<number, WindBlendAt>;
  /**
   * The week's sea (`waveWeek`), or null where the Waves section is not
   * shown: sheltered water, which the open sea's waves do not reach, or no
   * wave model at all.
   */
  waves: WaveWeek | null;
  /** The rider's wave model, or null for the finest at each hour. */
  waveModel: string | null;
  current: SpotCurrents;
  /** The rain in each hour, mm/h, by the hour's time (`rainPerHour`). */
  rain: ReadonlyMap<number, number>;
  /**
   * The weather station or buoy paired with the place (force5/src/windObs.ts
   * `pairStation`), or null: its readings up to now are drawn on the wind,
   * and its latest is the readout's at Now.
   */
  measured?: Paired | null;
  /** Its latest reading, while fresh (`measuredNow`): the readout's at Now. */
  nowMeasured?: MeasuredReading | null;
}) {
  const speed = useSpeed();
  const units = useContext(UnitsContext);
  const s = styles();
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const waveRef = useRef<HTMLDivElement>(null);
  const windSvg = useRef<SVGSVGElement>(null);
  const waveSvg = useRef<SVGSVGElement>(null);
  const wide = useWide();
  const [hover, setHover] = useState<number | null>(opening);
  // An hour clicked on, or stepped to with the arrow keys, is held: the
  // pointer moving off the graph goes back to it rather than to now.
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(
    () => onFocus(hover === null ? null : (rows[hover]?.time ?? null)),
    [hover, rows, onFocus],
  );
  // On a phone one readout is held over the top of the graphs as the page
  // scrolls (`tools`). The band names are held clear of its foot, `held`
  // being its height, and once the graph runs under it a line marks where.
  const tools = useRef<HTMLDivElement>(null);
  const gbox = useRef<HTMLDivElement>(null);
  const waveBox = useRef<HTMLDivElement>(null);
  const windSection = useRef<HTMLElement>(null);
  const waveSection = useRef<HTMLElement>(null);
  const [held, setHeld] = useState(0);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = tools.current;
    const box = gbox.current;
    if (!el || !box) return;
    let sticky = false;
    const scrolled = () =>
      setStuck(
        sticky &&
          box.getBoundingClientRect().top <
            el.getBoundingClientRect().bottom - 0.5,
      );
    const measured = () => {
      sticky = getComputedStyle(el).position === "sticky";
      setHeld(sticky ? el.offsetHeight : 0);
      scrolled();
    };
    measured();
    const watch =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measured);
    watch?.observe(el);
    window.addEventListener("scroll", scrolled, { passive: true });
    window.addEventListener("resize", measured);
    return () => {
      watch?.disconnect();
      window.removeEventListener("scroll", scrolled);
      window.removeEventListener("resize", measured);
    };
  }, [wide]);
  // On a phone the one readout says the wind while the Wind section is on
  // screen, and turns to the waves once the Waves section comes up past the
  // middle of what the readout leaves of the screen.
  const [section, setSection] = useState<Section>("wind");
  useEffect(() => {
    if (wide || !waves) {
      setSection("wind");
      return;
    }
    const check = () => {
      const top = tools.current?.getBoundingClientRect().bottom ?? 0;
      const head = waveSection.current?.getBoundingClientRect().top;
      if (head === undefined) return;
      setSection(head < top + (innerHeight - top) * 0.45 ? "waves" : "wind");
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [wide, !!waves]);
  /** The phone's Wind | Waves: to that section, under the readout. */
  const jump = (to: Section) => {
    const target = (to === "waves" ? waveSection : windSection).current;
    if (!target) return;
    setSection(to);
    window.scrollTo({
      top:
        target.getBoundingClientRect().top +
        scrollY -
        (tools.current?.offsetHeight ?? 0) -
        4,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  const lower = stack(WIND_BANDS, 14, (band) =>
    band === "blend" ? models.length > 0 : true,
  );
  const GH = lower.height;
  const ROW = lower.at as Record<WindBand, readonly [number, number]>;
  const start = days[0]?.midnight ?? now;
  const end = (days.at(-1)?.midnight ?? now) + 24 * HOUR;
  // The graph's timeline: the days end to end, or with the night hidden
  // each day's lit hours alone, the days joined side by side
  // (shared/web/afterDark.ts). Every x along the graph is a place on it.
  const line = useMemo<Fold>(
    () =>
      dark
        ? fold(
            keptSpans(rows, dark)
              .map((span) => ({
                from: Math.max(start, span.from),
                to: Math.min(end, span.to),
              }))
              .filter((span) => span.to > span.from),
          )
        : unfolded(start, end),
    [dark, rows, start, end],
  );
  /** Whether a row is drawn: all of them, or those before dark alone. */
  const seen = (r: Pick<SpotRow, "time">) => !dark || line.kept(r.time);
  /** Where a line through the hours breaks: across a night left out. */
  const apart = useMemo(() => {
    if (!dark) return () => false;
    const spanOf = (t: number) =>
      line.spans.findIndex((span) => t >= span.from && t < span.to);
    return (a: number, b: number) => spanOf(a) !== spanOf(b);
  }, [dark, line]);
  const hours = line.length / HOUR;
  /** Hours between the figures along the foot. */
  const tick = dark ? 3 : 6;
  const daysShown =
    width < 600 ? 0 : Math.max(3, Math.min(7, Math.floor(width / 330)));
  // A day's width on a desktop is a day's hours, the lit ones alone where
  // the night is hidden.
  const dayHours = dark ? hours / Math.max(1, line.spans.length) : 24;
  const px = width < 600 ? 18 : width / (daysShown * dayHours);
  const W = Math.max(width, hours * px);
  const X = (t: number) => (line.at(t) / HOUR) * px;
  /**
   * Whether a day has any of the graph: with the night left out, a day whose
   * light is all gone (tonight, the page opened after dark) has none, and
   * no name or line of its own.
   */
  const drawn = (midnight: number) =>
    !dark || X(midnight + 24 * HOUR) - X(midnight) >= 1;
  // The two sections' hours scroll as one, so an hour reads straight down
  // both. The one the rider moves (`driver`) leads; the other follows it,
  // and never the other way, so a finger's fling is not fought.
  const driver = useRef<HTMLDivElement | null>(null);
  const drove = useRef(-Infinity);
  const scrollers = () =>
    [ref.current, waveRef.current].filter(
      (el): el is HTMLDivElement => el !== null,
    );
  const drive = (e: { currentTarget: HTMLDivElement }) => {
    driver.current = e.currentTarget;
  };
  useEffect(() => {
    if (!scrollTo || !ref.current) return;
    driver.current = ref.current;
    ref.current.scrollTo({
      left: X(days[scrollTo.day]?.midnight ?? start),
      behavior: "smooth",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo]);
  // On a phone the hours are scrolled, not pointed at: a playhead stands in
  // the graph and the hour under it is the one read out. It rides in from
  // the left edge over the first half screen of scrolling, holds in the
  // middle, and rides out to the right edge over the last, so every hour
  // can be put under it.
  const phone = width < 600;
  const reach = W - width;
  const headAt = (left: number) =>
    reach < width
      ? (left / Math.max(1, reach)) * W
      : left < width / 2
        ? 2 * left
        : left > reach - width / 2
          ? 2 * left - reach + width
          : left + width / 2;
  const leftFor = (x: number) =>
    reach < width
      ? (x / W) * reach
      : x < width
        ? x / 2
        : x > reach
          ? (x + reach - width) / 2
          : x - width / 2;
  const rowAtX = (x: number) => {
    const t = line.time((x / px) * HOUR);
    let at = rows.findIndex(seen);
    rows.forEach((r, i) => {
      if (r.time <= t && seen(r)) at = i;
    });
    return Math.max(0, at);
  };
  const mid = (r: Pick<SpotRow, "time" | "step">) =>
    X(r.time) + (r.step * px) / 2;
  useEffect(() => {
    const opened = opening === null ? null : rows[opening];
    const left = phone
      ? // The hour the address opens on, else now, under the playhead.
        Math.max(0, leftFor(opened ? mid(opened) : X(now)))
      : // The hour the address opens on, a third of the way in, as the
        // hours before it are worth a glance; else now, six hours in.
        Math.max(0, opened ? X(opened.time) - width / 3 : X(now) - px * 6);
    for (const el of scrollers()) el.scrollLeft = left;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, !!waves]);
  // With a mouse the hour read out is the one under the pointer, and stays
  // so as a wheel or a trackpad scrolls the hours along under it. Over a
  // section, a card beside the pointer lists that section's models.
  const pointer = useRef<{
    section: Section;
    x: number;
    y: number;
  } | null>(null);
  const [card, setCard] = useState<{
    section: Section;
    left: number;
    top: number;
  } | null>(null);
  /** Where a section's card goes: beside the hour's column, by the pointer. */
  const place = (at: Section, row: number, y: number) => {
    const box = (at === "wind" ? gbox : waveBox).current;
    const svg = (at === "wind" ? windSvg : waveSvg).current;
    const r = rows[row];
    if (!box || !svg || !r) return null;
    const b = box.getBoundingClientRect();
    const v = svg.getBoundingClientRect();
    const right = v.left + X(r.time) + r.step * px - b.left;
    const left = right + 14 + CARD_WIDTH <= b.width - 8
      ? right + 14
      : Math.max(8, v.left + X(r.time) - b.left - 14 - CARD_WIDTH);
    const tall =
      CARD_ROW * ((at === "wind" ? models.length : (waves?.lines.length ?? 0)) + 3) + 40;
    return {
      section: at,
      left,
      top: Math.max(8, Math.min(y - b.top - 40, b.height - tall - 8)),
    };
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // A section scrolled a moment after the other last moved is following
    // it; one scrolled after a pause is being moved itself, and leads.
    const at = performance.now();
    if (el !== driver.current && at - drove.current > 150)
      driver.current = el;
    if (el === driver.current) {
      drove.current = at;
      for (const other of scrollers())
        if (other !== el && other.scrollLeft !== el.scrollLeft)
          other.scrollLeft = el.scrollLeft;
    }
    if (phone) setHover(rowAtX(headAt(el.scrollLeft)));
    else if (pointer.current) {
      const row = rowAtX(
        pointer.current.x -
          el.getBoundingClientRect().left -
          el.clientLeft +
          el.scrollLeft,
      );
      setHover(row);
      if (wide)
        setCard(place(pointer.current.section, row, pointer.current.y));
    }
  };
  const windRows = rows.filter((r) => r.hour.wind && seen(r));
  const [wy, wh] = ROW.wind;
  const Y = (k: number) => wy + wh - (Math.min(k, 36) / 36) * wh;
  /** Hours in runs, each broken where a night is left out between two. */
  const runs = <T extends { time: number }>(items: readonly T[]): T[][] => {
    const out: T[][] = [];
    items.forEach((item, i) => {
      if (!i || apart(items[i - 1].time, item.time)) out.push([]);
      out.at(-1)!.push(item);
    });
    return out.filter((run) => run.length > 1);
  };
  /** A line through each run, and the area under each down to `base`. */
  const traced = <T extends { time: number }>(
    items: readonly T[],
    at: (item: T) => readonly [number, number],
    base: number,
  ) => {
    const lines = runs(items).map((run) => run.map(at));
    return {
      line: lines.map(smoothPath).join(""),
      area: lines
        .map(
          (pts) =>
            `${smoothPath(pts)}L${pts.at(-1)![0]},${base}L${pts[0][0]},${base}Z`,
        )
        .join(""),
    };
  };
  /** The band between a low and a high through each run. */
  const between = <T extends { time: number }>(
    items: readonly T[],
    low: (item: T) => readonly [number, number],
    high: (item: T) => readonly [number, number],
  ) =>
    runs(items)
      .map((run) => {
        const top = run.map(high);
        const bot = run.map(low).reverse();
        return `${smoothPath(top)}L${smoothPath(bot).slice(1)}Z`;
      })
      .join("");
  const mean = traced(
    windRows,
    (r) => [mid(r), Y(r.hour.wind!.wind_kn)],
    wy + wh,
  );
  const spread = between(
    windRows,
    (r) => [mid(r), Y(r.hour.wind!.min_kn)],
    (r) => [mid(r), Y(r.hour.wind!.max_kn)],
  );
  const gust = traced(
    windRows.filter((r) => r.hour.wind!.gust_kn !== null),
    (r) => [mid(r), Y(r.hour.wind!.gust_kn!)],
    wy + wh,
  ).line;
  // The wind measured at the paired station, hour by hour up to now, where
  // the graph's hours are: each reading is the mean of the hour that ends
  // at its time, so it is drawn at that hour's middle, never past now. A
  // line through each run of hours, broken where one is missing.
  const readings = measured
    ? measured.station.readings.filter(
        (r) => r.time > start && r.time <= now && seen(r),
      )
    : [];
  const rx = (r: WindReading) => X(r.time - HOUR / 2);
  const measuredLine = readings
    .reduce<WindReading[][]>((out, r, i) => {
      const prev = readings[i - 1];
      if (!prev || r.time - prev.time > HOUR || apart(prev.time, r.time))
        out.push([]);
      out.at(-1)!.push(r);
      return out;
    }, [])
    .filter((run) => run.length > 1)
    .map((run) => smoothPath(run.map((r) => [rx(r), Y(r.windKn)] as const)))
    .join("");
  const [ty, th] = ROW.tide;
  const tideMax = Math.max(4.5, ...turns.map((t) => t.height)) + 0.3;
  const TY = (m: number) => ty + th - (m / tideMax) * (th - 6);
  const curve = traced(
    tideCurve(turns, start, end, 30).filter(seen),
    (p) => [X(p.time), TY(p.height)],
    ty + th,
  );
  const deepAt =
    bed && Number.isFinite(bed.z) && !bed.area.level ? bed.z + 1 : null;
  const handovers = leadChanges(rows);
  const hasDepth = useMemo(
    () => rows.some((r) => depthAt(r.time) !== null),
    [rows, depthAt],
  );
  const ay = lower.axis;
  const hoverRow = hover === null ? null : rows[hover];
  // Now, or with the night left out and now in it, the next first light.
  const nowRow = useMemo(() => {
    const row = rowAt(rows, now);
    if (!dark || !row || seen(row)) return row;
    return rows.find((r) => r.time > row.time && seen(r)) ?? row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, now, dark, line]);
  const shownRow = hoverRow ?? nowRow;
  const shownAt = shownRow ? rows.indexOf(shownRow) : -1;
  const onMove = (at: Section) => (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    pointer.current = { section: at, x: e.clientX, y: e.clientY };
    const box = e.currentTarget.getBoundingClientRect();
    const row = rowAtX(e.clientX - box.left);
    setHover(row);
    if (wide) setCard(place(at, row, e.clientY));
  };
  const onLeave = () => {
    pointer.current = null;
    setCard(null);
    setHover(pinned);
  };
  /** A click holds the hour under the pointer; a click on it again lets go. */
  const onClick = () => {
    if (hover === null) return;
    setPinned((was) => (was === hover ? null : hover));
  };
  /** The arrow keys step the hour, a day with Shift, and hold it. */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const by =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const from = shownAt < 0 ? rows.findIndex(seen) : shownAt;
    let next = from;
    for (let n = e.shiftKey ? 24 : 1; n > 0; ) {
      const i = next + by;
      if (i < 0 || i >= rows.length) break;
      next = i;
      if (seen(rows[i])) n -= rows[i].step;
    }
    while (next !== from && !seen(rows[next])) next -= by;
    const row = rows[next];
    if (!row) return;
    driver.current = e.currentTarget;
    if (phone) {
      e.currentTarget.scrollLeft = leftFor(mid(row));
      return;
    }
    setPinned(next);
    setHover(next);
    const el = e.currentTarget;
    const x = X(row.time);
    if (x < el.scrollLeft + 40 || x + row.step * px > el.scrollLeft + width - 40)
      el.scrollLeft = Math.max(0, x - width / 3);
  };
  // Now is said as now, however it came to be under the playhead.
  // Not with the night left out and now in it: then the hour read out is
  // the next first light's, and said by its time.
  const isNow = shownRow === rowAt(rows, now);
  const hourWords =
    isNow || !shownRow
      ? "Now"
      : `${dayNames(dublinDate(shownRow.time), shownRow.time).short} ${clock(shownRow.time)}`;
  const chip = (
    <span
      className={s.chip({ className: isNow ? s.chipNow() : undefined })}
      data-readout-hour
    >
      {hourWords}
    </span>
  );
  const waveAt = waves && shownAt >= 0 ? waves.rows[shownAt] : null;
  const windReadout = (desktop: boolean) => (
    <Readout
      row={shownRow}
      chip={desktop ? chip : null}
      depth={shownRow ? depthAt(shownRow.time) : null}
      rated={rated}
      gust={
        shownRow?.hour.wind
          ? gustReading(
              shownRow.hour.wind.wind_kn,
              shownRow.hour.wind.gust_kn,
              rider,
            )
          : null
      }
      current={current.columns[shownAt] ?? null}
      rain={shownRow ? rowRain(rain, shownRow) : null}
      hasCurrent={current.columns.length > 0}
      hasDepth={hasDepth}
      unlit={dark ? "Twilight" : "Dark"}
      measured={isNow ? nowMeasured : null}
      sea={waves ? (waveAt ?? null) : undefined}
      strip={
        desktop || !models.length ? null : (
          <BlendStrip
            label={`Wind blend${speed.unit ? `, ${speed.unit}` : ""}`}
            items={models.map((m) => {
              const p = shownRow
                ? m.points.find((q) => q.time === shownRow.time)
                : undefined;
              return {
                id: m.id,
                name: shortName(m.id),
                mark: <ModelMark wind={m.id} />,
                value: p ? speed.say(p.kn) : null,
              };
            })}
            blend={
              models.length > 1
                ? (() => {
                    const b = shownRow ? blend.get(shownRow.time) : undefined;
                    return b ? speed.say(b.kn) : null;
                  })()
                : undefined
            }
          />
        )
      }
      root={desktop}
    />
  );
  const waveReadout = (desktop: boolean) =>
    waves && (
      <WaveReadout
        row={shownRow}
        waves={waveAt}
        chip={desktop ? chip : null}
        partitions={PART_ROWS.filter(([key]) =>
          waves.rows.some((r) => partOf(r, key)),
        ).map(([key]) => key)}
        strip={
          desktop ? null : (
            <BlendStrip
              label="Wave blend, m"
              items={waves.lines.map((l) => {
                const own = waveAt?.models[l.id];
                return {
                  id: l.id,
                  name: shortName(l.id),
                  mark: <ModelMark wave={l.id} />,
                  value: own ? own.height_m.toFixed(1) : null,
                };
              })}
              blend={
                waves.blended
                  ? waveAt?.blendM != null
                    ? waveAt.blendM.toFixed(1)
                    : null
                  : undefined
              }
            />
          )
        }
      />
    );
  /** The night shaded, the day lines and the hours along a section's foot. */
  const frame = (height: number, axis: number, data: boolean) => (
    <>
      {/* The night shaded, each side of a day's light; with the night
          left out, none of it, and the line between two days is where
          it was. */}
      {days.map(({ sun, midnight }, i) => (
        <g key={i}>
          {!dark && sun.firstLight && (
            <rect
              x={X(midnight)}
              y={0}
              width={X(sun.firstLight) - X(midnight)}
              height={height - 22}
              className="fill-ink"
              fillOpacity={0.045}
              data-night={data || undefined}
            />
          )}
          {!dark && sun.lastLight && (
            <rect
              x={X(sun.lastLight)}
              y={0}
              width={X(midnight + 24 * HOUR) - X(sun.lastLight)}
              height={height - 22}
              className="fill-ink"
              fillOpacity={0.045}
              data-night={data || undefined}
            />
          )}
          {i > 0 && drawn(midnight) && X(midnight) > 0 && (
            <line
              x1={X(midnight)}
              x2={X(midnight)}
              y1={0}
              y2={height}
              className="stroke-line"
              data-day-line={data || undefined}
            />
          )}
        </g>
      ))}
      {/* The hours along the foot: every sixth, or with the night left
          out every third, clear of where each day starts. */}
      {Array.from(
        { length: Math.ceil((end - start) / HOUR / tick) },
        (_, i) => start + i * tick * HOUR,
      )
        .filter(
          (t) =>
            dublinHour(t) % 24 !== 0 &&
            (!dark ||
              line.spans.some(
                (span) =>
                  // Clear of the day's name at its start.
                  t >= span.from &&
                  X(t) - X(span.from) >= 60 &&
                  span.to - t >= HOUR,
              )),
        )
        .map((t) => (
          <text
            key={t}
            x={X(t)}
            y={axis + 14}
            textAnchor="middle"
            className="fill-ink-muted font-body text-caption"
          >
            {String(dublinHour(t)).padStart(2, "0")}
          </text>
        ))}
      {days.map(({ day, midnight }, i) =>
        !drawn(midnight) ? null : (
          <text
            key={i}
            x={X(midnight) + 8}
            y={axis + 14}
            className="fill-ink font-body text-caption font-semibold"
          >
            {dayNames(day.date, now).relative === "Today"
              ? "Today"
              : dayNames(day.date, now).short}{" "}
            {Number(day.date.slice(8, 10))}
          </text>
        ),
      )}
    </>
  );
  /** Now's line, and the hour read out's column and playhead. */
  const marks = (axis: number) => (
    <>
      <line
        x1={X(now)}
        x2={X(now)}
        y1={4}
        y2={axis}
        className="stroke-pen"
        strokeWidth={1.5}
      />
      {hoverRow && (
        <>
          <rect
            x={X(hoverRow.time)}
            y={4}
            width={hoverRow.step * px}
            height={axis - 4}
            rx={Math.min(6, px / 2)}
            className="fill-ink"
            fillOpacity={0.07}
          />
          {phone && (
            <line
              x1={mid(hoverRow)}
              x2={mid(hoverRow)}
              y1={4}
              y2={axis}
              className="stroke-ink"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              data-playhead-line
            />
          )}
        </>
      )}
    </>
  );
  const waveStack = waves
    ? stack(WAVE_BANDS, 10, (band) =>
        band in WAVE_PART
          ? waves.rows.some((r) => partOf(r, band as PartRow))
          : true,
      )
    : null;
  const graphProps = (at: Section) => ({
    className: s.graph(),
    onScroll,
    onPointerDown: drive,
    onTouchStart: drive,
    onWheel: drive,
    onKeyDown: onKey,
    onFocus: drive,
    tabIndex: 0,
    role: "group",
    "aria-label": `${at === "wind" ? "Wind" : "Waves"} graph: the arrow keys move the hour`,
    "data-playhead": phone || undefined,
  });
  const svgProps = (at: Section) => ({
    onPointerMove: phone ? undefined : onMove(at),
    onPointerLeave: phone ? undefined : onLeave,
    onClick: phone ? undefined : onClick,
    className: "block",
  });
  const windModels = models.map((m) => modelName(m.id)).join(", ");
  const waveModels = waves?.lines.map((l) => waveModelName(l.id)).join(", ");
  return (
    <>
      {!wide && (
        <div className={s.tools()} ref={tools}>
          {stuck && <div className={s.toolsEdge()} aria-hidden="true" />}
          <div className="grid w-full gap-2" data-readout>
            <div className="flex items-center justify-between gap-2.5">
              {chip}
              {waves && (
                <Segmented
                  aria-label="What the readout shows"
                  size="sm"
                  value={section}
                  onChange={jump}
                  options={[
                    { value: "wind", label: "Wind" },
                    { value: "waves", label: "Waves" },
                  ]}
                />
              )}
            </div>
            <div className="grid" aria-live="polite">
              <div
                className={s.pane({
                  className:
                    section === "wind" ? "visible opacity-100" : "invisible opacity-0",
                })}
                aria-hidden={section !== "wind"}
                data-pane="wind"
              >
                {windReadout(false)}
              </div>
              {waves && (
                <div
                  className={s.pane({
                    className:
                      section === "waves" ? "visible opacity-100" : "invisible opacity-0",
                  })}
                  aria-hidden={section !== "waves"}
                  data-pane="waves"
                >
                  {waveReadout(false)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <section
        ref={windSection}
        aria-labelledby="week-wind"
        data-week-section="wind"
      >
        <div className={s.weekHead()}>
          <h3 className={s.h3()} id="week-wind">
            Wind
          </h3>
          {windModels && (
            <span className={s.weekSub()}>
              {wide ? windModels : `${models.length} models`}
            </span>
          )}
        </div>
        {wide && (
          <div className={s.tools()} ref={tools}>
            {windReadout(true)}
          </div>
        )}
        <div className={s.gbox()} ref={gbox}>
          <BandNames
            height={GH}
            held={held}
            bands={(Object.keys(ROW) as WindBand[])
              .filter((band) => rated || band !== "stars")
              .map((band) => [
                WIND_NAME[band],
                band === "stars"
                  ? ROW.stars[0] + 10
                  : band === "wind"
                    ? ROW.wind[0] + 46
                    : band === "dir"
                      ? ROW.dir[0] + 18
                      : band === "tide"
                        ? ROW.tide[0] + 42
                        : band === "sky"
                          ? ROW.sky[0] + 20
                          : ROW[band][0] + Math.min(ROW[band][1], 40) / 2,
                ROW[band],
              ])}
          />
          <div {...graphProps("wind")} ref={ref} data-spot-graph>
            <svg
              ref={windSvg}
              width={W}
              height={GH}
              viewBox={`0 0 ${W} ${GH}`}
              {...svgProps("wind")}
              data-graph-svg
            >
              <defs>
                <linearGradient
                  id="spot-wind"
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  x2={W}
                  y1={0}
                  y2={0}
                >
                  {windRows.map((r, i) => (
                    <stop
                      key={i}
                      offset={Math.min(1, Math.max(0, mid(r) / W)).toFixed(4)}
                      stopColor={windCss(r.hour.wind!.wind_kn)}
                    />
                  ))}
                </linearGradient>
                {deepAt !== null && (
                  <clipPath id="spot-deep">
                    <rect x={0} y={0} width={W} height={TY(deepAt)} />
                  </clipPath>
                )}
              </defs>
              {frame(GH, ay, true)}
              {rows.map((r, i) =>
                r.rating && seen(r) ? (
                  <rect
                    key={i}
                    x={X(r.time) + 1}
                    y={ROW.stars[0]}
                    width={r.step * px - 2}
                    height={ROW.stars[1]}
                    rx={2}
                    className={STAR_FILL[r.rating.stars]}
                  />
                ) : null,
              )}
              {spread && (
                <path d={spread} className="fill-ink" fillOpacity={0.07} />
              )}
              {mean.line && (
                <>
                  <path
                    d={mean.area}
                    fill="url(#spot-wind)"
                    fillOpacity={0.78}
                  />
                  <path
                    d={mean.line}
                    fill="none"
                    stroke="url(#spot-wind)"
                    strokeWidth={2.2}
                  />
                </>
              )}
              {gust && (
                <path
                  d={gust}
                  className="fill-none stroke-gust"
                  strokeWidth={1.6}
                  strokeDasharray="4 3"
                />
              )}
              {readings.length > 0 && (
                <g data-measured={measured!.station.id}>
                  {/* On a ground-coloured halo, so the gold reads over the
                      wind's own colours and the paper alike. */}
                  {measuredLine && (
                    <>
                      <path
                        d={measuredLine}
                        className="fill-none stroke-ground"
                        strokeWidth={4.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d={measuredLine}
                        className="fill-none stroke-buoy"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        data-measured-line
                      />
                    </>
                  )}
                  {readings.map((r) =>
                    r.gustKn === null ? null : (
                      <circle
                        key={`g${r.time}`}
                        cx={rx(r)}
                        cy={Y(r.gustKn)}
                        r={2.3}
                        className="fill-ground stroke-buoy"
                        strokeWidth={1.4}
                        data-measured-gust={r.time}
                      />
                    ),
                  )}
                  {readings.map((r) => (
                    <circle
                      key={`w${r.time}`}
                      cx={rx(r)}
                      cy={Y(r.windKn)}
                      r={2.6}
                      className="fill-buoy stroke-ground"
                      strokeWidth={1.2}
                      data-measured-wind={r.time}
                    />
                  ))}
                </g>
              )}
              {[10, 20, 30].map((k) => (
                <text
                  key={k}
                  x={W - 6}
                  y={Y(k) - 3}
                  textAnchor="end"
                  className="fill-ink-muted font-body text-caption"
                >
                  {speed.say(k)}
                </text>
              ))}
              {windRows
                .filter((r) => dublinHour(r.time) % 3 === 0)
                .map((r, i) => (
                  <g key={i}>
                    <g
                      transform={`translate(${mid(r)},${ROW.dir[0] + 9}) rotate(${r.hour.wind!.direction_deg + 180})`}
                    >
                      <path
                        d={ARROW}
                        className={
                          isOff(r.shore)
                            ? "fill-none stroke-pen"
                            : "fill-none stroke-ink"
                        }
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                    <text
                      x={mid(r)}
                      y={ROW.dir[0] + 34}
                      textAnchor="middle"
                      className="fill-ink font-body text-body font-semibold"
                    >
                      {speed.say(r.hour.wind!.wind_kn)}
                    </text>
                  </g>
                ))}
              {curve.line && (
                <>
                  <path d={curve.area} className="fill-sea-3" />
                  {deepAt !== null && (
                    <path
                      d={curve.area}
                      className="fill-depth"
                      fillOpacity={0.9}
                      clipPath="url(#spot-deep)"
                    />
                  )}
                  <path
                    d={curve.line}
                    className="fill-none stroke-ink-2"
                    strokeWidth={1.4}
                  />
                </>
              )}
              {turns
                .filter((t) => t.time >= start && t.time <= end && seen(t))
                .map((t, i) => (
                  <text
                    key={i}
                    x={X(t.time)}
                    y={t.tide === "high" ? TY(t.height) - 6 : TY(t.height) + 15}
                    textAnchor="middle"
                    className="fill-ink-2 font-body text-caption"
                  >
                    {clock(t.time)}
                  </text>
                ))}
              <LowerBands
                rows={rows}
                seen={seen}
                apart={apart}
                lower={lower.at}
                X={X}
                px={px}
                W={W}
                hover={hover}
                rider={rider}
                rated={rated}
                models={models}
                blend={blend}
                current={current}
                rain={rain}
                units={units}
              />
              {handovers.filter(seen).map((h, i) => (
                <g key={i}>
                  <line
                    x1={X(h.time)}
                    x2={X(h.time)}
                    y1={ROW.wind[0] - 6}
                    y2={ROW.dir[0] + 40}
                    className="stroke-ink-muted"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={X(h.time) + 6}
                    y={ROW.wind[0] + 6}
                    className="fill-ink-muted font-body text-caption"
                  >
                    {modelName(h.to)} from here
                  </text>
                </g>
              ))}
              {marks(ay)}
              {hoverRow?.hour.wind && (
                <circle
                  cx={mid(hoverRow)}
                  cy={Y(hoverRow.hour.wind.wind_kn)}
                  r={4}
                  fill={windCss(hoverRow.hour.wind.wind_kn)}
                  className="stroke-ground"
                  strokeWidth={2}
                />
              )}
            </svg>
            {lower.at.current && current.columns.length === 0 && (
              // Said once, and kept in view as the hours scroll under it.
              <div
                className="pointer-events-none absolute left-0"
                style={{ top: lower.at.current[0] + 10, width: W }}
              >
                <span
                  className="sticky left-3 inline-block font-body text-caption text-ink-muted"
                  data-current-note
                >
                  {current.note ?? "Current: reading…"}
                </span>
              </div>
            )}
            {rows
              .filter(
                (r) =>
                  r.hour.weather && dublinHour(r.time) % 3 === 0 && seen(r),
              )
              .map((r, i) => (
                <span
                  key={i}
                  className={s.sky()}
                  style={{ left: mid(r) - 10, top: ROW.sky[0] + 4 }}
                >
                  <SkyGlyph
                    weather={r.hour.weather!}
                    size={16}
                    dark={!r.hour.daylight}
                  />
                  {r.hour.weather!.air_c !== null &&
                    `${Math.round(r.hour.weather!.air_c)}°`}
                </span>
              ))}
          </div>
          {card?.section === "wind" && shownRow && (
            <HoverCard
              title="Wind blend"
              when={hourWords}
              left={card.left}
              top={card.top}
              rows={[
                ...models.map((m) => {
                  const p = m.points.find((q) => q.time === shownRow.time);
                  return {
                    id: m.id,
                    mark: <ModelMark wind={m.id} />,
                    name: modelName(m.id),
                    value: p
                      ? `${speed.say(p.kn)} ${speed.unit}`.trim()
                      : shownRow.time > m.points.at(-1)!.time
                        ? "ended"
                        : null,
                    extra: p
                      ? compass(p.from)
                      : shownRow.time < m.points[0].time
                        ? `from ${clock(m.points[0].time)}`
                        : "",
                  };
                }),
              ]}
              blend={(() => {
                const b = blend.get(shownRow.time);
                return models.length > 1 && b
                  ? {
                      value: `${speed.say(b.kn)} ${speed.unit}`.trim(),
                      range: `${speed.say(b.low)}–${speed.say(b.high)} ${speed.unit}`.trim(),
                    }
                  : null;
              })()}
              data-card="wind"
            />
          )}
        </div>
        {/* The key, in groups as the graph's bands run, each mark drawn as
            the graph draws it. */}
        <div className={s.legend()} data-legend>
          <KeyGroup name="Wind">
            <KeyItem mark="wind">Wind</KeyItem>
            <KeyItem mark="gust">Gust</KeyItem>
            {readings.length > 0 && (
              <KeyItem mark="measured" data-measured-key>
                Measured at {pairedName(measured!)}, wind and gust
              </KeyItem>
            )}
            {/* A point reads one model an hour: nothing to disagree. */}
            {rated && <KeyItem mark="spread">Where models disagree</KeyItem>}
          </KeyGroup>
          {models.length > 0 && (
            <KeyGroup
              name={`Wind blend${speed.unit ? `, ${speed.unit}` : ""}`}
              data-models-legend
            >
              {models.map((m) => {
                const at = shownRow
                  ? m.points.find((p) => p.time === shownRow.time)
                  : undefined;
                return (
                  <KeyItem
                    key={m.id}
                    hue={modelHue(m.id).wind}
                    dashed={DASHED.has(m.id)}
                    figure={at ? speed.say(at.kn) : ""}
                    data-model-key={m.id}
                  >
                    {modelName(m.id)}
                  </KeyItem>
                );
              })}
              {models.length > 1 && (
                <KeyItem
                  mark="blend"
                  figure={(() => {
                    const b = shownRow ? blend.get(shownRow.time) : undefined;
                    return b ? speed.say(b.kn) : "";
                  })()}
                  data-model-key="blend"
                >
                  Blend
                </KeyItem>
              )}
            </KeyGroup>
          )}
          {rated && (
            <KeyGroup name="Gusts">
              <KeyItem mark="costs">Costs a star</KeyItem>
              <KeyItem mark="over">Past too much: no stars</KeyItem>
            </KeyGroup>
          )}
          <KeyGroup name="Sky and sea" wide>
            {!dark && <KeyItem mark="dark">Dark</KeyItem>}
            <KeyItem mark="rain">Rain, mm/h</KeyItem>
            <KeyItem mark="current">
              Current: where it runs, in {unitLabel(currentUnits(units))}
            </KeyItem>
            {deepAt !== null && (
              <KeyItem mark="depth">1 m of water or more at the launch</KeyItem>
            )}
          </KeyGroup>
        </div>
      </section>
      {waves && waveStack && (
        <section
          ref={waveSection}
          aria-labelledby="week-waves"
          data-week-section="waves"
        >
          <div className={s.weekHead({ className: "mt-9" })}>
            <h3 className={s.h3()} id="week-waves">
              Waves
            </h3>
            {waveModels && (
              <span className={s.weekSub()}>
                {wide ? waveModels : `${waves.lines.length} models`}
              </span>
            )}
          </div>
          {wide && <div className={s.tools()}>{waveReadout(true)}</div>}
          <div className={s.gbox()} ref={waveBox}>
            <BandNames
              height={waveStack.height}
              held={held}
              bands={(Object.keys(waveStack.at) as WaveBand[]).map((band) => {
                const [y, h] = waveStack.at[band]!;
                return [
                  WAVE_NAME[band],
                  band === "waves"
                    ? y + 18
                    : band === "wdir"
                      ? y + 18
                      : y + Math.min(h, 40) / 2,
                  [y, h],
                ];
              })}
            />
            <div {...graphProps("waves")} ref={waveRef} data-wave-graph>
              <svg
                ref={waveSvg}
                width={W}
                height={waveStack.height}
                viewBox={`0 0 ${W} ${waveStack.height}`}
                {...svgProps("waves")}
                data-wave-svg
              >
                {frame(waveStack.height, waveStack.axis, false)}
                <WaveBands
                  rows={rows}
                  waves={waves}
                  seen={seen}
                  apart={apart}
                  bands={waveStack.at}
                  X={X}
                  px={px}
                  W={W}
                  hover={hover}
                  end={end}
                  handovers={waveHandovers(rows, waves).filter(seen)}
                />
                {marks(waveStack.axis)}
              </svg>
            </div>
            {card?.section === "waves" && shownRow && (
              <HoverCard
                title="Wave blend"
                when={hourWords}
                left={card.left}
                top={card.top}
                rows={waves.lines.map((l) => {
                  const own = waveAt?.models[l.id];
                  const before = shownRow.time + shownRow.step * HOUR <= l.first;
                  return {
                    id: l.id,
                    mark: <ModelMark wave={l.id} />,
                    name: waveModelName(l.id),
                    // Its nearest own step, nothing worked out between two;
                    // across a hole in its run, no value.
                    value: own
                      ? `${own.height_m.toFixed(1)} m`
                      : shownRow.time > l.last
                        ? "ended"
                        : null,
                    extra: own
                      ? own.period_s === null
                        ? ""
                        : `${Math.round(own.period_s)} s`
                      : before
                        ? `from ${clock(l.first)}`
                        : "",
                  };
                })}
                blend={
                  waveAt?.blendM != null
                    ? {
                        value: `${waveAt.blendM.toFixed(1)} m`,
                        extra:
                          waveAt.blendPeriodS === null
                            ? ""
                            : `${Math.round(waveAt.blendPeriodS)} s`,
                        range:
                          waveAt.lowM !== null && waveAt.highM !== null
                            ? `${waveAt.lowM.toFixed(1)}–${waveAt.highM.toFixed(1)} m`
                            : null,
                      }
                    : null
                }
                data-card="waves"
              />
            )}
          </div>
          <div className={s.legend()} data-wave-legend>
            <KeyGroup name="Waves">
              <KeyItem mark="sea">
                {waveModel === WAVE_BLEND
                  ? "Wave height: the blend, the finest model where it has none"
                  : waveModel
                    ? `Wave height: ${waveModelName(waveModel)}, and the next model past its run`
                    : "Wave height: the finest model at each hour"}
              </KeyItem>
              {waves.lines.length > 1 && (
                <KeyItem mark="spread">Where models disagree</KeyItem>
              )}
              <KeyItem mark="waves">Arrow: where they run; figure: metres</KeyItem>
            </KeyGroup>
            <KeyGroup name="Wave blend, m" wide data-wave-models-legend>
              {waves.lines.map((l) => {
                const own = waveAt?.models[l.id];
                const detail = modelEntry(l.id)?.detail;
                return (
                  <KeyItem
                    key={l.id}
                    stroke={waveHue(l.id).stroke}
                    dashed={DASHED.has(l.id)}
                    figure={own ? own.height_m.toFixed(1) : ""}
                    data-model-key={l.id}
                  >
                    {waveModelName(l.id)}
                    {detail && (
                      <span className="text-ink-muted"> · {detail}</span>
                    )}
                  </KeyItem>
                );
              })}
              {waves.blended && (
                <KeyItem
                  mark="blend"
                  figure={
                    waveAt?.blendM != null ? waveAt.blendM.toFixed(1) : ""
                  }
                  data-model-key="blend"
                >
                  Blend
                </KeyItem>
              )}
            </KeyGroup>
            {PART_ROWS.some(([key]) => waveStack.at[key]) && (
              <KeyGroup name="Swell">
                <KeyItem mark="swell">
                  Each train: how high, its period, where it runs
                </KeyItem>
              </KeyGroup>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/** The partition bands, by key: a band of the waves' section only where it has data. */
const WAVE_PART: Record<string, true> = Object.fromEntries(
  PART_ROWS.map(([key]) => [key, true]),
);

/** The hover card's width, and a row's height, for placing it in the graph. */
const CARD_WIDTH = 256;
const CARD_ROW = 22;

/**
 * A section's band names, in a column of their own beside the hours, each in
 * a strip as tall as its band, held below a phone's readout while any of the
 * band is still in view.
 */
function BandNames({
  height,
  held,
  bands,
}: {
  height: number;
  held: number;
  bands: (readonly [string, number, readonly [number, number]])[];
}) {
  const s = styles();
  return (
    <div className={s.gl()} style={{ height }}>
      {bands.map(([name, middle, [y, h]]) => (
        // The strip runs from where the name sits, beside the middle of
        // its band, to the band's foot: as far as the name can be held.
        <div
          key={`${name}${y}`}
          className={s.glBand()}
          style={{
            top: middle - 8,
            height: Math.max(16, y + h - (middle - 8)),
          }}
        >
          <span
            className={s.glName()}
            style={{ top: held }}
            data-band-name={name}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A model's line, small, as the graph draws it: in its colour, dashed if it is. */
function ModelMark({
  wind,
  wave,
  blend = false,
}: {
  wind?: string;
  wave?: string;
  blend?: boolean;
}) {
  const id = wind ?? wave ?? "";
  return (
    <svg
      className="h-1.5 w-3.5 shrink-0 overflow-visible"
      viewBox="0 0 14 6"
      aria-hidden="true"
    >
      <path
        d="M1 3H13"
        fill="none"
        stroke={wind ? modelHue(wind).wind : undefined}
        className={
          blend ? "stroke-ink" : wave ? waveHue(wave).stroke : undefined
        }
        strokeWidth={blend ? 2.5 : 2}
        strokeLinecap="round"
        strokeDasharray={!blend && DASHED.has(id) ? "3 2" : undefined}
      />
    </svg>
  );
}

/**
 * The phone's readout of a blend: each model's value at the hour, then the
 * blend's apart, past a line, so every line in the band is named.
 */
function BlendStrip({
  label,
  items,
  blend,
}: {
  label: string;
  items: {
    id: string;
    name: string;
    mark: React.ReactNode;
    value: string | null;
  }[];
  /** The blend's value, null where it has none at the hour; undefined: no blend. */
  blend?: string | null;
}) {
  const s = styles();
  return (
    <div className={s.ro({ className: "col-span-4" })} data-blend-strip>
      <span className={s.roLabel()}>{label}</span>
      <div className={s.strip()}>
        {items.map((item) => (
          <div key={item.id} className={s.bl()} data-strip-model={item.id}>
            <span className={s.blName()}>
              {item.mark}
              <span className="truncate">{item.name}</span>
            </span>
            <b
              className={s.blValue({
                className: item.value === null ? s.blNone() : undefined,
              })}
            >
              {item.value ?? "–"}
            </b>
          </div>
        ))}
        {blend !== undefined && (
          <div
            className={s.bl({ className: s.blBlend() })}
            data-strip-model="blend"
          >
            <span className={s.blName({ className: "font-semibold text-ink" })}>
              <ModelMark blend />
              Blend
            </span>
            <b
              className={s.blValue({
                className: blend === null ? s.blNone() : s.blSum(),
              })}
            >
              {blend ?? "–"}
            </b>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Beside the pointer over a section, on a desktop: that section's models at
 * the hour, and their blend with the models' range. Never both sections'.
 */
function HoverCard({
  title,
  when,
  left,
  top,
  rows,
  blend,
  ...data
}: {
  title: string;
  when: string;
  left: number;
  top: number;
  rows: {
    id: string;
    mark: React.ReactNode;
    name: string;
    /** Its value, "ended" past its run, or null before it starts. */
    value: string | null;
    extra: string;
  }[];
  blend: { value: string; extra?: string; range: string | null } | null;
  "data-card": Section;
}) {
  const s = styles();
  return (
    <div
      className={s.card2()}
      style={{ left, top, width: CARD_WIDTH }}
      aria-hidden="true"
      {...data}
    >
      <div className={s.cardHead()}>
        {title}
        <span className="font-normal text-ink-muted">{when}</span>
      </div>
      <table className="w-full border-collapse tabular-nums">
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={r.value === null || r.value === "ended" ? "text-ink-muted" : undefined}
              data-card-model={r.id}
            >
              <td className="w-5 py-0.5">{r.mark}</td>
              <td className="py-0.5 whitespace-nowrap text-ink-2">{r.name}</td>
              <td
                className={`py-0.5 pl-2.5 text-right whitespace-nowrap ${
                  r.value === null || r.value === "ended"
                    ? "font-normal"
                    : "font-semibold text-ink"
                }`}
              >
                {r.value ?? "–"}
              </td>
              <td className="w-px py-0.5 pl-2 text-right whitespace-nowrap text-ink-muted">
                {r.extra}
              </td>
            </tr>
          ))}
          {blend && (
            <>
              <tr className="font-semibold text-ink" data-card-model="blend">
                <td className="w-5 border-0 border-t border-line pt-1.5">
                  <ModelMark blend />
                </td>
                <td className="border-0 border-t border-line pt-1.5">Blend</td>
                <td className="border-0 border-t border-line pt-1.5 pl-2.5 text-right whitespace-nowrap">
                  {blend.value}
                </td>
                <td className="border-0 border-t border-line pt-1.5 pl-2 text-right whitespace-nowrap">
                  {blend.extra ?? ""}
                </td>
              </tr>
              {blend.range && (
                <tr className="text-ink-muted">
                  <td />
                  <td className="py-0.5 whitespace-nowrap">Models range</td>
                  <td
                    className="py-0.5 pl-2.5 text-right whitespace-nowrap"
                    colSpan={2}
                  >
                    {blend.range}
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** What a key's mark is: one of the graph's own, or a model's line in its hue. */
type KeyMarkKind =
  | "wind"
  | "gust"
  | "measured"
  | "spread"
  | "costs"
  | "over"
  | "waves"
  | "current"
  | "depth"
  | "dark"
  | "rain"
  | "blend"
  | "sea"
  | "swell";

/** A group of the key under the graph: a small heading, and its marks. */
function KeyGroup({
  name,
  wide = false,
  children,
  ...data
}: {
  name: string;
  /** Its words are long: the whole width on a phone. */
  wide?: boolean;
  children: React.ReactNode;
  "data-models-legend"?: boolean;
  "data-wave-models-legend"?: boolean;
}) {
  const s = styles();
  return (
    <div
      className={s.kGroup({ className: wide ? "max-wide:col-span-2" : "" })}
      {...data}
    >
      <span className={s.kHead()}>{name}</span>
      <ul className={s.kList()}>{children}</ul>
    </div>
  );
}

/**
 * One mark of the key, drawn as the graph draws it, at one size for every
 * mark: `mark` is the kind, or a model's line in its colour, `hue` (a wind
 * model's) or `stroke` (a wave model's class), dashed if its line is. A
 * model's figure at the hour read out sits in a slot of its own, kept
 * whether there is a figure or not, so the key never rewraps as the hours
 * move.
 */
function KeyItem({
  mark,
  hue,
  stroke,
  dashed = false,
  figure,
  children,
  ...data
}: {
  mark?: KeyMarkKind;
  hue?: string;
  stroke?: string;
  dashed?: boolean;
  figure?: string;
  children: React.ReactNode;
  "data-model-key"?: string;
  "data-measured-key"?: boolean;
}) {
  const s = styles();
  return (
    <li className={s.kItem()} {...data}>
      <svg
        className={s.kMark()}
        viewBox="0 0 20 12"
        aria-hidden="true"
        data-key-mark={mark ?? "model"}
      >
        {mark ? (
          <KeyMark mark={mark} />
        ) : (
          // A model's own line, in its hue (the ruling of 2026-09-16).
          <path
            d="M0 6H20"
            fill="none"
            stroke={hue}
            className={stroke}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeDasharray={dashed ? DASH : undefined}
          />
        )}
      </svg>
      <span className={s.kWords()}>{children}</span>
      {figure !== undefined && <b className={s.kFigure()}>{figure}</b>}
    </li>
  );
}

function KeyMark({ mark }: { mark: KeyMarkKind }) {
  switch (mark) {
    case "wind":
      return (
        <>
          <path
            d="M0 7C4 4 7 5 10 4.5S16 2.5 20 3.5V12H0Z"
            className="fill-wind-k15"
            fillOpacity={0.78}
          />
          <path
            d="M0 7C4 4 7 5 10 4.5S16 2.5 20 3.5"
            className="fill-none stroke-wind-k15"
            strokeWidth={1.6}
          />
        </>
      );
    case "gust":
      return (
        <path
          d="M0 6H20"
          className="fill-none stroke-gust"
          strokeWidth={1.6}
          strokeDasharray="4 3"
        />
      );
    case "measured":
      return (
        <>
          <path
            d="M1 8C6 6 9 7 14 5S18 4 19 4"
            className="fill-none stroke-buoy"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle
            cx={7}
            cy={6.8}
            r={2.4}
            className="fill-buoy stroke-ground"
            strokeWidth={1}
          />
          <circle
            cx={13}
            cy={1.6}
            r={2}
            className="fill-ground stroke-buoy"
            strokeWidth={1.3}
          />
        </>
      );
    case "spread":
      return (
        <path
          d="M0 4C5 1.5 10 3 20 1.5V10C12 11 6 9.5 0 10.5Z"
          className="fill-ink"
          fillOpacity={0.14}
        />
      );
    case "costs":
    case "over":
      return (
        <rect
          x={0}
          y={1}
          width={20}
          height={10}
          rx={2}
          className="fill-gust"
          fillOpacity={mark === "over" ? 0.45 : 0.22}
        />
      );
    case "waves":
    case "current":
      return (
        <g transform="translate(10 6) rotate(45) scale(0.8)">
          <path
            d={ARROW}
            className={
              mark === "waves"
                ? "fill-none stroke-depth"
                : "fill-none stroke-ink-2"
            }
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case "depth":
      return (
        <rect
          x={0}
          y={1}
          width={20}
          height={10}
          rx={2}
          className="fill-depth"
          fillOpacity={0.9}
        />
      );
    case "dark":
      return (
        <rect
          x={0}
          y={0}
          width={20}
          height={12}
          rx={2}
          className="fill-ink"
          fillOpacity={0.09}
        />
      );
    case "blend":
      return (
        <path
          d="M0 6H20"
          className="fill-none stroke-ink"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      );
    case "sea":
      return (
        <rect
          x={0}
          y={1}
          width={20}
          height={10}
          rx={2}
          className="fill-sea-1"
          fillOpacity={0.9}
        />
      );
    case "swell":
      return (
        <>
          <path
            d="M0 9C5 7 9 8 14 7S18 6 20 6V12H0Z"
            className="fill-sea-1"
            fillOpacity={0.55}
          />
          <path
            d="M0 9C5 7 9 8 14 7S18 6 20 6"
            className="fill-none stroke-depth"
            strokeWidth={1.2}
          />
        </>
      );
    case "rain":
      return (
        <g className="fill-weather-rain">
          <rect x={1} y={7} width={5} height={5} rx={1} />
          <rect x={7.5} y={3} width={5} height={9} rx={1} />
          <rect x={14} y={5} width={5} height={7} rx={1} />
        </g>
      );
  }
}

/**
 * The wind section's bands under its sky, each a row of the chart's old dock
 * carried here when the dock gave way to the chart's scrub bar, on the
 * graph's own hours, its scroll, its nights and its pointer:
 *
 * - Wind blend: every model the rider blends (Settings), its own wind as its
 *   own line in its own colour, the global models dashed, and their blend in
 *   ink over the band from the lowest model to the highest (`windBlend`), on
 *   the tens either side of the week's model winds so the lines fill the
 *   band. The blend is said here and nowhere else: the headline wind, and
 *   the stars, stay the one model's own.
 * - Gusts: the gust factor every third hour, and behind every hour the
 *   stars' reading of its gust, as the dock tinted it (`gustReading`).
 * - Rain: each row's mm/h as a bar, on the square root the dock's rain tint
 *   reads (force5/src/rain.ts), so a wet hour of 0.2 mm shows and a downpour
 *   still fits; the figure every third hour it rains.
 * - Current: where the water runs, and how fast; with none, the dock's note.
 */
function LowerBands({
  rows,
  seen,
  apart,
  lower,
  X,
  px,
  W,
  hover,
  rider,
  rated,
  models,
  blend,
  current,
  rain,
  units,
}: {
  rows: readonly SpotRow[];
  /** Whether a row is drawn: not with the night left out and it after dark. */
  seen: (row: Pick<SpotRow, "time">) => boolean;
  /** Whether a night left out stands between two times: a line breaks there. */
  apart: (a: number, b: number) => boolean;
  lower: Stack<WindBand>["at"];
  X: (t: number) => number;
  px: number;
  W: number;
  hover: number | null;
  rider: Rider;
  rated: boolean;
  models: readonly ModelSeries[];
  blend: ReadonlyMap<number, WindBlendAt>;
  current: SpotCurrents;
  rain: ReadonlyMap<number, number>;
  units: Units;
}) {
  const speed = useSpeed();
  const mid = (r: Pick<SpotRow, "time" | "step">) =>
    X(r.time) + (r.step * px) / 2;
  const third = (r: SpotRow) => dublinHour(r.time) % 3 === 0 && seen(r);
  const caption = "font-body text-caption";
  const hovered = hover === null ? null : rows[hover];
  /** A line through points in runs, broken where a reading is missing. */
  const lineOf = (
    points: readonly { time: number; step: number }[],
    y: (i: number) => number,
  ) => {
    const out: (readonly [number, number])[][] = [];
    points.forEach((p, i) => {
      const before = points[i - 1];
      if (
        !before ||
        before.time + before.step * HOUR !== p.time ||
        apart(before.time, p.time)
      )
        out.push([]);
      out.at(-1)!.push([mid(p), y(i)]);
    });
    return out
      .filter((run) => run.length > 1)
      .map(smoothPath)
      .join("");
  };
  return (
    <>
      {lower.rain &&
        (() => {
          const [y, h] = lower.rain;
          const bar = h - 14;
          return (
            <g data-band="rain">
              <line
                x1={0}
                x2={W}
                y1={y + h}
                y2={y + h}
                className="stroke-line"
              />
              {rows.map((r, i) => {
                if (!seen(r)) return null;
                const rate = rowRain(rain, r);
                const tint = rate === null ? 0 : rainTint(rate);
                if (!tint) return null;
                const tall = Math.max(2, tint * bar);
                return (
                  <rect
                    key={i}
                    x={X(r.time) + 1}
                    y={y + h - tall}
                    width={Math.max(1, r.step * px - 2)}
                    height={tall}
                    rx={1.5}
                    className="fill-weather-rain"
                    data-rain={rate!.toFixed(2)}
                  />
                );
              })}
              {rows.filter(third).map((r, i) => {
                const rate = rowRain(rain, r);
                return rate === null || rate < DRY_MM_PER_HOUR ? null : (
                  <text
                    key={i}
                    x={mid(r)}
                    y={y + 9}
                    textAnchor="middle"
                    className={`fill-ink-2 ${caption}`}
                  >
                    {rate < 0.1 ? "<0.1" : rate.toFixed(1)}
                  </text>
                );
              })}
            </g>
          );
        })()}
      {lower.blend &&
        (() => {
          const [y, h] = lower.blend;
          // On the tens either side of the week's model winds, so the lines
          // fill the band rather than a strip of a scale from calm to 36 kn.
          const kns = models.flatMap((m) =>
            m.points.filter(seen).map((p) => p.kn),
          );
          const lo = kns.length ? Math.floor(Math.min(...kns) / 10) * 10 : 0;
          const hi = Math.max(
            lo + 10,
            kns.length ? Math.ceil(Math.max(...kns) / 10) * 10 : 20,
          );
          const MY = (k: number) => y + h - ((k - lo) / (hi - lo)) * h;
          // The blend's hours, in the rows' order, drawn where two models or
          // more feed it: with one, the blend is that model's own line.
          const blended =
            models.length > 1
              ? rows.filter((r) => seen(r) && blend.has(r.time))
              : [];
          const spread = blended.length
            ? (() => {
                const parts: string[] = [];
                let run: SpotRow[] = [];
                const flush = () => {
                  if (run.length > 1) {
                    const top = run.map(
                      (r) => [mid(r), MY(blend.get(r.time)!.high)] as const,
                    );
                    const bot = run
                      .map((r) => [mid(r), MY(blend.get(r.time)!.low)] as const)
                      .reverse();
                    parts.push(
                      `${smoothPath(top)}L${smoothPath(bot).slice(1)}Z`,
                    );
                  }
                  run = [];
                };
                blended.forEach((r, i) => {
                  const before = blended[i - 1];
                  if (
                    before &&
                    (before.time + before.step * HOUR !== r.time ||
                      apart(before.time, r.time))
                  )
                    flush();
                  run.push(r);
                });
                flush();
                return parts.join("");
              })()
            : "";
          const blendLine = lineOf(blended, (i) =>
            MY(blend.get(blended[i].time)!.kn),
          );
          return (
            <g data-band="wind-blend" data-scale={`${lo}-${hi}`}>
              {Array.from(
                { length: (hi - lo) / 10 + 1 },
                (_, i) => lo + i * 10,
              ).map((k) => (
                <g key={k}>
                  <line
                    x1={0}
                    x2={W}
                    y1={MY(k)}
                    y2={MY(k)}
                    className="stroke-line"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={W - 6}
                    y={MY(k) - 3}
                    textAnchor="end"
                    className={`fill-ink-muted ${caption}`}
                  >
                    {speed.say(k)}
                  </text>
                </g>
              ))}
              {spread && (
                <path d={spread} className="fill-ink" fillOpacity={0.06} />
              )}
              {models.map((m) => {
                // A model's line breaks where it has no reading, rather than
                // drawing a guess across the hole.
                const points = m.points.filter(seen);
                return (
                  <path
                    key={m.id}
                    d={lineOf(points, (i) => MY(points[i].kn))}
                    fill="none"
                    stroke={modelHue(m.id).wind}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={DASHED.has(m.id) ? DASH : undefined}
                    data-model={m.id}
                  />
                );
              })}
              {blendLine && (
                <path
                  d={blendLine}
                  className="fill-none stroke-ink"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  data-blend
                />
              )}
              {hovered &&
                seen(hovered) &&
                models.map((m) => {
                  const p = m.points.find((q) => q.time === hovered.time);
                  return p ? (
                    <circle
                      key={m.id}
                      cx={mid(p)}
                      cy={MY(p.kn)}
                      r={3}
                      fill={modelHue(m.id).wind}
                      className="stroke-ground"
                      strokeWidth={1.5}
                    />
                  ) : null;
                })}
              {hovered &&
                seen(hovered) &&
                models.length > 1 &&
                blend.has(hovered.time) && (
                  <circle
                    cx={mid(hovered)}
                    cy={MY(blend.get(hovered.time)!.kn)}
                    r={3.5}
                    className="fill-ink stroke-ground"
                    strokeWidth={1.5}
                  />
                )}
            </g>
          );
        })()}
      {lower.gusts &&
        (() => {
          const [y, h] = lower.gusts;
          const read = rows.map((r) =>
            r.hour.wind
              ? gustReading(r.hour.wind.wind_kn, r.hour.wind.gust_kn, rider)
              : null,
          );
          return (
            <g data-band="gusts">
              {rated &&
                rows.map((r, i) => {
                  const kind = seen(r) ? read[i]?.kind : undefined;
                  return kind === "costs" || kind === "over" ? (
                    <rect
                      key={i}
                      x={X(r.time)}
                      y={y}
                      width={r.step * px}
                      height={h}
                      className="fill-gust"
                      fillOpacity={kind === "over" ? 0.45 : 0.22}
                    />
                  ) : null;
                })}
              {rows.map((r, i) => {
                const g = read[i];
                return g && third(r) ? (
                  <text
                    key={i}
                    x={mid(r)}
                    y={y + h / 2 + 4}
                    textAnchor="middle"
                    className={`${caption} ${
                      g.kind === "fine" || !rated
                        ? "fill-ink-2"
                        : "fill-ink font-semibold"
                    }`}
                    data-gust-factor={g.text}
                  >
                    <title>
                      {`${g.text}: the gusts ${g.text.slice(0, -1)} times the wind${rated && g.kind !== "fine" ? `, ${GUST_WORDS[g.kind]}` : ""}`}
                    </title>
                    {g.text}
                  </text>
                ) : null;
              })}
            </g>
          );
        })()}
      {lower.current && current.columns.length > 0 && (
        <g data-band="current">
          {rows.map((r, i) => {
            const reading = current.columns[i];
            if (!reading || !third(r)) return null;
            const [y] = lower.current!;
            return (
              <g key={i}>
                {reading.speed >= MIN_ARROW_MS && (
                  <g
                    transform={`translate(${mid(r)},${y + 10}) rotate(${reading.towards})`}
                  >
                    <path
                      d={ARROW}
                      className="fill-none stroke-ink-2"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                )}
                <text
                  x={mid(r)}
                  y={y + 34}
                  textAnchor="middle"
                  className={`fill-ink-2 ${caption}`}
                  data-current={currentFigure(reading.speed, units)}
                >
                  <title>
                    {`${currentText(reading.speed, units)}${reading.speed >= MIN_ARROW_MS ? ` towards ${compass(reading.towards)}` : ""}${current.model ? ` · ${current.model}` : ""}`}
                  </title>
                  {currentFigure(reading.speed, units)}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </>
  );
}

/**
 * The Waves section's bands (`WAVE_BANDS`), on the wind's hours:
 *
 * - Waves: the blended height (the models' median, `waveWeek`) as an area in
 *   the sea's colour, over the band from the lowest model to the highest;
 *   where the blend is missing, the leading model's own height.
 * - Direction: where the sea runs, as the arrow points, and its height.
 * - Period: the peak period, every third hour.
 * - Wave blend: every wave model's own line through its own steps, in its
 *   own colour, the global ones dashed; the blend's in ink where it is
 *   published; and a dotted mark where a model's run ends inside the week.
 * - The swells and the wind sea: the lead model's own split, each its
 *   height as a low area and, every sixth hour, where it runs, how high and
 *   its period. One model's split, never averaged with another's.
 */
function WaveBands({
  rows,
  waves,
  seen,
  apart,
  bands,
  X,
  px,
  W,
  hover,
  end,
  handovers,
}: {
  rows: readonly SpotRow[];
  waves: WaveWeek;
  seen: (row: Pick<SpotRow, "time">) => boolean;
  apart: (a: number, b: number) => boolean;
  bands: Stack<WaveBand>["at"];
  X: (t: number) => number;
  px: number;
  W: number;
  hover: number | null;
  /** The week's end: a run that ends before it is marked where it does. */
  end: number;
  /** Where the headline's model changes (`waveHandovers`). */
  handovers: readonly { time: number; to: string }[];
}) {
  const mid = (r: Pick<SpotRow, "time" | "step">) =>
    X(r.time) + (r.step * px) / 2;
  const caption = "font-body text-caption";
  const third = (r: SpotRow) => dublinHour(r.time) % 3 === 0 && seen(r);
  const sixth = (r: SpotRow) => dublinHour(r.time) % 6 === 3 && seen(r);
  const at = rows
    .map((row, i) => ({
      row,
      w: waves.rows[i],
      held: waves.rows[i]?.held ?? false,
    }))
    .filter(
      (p): p is { row: SpotRow; w: WaveRow; held: boolean } =>
        p.w !== null && p.w.heightM !== null && seen(p.row),
    );
  // Every wave model's height and the blend's on one scale, in half metres.
  const top = Math.max(
    0,
    ...at.map((p) => p.w.highM ?? p.w.heightM!),
    ...waves.lines.flatMap((l) => l.points.map((p) => p.m)),
  );
  const most = Math.max(1.5, Math.ceil(top * 2) / 2);
  const ticks = Array.from(
    { length: Math.floor(most / (most > 3 ? 1 : 0.5)) },
    (_, i) => (i + 1) * (most > 3 ? 1 : 0.5),
  );
  /**
   * Runs of the hours drawn, broken at a gap or a night left out. A `held`
   * hour keeps its run whole, between two of a coarse run's steps, and is not
   * drawn itself: the line goes through the steps.
   */
  const runsOf = <
    T extends { row: Pick<SpotRow, "time" | "step">; held: boolean },
  >(
    items: readonly T[],
  ): T[][] => {
    const out: T[][] = [];
    items.forEach((item, i) => {
      const before = items[i - 1];
      if (
        !before ||
        before.row.time + before.row.step * HOUR < item.row.time ||
        apart(before.row.time, item.row.time)
      )
        out.push([]);
      out.at(-1)!.push(item);
    });
    return out
      .map((run) => run.filter((item) => !item.held))
      .filter((run) => run.length > 1);
  };
  const band = (
    items: readonly { row: SpotRow; w: WaveRow; held: boolean }[],
    y: (m: number) => number,
  ) =>
    runsOf(items.filter((p) => p.w.lowM !== null && p.w.highM !== null))
      .map((run) => {
        const hi = run.map((p) => [mid(p.row), y(p.w.highM!)] as const);
        const lo = run
          .map((p) => [mid(p.row), y(p.w.lowM!)] as const)
          .reverse();
        return `${smoothPath(hi)}L${smoothPath(lo).slice(1)}Z`;
      })
      .join("");
  const hovered = hover === null ? null : rows[hover];
  const hoveredWave = hover === null ? null : waves.rows[hover];
  const scale = (y: number, h: number, ticks: readonly number[]) =>
    ticks.map((m) => {
      const yy = y + h - (m / most) * (h - 4);
      return (
        <g key={m}>
          <line
            x1={0}
            x2={W}
            y1={yy}
            y2={yy}
            className="stroke-line"
            strokeDasharray="2 4"
          />
          <text
            x={W - 6}
            y={yy - 3}
            textAnchor="end"
            className={`fill-ink-muted ${caption}`}
          >
            {m} m
          </text>
        </g>
      );
    });
  return (
    <>
      {bands.waves &&
        (() => {
          const [y, h] = bands.waves;
          const HY = (m: number) => y + h - (Math.min(m, most) / most) * (h - 4);
          const runs = runsOf(at);
          const lines = runs.map((run) =>
            run.map((p) => [mid(p.row), HY(p.w.heightM!)] as const),
          );
          return (
            <g data-band="waves">
              {scale(y, h, ticks)}
              {lines.map((pts, i) => (
                <path
                  key={i}
                  d={`${smoothPath(pts)}L${pts.at(-1)![0]},${y + h}L${pts[0][0]},${y + h}Z`}
                  className="fill-sea-1"
                  fillOpacity={0.9}
                />
              ))}
              <path
                d={band(at, HY)}
                className="fill-ink"
                fillOpacity={0.14}
                data-wave-spread
              />
              <path
                d={lines.map(smoothPath).join("")}
                className="fill-none stroke-depth"
                strokeWidth={2}
                data-wave-height
              />
              {/* Where the headline's model changes: its run has ended. */}
              {handovers.map((change) => (
                <g key={change.time} data-wave-handover={change.to}>
                  <line
                    x1={X(change.time)}
                    x2={X(change.time)}
                    y1={y - 6}
                    y2={(bands.wdir ?? bands.waves!)[0] + 40}
                    className="stroke-ink-muted"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={X(change.time) + 6}
                    y={y + 6}
                    className={`fill-ink-muted ${caption}`}
                  >
                    {waveModelName(change.to)} from here
                  </text>
                </g>
              ))}
              {hovered && hoveredWave?.heightM != null && seen(hovered) && (
                <circle
                  cx={mid(hovered)}
                  cy={HY(hoveredWave.heightM)}
                  r={4}
                  className="fill-depth stroke-ground"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })()}
      {bands.wdir &&
        (() => {
          const [y] = bands.wdir;
          return (
            <g data-band="wave-direction">
              {at
                .filter((p) => third(p.row) && !p.held)
                .map(({ row, w }, i) => (
                  <g key={i}>
                    {w.from !== null && (
                      <g
                        transform={`translate(${mid(row)},${y + 9}) rotate(${w.from + 180})`}
                      >
                        <path
                          d={ARROW}
                          className="fill-none stroke-depth"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    )}
                    <text
                      x={mid(row)}
                      y={y + 34}
                      textAnchor="middle"
                      className="fill-ink font-body text-body font-semibold"
                      data-wave-height={w.heightM!.toFixed(1)}
                    >
                      {w.heightM!.toFixed(1)}
                    </text>
                  </g>
                ))}
            </g>
          );
        })()}
      {bands.period &&
        (() => {
          const [y, h] = bands.period;
          return (
            <g data-band="period">
              {at
                .filter(
                  (p) => third(p.row) && !p.held && p.w.periodS !== null,
                )
                .map(({ row, w }, i) => (
                  <text
                    key={i}
                    x={mid(row)}
                    y={y + h / 2 + 4}
                    textAnchor="middle"
                    className={`fill-ink-2 ${caption}`}
                    data-wave-period={Math.round(w.periodS!)}
                  >
                    {Math.round(w.periodS!)}s
                  </text>
                ))}
            </g>
          );
        })()}
      {bands.wblend &&
        (() => {
          const [y, h] = bands.wblend;
          const BY = (m: number) => y + h - (Math.min(m, most) / most) * (h - 4);
          const blended = at
            .filter((p) => p.w.blendM !== null)
            .map((p) => ({ ...p, held: p.w.blendHeld }));
          // How far the longest run reaches in the hours drawn: a run that
          // ends there is cut by the graph, not ended.
          const reach = Math.max(...waves.lines.map((l) => l.last));
          return (
            <g data-band="wave-blend">
              {scale(
                y,
                h,
                ticks.filter((m) => m < most),
              )}
              <path d={band(at, BY)} className="fill-ink" fillOpacity={0.06} />
              {waves.lines.map((l) => {
                const points = l.points.filter(seen);
                // Through its own steps alone: a three-hourly model's line
                // goes from step to step, and breaks across a night left out.
                const lines: (readonly [number, number])[][] = [];
                points.forEach((p, i) => {
                  const before = points[i - 1];
                  if (
                    !before ||
                    p.time - before.time > 6 * HOUR ||
                    apart(before.time, p.time)
                  )
                    lines.push([]);
                  lines.at(-1)!.push([mid(p), BY(p.m)]);
                });
                return (
                  <path
                    key={l.id}
                    d={lines
                      .filter((run) => run.length > 1)
                      .map(smoothPath)
                      .join("")}
                    className={`fill-none ${waveHue(l.id).stroke}`}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={DASHED.has(l.id) ? DASH : undefined}
                    data-model={l.id}
                  />
                );
              })}
              {blended.length > 1 && (
                <path
                  d={runsOf(blended)
                    .map((run) =>
                      smoothPath(
                        run.map((p) => [mid(p.row), BY(p.w.blendM!)] as const),
                      ),
                    )
                    .join("")}
                  className="fill-none stroke-ink"
                  strokeWidth={2.2}
                  strokeLinejoin="round"
                  data-blend
                />
              )}
              {/* Where a model's run ends inside the week: past it, the
                  blend is made of the models that are left. */}
              {waves.lines
                .filter(
                  (l) =>
                    l.last + 3 * HOUR < reach &&
                    l.last + 3 * HOUR < end &&
                    l.last > (rows[0]?.time ?? 0) &&
                    seen({ time: l.last }),
                )
                .map((l) => {
                  const x = X(l.last) + px / 2;
                  return (
                    <g key={l.id} data-run-end={l.id}>
                      <line
                        x1={x}
                        x2={x}
                        y1={y - 4}
                        y2={y + h}
                        className="stroke-ink-muted"
                        strokeDasharray="3 4"
                      />
                      <circle
                        cx={x}
                        cy={y + 2}
                        r={3}
                        className={waveHue(l.id).fill}
                      />
                      <text
                        x={x + 7}
                        y={y + 6}
                        className={`fill-ink-muted ${caption}`}
                      >
                        {waveEndName(l.id)} ends
                      </text>
                    </g>
                  );
                })}
              {hovered &&
                seen(hovered) &&
                waves.lines.map((l) => {
                  const own = hoveredWave?.models[l.id];
                  return own ? (
                    <circle
                      key={l.id}
                      cx={mid(hovered)}
                      cy={BY(own.height_m)}
                      r={3}
                      className={`${waveHue(l.id).fill} stroke-ground`}
                      strokeWidth={1.5}
                    />
                  ) : null;
                })}
              {hovered &&
                seen(hovered) &&
                hoveredWave?.blendM != null && (
                  <circle
                    cx={mid(hovered)}
                    cy={BY(hoveredWave.blendM)}
                    r={3.5}
                    className="fill-ink stroke-ground"
                    strokeWidth={1.5}
                  />
                )}
            </g>
          );
        })()}
      {PART_ROWS.map(([key]) => {
        const at2 = bands[key];
        if (!at2) return null;
        const [y, h] = at2;
        const PY = (m: number) => y + h - (Math.min(m, most) / most) * (h - 18);
        const parts = rows
          .map((row, i) => ({
            row,
            part: partOf(waves.rows[i], key),
            held: waves.rows[i]?.held ?? false,
          }))
          .filter(
            (p): p is { row: SpotRow; part: WavePartHour; held: boolean } =>
              p.part !== null && seen(p.row),
          );
        const lines = runsOf(parts).map((run) =>
          run.map((p) => [mid(p.row), PY(p.part.heightM!)] as const),
        );
        return (
          <g key={key} data-band={key}>
            {lines.map((pts, i) => (
              <path
                key={i}
                d={`${smoothPath(pts)}L${pts.at(-1)![0]},${y + h}L${pts[0][0]},${y + h}Z`}
                className="fill-sea-1"
                fillOpacity={0.55}
              />
            ))}
            <path
              d={lines.map(smoothPath).join("")}
              className="fill-none stroke-depth"
              strokeWidth={1.2}
            />
            {parts
              .filter((p) => sixth(p.row) && !p.held)
              .map(({ row, part }, i) => (
                <g key={i}>
                  {part.from !== null && (
                    <g
                      transform={`translate(${mid(row) - 17},${y + 8}) rotate(${part.from + 180}) scale(0.85)`}
                    >
                      <path
                        d={ARROW}
                        className="fill-none stroke-depth"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  )}
                  <text
                    x={mid(row) - 6}
                    y={y + 12}
                    className={`fill-ink-2 ${caption}`}
                    data-part={key}
                  >
                    <tspan className="fill-ink font-semibold">
                      {part.heightM!.toFixed(1)}
                    </tspan>
                    {part.periodS !== null && ` ${Math.round(part.periodS)}s`}
                  </text>
                </g>
              ))}
          </g>
        );
      })}
    </>
  );
}

function Readout({
  row,
  chip,
  depth,
  rated,
  gust,
  current,
  rain,
  hasCurrent,
  hasDepth,
  unlit,
  measured = null,
  sea,
  strip,
  root,
}: {
  row: SpotRow | null;
  /** The hour's chip, first in the grid on a desktop; a phone's is above. */
  chip: React.ReactNode;
  depth: number | null;
  rated: boolean;
  gust: GustReading | null;
  current: CurrentReading | null;
  /** The row's rain, mm/h, or null where no total covers it. */
  rain: number | null;
  /** The place has a current, and a launch with a depth, at any hour. */
  hasCurrent: boolean;
  hasDepth: boolean;
  /**
   * What an hour the sun is not up in is called: dark, or with the night
   * left out the twilight, the one such hour still shown.
   */
  unlit: "Dark" | "Twilight";
  /**
   * At Now, the paired station's latest reading, fresh: the wind cell says
   * it, and where it is from, in place of the forecast's.
   */
  measured?: MeasuredReading | null;
  /**
   * The sea at the hour, as the Waves section has it, on one line; null
   * where no wave model reaches the hour, and undefined (no cell) on water
   * the open sea's waves do not reach.
   */
  sea?: WaveRow | null;
  /** On a phone, the wind blend's models and blend (`BlendStrip`). */
  strip: React.ReactNode;
  /** The readout the page's tests and tools find as `[data-readout]`. */
  root: boolean;
}) {
  const speed = useSpeed();
  const units = useContext(UnitsContext);
  const s = styles();
  const wind = row?.hour.wind;
  const gustKn = wind ? speed.gust(wind.wind_kn, wind.gust_kn) : null;
  const beside = row?.rating ? besideMark(row) : null;
  const taken = row && !row.rating ? standIn(row) : null;
  // Every reading the place has, in a cell of its own that holds its place
  // whatever the hour: an hour without one reads "–", so nothing moves as
  // the hours are scrubbed through. Before the hours are read the cells
  // stand empty, at the height they will have.
  return (
    <div
      className={s.readout()}
      data-readout={root || undefined}
      data-wind-readout
    >
      {chip && <div className={s.ro()}>{chip}</div>}
      <div className={s.ro({ className: s.roWide() })} data-readout-wind>
        <span className={s.roLabel()}>
          Wind
          {measured && (
            <span className={s.roSource()} data-readout-source>
              {" "}
              · {pairedName(measured.paired)},{" "}
              {measuredAt(measured.reading.time)}
            </span>
          )}
        </span>
        <b
          className={s.roValue()}
          data-measured={measured ? measured.paired.station.id : undefined}
        >
          {measured ? (
            <>
              {speed.say(measured.reading.windKn)}
              {speed.gust(measured.reading.windKn, measured.reading.gustKn) !==
                null && (
                <span className="text-gust">
                  {" "}
                  g
                  {speed.say(
                    speed.gust(
                      measured.reading.windKn,
                      measured.reading.gustKn,
                    )!,
                  )}
                </span>
              )}{" "}
              {speed.unit}
              {measured.reading.from !== null &&
                ` ${compass(measured.reading.from)}`}
            </>
          ) : wind ? (
            <>
              {speed.say(wind.wind_kn)}
              {gustKn !== null && (
                <span className="text-gust"> g{speed.say(gustKn)}</span>
              )}{" "}
              {speed.unit} {compass(wind.direction_deg)}
            </>
          ) : (
            "–"
          )}
        </b>
      </div>
      {rated && (
        // Two wide on a phone, where one cell has no room for the five
        // stars and a warning's mark beside them.
        <div className={s.ro({ className: "max-wide:col-span-2" })}>
          <span className={s.roLabel()}>Stars</span>
          {row?.rating ? (
            <span className={s.roMarks()}>
              <Stars n={row.rating.stars} />
              {beside && <NoticeMark level={beside} />}
            </span>
          ) : taken ? (
            <span className={s.roMarks()} title={taken.word}>
              <NoticeMark level={taken.level} className="min-w-0">
                <span className="truncate">{taken.word}</span>
              </NoticeMark>
            </span>
          ) : (
            <b className={s.roValue()}>
              {!row || row.hour.daylight ? "–" : unlit}
            </b>
          )}
        </div>
      )}
      {strip}
      <div className={s.ro()} data-readout-gust>
        <span className={s.roLabel()}>Gusts</span>
        <b
          className={s.roValue()}
          title={rated && gust ? GUST_WORDS[gust.kind] : undefined}
        >
          {gust?.text ?? "–"}
        </b>
      </div>
      {/* On a phone the blend's strip names every model's wind instead. */}
      <div className={s.ro({ className: strip ? "hidden" : undefined })}>
        <span className={s.roLabel()}>Wind models</span>
        <b className={s.roValue()}>
          {wind && wind.models > 1
            ? `${speed.say(wind.min_kn)}–${speed.say(wind.max_kn)}`
            : "–"}
          {wind && wind.models > 1 && speed.unit && (
            <span className="font-normal text-ink-2"> {speed.unit}</span>
          )}
        </b>
      </div>
      {rated && (
        <div className={s.ro()}>
          <span className={s.roLabel()}>Wing</span>
          <b className={s.roValue()}>
            {row?.rating
              ? `${row.rating.wing.own ?? row.rating.wing.recommended} m²`
              : "–"}
          </b>
        </div>
      )}
      <div className={s.ro()} data-readout-rain>
        <span className={s.roLabel()}>Rain</span>
        <b className={s.roValue()}>
          {rain === null
            ? "–"
            : rain < DRY_MM_PER_HOUR
              ? "Dry"
              : `${rain < 0.1 ? "<0.1" : rain.toFixed(1)} mm/h`}
        </b>
      </div>
      {hasDepth && (
        <div className={s.ro()}>
          <span className={s.roLabel()}>At the launch</span>
          <b
            className={s.roValue({
              className: depth !== null && depth < 1 ? s.off() : undefined,
            })}
          >
            {depth === null ? "–" : `${depth.toFixed(1)} m`}
          </b>
        </div>
      )}
      {sea !== undefined && (
        <div className={s.ro({ className: s.roWide() })} data-readout-sea>
          <span className={s.roLabel()}>Sea</span>
          <b className={s.roValue()}>
            <SeaLine at={sea} />
          </b>
        </div>
      )}
      {hasCurrent && (
        <div className={s.ro({ className: s.roWide() })} data-readout-current>
          <span className={s.roLabel()}>Current</span>
          <b className={s.roValue()}>
            {current ? (
              <>
                {currentText(current.speed, units)}
                {current.speed >= MIN_ARROW_MS && (
                  <span className="font-normal text-ink-2">
                    {" "}
                    to {compass(current.towards)}
                  </span>
                )}
              </>
            ) : (
              "–"
            )}
          </b>
        </div>
      )}
    </div>
  );
}

/** The sea on one line: "1.2 m 13 s from W". */
function SeaLine({ at }: { at: WaveRow | null }) {
  if (!at || at.heightM === null) return <>–</>;
  return (
    <>
      {at.heightM.toFixed(1)} m
      {(at.periodS !== null || at.from !== null) && (
        <span className="font-normal text-ink-2">
          {at.periodS !== null && ` ${Math.round(at.periodS)} s`}
          {at.from !== null && ` from ${compass(at.from)}`}
        </span>
      )}
    </>
  );
}

/** A partition on one line: "1.3 m 12 s W". */
function PartLine({ part }: { part: WavePartHour | null }) {
  if (!part || part.heightM === null) return <>–</>;
  return (
    <>
      {part.heightM.toFixed(1)} m
      {(part.periodS !== null || part.from !== null) && (
        <span className="font-normal text-ink-2">
          {part.periodS !== null && ` ${Math.round(part.periodS)} s`}
          {part.from !== null && ` ${compass(part.from)}`}
        </span>
      )}
    </>
  );
}

/**
 * The Waves section's readout: the sea at the hour, the models' range, and
 * the swells and the wind sea. Never the wind: that is the Wind section's.
 */
function WaveReadout({
  row,
  waves,
  chip,
  partitions,
  strip,
}: {
  row: SpotRow | null;
  waves: WaveRow | null;
  chip: React.ReactNode;
  /** The partitions the week has, in the bands' order. */
  partitions: readonly PartRow[];
  /** On a phone, the wave blend's models and blend (`BlendStrip`). */
  strip: React.ReactNode;
}) {
  const s = styles();
  const range =
    waves && waves.lowM !== null && waves.highM !== null && waves.highM > waves.lowM
      ? `${waves.lowM.toFixed(1)}–${waves.highM.toFixed(1)}`
      : null;
  return (
    <div className={s.readout()} data-wave-readout>
      {chip && <div className={s.ro()}>{chip}</div>}
      <div className={s.ro({ className: s.roWide() })} data-readout-waves>
        <span className={s.roLabel()}>
          Waves
        </span>
        <b className={s.roValue()}>
          <SeaLine at={row ? waves : null} />
        </b>
      </div>
      <div
        className={s.ro({ className: strip ? "col-span-2" : undefined })}
        data-readout-wave-models
      >
        <span className={s.roLabel()}>Wave models</span>
        <b className={s.roValue()}>
          {range ?? "–"}
          {range && <span className="font-normal text-ink-2"> m</span>}
        </b>
      </div>
      {strip}
      {partitions.length > 0 && (
        // Three to a row on a phone; each two cells wide on a desktop.
        <div className={s.parts()}>
          {partitions.map((key) => (
            <div
              key={key}
              className={s.ro({ className: "wide:col-span-2" })}
              data-readout-part={key}
            >
              <span className={s.roLabel()}>{WAVE_NAME[key]}</span>
              <b className={s.roValue()}>
                <PartLine part={partOf(waves, key)} />
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HourTable({
  forecast,
  rows,
  date,
  now,
  depthAt,
  rider,
  rated,
  rain,
}: {
  forecast: SpotForecast;
  rows: SpotRow[];
  date: string;
  now: number;
  depthAt: (t: number) => number | null;
  rider: Rider;
  /** False at a point on the open water: no stars, no wing, no launch. */
  rated: boolean;
  rain: ReadonlyMap<number, number>;
}) {
  const speed = useSpeed();
  const s = styles();
  const light = rows.filter((r) => r.hour.daylight);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className={s.table()} data-hour-table>
        <thead>
          <tr>
            <th className={s.th()}>{date ? dayNames(date, now).long : ""}</th>
            {rated && <th className={s.th()}>Stars</th>}
            <th className={s.th()}>Wind {speed.unit}</th>
            <th className={s.th({ className: s.narrow() })}>Gusts</th>
            <th className={s.th()}>From</th>
            {/* A point reads one model an hour: no range to give. */}
            {rated && (
              <th className={s.th({ className: s.narrow() })}>Models</th>
            )}
            {rated && <th className={s.th({ className: s.narrow() })}>Wing</th>}
            <th className={s.th()}>Sea</th>
            <th className={s.th({ className: s.narrow() })}>Period</th>
            {rated && <th className={s.th()}>Launch</th>}
            <th className={s.th({ className: s.narrow() })}>Air</th>
            <th className={s.th({ className: s.narrow() })}>Rain mm/h</th>
          </tr>
        </thead>
        <tbody>
          {light.map((r) => {
            const w = r.hour.wind;
            const d = depthAt(r.time);
            const g = w ? gustReading(w.wind_kn, w.gust_kn, rider) : null;
            const wet = rowRain(rain, r);
            return (
              <tr
                key={r.time}
                data-hour={new Date(r.time).toISOString()}
                className={
                  !rated || r.rating?.stars ? undefined : "text-ink-muted"
                }
              >
                <td className={s.td()}>{clock(r.time)}</td>
                {rated && <StarsCell row={r} forecast={forecast} />}
                <td className={s.td()}>
                  <b className="font-semibold text-ink">
                    {w ? speed.say(w.wind_kn) : "–"}
                  </b>
                  {w && speed.gust(w.wind_kn, w.gust_kn) !== null && (
                    <span className="text-gust">
                      {" "}
                      {speed.say(speed.gust(w.wind_kn, w.gust_kn)!)}
                    </span>
                  )}
                </td>
                <td
                  className={s.td({
                    className: `${s.narrow()} ${
                      rated && g && g.kind !== "fine" ? "text-gust" : ""
                    }`,
                  })}
                  title={rated && g ? GUST_WORDS[g.kind] : undefined}
                  data-gust-cell={g?.kind}
                >
                  {g ? g.text : "–"}
                </td>
                <td
                  className={s.td({
                    className: isOff(r.shore) ? s.off() : undefined,
                  })}
                >
                  {w ? compass(w.direction_deg) : "–"}
                  {shoreWord(r.shore) && ` · ${shoreWord(r.shore)}`}
                </td>
                {rated && (
                  <td className={s.td({ className: s.narrow() })}>
                    {w ? `${speed.say(w.min_kn)}–${speed.say(w.max_kn)}` : "–"}
                  </td>
                )}
                {rated && (
                  <td className={s.td({ className: s.narrow() })}>
                    {r.rating
                      ? `${r.rating.wing.own ?? r.rating.wing.recommended} m²`
                      : "–"}
                  </td>
                )}
                <td className={s.td()}>
                  {r.hour.waves?.height_m == null
                    ? "–"
                    : `${r.hour.waves.height_m.toFixed(1)} m`}
                </td>
                <td className={s.td({ className: s.narrow() })}>
                  {r.hour.waves?.period_s == null
                    ? "–"
                    : `${r.hour.waves.period_s} s`}
                </td>
                {rated && (
                  <td
                    className={s.td({
                      className: d !== null && d < 1 ? s.off() : undefined,
                    })}
                  >
                    {d === null ? "–" : `${d.toFixed(1)} m`}
                  </td>
                )}
                <td className={s.td({ className: s.narrow() })}>
                  {r.hour.weather?.air_c == null
                    ? "–"
                    : `${Math.round(r.hour.weather.air_c)}°`}
                </td>
                <td className={s.td({ className: s.narrow() })} data-rain-cell>
                  {wet === null
                    ? "–"
                    : wet < DRY_MM_PER_HOUR
                      ? "0"
                      : wet < 0.1
                        ? "<0.1"
                        : wet.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An hour's stars in the table: an orange or red Met Éireann warning, or a
 * notice against bathing, stands where the stars were, as its square and one
 * word ("Orange warning", "Water"); a yellow warning or any other notice
 * rides beside them, the square alone. A press says why, in words
 * (ui/RatingTip.tsx).
 */
function StarsCell({
  row,
  forecast,
}: {
  row: SpotRow;
  forecast: SpotForecast;
}) {
  const warned = (row.warning?.ids ?? [])
    .map((id) => forecast.warnings.items.find((item) => item.id === id))
    .filter((item) => item !== undefined)
    .map(warningName)
    .join("; ");
  const watered =
    (row.water?.ids ?? [])
      .map((id) => forecast.water_quality.items.find((item) => item.id === id))
      .filter((item) => item !== undefined)
      .map(noticeWords)
      .join("; ") || "Bathing water notice";
  const taken = standIn(row);
  const beside = besideMark(row);
  const warningWords = row.warning
    ? warned || `${LEVEL_LABEL[row.warning.level]} warning`
    : "";
  const label = `${clock(row.time)}: ${
    taken?.level === "water"
      ? `no stars: ${watered}`
      : taken
        ? `no stars: ${warningWords}`
        : row.rating
          ? starsText(row.rating)
          : row.hour.daylight
            ? "no wind reading"
            : "dark, not rated"
  }${row.warning && !row.warning.replaces_rating ? `; ${warningWords}` : ""}${row.water && taken?.level !== "water" ? `; ${watered}` : ""}`;
  return (
    <td
      className={styles().td()}
      data-stars={row.rating ? row.rating.stars : undefined}
      data-hour-warning={row.warning?.level}
      data-hour-water={
        row.water
          ? row.water.replaces_rating
            ? "replaces"
            : "beside"
          : undefined
      }
    >
      <RatingTip
        label={label}
        detail={
          <div className="grid gap-1.5" data-hour-tip>
            {row.warning && (
              <p className="m-0 flex items-center gap-1.5" data-tip-warning>
                <NoticeMark level={row.warning.level} />
                <span>
                  {warningWords}
                  {row.warning.replaces_rating
                    ? ": no stars while it is in force."
                    : ": the stars stand beside it."}
                </span>
              </p>
            )}
            {row.water && (
              <p className="m-0 flex items-center gap-1.5" data-tip-water>
                <NoticeMark
                  level={row.water.replaces_rating ? "water" : "water-advice"}
                />
                <span>
                  {watered}
                  {row.water.replaces_rating
                    ? ": no stars while it stands."
                    : ": the stars stand beside it."}
                </span>
              </p>
            )}
            <p className="m-0 font-semibold">
              {taken?.level === "water"
                ? "Bathing water notice."
                : taken
                  ? "Met Éireann warning."
                  : row.rating
                    ? starsText(row.rating)
                    : row.hour.daylight
                      ? "No wind reading."
                      : "Dark, not rated."}
            </p>
            {!!row.rating?.reasons.length && (
              <ul className="m-0 pl-4">
                {row.rating.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        }
      >
        {taken ? (
          <NoticeMark level={taken.level}>{taken.word}</NoticeMark>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {row.rating ? <Stars n={row.rating.stars} size={12} /> : "–"}
            {beside && <NoticeMark level={beside} />}
          </span>
        )}
      </RatingTip>
    </td>
  );
}
