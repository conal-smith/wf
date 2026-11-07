/**
 * A riding place's own page, at /spot/<id>: the spot report
 * (report/SpotReport.tsx), with its warnings and notices (Notices.tsx) above
 * the cards. `src/main.tsx` lazy-loads it, so it never carries the map,
 * MapLibre or the other sections; it reads the published forecast through
 * the MCP server's own reduction, so the page and an agent can never be told
 * two different forecasts.
 *
 * /spot with no id is the index of every place, by county; /stars is "How
 * the stars work" (StarsPage.tsx), the bundle's other page.
 */
import { CloudOff, MapPin } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { starsFromAt } from "../../force5/src/lead";
import { loadPrefs, saveRider } from "../../force5/src/prefs";
import { useNightHours } from "../../shared/web/useNightHours";
import {
  CHART_HREF,
  isStarsPath,
  mapSpotHref,
  pointFromId,
  spotHref,
  spotIdFromPath,
} from "../../force5/src/siteNav";
import type { Rider } from "../../force5/src/stars";
import { type RidingSpot, type SpotForecast } from "../../mcp/api/forecast";
import { favourites } from "../../shared/web/favourites";
import { onPrefsChange, signedInHint } from "../../shared/web/riderSync";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, Empty, Heading, Row, Rows, Skeleton } from "../../ui";
import { RING, tv } from "../../ui/tv";
import { SpotFrame } from "./Frame";
import { KeepHeart } from "./glyphs";
import { loadSpotPictures } from "./satellite";
import StarsPage from "./StarsPage";
import { useSpotForecast } from "./useSpotForecast";
import { atFromSearch } from "./report/detail";
import { SpotReport, type ReportPoint } from "./report/SpotReport";
import { SpotNotices, hasNotices } from "./Notices";

const styles = tv({
  slots: {
    main: "relative flex flex-col gap-4 pt-7 pb-12 max-sm:pt-5",
    starWord: "max-sm:sr-only",
    address: "wrap-anywhere text-ink",
    // The index: a county a section, kept apart by space, its name beside
    // its places on a wide screen; the places in one soft card, as many
    // columns of plain links as fit.
    index: "flex flex-col gap-6 pt-6",
    county: "grid items-start gap-3 wide:grid-cols-shell wide:gap-6",
    countyHead: "wide:pt-3.5",
    count: "font-body text-body font-normal text-ink-muted tabular-nums",
    places:
      "m-0 grid list-none grid-cols-cards gap-x-6 rounded-surface bg-sunken on-card px-5 py-2 max-wide:px-4",
    place: [
      "flex min-h-10 items-center rounded-control font-body text-body font-medium text-ink no-underline",
      "transition-colors duration-fast hover:text-chart-magenta pointer-coarse:min-h-touch",
      RING,
    ],
    candidates: "w-full max-w-form text-left",
  },
});

// The account's copy of the rider, on a device that has signed in before.
const AccountRider = lazy(() => import("../../shared/web/AccountRider"));

export default function SpotApp() {
  const path = window.location.pathname;
  const [syncAccount] = useState(
    () => signedInHint() || Boolean(import.meta.env.VITE_MARKET_DEV_USER),
  );
  return (
    <>
      {isStarsPath(path) ? (
        <StarsPage />
      ) : (
        <SpotRoute id={spotIdFromPath(path)} />
      )}
      {syncAccount && (
        <Suspense fallback={null}>
          <AccountRider />
        </Suspense>
      )}
    </>
  );
}

/**
 * Who the stars are for, kept on the device (force5.prefs.v1) and changed
 * from the rider line or an hour's card. Held above the page because the
 * forecast itself is read for it: the stars come from the model it names.
 */
function useRider() {
  const [rider, setRider] = useState<Rider>(() => loadPrefs().rider);
  // A rating adopted from the account, or changed in another tab.
  useEffect(() => onPrefsChange(() => setRider(loadPrefs().rider)), []);
  // Saved over what is stored now, so a change made on the map in another
  // tab, or the rider's own stars, are not undone.
  const changeRider = (next: Rider) => setRider(saveRider(next).rider);
  return [rider, changeRider] as const;
}

function SpotRoute({ id }: { id: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const [rider, changeRider] = useRider();
  const state = useSpotForecast(id, attempt, starsFromAt(rider.starsFrom));
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
  // The list of satellite pictures is read beside the forecast, not after it.
  useEffect(() => {
    if (id !== null) void loadSpotPictures();
  }, [id]);

  return (
    // A point on the water goes back to the chart, which has no light for it.
    <SpotFrame back={id && !pointFromId(id) ? mapSpotHref(id) : CHART_HREF}>
      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && (
        <main className={s.main()}>
          <Empty
            as="h1"
            alert
            title="The forecast could not be loaded"
            icon={<CloudOff size={24} strokeWidth={1.75} />}
            actions={
              <>
                <Button
                  variant="primary"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try again
                </Button>
                <Button variant="quiet" href="/spot">
                  All places
                </Button>
              </>
            }
          >
            <p className="m-0">
              Check your connection. If it is fine, the latest forecast is late
              reaching us, so try again in a few minutes.
            </p>
          </Empty>
        </main>
      )}
      {state.kind === "unknown" && (
        <main className={s.main()}>
          {/* The address goes in the line under the title, not in it: an
              address breaks at its hyphens, and a title that leaves "all”"
              alone on its last line is worse than one that never names it. */}
          <Empty
            as="h1"
            title="No riding place at this address"
            icon={<MapPin size={24} strokeWidth={1.75} />}
            actions={
              <>
                <Button href="/spot">All places</Button>
                <Button variant="quiet" href={CHART_HREF}>
                  The chart
                </Button>
              </>
            }
          >
            <p className="m-0">
              Nothing is called{" "}
              <span className={s.address()}>“{state.id}”</span>.{" "}
              {state.candidates.length
                ? "Did you mean one of these?"
                : "It may have been renamed. Every place is on the map, and in the list of all places."}
            </p>
            {state.candidates.length > 0 && (
              <Rows className={s.candidates()}>
                {state.candidates.map((spot) => (
                  <PlaceRow key={spot.id} spot={spot} />
                ))}
              </Rows>
            )}
          </Empty>
        </main>
      )}
      {state.kind === "index" && <SpotIndex spots={state.spots} />}
      {state.kind === "ready" && (
        <SpotPage
          spot={state.spot}
          forecast={state.forecast}
          point={state.point ?? null}
          rider={rider}
          onRider={changeRider}
        />
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
    <Button
      pressed={on ? "worded" : false}
      aria-label={`Save ${name}`}
      data-keep-star
      onClick={() => setOn(store.toggle(id))}
    >
      <KeepHeart on={on} />
      <span className={s.starWord()} aria-hidden="true">
        {on ? "Saved" : "Save"}
      </span>
    </Button>
  );
}

/** A place it may have meant: its name and county, the way to its page. */
function PlaceRow({ spot }: { spot: RidingSpot }) {
  return (
    <Row
      inList
      href={spotHref(spot.id)}
      title={spot.name}
      detail={spot.county || undefined}
      chevron
    />
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
      <Heading
        level="page"
        lead={`${spots.length} riding places, by county, each with its forecast hour by hour.`}
      >
        Spot forecasts
      </Heading>
      <div className={s.index()}>
        {counties.map(([county, places]) => (
          <section
            key={county}
            className={s.county()}
            aria-labelledby={`county-${county}`}
          >
            <Heading
              level="card"
              as="h2"
              id={`county-${county}`}
              className={s.countyHead()}
              aside={
                <span className={s.count()}>
                  {places.length} {places.length === 1 ? "place" : "places"}
                </span>
              }
            >
              {county}
            </Heading>
            <ul className={s.places()}>
              {places.map((spot) => (
                <li key={spot.id}>
                  <a className={s.place()} href={spotHref(spot.id)}>
                    {spot.name}
                  </a>
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

function SpotPage({
  spot,
  forecast,
  point,
  rider,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
  /** A point on the open water: no star to keep it by, and no stars. */
  point: ReportPoint | null;
  rider: Rider;
  onRider: (rider: Rider) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const { units, blendModels, waveModel } = useMemo(() => loadPrefs(), []);
  // Whether the week shows the hours after dark (Settings), kept on the
  // device and followed as it changes.
  const nightHours = useNightHours();
  // The hour a link opens the week at (`?at=`, siteNav's spotHref), read
  // once: the week opens there, and then it is the rider's.
  const [at] = useState(() => atFromSearch(window.location.search));
  return (
    <SpotReport
      spot={spot}
      forecast={forecast}
      rider={rider}
      units={units}
      nightHours={nightHours}
      now={now}
      at={at}
      blendModels={blendModels}
      waveModel={waveModel}
      point={point}
      actions={point ? null : <KeepButton id={spot.id} name={spot.name} />}
      notices={
        hasNotices(forecast.warnings, forecast.water_quality) && (
          <SpotNotices
            warnings={forecast.warnings}
            water={forecast.water_quality}
          />
        )
      }
    />
  );
}
