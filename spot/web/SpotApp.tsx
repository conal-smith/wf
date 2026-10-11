/**
 * A riding place's own page, at /spot/<id>, set as the chart's broadsheet: the
 * place's name, the week in one strip, then day after day
 * down the page, every daylight hour a row of figures with the pen round the
 * best of it, and the tide and the light under each day. `src/main.tsx`
 * lazy-loads it, so it never carries the map, MapLibre or the other sections;
 * it reads the published forecast through the MCP server's own reduction, so
 * the page and an agent can never be told two different forecasts.
 *
 * /spot with no id is the index of every place; /stars is "How the stars
 * work" (StarsPage.tsx), the bundle's other page.
 */
import { MapPin, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadPrefs, savePrefs } from "../../force5/src/prefs";
import { shoreFacing } from "../../force5/src/shoreFacing";
import {
  STARS_HREF,
  isStarsPath,
  mapSpotHref,
  spotHref,
  spotIdFromPath,
} from "../../force5/src/siteNav";
import type { Rider } from "../../force5/src/stars";
import { unitLabel } from "../../force5/src/units";
import {
  WAVE_MODELS,
  WEATHER_MODELS,
  WIND_MODELS,
  localTime,
  type RidingSpot,
  type SpotForecast,
  type Unavailable,
} from "../../mcp/api/forecast";
import { favourites } from "../../shared/web/favourites";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Button,
  Empty,
  Headline,
  Kicker,
  Notice,
  SectionHeading,
  Skeleton,
} from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import { DaySection } from "./DaySection";
import { SpotFrame } from "./Frame";
import { FacingGlyph, KeepStar } from "./glyphs";
import { RiderSwitch, riderWords } from "./RiderSwitch";
import {
  FORECAST_DAYS,
  PEN_STARS,
  bandKnots,
  compass,
  dayWindow,
  daySun,
  goodWindArcs,
  groupDays,
  spotRows,
  tideTurns,
  weekBest,
} from "./spot";
import StarsPage from "./StarsPage";
import { useSpotForecast } from "./useSpotForecast";
import { useWidth } from "./useWidth";
import { WeekStrip } from "./WeekStrip";

const styles = tv({
  slots: {
    main: "flex flex-col gap-4 pt-4 pb-12 max-sm:pt-3",
    // The facts are kept apart by points (Dot), so the gap between them is
    // the point's own spacing either side.
    meta: [
      "m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-muted",
      MONO_LABEL,
    ],
    metaItem: "inline-flex items-center gap-1.5",
    strong: "font-semibold text-ink",
    star: [
      "inline-flex min-h-control-sm cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2 text-ink",
      "pointer-coarse:min-h-touch pointer-coarse:min-w-touch not-disabled:hover:bg-sunken",
      MONO_LABEL,
      RING,
    ],
    starWord: "max-sm:sr-only",
    days: "flex flex-col",
    footer:
      "mt-8 flex flex-col gap-2 border-0 border-t-2 border-ink pt-3 font-body text-body text-ink-2",
    footerList: "m-0 flex list-none flex-col gap-1 p-0",
    muted: "text-ink-muted",
    safety: "m-0 font-body text-body font-semibold text-ink",
    link: "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
    address: "font-mono text-body wrap-anywhere text-ink",
    index: "flex flex-col gap-6",
    places: "m-0 grid list-none grid-cols-cards gap-x-6 p-0",
    place: [
      "flex min-h-touch items-center border-0 border-b border-line py-2 font-display text-prose font-semibold text-ink italic no-underline",
      "hover:text-chart-magenta",
      RING,
    ],
  },
});

export default function SpotApp() {
  const path = window.location.pathname;
  if (isStarsPath(path)) return <StarsPage />;
  return <SpotRoute id={spotIdFromPath(path)} />;
}

function SpotRoute({ id }: { id: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const state = useSpotForecast(id, attempt);
  const s = styles();
  const title =
    state.kind === "ready"
      ? `${state.spot.name} wing foil forecast`
      : state.kind === "unknown"
        ? "Spot not found"
        : id === null
          ? "Spot forecasts"
          : "Spot forecast";
  usePageTitle(title, "Wind map");

  return (
    <SpotFrame
      back={id ? mapSpotHref(id) : "/"}
      actions={
        state.kind === "ready" && (
          <KeepButton id={state.spot.id} name={state.spot.name} />
        )
      }
    >
      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && (
        <main className={s.main()}>
          <Notice kind="warn">
            The forecast could not be read just now: {state.message}
          </Notice>
          <div>
            <Button variant="pill" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>Try again</span>
            </Button>
          </div>
        </main>
      )}
      {state.kind === "unknown" && (
        <main className={s.main()}>
          {/* The address goes in the line under the title, not in it: an
              address breaks at its hyphens, and a title that leaves "all”"
              alone on its last line is worse than one that never names it. */}
          <Empty
            title="No riding place at this address"
            icon={<MapPin size={24} strokeWidth={1.5} />}
            className="text-balance"
          >
            <p className="m-0">
              Nothing is called{" "}
              <span className={s.address()}>“{state.id}”</span>.{" "}
              {state.candidates.length
                ? "Did you mean one of these?"
                : "It may have been renamed. Every place is on the map, and in the list of all places."}
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
            <div>
              <Button variant="pill" href="/spot">
                All places
              </Button>
            </div>
          </Empty>
        </main>
      )}
      {state.kind === "index" && <SpotIndex spots={state.spots} />}
      {state.kind === "ready" && (
        <SpotPage spot={state.spot} forecast={state.forecast} />
      )}
    </SpotFrame>
  );
}

/**
 * The star a rider keeps a place by, shared with the map through
 * shared/web/favourites (localStorage `wingfoil.spots.v1`): starred here, it is
 * starred there, and a change in another tab arrives here too. Opening the
 * page counts as a visit, once.
 */
function KeepButton({ id, name }: { id: string; name: string }) {
  const s = styles();
  const store = useMemo(() => favourites(), []);
  const [on, setOn] = useState(() => store.isStarred(id));
  const counted = useRef(false);
  useEffect(() => {
    if (!counted.current) {
      counted.current = true;
      store.visit(id);
    }
    setOn(store.isStarred(id));
    return store.subscribe(() => setOn(store.isStarred(id)));
  }, [store, id]);
  return (
    <button
      type="button"
      className={s.star()}
      aria-pressed={on}
      aria-label={on ? `Unstar ${name}` : `Star ${name}`}
      data-keep-star
      onClick={() => setOn(store.toggle(id))}
    >
      <KeepStar on={on} />
      <span className={s.starWord()} aria-hidden="true">
        {on ? "Starred" : "Star"}
      </span>
    </button>
  );
}

function PlaceLink({ spot }: { spot: RidingSpot }) {
  const s = styles();
  return (
    <a className={s.place()} href={spotHref(spot.id)}>
      {spot.name}
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
      <Headline>Spot forecasts</Headline>
      <p className={s.meta()}>{spots.length} riding places</p>
      <div className={s.index()}>
        {counties.map(([county, places]) => (
          <section key={county} aria-label={county}>
            <SectionHeading size="kicker" rule="thin" aside={places.length}>
              {county}
            </SectionHeading>
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
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="w-64 max-w-full" />
      <Skeleton shape="block" className="min-h-16" />
      <Skeleton shape="block" className="min-h-96" />
    </main>
  );
}

/** Scroll to an element, smoothly unless the reader has asked for less motion. */
function scrollToId(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
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
  const rows = useMemo(
    () => spotRows(forecast.hours, now, facing, rider),
    [forecast.hours, now, facing, rider],
  );
  const days = useMemo(
    () =>
      groupDays(rows)
        .filter((day) => day.hasWind)
        .slice(0, FORECAST_DAYS)
        .map((day) => {
          const sun = daySun(spot.lat, spot.lon, day.date);
          return { day, sun, window: dayWindow(day.rows, sun) };
        }),
    [rows, spot.lat, spot.lon],
  );
  // The pen's note, as its loop: only for a week whose best is worth riding.
  const best = useMemo(() => {
    const top = weekBest(
      days.map(({ day, window }) => ({ date: day.date, window })),
    );
    return top && top.window.stars >= PEN_STARS ? top : null;
  }, [days]);
  const band = useMemo(() => bandKnots(rider), [rider]);
  const turns = useMemo(() => tideTurns(forecast), [forecast]);
  const ceiling = Math.max(4.5, ...turns.map((t) => t.height)) + 0.3;
  const tides = forecast.tides;
  const stationNote = !tides
    ? "No tide station near"
    : "note" in tides
      ? tides.note
      : null;
  const [mainRef, width] = useWidth<HTMLElement>();

  // Days draw as they scroll near; a day chosen from the strip, and every day
  // before it, draws at once, so the page does not move under the scroll.
  const [eagerTo, setEagerTo] = useState(1);
  const [current, setCurrent] = useState<string | null>(null);
  const [goTo, setGoTo] = useState<string | null>(null);
  useEffect(() => {
    if (!goTo) return;
    scrollToId(`day-${goTo}`);
    setGoTo(null);
  }, [goTo]);
  const showDay = (date: string) => {
    const index = days.findIndex(({ day }) => day.date === date);
    setEagerTo((was) => Math.max(was, index));
    setCurrent(date);
    setGoTo(date);
  };

  // The strip follows the day whose header is at the top of the screen.
  const daysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = daysRef.current;
    if (!box || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            setCurrent((entry.target as HTMLElement).dataset.day ?? null);
      },
      { rootMargin: "0px 0px -90% 0px" },
    );
    box.querySelectorAll("[data-day]").forEach((el) => watch.observe(el));
    return () => watch.disconnect();
  }, [days.length]);

  const shown = current ?? days[0]?.day.date ?? "";
  const arcs = facing === null ? [] : goodWindArcs(facing);
  const sea = forecast.sea_temperature;
  const riderText = riderWords(rider);

  return (
    <main className={s.main()} ref={mainRef}>
      <Headline>{spot.name}</Headline>
      <p className={s.meta()}>
        {facing !== null ? (
          <span className={s.metaItem()} data-shore-summary>
            <FacingGlyph facing={facing} />
            <span>
              Faces <b className={s.strong()}>{compass(facing)}</b>{" "}
              {Math.round(facing)}°
            </span>
            {arcs.length > 0 && (
              <span>
                · best{" "}
                {arcs
                  .map((arc) =>
                    arc.from === arc.to ? arc.from : `${arc.from}–${arc.to}`,
                  )
                  .join(", ")}
              </span>
            )}
          </span>
        ) : (
          <span data-shore-summary>
            Facing unknown: rated on the wind alone
          </span>
        )}
        {spot.county && (
          <span className={s.metaItem()}>
            <Dot />
            {spot.county}
          </span>
        )}
        {sea && (
          <span
            className={s.metaItem()}
            data-sea-temperature
            title={`${sea.station}, ${sea.measured}`}
          >
            <Dot />
            <span>
              Sea <b className={s.strong()}>{sea.celsius.toFixed(1)}°</b>
            </span>
          </span>
        )}
      </p>
      <RiderSwitch rider={rider} onChange={changeRider} />
      <WeekStrip
        days={days.map(({ day, window }) => ({
          date: day.date,
          window,
          stars: day.stars,
          potential: day.potential,
        }))}
        current={shown}
        now={now}
        onSelect={showDay}
      />
      <div className={s.days()} ref={daysRef}>
        {days.map(({ day, sun, window }, index) => (
          <DaySection
            key={day.date}
            day={day}
            window={window}
            weekBest={best?.date === day.date}
            now={now}
            units={units}
            unitText={unitText}
            riderText={riderText}
            band={band}
            facing={facing}
            turns={turns}
            sun={sun}
            tideCeiling={ceiling}
            stationNote={stationNote}
            width={width}
            eager={index <= eagerTo}
            spotName={spot.name}
          />
        ))}
      </div>
      <SourcesFooter forecast={forecast} />
    </main>
  );
}

/** What each kind of model forecasts, for a reader who does not know them by name. */
const MODEL_KIND = new Map<string, string>([
  ...WIND_MODELS.map((model) => [model.id, "wind"] as const),
  ...WAVE_MODELS.map((model) => [model.id, "wave"] as const),
  ...WEATHER_MODELS.map((model) => [model.id, "weather"] as const),
]);

/** The server's reasons for leaving a model out, said shortly. */
const MISSING_WHY: Record<string, string> = {
  "Could not be read just now.": "could not be read just now",
  "Not published.": "not published",
  "The latest published run has already ended.": "its latest run has ended",
};

/**
 * "the MI SWAN wave model (its latest run has ended)": a model the forecast
 * went without, and why, rather than a bare name a rider cannot place.
 */
function missingWords(model: Unavailable): string {
  const kind = MODEL_KIND.get(model.id);
  const why = MISSING_WHY[model.reason];
  // "ICON-EU weather" already says what it is.
  const what =
    kind && !model.name.toLowerCase().includes(kind) ? ` ${kind}` : "";
  return `the ${model.name}${what} model${why ? ` (${why})` : ""}`;
}

/**
 * The point between the header's facts, as the shore summary has inside its
 * own: without it "best SE–SSW, N–ENE" and "Kerry" read as one list.
 */
function Dot() {
  return <span aria-hidden="true">·</span>;
}

function SourcesFooter({ forecast }: { forecast: SpotForecast }) {
  const s = styles();
  const { sources } = forecast;
  const tides =
    forecast.tides && "station" in forecast.tides ? forecast.tides : null;
  const sea = forecast.sea_temperature;
  return (
    <footer className={s.footer()} aria-labelledby="sources-title">
      <Kicker as="h2" id="sources-title">
        Where this comes from
      </Kicker>
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
        </li>
        {sources.waves && <li>Waves: {sources.waves.name}.</li>}
        {sources.weather && <li>Sky, air and rain: {sources.weather.name}.</li>}
        {tides && (
          <li>
            Tides: {tides.station}, {tides.distance_km} km away, above{" "}
            {tides.datum}
            {tides.attribution ? ` · ${tides.attribution}` : ""}.
          </li>
        )}
        {sea && (
          <li>
            Sea: {sea.station}, {sea.measured}
            {sea.attribution ? ` · ${sea.attribution}` : ""}.
          </li>
        )}
        {sources.unavailable.length > 0 && (
          <li className={s.muted()}>
            Left out of this forecast:{" "}
            {sources.unavailable.map(missingWords).join("; ")}.
          </li>
        )}
      </ul>
      <p className="m-0">
        Times are Irish.{" "}
        <a className={s.link()} href={STARS_HREF}>
          How the stars work
        </a>
      </p>
      <p className={s.safety()}>
        Model forecasts only, not a safety statement. Look at the water, and
        never ride alone in offshore wind.
      </p>
    </footer>
  );
}
