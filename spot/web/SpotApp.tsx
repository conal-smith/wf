/**
 * A riding place's own page, at /spot/<id>: the week's stars by day, every
 * hour of it for a wing foiler, then tide and daylight. `src/main.tsx`
 * lazy-loads it, so it never carries the map, MapLibre or the other sections;
 * it reads the published forecast through the MCP server's reduction, so the
 * page and an agent can never be told two different forecasts.
 *
 * /spot with no id is the index of every place.
 */
import {
  ArrowLeft,
  Map as MapIcon,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { loadPrefs, savePrefs } from "../../force5/src/prefs";
import { shoreFacing } from "../../force5/src/shoreFacing";
import {
  mapSpotHref,
  spotHref,
  spotIdFromPath,
} from "../../force5/src/siteNav";
import {
  SESSION_LABEL,
  SHORE_LABEL,
  starsText,
  type Rider,
} from "../../force5/src/stars";
import { unitLabel } from "../../force5/src/units";
import {
  localTime,
  type RidingSpot,
  type SpotForecast,
} from "../../mcp/api/forecast";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { StarGlyphs } from "../../src/StarsRows";
import { Button, Chip, Empty, Notice, Pane, Skeleton } from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { RING, tv } from "../../ui/tv";
import { DayStrip } from "./DayStrip";
import { DayTable } from "./DayTable";
import { RiderSwitch, SKILL_LABEL, weightText } from "./RiderSwitch";
import { ShoreDial } from "./ShoreDial";
import { TideSection, tideTurns } from "./TideSection";
import {
  FORECAST_DAYS,
  bestIn,
  clock,
  compass,
  dayNames,
  daySun,
  dublinDate,
  groupDays,
  shoreSummary,
  spotRows,
  tideHeightAt,
  tideTrend,
  windIn,
} from "./spot";
import { useSpotForecast } from "./useSpotForecast";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-page flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    main: "flex flex-col gap-10 pt-4 pb-12 max-wide:gap-8 max-sm:gap-6 max-sm:pt-1",
    hero: "grid items-start gap-6 rail:grid-cols-detail",
    identity: "flex min-w-0 flex-col gap-4 max-sm:gap-3",
    eyebrow: "flex flex-wrap items-center gap-2 text-body text-ink-muted",
    name: "m-0 text-title wide:text-reading wide:leading-tight wide:font-semibold wide:tracking-tight",
    shore: "flex items-center gap-4",
    shoreText: "flex min-w-0 flex-col gap-1.5",
    shoreLine: "m-0 text-prose font-semibold text-ink",
    fact: "m-0 text-body text-ink-2 tabular-nums",
    factMuted: "text-ink-muted",
    actions: "flex flex-wrap items-center gap-2",
    // On a phone the header's Map button is the way back; the row would only
    // push the week further down.
    heroActions: "max-sm:hidden",
    // A phone folds the rider into one line under the name, so the week is on
    // the first screen; it opens in place.
    riderChip: [
      "flex min-h-touch w-full items-center gap-2 rounded-pill border border-line bg-card px-4 py-2 text-left font-body text-body text-ink-2 shadow-control",
      "cursor-pointer transition-colors duration-fast not-disabled:hover:bg-solid motion-reduce:transition-none",
      RING,
    ],
    riderChipText: "min-w-0 flex-1 truncate tabular-nums",
    riderChipLevel: "font-semibold text-ink",
    riderChipAction:
      "shrink-0 text-label text-quiet underline underline-offset-4 decoration-line-strong",
    riderPanel: "rounded-surface border border-line bg-card p-4 shadow-control",
    glance: "m-0 grid grid-cols-4 gap-2 max-wide:grid-cols-2",
    tile: "flex min-w-0 flex-col gap-0.5 rounded-control border border-line bg-card px-4 py-3 shadow-control max-sm:px-3 max-sm:py-2",
    tileLabel: "text-eyebrow uppercase text-ink-muted",
    tileValue:
      "m-0 text-lead whitespace-nowrap tabular-nums max-sm:text-prose max-sm:font-semibold",
    tileDetail: "m-0 truncate text-caption text-ink-muted",
    side: "flex flex-col gap-5",
    bestEyebrow: "m-0 text-eyebrow uppercase text-ink-muted",
    best: "flex flex-col gap-1.5",
    bestWhen: "m-0 text-lead tabular-nums",
    bestWhat: "m-0 text-body text-ink-2",
    rule: "m-0 h-px border-0 bg-line",
    block: "flex flex-col gap-3",
    blockHead: "flex flex-wrap items-baseline justify-between gap-2",
    blockTitle: "m-0 text-title",
    blockNote: "m-0 text-body text-ink-muted",
    days: "flex flex-col gap-8",
    footer:
      "flex flex-col gap-3 rounded-surface bg-sunken p-5 text-body text-ink-2",
    footerTitle: "m-0 text-label text-ink",
    footerList: "m-0 flex list-none flex-col gap-1 p-0",
    safety: "m-0 text-prose font-semibold text-ink",
    index: "grid gap-6",
    county: "flex flex-col gap-2",
    countyTitle: "m-0 text-eyebrow uppercase text-ink-muted",
    places: "m-0 grid list-none grid-cols-cards gap-2 p-0",
    place: [
      "flex min-h-touch items-center gap-2 rounded-control bg-card px-4 py-2 text-ink no-underline shadow-control",
      "transition-colors duration-fast not-disabled:hover:bg-solid motion-reduce:transition-none",
      RING,
    ],
  },
});

export default function SpotApp() {
  const id = spotIdFromPath(window.location.pathname);
  const [attempt, setAttempt] = useState(0);
  const state = useSpotForecast(id, attempt);
  const s = styles();
  const title =
    state.kind === "ready"
      ? `${state.spot.name} wing foil forecast`
      : id === null
        ? "Spot forecasts"
        : "Spot forecast";
  usePageTitle(title, "Wind map");

  return (
    <div className={s.root()}>
      <div className={s.page()}>
        <Masthead>
            <SiteMenu current="map" size="sm" ground="content" />
            <a
              href="/"
              className={mastheadStyles().brand()}
              aria-label="wingfoil.ie, wind map"
            >
              <MastheadMark />
            </a>
            <span className={mastheadStyles().actions()}>
              <Button
                variant="pill"
                size="sm"
                href={id ? mapSpotHref(id) : "/"}
                data-back-to-map
              >
                <ArrowLeft size={14} aria-hidden="true" />
                <span>Map</span>
              </Button>
            </span>
        </Masthead>
        {state.kind === "loading" && <Loading />}
        {state.kind === "error" && (
          <main className={s.main()}>
            <Notice kind="warn">
              The forecast could not be read just now: {state.message}
            </Notice>
            <div className={s.actions()}>
              <Button variant="pill" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw size={14} aria-hidden="true" />
                <span>Try again</span>
              </Button>
              <Button variant="link" href="/">
                Back to the map
              </Button>
            </div>
          </main>
        )}
        {state.kind === "unknown" && (
          <main className={s.main()}>
            <Empty
              title={`No riding place called “${state.id}”`}
              icon={<MapPin size={24} />}
            >
              <p className="m-0">
                {state.candidates.length
                  ? "Did you mean one of these?"
                  : "It may have been renamed. Every place is listed on the map and below."}
              </p>
              {state.candidates.length > 0 && (
                <ul className={s.places()}>
                  {state.candidates.map((spot) => (
                    <li key={spot.id}>
                      <PlaceLink spot={spot} />
                    </li>
                  ))}
                </ul>
              )}
              <div className={s.actions()}>
                <Button variant="pill" href="/spot">
                  All places
                </Button>
                <Button variant="link" href="/">
                  Open the map
                </Button>
              </div>
            </Empty>
          </main>
        )}
        {state.kind === "index" && <SpotIndex spots={state.spots} />}
        {state.kind === "ready" && (
          <SpotPage spot={state.spot} forecast={state.forecast} />
        )}
      </div>
    </div>
  );
}

function Glance({
  label,
  value,
  detail,
  ...rest
}: {
  label: string;
  value: string;
  detail: string;
  "data-sea-temperature"?: string;
}) {
  const s = styles();
  return (
    <div className={s.tile()} {...rest}>
      <dt className={s.tileLabel()}>{label}</dt>
      <dd className={s.tileValue()}>{value}</dd>
      <dd className={s.tileDetail()} title={detail}>
        {detail || "\u00a0"}
      </dd>
    </div>
  );
}

function PlaceLink({ spot }: { spot: RidingSpot }) {
  const s = styles();
  return (
    <a className={s.place()} href={spotHref(spot.id)}>
      <MapPin size={14} aria-hidden="true" />
      <span className="min-w-0 truncate">{spot.name}</span>
    </a>
  );
}

function SpotIndex({ spots }: { spots: readonly RidingSpot[] }) {
  const s = styles();
  const counties = useMemo(() => {
    const groups = new Map<string, RidingSpot[]>();
    for (const spot of [...spots].sort((a, b) => a.name.localeCompare(b.name)))
      groups.set(spot.county || "Elsewhere", [
        ...(groups.get(spot.county || "Elsewhere") ?? []),
        spot,
      ]);
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [spots]);
  return (
    <main className={s.main()}>
      <div className={s.block()}>
        <h1 className={s.name()}>Spot forecasts</h1>
        <p className={s.blockNote()}>
          {spots.length} riding places around Ireland, each with its week of
          stars, hourly wind, tide and daylight.
        </p>
      </div>
      <div className={s.index()}>
        {counties.map(([county, places]) => (
          <section key={county} className={s.county()}>
            <h2 className={s.countyTitle()}>{county}</h2>
            <ul className={s.places()}>
              {places.map((spot) => (
                <li key={spot.id}>
                  <PlaceLink spot={spot} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function Loading() {
  const s = styles();
  return (
    <main
      className={s.main()}
      aria-busy="true"
      aria-label="Loading the forecast"
    >
      <div className={s.hero()}>
        <div className={s.identity()}>
          <Skeleton className="w-32" />
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="w-80 max-w-full" />
        </div>
        <Skeleton shape="block" />
      </div>
      <Skeleton shape="block" className="min-h-40" />
      <Skeleton shape="block" className="min-h-96" />
    </main>
  );
}

/** Below Tailwind's `sm` (40rem): where the rider folds into one line. */
const PHONE = "(max-width: 39.99rem)";

/**
 * Whether the page is on a phone. The rider's controls are drawn once, in the
 * side panel or in the fold under the name, never in both: two copies would be
 * two sets of the same fields.
 */
function usePhone(): boolean {
  const [phone, setPhone] = useState(
    () => window.matchMedia?.(PHONE).matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.(PHONE);
    if (!media) return;
    const change = () => setPhone(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return phone;
}

/** Scroll to an element, smoothly unless the reader has asked for less motion. */
function scrollToId(id: string, focus = false) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
  if (focus) element.focus({ preventScroll: true });
}

function SpotPage({
  spot,
  forecast,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
}) {
  const s = styles();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [rider, setRider] = useState<Rider>(() => loadPrefs().rider);
  const units = useMemo(() => loadPrefs().units, []);
  const unitText = unitLabel(units);
  const changeRider = (next: Rider) => {
    setRider(next);
    // Read afresh, so a change made on the map in another tab is not undone.
    savePrefs({ ...loadPrefs(), rider: next });
  };
  const facing = shoreFacing(spot.id);
  const phone = usePhone();
  const [riderOpen, setRiderOpen] = useState(false);
  const rows = useMemo(
    () => spotRows(forecast.hours, now, facing, rider),
    [forecast.hours, now, facing, rider],
  );
  const days = useMemo(
    () =>
      groupDays(rows)
        .filter((day) => day.hasWind)
        .slice(0, FORECAST_DAYS),
    [rows],
  );
  const best = useMemo(() => bestIn(rows), [rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDay =
    selected && days.some((day) => day.date === selected)
      ? selected
      : (days[0]?.date ?? dublinDate(now));
  const first = rows.find((row) => row.hour.wind);
  const windNow = first?.hour.wind ?? null;
  const shoreText = shoreSummary(facing);
  const sea = forecast.sea_temperature;
  const riderText = `${SKILL_LABEL[rider.skill]}, ${weightText(rider)}`;
  const turns = useMemo(() => tideTurns(forecast), [forecast]);
  const tideNow = tideHeightAt(turns, now);
  const tideTrendNow = tideTrend(turns, now);
  const nextTurn = turns.find((turn) => turn.time > now) ?? null;
  const sunToday = daySun(spot.lat, spot.lon, dublinDate(now));

  const showDay = (date: string) => {
    setSelected(date);
    scrollToId(`day-${date}`);
  };

  return (
    <main className={s.main()}>
      <div className={s.hero()}>
        <div className={s.identity()}>
          <div className={s.eyebrow()}>
            <Chip eyebrow>Spot forecast</Chip>
            {spot.county && <span>{spot.county}</span>}
          </div>
          <h1 className={s.name()}>{spot.name}</h1>
          {phone && (
            <>
              <button
                type="button"
                className={s.riderChip()}
                aria-expanded={riderOpen}
                aria-controls="rider-panel"
                data-rider-chip
                onClick={() => setRiderOpen((open) => !open)}
              >
                <span className={s.riderChipText()}>
                  Rated for{" "}
                  <span className={s.riderChipLevel()}>
                    {SKILL_LABEL[rider.skill]}
                  </span>{" "}
                  · {weightText(rider)}
                  {rider.wings.length ? ` · ${rider.wings.join(", ")} m²` : ""}
                </span>
                <span className={s.riderChipAction()} aria-hidden="true">
                  {riderOpen ? "Done" : "Change"}
                </span>
                <span className="sr-only">
                  {riderOpen
                    ? ". Close the rider controls"
                    : ". Change who the stars are rated for"}
                </span>
              </button>
              {riderOpen && (
                <div id="rider-panel" className={s.riderPanel()}>
                  <RiderSwitch rider={rider} onChange={changeRider} />
                </div>
              )}
            </>
          )}
          <div className={s.shore()}>
            <ShoreDial
              facing={facing}
              windFrom={windNow?.direction_deg ?? null}
            />
            <div className={s.shoreText()}>
              <p className={s.shoreLine()} data-shore-summary>
                {shoreText ??
                  "Shore direction not known well enough: rated on the wind alone"}
              </p>
              <p className={s.fact({ className: "max-wide:hidden" })}>
                {facing === null ? (
                  <span className={s.factMuted()}>
                    The stars here rate the wind, not its angle to the beach.
                  </span>
                ) : (
                  <span className={s.factMuted()}>
                    Cross and cross-onshore, from the map&rsquo;s coastline.
                    Onshore is slow to get out through; offshore takes you away
                    from the beach.
                  </span>
                )}
              </p>
            </div>
          </div>
          <dl className={s.glance()} data-glance>
            <Glance
              label={first && first.time > now ? "Wind next hour" : "Wind now"}
              value={
                windNow
                  ? `${windIn(windNow.wind_kn, units)}${
                      windNow.gust_kn !== null
                        ? `–${windIn(windNow.gust_kn, units)}`
                        : ""
                    } ${unitText}`
                  : "–"
              }
              detail={
                windNow
                  ? `${compass(windNow.direction_deg)}${
                      first?.shore ? ` · ${SHORE_LABEL[first.shore]}` : ""
                    }`
                  : "No model reaches this hour"
              }
            />
            <Glance
              label="Tide now"
              value={tideNow === null ? "–" : `${tideNow.toFixed(1)} m`}
              detail={
                tideNow === null
                  ? "No prediction for now"
                  : `${tideTrendNow ?? ""}${
                      nextTurn
                        ? ` · ${nextTurn.tide} ${clock(nextTurn.time)}`
                        : ""
                    }`
              }
            />
            <Glance
              label="Daylight today"
              value={
                sunToday.sunrise !== null && sunToday.sunset !== null
                  ? `${clock(sunToday.sunrise)}–${clock(sunToday.sunset)}`
                  : "–"
              }
              detail={
                sunToday.firstLight !== null && sunToday.lastLight !== null
                  ? `light ${clock(sunToday.firstLight)}–${clock(sunToday.lastLight)}`
                  : ""
              }
            />
            <Glance
              label="Sea"
              value={sea ? `${sea.celsius.toFixed(1)} °C` : "–"}
              detail={
                sea
                  ? `${sea.station}, ${sea.distance_km} km`
                  : "No reading close by"
              }
              data-sea-temperature={sea ? "" : undefined}
            />
          </dl>
          <div className={s.actions({ className: s.heroActions() })}>
            <Button variant="pill" size="sm" href={mapSpotHref(spot.id)}>
              <MapIcon size={14} aria-hidden="true" />
              <span>Open on the map</span>
            </Button>
            <Button variant="quiet" size="sm" href="#tide-and-daylight">
              Tide and daylight
            </Button>
          </div>
        </div>
        <Pane standing className={s.side()}>
          <div className={s.best()} data-best-window>
            <p className={s.bestEyebrow()}>Best still ahead</p>
            {best ? (
              <>
                <StarGlyphs
                  stars={best.stars}
                  potential={best.stars}
                  size={20}
                />
                <p className={s.bestWhen()}>
                  {dayNames(dublinDate(best.from), now).short}{" "}
                  {clock(best.from)}–{clock(best.to)}{" "}
                  <span className={s.factMuted()}>on a {best.wing} m²</span>
                </p>
                <p className={s.bestWhat()}>
                  {SESSION_LABEL[best.rating.session]}
                  {best.rating.shore && ` · ${SHORE_LABEL[best.rating.shore]}`}
                  {best.own ? " · your own wing" : ""}
                  <span className="sr-only">
                    . {starsText({ stars: best.stars, potential: best.stars })}
                  </span>
                </p>
                <div>
                  <Button
                    variant="link"
                    onClick={() => {
                      const date = dublinDate(best.from);
                      setSelected(date);
                      scrollToId(`hour-${best.from}`, true);
                    }}
                  >
                    Show those hours
                  </Button>
                </div>
              </>
            ) : (
              <p className={s.bestWhat()}>
                Nothing rated a star or more in the days ahead for a{" "}
                {SKILL_LABEL[rider.skill].toLowerCase()} rider.
              </p>
            )}
          </div>
          {!phone && (
            <>
              <hr className={s.rule()} />
              <RiderSwitch rider={rider} onChange={changeRider} />
            </>
          )}
        </Pane>
      </div>

      <section className={s.block()} aria-labelledby="week-title">
        <div className={s.blockHead()}>
          <h2 id="week-title" className={s.blockTitle()}>
            The week
          </h2>
          <p className={s.blockNote()}>
            Rated for {riderText} · daylight hours only
          </p>
        </div>
        <DayStrip
          days={days}
          selected={selectedDay}
          now={now}
          units={units}
          unitText={unitText}
          onSelect={showDay}
        />
      </section>

      <div className={s.days()}>
        {days.map((day) => (
          <DayTable
            key={day.date}
            day={day}
            spotName={spot.name}
            now={now}
            units={units}
            unitText={unitText}
            riderText={riderText}
          />
        ))}
      </div>

      <TideSection
        forecast={forecast}
        dates={days.map((day) => day.date)}
        selected={selectedDay}
        onSelect={setSelected}
        now={now}
      />

      <SourcesFooter forecast={forecast} />
    </main>
  );
}

function SourcesFooter({ forecast }: { forecast: SpotForecast }) {
  const s = styles();
  const { sources } = forecast;
  const tides =
    forecast.tides && "station" in forecast.tides ? forecast.tides : null;
  const sea = forecast.sea_temperature;
  return (
    <footer className={s.footer()} aria-labelledby="sources-title">
      <h2 id="sources-title" className={s.footerTitle()}>
        Where this comes from
      </h2>
      <ul className={s.footerList()} data-sources>
        <li>
          Wind:{" "}
          {sources.wind.length
            ? sources.wind
                .map(
                  (run) =>
                    `${run.name} (${localTime(Date.parse(run.run_time))}${run.stale ? ", older run" : ""})`,
                )
                .join(", ")
            : "no live model reaches this spot"}
          .
          {sources.wind_outside_domain.length > 0 &&
            ` Not covering this spot: ${sources.wind_outside_domain.join(", ")}.`}
        </li>
        {sources.waves && (
          <li>
            Waves: {sources.waves.name} (
            {localTime(Date.parse(sources.waves.run_time))}).
          </li>
        )}
        {sources.weather && (
          <li>
            Sky, air and rain: {sources.weather.name} (
            {localTime(Date.parse(sources.weather.run_time))}).
          </li>
        )}
        {tides && (
          <li>
            Tides: {tides.station}, {tides.distance_km} km away
            {tides.attribution ? ` · ${tides.attribution}` : ""}.
          </li>
        )}
        {sea && (
          <li>
            Sea temperature: {sea.station}, measured {sea.measured}
            {sea.attribution ? ` · ${sea.attribution}` : ""}.
          </li>
        )}
        {sources.unavailable.length > 0 && (
          <li className={s.factMuted()}>
            Not available just now:{" "}
            {sources.unavailable.map((model) => model.name).join(", ")}.
          </li>
        )}
      </ul>
      <p className="m-0">{forecast.method}</p>
      <p className="m-0">
        Stars rate each daylight hour out of five for the rider chosen above:
        the solid stars after the shore angle, the gusts and model agreement
        have their say, the faded ones what the wind alone would give. Times are
        Irish.
      </p>
      <p className={s.safety()}>
        Model forecasts only — not a safety statement. Look at the water, and
        never ride alone in offshore wind.
      </p>
    </footer>
  );
}
