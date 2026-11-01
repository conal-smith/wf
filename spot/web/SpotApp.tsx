/**
 * A riding place's own page, at /spot/<id>, set as the chart's broadsheet: the
 * place's name, the week in one strip, then day after day
 * down the page, every daylight hour a row of figures, and the tide and the
 * light under each day. No day is rated: the hours carry the stars. `src/main.tsx`
 * lazy-loads it, so it never carries the map, MapLibre or the other sections;
 * it reads the published forecast through the MCP server's own reduction, so
 * the page and an agent can never be told two different forecasts.
 *
 * /spot with no id is the index of every place; /stars is "How the stars
 * work" (StarsPage.tsx), the bundle's other page.
 */
import { MapPin, RefreshCw } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { starsFromAt } from "../../force5/src/lead";
import { loadPrefs, saveRider } from "../../force5/src/prefs";
import {
  CHART_HREF,
  isStarsPath,
  mapSpotHref,
  spotHref,
  spotIdFromPath,
} from "../../force5/src/siteNav";
import type { Rider } from "../../force5/src/stars";
import { type RidingSpot, type SpotForecast } from "../../mcp/api/forecast";
import { favourites } from "../../shared/web/favourites";
import { onPrefsChange, signedInHint } from "../../shared/web/riderSync";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Button,
  Empty,
  Headline,
  Notice,
  SectionHeading,
  Skeleton,
} from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import { SpotFrame } from "./Frame";
import { KeepStar } from "./glyphs";
import { loadSpotPictures } from "./satellite";
import StarsPage from "./StarsPage";
import { useSpotForecast } from "./useSpotForecast";
import { SpotReport } from "./report/SpotReport";
import { WarningsPanel } from "./Warnings";
import { WaterQualityPanel } from "./WaterQuality";

const styles = tv({
  slots: {
    main: "relative flex flex-col gap-4 pt-4 pb-12 max-sm:pt-3",
    // Met Éireann's warnings and the bathing water notices. Where the page
    // has a margin as wide as the list, they stand in it, beside the name and
    // the picture: there they add nothing above the forecast, which then
    // starts where it would with none at all.
    notices: "mb-4 grid gap-3 wide:grid-cols-2",
    // The facts are kept apart by points (Dot), so the gap between them is
    // the point's own spacing either side.
    meta: [
      "m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-muted",
      MONO_LABEL,
    ],
    metaItem: "inline-flex items-center gap-1.5",
    strong: "font-semibold text-ink",
    water: "m-0 -mt-2 font-body text-body text-ink",
    star: [
      "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-ground px-4 font-body text-body font-medium text-ink",
      "pointer-coarse:min-h-touch not-disabled:hover:bg-sunken",
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
    <SpotFrame back={id ? mapSpotHref(id) : CHART_HREF}>
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
        <SpotPage
          spot={state.spot}
          forecast={state.forecast}
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

function SpotPage({
  spot,
  forecast,
  rider,
}: {
  spot: RidingSpot;
  forecast: SpotForecast;
  rider: Rider;
  onRider: (rider: Rider) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const units = useMemo(() => loadPrefs().units, []);
  const s = styles();
  const warned =
    (forecast.warnings.status === "current" &&
      forecast.warnings.items.length > 0) ||
    (forecast.water_quality.status === "current" &&
      forecast.water_quality.items.length > 0);
  return (
    <SpotReport
      spot={spot}
      forecast={forecast}
      rider={rider}
      units={units}
      now={now}
      actions={<KeepButton id={spot.id} name={spot.name} />}
      notices={
        warned && (
          <div className={s.notices()}>
            <WarningsPanel warnings={forecast.warnings} />
            <WaterQualityPanel water={forecast.water_quality} />
          </div>
        )
      }
    />
  );
}

/** How far off a station is before the page says it may not be the beach's water. */
