/**
 * A riding place as a spot report, after the approved mock-up
 * (the approved mock-up): what it is like now on quiet
 * cards beside the chart's loupe on the satellite picture, the spots around
 * it, the week as a row of day cards, one graph where every row shares the
 * clock (or the table), and the spot's own notes. Two faces, sentence-case
 * labels, one big figure and one short line per card, the stars as stars.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loupeRose, roseScale } from "../../../force5/src/focus";
import { modelName } from "../../../force5/src/lead";
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
  RidingSpot,
  SpotForecast,
  SpotSea,
} from "../../../mcp/api/forecast";
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
import { useNearby, type NearbyReading } from "./nearby";
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
    tools: "my-4 flex flex-wrap items-center justify-between gap-2.5",
    readout: "flex min-h-12 flex-wrap items-center gap-x-6 gap-y-1.5",
    chip: "rounded-full bg-inverse px-3 py-1 font-body text-body font-semibold text-ink-inverse",
    chipNow: "bg-pen text-ground",
    ro: "grid gap-px",
    roValue: "font-body text-prose font-semibold text-ink",
    gbox: "grid grid-cols-graph rounded-surface bg-sunken on-card py-1.5",
    gl: "relative",
    glName:
      "absolute left-4 -translate-y-1/2 font-body text-caption font-medium whitespace-nowrap text-ink-muted",
    graph:
      "relative overflow-x-auto overscroll-x-contain border-0 border-l border-line",
    sky: "pointer-events-none absolute left-0 flex items-center gap-1 font-body text-caption text-ink-2",
    legend:
      "flex flex-wrap gap-x-4 gap-y-1.5 pt-3 font-body text-caption text-ink-2",
    key: "mr-1.5 inline-block h-2 w-3.5 rounded-control align-middle",
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

export function SpotReport({
  spot,
  forecast,
  rider,
  units,
  now,
  actions,
  notices,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
  rider: Rider;
  units: Units;
  now: number;
  actions?: React.ReactNode;
  notices?: React.ReactNode;
}) {
  const s = styles();
  const facing = shoreFacing(spot.id);
  const rows = useMemo(
    () => spotRows(forecast.hours, now, facing, rider),
    [forecast.hours, now, facing, rider],
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
    let current = true;
    void launchBed(spot, facing).then((b) => current && setBed(b));
    return () => {
      current = false;
    };
  }, [spot, facing]);
  const depthAt = useMemo(
    () => (t: number) => (bed ? launchDepth(bed, tideAt, t) : null),
    [bed, tideAt],
  );
  const picture = useSpotPicture(spot);
  const [firstNow] = useState(now);
  const nearby = useNearby(forecast.nearby, rider, firstNow);
  const [focus, setFocus] = useState<number | null>(null);
  const [view, setView] = useState<"graph" | "table">("graph");
  const [dayAt, setDayAt] = useState(0);
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
          <h1 className={s.name()}>{spot.name}</h1>
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
              <NearbyCards here={spot} readings={nearby} />
            </div>
          </section>
        )}

        <section className={s.section({ className: "pt-5" })} aria-label="Now">
          <div
            className={s.now({
              className: !picture
                ? "rail:grid-cols-1 xwide:grid-cols-1"
                : nearby.length
                  ? undefined
                  : "xwide:grid-cols-now",
            })}
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
                <NearbyCards here={spot} readings={nearby.slice(0, 6)} column />
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
            />
          ) : (
            <HourTable
              forecast={forecast}
              rows={days[dayAt]?.day.rows ?? []}
              date={days[dayAt]?.day.date ?? ""}
              now={now}
              depthAt={depthAt}
            />
          )}
        </section>

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

function NearbyCards({
  here,
  readings,
  column = false,
}: {
  here: RidingSpot;
  readings: NearbyReading[];
  column?: boolean;
}) {
  const speed = useSpeed();
  const s = styles();
  return (
    <>
      {[
        {
          id: here.id,
          name: here.name,
          distanceKm: 0,
          windKn: null,
          best: null,
        } as NearbyReading,
        ...readings,
      ].map((r, i) => (
        <a
          key={r.id}
          className={s.near({
            className: [i === 0 && s.nearHere(), column && "grid-cols-near"]
              .filter(Boolean)
              .join(" "),
          })}
          href={spotHref(r.id)}
          aria-current={i === 0 ? "page" : undefined}
          data-nearby={r.id}
        >
          <NearThumb id={r.id} lat={here.lat} lon={here.lon} />
          <span className={s.nearName()}>{r.name}</span>
          <span className={s.nearLine()}>
            {i === 0
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
  on,
  onClick,
}: {
  card: DayCard;
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
      ) : (
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
  axis: [388, 20],
} as const;
const GH = 410;

function Graph({
  rows,
  days,
  now,
  turns,
  bed,
  depthAt,
  onFocus,
  scrollTo,
}: {
  rows: SpotRow[];
  days: { day: { date: string }; sun: DaySun; midnight: number }[];
  now: number;
  turns: ReturnType<typeof tideTurns>;
  bed: LaunchBed | null;
  depthAt: (t: number) => number | null;
  onFocus: (t: number | null) => void;
  scrollTo: { day: number; at: number } | null;
}) {
  const speed = useSpeed();
  const s = styles();
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(
    () => onFocus(hover === null ? null : (rows[hover]?.time ?? null)),
    [hover, rows, onFocus],
  );
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
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = Math.max(0, X(now) - px * 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);
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
  const [ay] = ROW.axis;
  const hoverRow = hover === null ? null : rows[hover];
  const shownRow = hoverRow ?? rowAt(rows, now);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = start + ((e.clientX - box.left) / px) * HOUR;
    let at = 0;
    rows.forEach((r, i) => {
      if (r.time <= t) at = i;
    });
    setHover(at);
  };
  return (
    <>
      <div className={s.tools()}>
        <Readout
          row={shownRow}
          isNow={hover === null}
          depth={shownRow ? depthAt(shownRow.time) : null}
        />
      </div>
      <div className={s.gbox()}>
        <div className={s.gl()} style={{ height: GH }}>
          {(
            [
              ["Stars", ROW.stars[0] + 4],
              ["Wind", ROW.wind[0] + 40],
              ["Direction", ROW.dir[0] + 12],
              ["Sea", ROW.sea[0] + 26],
              ["Tide", ROW.tide[0] + 36],
              ["Sky", ROW.sky[0] + 14],
            ] as const
          ).map(([name, y]) => (
            <span key={name} className={s.glName()} style={{ top: y + 6 }}>
              {name}
            </span>
          ))}
        </div>
        <div className={s.graph()} ref={ref} data-spot-graph>
          <svg
            width={W}
            height={GH}
            viewBox={`0 0 ${W} ${GH}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
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
                      d="M0 6V-6M-3.5 -2.5L0 -6.5l3.5 4"
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
      <div className={s.legend()}>
        <span>
          <i className={s.key({ className: "bg-wind-k15" })} />
          Wind
        </span>
        <span>
          <i className={s.key({ className: "h-0.5 bg-gust" })} />
          Gust
        </span>
        <span>
          <i className={s.key({ className: "bg-line" })} />
          Where the models disagree
        </span>
        {deepAt !== null && (
          <span>
            <i className={s.key({ className: "bg-depth" })} />1 m of water or
            more at the launch
          </span>
        )}
        <span>
          <i className={s.key({ className: "bg-ink/10" })} />
          Dark
        </span>
      </div>
    </>
  );
}

function Readout({
  row,
  isNow,
  depth,
}: {
  row: SpotRow | null;
  isNow: boolean;
  depth: number | null;
}) {
  const speed = useSpeed();
  const s = styles();
  if (!row) return <div className={s.readout()} />;
  const wind = row.hour.wind;
  const waves = row.hour.waves;
  return (
    <div className={s.readout()} data-readout>
      <span className={s.chip({ className: isNow ? s.chipNow() : undefined })}>
        {isNow
          ? "Now"
          : `${dayNames(dublinDate(row.time), row.time).short} ${clock(row.time)}`}
      </span>
      <div className={s.ro()}>
        <span className={s.label()}>Stars</span>
        {row.rating ? (
          <span className="inline-flex items-center gap-1.5">
            <Stars n={row.rating.stars} />
            {besideMark(row) && <NoticeMark level={besideMark(row)!} />}
          </span>
        ) : standIn(row) ? (
          <NoticeMark level={standIn(row)!.level}>
            {standIn(row)!.word}
          </NoticeMark>
        ) : (
          <b className={s.roValue()}>{row.hour.daylight ? "–" : "Dark"}</b>
        )}
      </div>
      {wind && (
        <div className={s.ro()}>
          <span className={s.label()}>Wind</span>
          <b className={s.roValue()}>
            {speed.say(wind.wind_kn)}
            {speed.gust(wind.wind_kn, wind.gust_kn) !== null && (
              <span className="text-gust">
                {" "}
                g{speed.say(speed.gust(wind.wind_kn, wind.gust_kn)!)}
              </span>
            )}{" "}
            {speed.unit} {compass(wind.direction_deg)}
          </b>
        </div>
      )}
      {wind && (
        <div className={s.ro()}>
          <span className={s.label()}>Models</span>
          <b className={s.roValue()}>
            {speed.say(wind.min_kn)}–{speed.say(wind.max_kn)}
          </b>
        </div>
      )}
      <div className={s.ro()}>
        <span className={s.label()}>Wing</span>
        <b className={s.roValue()}>
          {row.rating
            ? `${row.rating.wing.own ?? row.rating.wing.recommended} m²`
            : "–"}
        </b>
      </div>
      <div className={s.ro()}>
        <span className={s.label()}>Sea</span>
        <b className={s.roValue()}>
          {waves?.height_m == null ? "–" : `${waves.height_m.toFixed(1)} m`}
        </b>
      </div>
      {depth !== null && (
        <div className={s.ro()}>
          <span className={s.label()}>At the launch</span>
          <b
            className={s.roValue({
              className: depth < 1 ? s.off() : undefined,
            })}
          >
            {depth.toFixed(1)} m
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
}: {
  forecast: SpotForecast;
  rows: SpotRow[];
  date: string;
  now: number;
  depthAt: (t: number) => number | null;
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
            <th className={s.th()}>Stars</th>
            <th className={s.th()}>Wind {speed.unit}</th>
            <th className={s.th()}>From</th>
            <th className={s.th({ className: s.narrow() })}>Models</th>
            <th className={s.th({ className: s.narrow() })}>Wing</th>
            <th className={s.th()}>Sea</th>
            <th className={s.th()}>Launch</th>
            <th className={s.th({ className: s.narrow() })}>Air</th>
          </tr>
        </thead>
        <tbody>
          {light.map((r) => {
            const w = r.hour.wind;
            const d = depthAt(r.time);
            return (
              <tr
                key={r.time}
                data-hour={new Date(r.time).toISOString()}
                className={r.rating?.stars ? undefined : "text-ink-muted"}
              >
                <td className={s.td()}>{clock(r.time)}</td>
                <StarsCell row={r} forecast={forecast} />
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
                    className: isOff(r) ? s.off() : undefined,
                  })}
                >
                  {w ? compass(w.direction_deg) : "–"}
                  {shoreWord(r) && ` · ${shoreWord(r)}`}
                </td>
                <td className={s.td({ className: s.narrow() })}>
                  {w ? `${speed.say(w.min_kn)}–${speed.say(w.max_kn)}` : "–"}
                </td>
                <td className={s.td({ className: s.narrow() })}>
                  {r.rating
                    ? `${r.rating.wing.own ?? r.rating.wing.recommended} m²`
                    : "–"}
                </td>
                <td className={s.td()}>
                  {r.hour.waves?.height_m == null
                    ? "–"
                    : `${r.hour.waves.height_m.toFixed(1)} m`}
                </td>
                <td
                  className={s.td({
                    className: d !== null && d < 1 ? s.off() : undefined,
                  })}
                >
                  {d === null ? "–" : `${d.toFixed(1)} m`}
                </td>
                <td className={s.td({ className: s.narrow() })}>
                  {r.hour.weather?.air_c == null
                    ? "–"
                    : `${Math.round(r.hour.weather.air_c)}°`}
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
