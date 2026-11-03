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
import { modelHue } from "../../../force5/src/manifests";
import { POINT_SOURCE_KM } from "../../../force5/src/pointSource";
import { rainTint, DRY_MM_PER_HOUR } from "../../../force5/src/rain";
import { shoreFacing } from "../../../force5/src/shoreFacing";
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
import { RatingTip } from "../../../ui/RatingTip";
import { starsText } from "../../../force5/src/stars";
import { warningName } from "../Warnings";
import { noticeWords, restrictionShort } from "../WaterQuality";
import { RING, tv } from "../../../ui/tv";
import { SkyGlyph } from "../glyphs";
import { lift, pictureCredit, type PictureTide } from "../satellite";
import {
  FORECAST_DAYS,
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
import { ClimateSections } from "./ClimateSections";
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
    week: "grid grid-cols-week gap-2 overflow-x-auto",
    day: [
      "grid content-start gap-2 rounded-surface border-0 bg-sunken on-card p-3.5 text-left text-ink",
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
    roLabel:
      "font-body text-caption font-medium whitespace-nowrap text-ink-muted wide:text-body",
    // One line of a fixed height, whatever it holds: a figure, a dash, the
    // stars or a notice, so no row grows or shrinks with the hour.
    roValue:
      "block h-5 truncate font-body text-body leading-5 font-semibold whitespace-nowrap text-ink tabular-nums wide:h-6 wide:text-prose wide:leading-6",
    roMarks: "flex h-5 min-w-0 items-center gap-1.5 overflow-hidden wide:h-6",
    // The band names in a column of their own beside the hours; on a phone
    // they float over the hours' left edge instead, so the graph has the
    // card's whole width.
    gbox: "relative grid grid-cols-1 rounded-surface bg-sunken on-card py-1.5 wide:grid-cols-graph",
    gl: "max-wide:pointer-events-none max-wide:absolute max-wide:inset-y-1.5 max-wide:left-0 max-wide:z-1 wide:relative",
    glName: [
      "absolute left-4 -translate-y-1/2 font-body text-caption font-medium whitespace-nowrap text-ink-muted",
      "max-wide:left-1.5 max-wide:rounded-control max-wide:bg-sunken/85 max-wide:px-1 max-wide:text-eyebrow",
    ],
    graph:
      "relative overflow-x-auto overscroll-x-contain border-0 border-line wide:border-l",
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

const isOff = (row: SpotRow | null) =>
  row?.shore === "offshore" || row?.shore === "cross-off";
const shoreWord = (row: SpotRow | null) =>
  !row?.shore ? null : row.shore === "cross" ? "cross-shore" : row.shore;

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
  now,
  at = null,
  blendModels = [],
  point = null,
  actions,
  notices,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
  rider: Rider;
  units: Units;
  now: number;
  /**
   * The hour the week opens at (`?at=`), as if the rider had put the pointer
   * on it; null, or an hour the week does not hold, opens it on now.
   */
  at?: number | null;
  /** The models the rider blends (Settings): the Models band's lines. */
  blendModels?: readonly string[];
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
        .slice(0, FORECAST_DAYS)
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
  const [firstNow] = useState(now);
  const nearby = useNearby(forecast.nearby, rider, firstNow);
  // The hour the address opens the week at, while the rows hold it: the
  // row it falls in, focused as a pointer resting on it would focus it.
  const [opening] = useState(() => (at === null ? null : rowIndexAt(rows, at)));
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

  const nowRow = rowAt(rows, now);
  const shown = focus === null ? nowRow : rowAt(rows, focus);
  const scale = useMemo(() => roseScale(units), [units]);
  const loupe = shown?.hour.wind
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
                <span className={s.foot()} data-loupe-foot>
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
                        {shoreWord(shown) ?? loupe.relation.toLowerCase()}
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
              The week
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
              rider={rider}
              rated={!point}
              models={models}
              current={current}
              rain={rain}
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
}) {
  const speed = useSpeed();
  const s = styles();
  const wind = row?.hour.wind ?? null;
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
        <span className={s.label()}>Wind now</span>
        {wind ? (
          <>
            <div className={s.big()}>
              {speed.say(wind.wind_kn)}
              {speed.gust(wind.wind_kn, wind.gust_kn) !== null && (
                <span className={s.gust()}>
                  g{speed.say(speed.gust(wind.wind_kn, wind.gust_kn)!)}
                </span>
              )}
              {speed.unit && <span className={s.unit()}>{speed.unit}</span>}
            </div>
            <div
              className={s.line({
                className: isOff(row) ? s.off() : undefined,
              })}
            >
              {compass(wind.direction_deg)}
              {shoreWord(row) && ` · ${shoreWord(row)}`}
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

const ROW = {
  stars: [14, 8],
  wind: [34, 118],
  dir: [160, 40],
  sea: [208, 46],
  tide: [266, 74],
  sky: [352, 28],
} as const;

/**
 * The bands under the sky, each a row of the chart's old dock carried here
 * when the dock gave way to the chart's scrub bar: the rain, every model's own
 * wind, how gusty each hour is, the waves' period and direction, and the
 * current. They share the graph's hours, its scroll, its nights and its
 * pointer, so an hour reads straight down. A point on the water reads one
 * model at a time, so it has no Models band.
 */
const LOWER = [
  ["rain", 34],
  ["models", 72],
  ["gusts", 20],
  ["waves", 38],
  ["current", 38],
] as const;
type LowerBand = (typeof LOWER)[number][0];
const LOWER_TOP = 396;
const BAND_GAP = 14;

/** Where each lower band sits, the hours axis under the last, and the height. */
function lowerBands(withModels: boolean) {
  const at: Partial<Record<LowerBand, readonly [number, number]>> = {};
  let y = LOWER_TOP;
  for (const [band, h] of LOWER) {
    if (band === "models" && !withModels) continue;
    at[band] = [y, h];
    y += h + BAND_GAP;
  }
  const axis = y - BAND_GAP + 8;
  return { at, axis, height: axis + 22 };
}

/** An arrow pointing up, turned to a bearing: the wind's, the sea's, the water's. */
const ARROW = "M0 6V-6M-3.5 -2.5L0 -6.5l3.5 4";

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
  rider,
  rated,
  models,
  current,
  rain,
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
  rider: Rider;
  /** False at a point on the open water: no stars, so no star row or tint. */
  rated: boolean;
  models: readonly ModelSeries[];
  current: SpotCurrents;
  /** The rain in each hour, mm/h, by the hour's time (`rainPerHour`). */
  rain: ReadonlyMap<number, number>;
}) {
  const speed = useSpeed();
  const units = useContext(UnitsContext);
  const s = styles();
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const [hover, setHover] = useState<number | null>(opening);
  useEffect(
    () => onFocus(hover === null ? null : (rows[hover]?.time ?? null)),
    [hover, rows, onFocus],
  );
  const lower = lowerBands(models.length > 0);
  const GH = lower.height;
  const start = days[0]?.midnight ?? now;
  const end = (days.at(-1)?.midnight ?? now) + 24 * HOUR;
  const hours = (end - start) / HOUR;
  const daysShown =
    width < 600 ? 0 : Math.max(3, Math.min(7, Math.floor(width / 330)));
  const px = width < 600 ? 18 : width / (daysShown * 24);
  const W = Math.max(width, hours * px);
  const X = (t: number) => ((t - start) / HOUR) * px;
  useEffect(() => {
    if (!scrollTo || !ref.current) return;
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
    const t = start + (x / px) * HOUR;
    let at = 0;
    rows.forEach((r, i) => {
      if (r.time <= t) at = i;
    });
    return at;
  };
  useEffect(() => {
    if (!ref.current) return;
    const opened = opening === null ? null : rows[opening];
    ref.current.scrollLeft = phone
      ? // The hour the address opens on, else now, under the playhead.
        Math.max(0, leftFor(opened ? mid(opened) : X(now)))
      : // The hour the address opens on, a third of the way in, as the
        // hours before it are worth a glance; else now, six hours in.
        Math.max(0, opened ? X(opened.time) - width / 3 : X(now) - px * 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);
  // With a mouse the hour read out is the one under the pointer, and stays
  // so as a wheel or a trackpad scrolls the hours along under it.
  const pointerX = useRef<number | null>(null);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (phone) setHover(rowAtX(headAt(el.scrollLeft)));
    else if (pointerX.current !== null)
      setHover(
        rowAtX(
          pointerX.current -
            el.getBoundingClientRect().left -
            el.clientLeft +
            el.scrollLeft,
        ),
      );
  };
  const windRows = rows.filter((r) => r.hour.wind);
  const [wy, wh] = ROW.wind;
  const Y = (k: number) => wy + wh - (Math.min(k, 36) / 36) * wh;
  const mid = (r: SpotRow) => X(r.time) + (r.step * px) / 2;
  const mean = windRows.map((r) => [mid(r), Y(r.hour.wind!.wind_kn)] as const);
  const top = windRows.map((r) => [mid(r), Y(r.hour.wind!.max_kn)] as const);
  const bot = windRows
    .map((r) => [mid(r), Y(r.hour.wind!.min_kn)] as const)
    .reverse();
  const gust = windRows
    .filter((r) => r.hour.wind!.gust_kn !== null)
    .map((r) => [mid(r), Y(r.hour.wind!.gust_kn!)] as const);
  const [sy, sh] = ROW.sea;
  const SY = (m: number) => sy + sh - (Math.min(m, 2) / 2) * (sh - 4);
  const seaRows = rows.filter((r) => r.hour.waves?.height_m != null);
  const sea = seaRows.map(
    (r) => [mid(r), SY(r.hour.waves!.height_m!)] as const,
  );
  const [ty, th] = ROW.tide;
  const tideMax = Math.max(4.5, ...turns.map((t) => t.height)) + 0.3;
  const TY = (m: number) => ty + th - (m / tideMax) * (th - 6);
  const curve = tideCurve(turns, start, end, 30).map(
    (p) => [X(p.time), TY(p.height)] as const,
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
  const shownRow = hoverRow ?? rowAt(rows, now);
  const shownAt = shownRow ? rows.indexOf(shownRow) : -1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    pointerX.current = e.clientX;
    const box = e.currentTarget.getBoundingClientRect();
    setHover(rowAtX(e.clientX - box.left));
  };
  const onLeave = () => {
    pointerX.current = null;
    setHover(null);
  };
  // Now is said as now, however it came to be under the playhead.
  const isNow = hoverRow === null || hoverRow === rowAt(rows, now);
  return (
    <>
      <div className={s.tools()}>
        <Readout
          row={shownRow}
          isNow={isNow}
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
        />
      </div>
      <div className={s.gbox()}>
        <div className={s.gl()} style={{ height: GH }}>
          {(
            [
              ...(rated ? [["Stars", ROW.stars[0] + 4] as const] : []),
              ["Wind", ROW.wind[0] + 40],
              ["Direction", ROW.dir[0] + 12],
              ["Sea", ROW.sea[0] + 26],
              ["Tide", ROW.tide[0] + 36],
              ["Sky", ROW.sky[0] + 14],
              ...LOWER.flatMap(([band]) => {
                const at = lower.at[band];
                return at ? [[LOWER_NAME[band], at[0] + at[1] / 2 - 6]] : [];
              }),
            ] as (readonly [string, number])[]
          ).map(([name, y]) => (
            <span key={name} className={s.glName()} style={{ top: y + 6 }}>
              {name}
            </span>
          ))}
        </div>
        <div
          className={s.graph()}
          ref={ref}
          onScroll={onScroll}
          data-spot-graph
          data-playhead={phone || undefined}
        >
          <svg
            width={W}
            height={GH}
            viewBox={`0 0 ${W} ${GH}`}
            onPointerMove={phone ? undefined : onMove}
            onPointerLeave={phone ? undefined : onLeave}
            className="block touch-pan-x"
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
            {days.map(({ sun, midnight }, i) => (
              <g key={i}>
                {sun.firstLight && (
                  <rect
                    x={X(midnight)}
                    y={0}
                    width={X(sun.firstLight) - X(midnight)}
                    height={GH - 22}
                    className="fill-ink"
                    fillOpacity={0.045}
                  />
                )}
                {sun.lastLight && (
                  <rect
                    x={X(sun.lastLight)}
                    y={0}
                    width={X(midnight + 24 * HOUR) - X(sun.lastLight)}
                    height={GH - 22}
                    className="fill-ink"
                    fillOpacity={0.045}
                  />
                )}
                {i > 0 && (
                  <line
                    x1={X(midnight)}
                    x2={X(midnight)}
                    y1={0}
                    y2={GH}
                    className="stroke-line"
                  />
                )}
              </g>
            ))}
            {rows.map((r, i) =>
              r.rating ? (
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
            {top.length > 1 && (
              <path
                d={`${smoothPath(top)}L${smoothPath(bot).slice(1)}Z`}
                className="fill-ink"
                fillOpacity={0.07}
              />
            )}
            {mean.length > 1 && (
              <>
                <path
                  d={`${smoothPath(mean)}L${mean.at(-1)![0]},${wy + wh}L${mean[0][0]},${wy + wh}Z`}
                  fill="url(#spot-wind)"
                  fillOpacity={0.78}
                />
                <path
                  d={smoothPath(mean)}
                  fill="none"
                  stroke="url(#spot-wind)"
                  strokeWidth={2.2}
                />
              </>
            )}
            {gust.length > 1 && (
              <path
                d={smoothPath(gust)}
                className="fill-none stroke-gust"
                strokeWidth={1.6}
                strokeDasharray="4 3"
              />
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
                        isOff(r)
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
            {sea.length > 1 && (
              <path
                d={`${smoothPath(sea)}L${sea.at(-1)![0]},${sy + sh}L${sea[0][0]},${sy + sh}Z`}
                className="fill-sea-1"
                fillOpacity={0.9}
              />
            )}
            {curve.length > 1 && (
              <>
                <path
                  d={`${smoothPath(curve)}L${curve.at(-1)![0]},${ty + th}L${curve[0][0]},${ty + th}Z`}
                  className="fill-sea-3"
                />
                {deepAt !== null && (
                  <path
                    d={`${smoothPath(curve)}L${curve.at(-1)![0]},${ty + th}L${curve[0][0]},${ty + th}Z`}
                    className="fill-depth"
                    fillOpacity={0.9}
                    clipPath="url(#spot-deep)"
                  />
                )}
                <path
                  d={smoothPath(curve)}
                  className="fill-none stroke-ink-2"
                  strokeWidth={1.4}
                />
              </>
            )}
            {turns
              .filter((t) => t.time >= start && t.time <= end)
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
              lower={lower.at}
              X={X}
              px={px}
              W={W}
              hover={hover}
              rider={rider}
              rated={rated}
              models={models}
              current={current}
              rain={rain}
              units={units}
            />
            {Array.from(
              { length: Math.ceil(hours / 6) },
              (_, i) => start + i * 6 * HOUR,
            )
              .filter((t) => dublinHour(t) % 24 !== 0)
              .map((t) => (
                <text
                  key={t}
                  x={X(t)}
                  y={ay + 14}
                  textAnchor="middle"
                  className="fill-ink-muted font-body text-caption"
                >
                  {String(dublinHour(t)).padStart(2, "0")}
                </text>
              ))}
            {days.map(({ day, midnight }, i) => (
              <text
                key={i}
                x={X(midnight) + 8}
                y={ay + 14}
                className="fill-ink font-body text-caption font-semibold"
              >
                {dayNames(day.date, now).relative === "Today"
                  ? "Today"
                  : dayNames(day.date, now).short}{" "}
                {Number(day.date.slice(8, 10))}
              </text>
            ))}
            {handovers.map((h, i) => (
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
            <line
              x1={X(now)}
              x2={X(now)}
              y1={4}
              y2={ay}
              className="stroke-pen"
              strokeWidth={1.5}
            />
            {hoverRow && (
              <g>
                <rect
                  x={X(hoverRow.time)}
                  y={4}
                  width={hoverRow.step * px}
                  height={ay - 4}
                  rx={Math.min(6, px / 2)}
                  className="fill-ink"
                  fillOpacity={0.07}
                />
                {phone && (
                  <line
                    x1={mid(hoverRow)}
                    x2={mid(hoverRow)}
                    y1={4}
                    y2={ay}
                    className="stroke-ink"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    data-playhead-line
                  />
                )}
                {hoverRow.hour.wind && (
                  <circle
                    cx={mid(hoverRow)}
                    cy={Y(hoverRow.hour.wind.wind_kn)}
                    r={4}
                    fill={windCss(hoverRow.hour.wind.wind_kn)}
                    className="stroke-ground"
                    strokeWidth={2}
                  />
                )}
              </g>
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
            .filter((r) => r.hour.weather && dublinHour(r.time) % 3 === 0)
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
      </div>
      {/* The key, in groups as the graph's bands run, each mark drawn as
          the graph draws it. */}
      <div className={s.legend()} data-legend>
        <KeyGroup name="Wind">
          <KeyItem mark="wind">Wind</KeyItem>
          <KeyItem mark="gust">Gust</KeyItem>
          {/* A point reads one model an hour: nothing to disagree. */}
          {rated && <KeyItem mark="spread">Where models disagree</KeyItem>}
        </KeyGroup>
        {rated && (
          <KeyGroup name="Gusts">
            <KeyItem mark="costs">Costs a star</KeyItem>
            <KeyItem mark="over">Past too much: no stars</KeyItem>
          </KeyGroup>
        )}
        <KeyGroup name="Sea" wide>
          <KeyItem mark="waves">Waves: where they run, period in s</KeyItem>
          <KeyItem mark="current">
            Current: where it runs, in {unitLabel(currentUnits(units))}
          </KeyItem>
          {deepAt !== null && (
            <KeyItem mark="depth">1 m of water or more at the launch</KeyItem>
          )}
        </KeyGroup>
        <KeyGroup name="Sky">
          <KeyItem mark="dark">Dark</KeyItem>
          <KeyItem mark="rain">Rain, mm/h</KeyItem>
        </KeyGroup>
        {models.length > 0 && (
          <KeyGroup name="Models" data-models-legend>
            {models.map((m) => {
              const at = shownRow
                ? m.points.find((p) => p.time === shownRow.time)
                : undefined;
              return (
                <KeyItem
                  key={m.id}
                  hue={modelHue(m.id).wind}
                  figure={at ? speed.say(at.kn) : ""}
                  data-model-key={m.id}
                >
                  {modelName(m.id)}
                </KeyItem>
              );
            })}
          </KeyGroup>
        )}
      </div>
    </>
  );
}

/** What a key's mark is: one of the graph's own, or a model's line in its hue. */
type KeyMarkKind =
  | "wind"
  | "gust"
  | "spread"
  | "costs"
  | "over"
  | "waves"
  | "current"
  | "depth"
  | "dark"
  | "rain";

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
 * mark: `mark` is the kind, or `hue` a model's colour for its line. A model's figure
 * at the hour read out sits in a slot of its own, kept whether there is a
 * figure or not, so the key never rewraps as the hours move.
 */
function KeyItem({
  mark,
  hue,
  figure,
  children,
  ...data
}: {
  mark?: KeyMarkKind;
  hue?: string;
  figure?: string;
  children: React.ReactNode;
  "data-model-key"?: string;
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
            strokeWidth={1.6}
            strokeLinecap="round"
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

/** The lower bands' names, down the graph's left edge. */
const LOWER_NAME: Record<LowerBand, string> = {
  rain: "Rain",
  models: "Models",
  gusts: "Gusts",
  waves: "Waves",
  current: "Current",
};

/**
 * The graph's lower bands (`LOWER`), drawn on its own hours. Each is the
 * dock's row of the same name, carried over:
 *
 * - Rain: each row's mm/h as a bar, on the square root the dock's rain tint
 *   reads (force5/src/rain.ts), so a wet hour of 0.2 mm shows and a downpour
 *   still fits; the figure every third hour it rains.
 * - Models: every model the rider blends (Settings), its own wind as its own
 *   line, in its own colour, on the wind band's scale.
 * - Gusts: the gust factor every third hour, and behind every hour the
 *   stars' reading of its gust, as the dock tinted it (`gustReading`).
 * - Waves: where the sea runs, as the arrow points, and its period.
 * - Current: where the water runs, and how fast; with none, the dock's note.
 */
function LowerBands({
  rows,
  lower,
  X,
  px,
  W,
  hover,
  rider,
  rated,
  models,
  current,
  rain,
  units,
}: {
  rows: readonly SpotRow[];
  lower: ReturnType<typeof lowerBands>["at"];
  X: (t: number) => number;
  px: number;
  W: number;
  hover: number | null;
  rider: Rider;
  rated: boolean;
  models: readonly ModelSeries[];
  current: SpotCurrents;
  rain: ReadonlyMap<number, number>;
  units: Units;
}) {
  const speed = useSpeed();
  const mid = (r: Pick<SpotRow, "time" | "step">) =>
    X(r.time) + (r.step * px) / 2;
  const third = (r: SpotRow) => dublinHour(r.time) % 3 === 0;
  const caption = "font-body text-caption";
  const hovered = hover === null ? null : rows[hover];
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
      {lower.models &&
        (() => {
          const [y, h] = lower.models;
          const MY = (k: number) => y + h - (Math.min(k, 36) / 36) * h;
          return (
            <g data-band="models">
              {[10, 20, 30].map((k) => (
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
              {models.map((m) => {
                // A model's line breaks where it has no reading, rather than
                // drawing a guess across the hole.
                const runs: (readonly [number, number])[][] = [];
                m.points.forEach((p, i) => {
                  const before = m.points[i - 1];
                  if (!before || before.time + before.step * HOUR !== p.time)
                    runs.push([]);
                  runs.at(-1)!.push([mid(p), MY(p.kn)]);
                });
                return (
                  <path
                    key={m.id}
                    d={runs
                      .filter((run) => run.length > 1)
                      .map(smoothPath)
                      .join("")}
                    fill="none"
                    stroke={modelHue(m.id).wind}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                    data-model={m.id}
                  />
                );
              })}
              {hovered &&
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
                  const kind = read[i]?.kind;
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
      {lower.waves &&
        (() => {
          const [y] = lower.waves;
          return (
            <g data-band="waves">
              {rows.filter(third).map((r, i) => {
                const waves = r.hour.waves;
                if (!waves || waves.height_m == null) return null;
                return (
                  <g key={i}>
                    {waves.direction_deg !== null && (
                      <g
                        transform={`translate(${mid(r)},${y + 10}) rotate(${waves.direction_deg + 180})`}
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
                    {waves.period_s !== null && (
                      <text
                        x={mid(r)}
                        y={y + 34}
                        textAnchor="middle"
                        className={`fill-ink-2 ${caption}`}
                        data-wave-period={waves.period_s}
                      >
                        {waves.period_s}s
                      </text>
                    )}
                  </g>
                );
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

function Readout({
  row,
  isNow,
  depth,
  rated,
  gust,
  current,
  rain,
  hasCurrent,
  hasDepth,
}: {
  row: SpotRow | null;
  isNow: boolean;
  depth: number | null;
  rated: boolean;
  gust: GustReading | null;
  current: CurrentReading | null;
  /** The row's rain, mm/h, or null where no total covers it. */
  rain: number | null;
  /** The place has a current, and a launch with a depth, at any hour. */
  hasCurrent: boolean;
  hasDepth: boolean;
}) {
  const speed = useSpeed();
  const units = useContext(UnitsContext);
  const s = styles();
  const wind = row?.hour.wind;
  const waves = row?.hour.waves;
  const gustKn = wind ? speed.gust(wind.wind_kn, wind.gust_kn) : null;
  const beside = row?.rating ? besideMark(row) : null;
  const taken = row && !row.rating ? standIn(row) : null;
  // Every reading the place has, in a cell of its own that holds its place
  // whatever the hour: an hour without one reads "–", so nothing moves as
  // the hours are scrubbed through. Before the hours are read the cells
  // stand empty, at the height they will have.
  return (
    <div className={s.readout()} data-readout>
      <div className={s.ro({ className: "max-wide:col-span-2" })}>
        <span
          className={s.chip({ className: isNow ? s.chipNow() : undefined })}
        >
          {isNow || !row
            ? "Now"
            : `${dayNames(dublinDate(row.time), row.time).short} ${clock(row.time)}`}
        </span>
      </div>
      {rated && (
        <div className={s.ro()}>
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
              {!row || row.hour.daylight ? "–" : "Dark"}
            </b>
          )}
        </div>
      )}
      <div className={s.ro({ className: s.roWide() })}>
        <span className={s.roLabel()}>Wind</span>
        <b className={s.roValue()}>
          {wind ? (
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
      <div className={s.ro()} data-readout-gust>
        <span className={s.roLabel()}>Gusts</span>
        <b
          className={s.roValue()}
          title={rated && gust ? GUST_WORDS[gust.kind] : undefined}
        >
          {gust?.text ?? "–"}
        </b>
      </div>
      <div className={s.ro()}>
        <span className={s.roLabel()}>Models</span>
        <b className={s.roValue()}>
          {wind && wind.models > 1
            ? `${speed.say(wind.min_kn)}–${speed.say(wind.max_kn)}`
            : "–"}
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
      <div className={s.ro({ className: s.roWide() })} data-readout-sea>
        <span className={s.roLabel()}>Sea</span>
        <b className={s.roValue()}>
          {waves?.height_m == null ? "–" : `${waves.height_m.toFixed(1)} m`}
          {waves?.height_m != null && waves.period_s !== null && (
            <span className="font-normal text-ink-2">
              {" "}
              {waves.period_s} s
              {waves.direction_deg !== null &&
                ` from ${compass(waves.direction_deg)}`}
            </span>
          )}
        </b>
      </div>
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
                    className: isOff(r) ? s.off() : undefined,
                  })}
                >
                  {w ? compass(w.direction_deg) : "–"}
                  {shoreWord(r) && ` · ${shoreWord(r)}`}
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
