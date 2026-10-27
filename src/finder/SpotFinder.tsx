/**
 * The spot finder, the home page at /: where is good for this rider this week. The
 * places (their favourites, or every one round them: it opens on the
 * favourites once there are some, else on the places round the rider, so a
 * first visit is never empty) as cards, the best
 * first: the most stars in today and the five days after it, the soonest,
 * then the nearest. Each card is the place from above with the ride rose on
 * it, today hour by hour from first light to last, and the next five days
 * (src/finder/SpotCard.tsx). The approved design is
 * backlog/mockups/2026-10-25-spot-list-cards.html, its "7e".
 *
 * Over the cards, "Find a spot…": a name typed lists the places it names,
 * from every place and not only the tab's, best match first, so a rider
 * after one place, or with nothing starred yet, has it in a few letters.
 * The tab is in the address (`/?tab=favourites`, finder.ts `TAB_PARAM`)
 * once one is chosen, so either can be linked to, kept and reloaded.
 *
 * The home page (since 26 October 2026). On a wide screen the chart stands
 * beside the list, drawn by src/App.tsx over the room the list leaves it
 * (`beside`); the list tells it which places it shows, at which hour, which
 * card is under the pointer and where the rider is. Under that width the
 * list is alone, with a button to the chart. No timeline at its head, and
 * not tied to the chart's time. The cards keep one time between them, as a dashboard's
 * charts do: a day pressed among the next ones is drawn hour by hour on
 * every card in today's place (today goes among the others, to come back
 * to); an hour picked on one card's day is picked on every card, its rose
 * turned to it; and a mouse over a card's hours, or over a day, draws a
 * dotted line at that time on every card (src/finder/hover.ts). The picture
 * opens the chart there, at the hour its rose shows. No legend: the stars
 * and the wind's colours are the site's own, said once on the Info page.
 *
 * A page of the map's bundle, drawn by src/App.tsx under the chart and
 * loaded as a chunk of its own. Its wind and its
 * stars are the chart's own rated hours, handed in; the places it lists are
 * handed back (`onWant`), so the chart reads their squares and rates them
 * first. Their sky, air, sea and tide it reads itself, as the dock reads a
 * place's (src/finder/useReadings.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { isChartAddress } from "../../force5/src/siteNav";
import { Link } from "../../ui/Link";
import { PageHeader } from "../../ui/PageHeader";
import { SearchField } from "../../ui/SearchField";
import { Segmented } from "../../ui/Segmented";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import { findSpots } from "../spotSearch";
import {
  dayLong,
  dayShort,
  irishDate,
  openingColumn,
  type StripColumn,
} from "../strip";
import {
  cardDates,
  columnsByTime,
  dayOpening,
  dayPlan,
  dayRow,
  distanceKm,
  FOUND_COUNT,
  hourOf,
  listFor,
  openingScope,
  pickHour,
  rankSpots,
  scopeAddress,
  scopeInAddress,
  shownColumn,
  weekBest,
  type Listed,
  type Scope,
} from "./finder";

export type { Scope };
import { HoverContext, hoverStore } from "./hover";
import { useRiderPlace } from "./location";
import { CardSkeleton, SpotCard } from "./SpotCard";
import { useReadings } from "./useReadings";

const styles = tv({
  slots: {
    root: "fixed inset-0 flex flex-col bg-ground paper-grain font-body text-ink antialiased",
    body: "flex min-h-0 flex-1",
    list: [
      "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4.5 pt-3.5 pb-10",
      "max-wide:px-2.5 max-wide:pt-2.5 max-wide:pb-20",
    ],
    // Under the chart's width, room at the foot for the button to the map.
    alone: "pb-24 max-wide:pb-24",
    // Find a spot by name, over the cards: a rule to write on, as the
    // chart's, no wider than a line of reading.
    find: "mb-3.5 max-w-reading max-wide:mb-2.5",
    // One column, two where each card has its room (`cards:`, 1180px).
    cards:
      "m-0 grid list-none grid-cols-1 items-start gap-3.5 p-0 cards:grid-cols-2",
    empty: "py-8 text-prose text-ink-2",
    // Above the cards: where "near you" is measured from, when that is not
    // the rider.
    note: "m-0 pb-3 text-prose text-ink-2",
  },
});

const SCOPES = [
  { value: "favourites", label: "Favourites" },
  { value: "near", label: "Near you" },
] as const;

export interface FinderProps {
  spots: readonly Spot[];
  /** The chart's table of rated hours, and its version. */
  hours: ReadonlyMap<string, PlaceHour[]>;
  version: number;
  /** The chart's strip of columns: the hours are rated on it. */
  strip: readonly StripColumn[];
  /** The time now, as the chart keeps it. */
  now: number;
  starred: readonly string[];
  onToggleStar: (id: string) => void;
  rider: Rider;
  units: Units;
  reducedMotion: boolean;
  phone: boolean;
  /**
   * The places the finder lists, which it needs rated, and which list:
   * the tab, or a search (`find:` and the words), so the chart beside it is
   * fitted again when the list is another.
   */
  onWant: (ids: readonly string[], list: string) => void;
  /** The chart stands beside the list, in the room it leaves on the right. */
  beside?: boolean;
  /** A mouse comes onto a place's card, or leaves it (null). */
  onHover?: (id: string | null) => void;
  /** The time every card shows, as it changes. */
  onShown?: (time: number) => void;
  /** Where the rider is, once their browser has said; else null. */
  onPlace?: (at: { lat: number; lon: number } | null) => void;
  /** The head, for the chart beside the list to stand under it. */
  headRef?: (el: HTMLElement | null) => void;
  /** The chart, on a place, at a column of the strip (null: as it is). */
  onInChart: (spot: Spot, at: number | null) => void;
  /** The site menu, with its rows for this page. */
  menu: ReactNode;
  /**
   * The list is on the screen, not waiting under the full chart. The tab it
   * opens on is chosen, and the browser asked where the rider is, only once
   * it is.
   */
  onScreen?: boolean;
}

export default function SpotFinder(props: FinderProps) {
  const {
    spots,
    hours,
    version,
    strip,
    now,
    starred,
    onToggleStar,
    rider,
    units,
    reducedMotion,
    phone,
    onWant,
    onInChart,
    menu,
    beside = false,
    onHover,
    onShown,
    onPlace,
    headRef,
    onScreen = true,
  } = props;
  const s = styles();
  // The tab: the one the address names, else, once the list has been on
  // the screen, the one it opened on; until then the one it would open on:
  // Favourites with a place starred, else Near you.
  const [kept, setScope] = useState<Scope | null>(() =>
    scopeInAddress(location.search),
  );
  const scope = kept ?? openingScope(starred);
  // Whether the address is to name the tab: one was chosen, or named.
  const [named, setNamed] = useState(() => kept !== null);
  const [asked, setAsked] = useState(false);
  // Near you asks where the rider is, chosen or opened on.
  const place = useRiderPlace(asked || (onScreen && scope === "near"));
  useEffect(() => {
    if (!onScreen) return;
    if (kept === null) setScope(scope);
    if (scope === "near") setAsked(true);
  }, [onScreen, kept, scope]);
  // The tab in the address, in place: the list's own address, never the
  // full chart's over it. Again as the list comes back on the screen, whose
  // address may have been written without it (the menu's Spot finder).
  useEffect(() => {
    if (!onScreen || !named) return;
    const url = window.location;
    if (url.pathname !== "/" || isChartAddress(url)) return;
    if (scopeInAddress(url.search) === scope) return;
    window.history.replaceState(
      window.history.state,
      "",
      scopeAddress(url.href, scope),
    );
  }, [onScreen, named, scope]);
  // Back or Forward to a list whose address names the other tab.
  useEffect(() => {
    const pop = () => {
      const tab = scopeInAddress(window.location.search);
      if (tab) setScope(tab);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  // A spot's name typed over the cards.
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  // The day drawn hour by hour on every card; null is today.
  const [chosen, setChosen] = useState<string | null>(null);
  // The hour picked on that day's row, for every card; null is the hour the
  // day stands at (now, today).
  const [picked, setPicked] = useState<number | null>(null);
  // The time under a mouse, shared by every card without drawing them again.
  const [hover] = useState(hoverStore);

  const chooseScope = (next: Scope) => {
    if (next === "near") setAsked(true);
    setScope(next);
    setNamed(true);
    setQuery("");
  };

  // Where "near you" and the distances are measured from: the rider's
  // place once the browser has said. Without it, the places nearest where
  // the chart was last centred, or the middle of Ireland, with no distances;
  // and none while the browser is first asked.
  const known = place.source === "rider";
  const waiting = !searching && scope === "near" && place.asking;
  // The places themselves not read yet (src/App.tsx reads them with the
  // forecast's first manifest): the shapes of the cards to come, not the
  // empty list's words.
  const placesDue =
    spots.length === 0 &&
    !waiting &&
    (searching || scope === "near" || starred.length > 0);
  const listed = useMemo(
    () =>
      searching
        ? findSpots(spots, query, starred)
            .slice(0, FOUND_COUNT)
            .map((spot) => ({
              spot,
              km: known ? distanceKm(place.at, spot) : null,
            }))
        : waiting
          ? []
          : listFor(scope, spots, starred, place.at, known),
    [scope, spots, starred, place.at, known, waiting, searching, query],
  );

  const wanted = listed.map((l) => l.spot.id);
  const wantKey = wanted.join(",");
  const listKey = searching ? `find:${query.trim()}` : scope;
  useEffect(() => onWant(wanted, listKey), [wantKey, listKey]);
  const placeLat = known ? place.at.lat : null;
  const placeLon = known ? place.at.lon : null;
  useEffect(
    () =>
      onPlace?.(
        placeLat === null || placeLon === null
          ? null
          : { lat: placeLat, lon: placeLon },
      ),
    [placeLat, placeLon],
  );

  const hourKey = hourOf(now);
  const dates = useMemo(() => cardDates(now), [hourKey]);
  // A day chosen yesterday that is today now, or gone, is today again.
  const day = chosen !== null && dates.includes(chosen) ? chosen : dates[0];
  const isToday = day === dates[0];
  // An hour picked on another day is not one of this day's to show.
  const pick = picked !== null && irishDate(picked) === day ? picked : null;
  const chooseDay = (date: string) => {
    setChosen(date === dates[0] ? null : date);
    setPicked(null);
  };
  const byTime = useMemo(() => columnsByTime(strip), [strip]);
  // A search's places stay in the order they match the words; a tab's are
  // the best of the week first.
  const ranked: Listed[] = useMemo(() => {
    const rated = listed.map(({ spot, km }) => ({
      spot,
      km,
      best: weekBest(hours.get(spot.id), strip, dates, now),
    }));
    return searching ? rated : rankSpots(rated);
  }, [listed, searching, hours, version, strip, dates, hourKey]);

  const listedSpots = useMemo(() => listed.map((l) => l.spot), [listed]);
  const axis = useMemo(() => strip.map((c) => c.validTime), [strip]);
  const readings = useReadings(listedSpots, axis);

  // The day's row and the other five days, at each place's own light.
  const plans = useMemo(
    () =>
      new Map(
        listedSpots.map((spot) => [
          spot.id,
          {
            day: dayRow(strip, spot, day, now, byTime),
            days: dates
              .filter((date) => date !== day)
              .map((date) => dayPlan(strip, spot, date)),
          },
        ]),
      ),
    [listedSpots, strip, byTime, dates, day, hourKey],
  );

  // Where the day stands with no hour picked: now, today, as the chart
  // would open; a day chosen, its early afternoon.
  const opening = isToday
    ? strip.length
      ? openingColumn(strip, now)
      : null
    : dayOpening(strip, day, now);
  const roseAt = shownColumn(strip, pick, opening, byTime);
  const noon = Date.parse(`${day}T12:00:00Z`);
  const standing = isToday
    ? hourOf(now)
    : opening === null
      ? noon
      : strip[opening].time;
  const shown = pick ?? standing;
  useEffect(() => onShown?.(shown), [shown]);
  const dayName = isToday
    ? { short: "Today", long: "Today" }
    : {
        short: `${dayShort(noon)} ${Number(day.slice(8))}`,
        long: `${dayLong(noon)} ${Number(day.slice(8))}`,
      };

  return (
    <div
      className={s.root()}
      data-spot-finder
      data-scope={scope}
      data-beside-chart={beside || undefined}
    >
      <PageHeader menu={menu} headRef={headRef}>
        <Segmented
          aria-label="Which spots"
          options={SCOPES}
          value={scope}
          onChange={chooseScope}
        />
      </PageHeader>
      <div className={s.body()}>
        <section
          className={s.list({ class: beside ? undefined : s.alone() })}
          aria-label={
            searching
              ? "Spots found"
              : scope === "near"
                ? "Spots near you"
                : "Favourites"
          }
          aria-busy={waiting || placesDue || undefined}
          data-finder-list
        >
          <SearchField
            size="md"
            className={s.find()}
            aria-label="Find a spot"
            placeholder="Find a spot…"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                setQuery("");
                event.stopPropagation();
              }
            }}
            data-finder-find
          />
          {!searching &&
            scope === "near" &&
            !known &&
            !waiting &&
            ranked.length > 0 && (
              <p className={s.note()} data-finder-note>
                {place.source === "chart"
                  ? "We don’t know where you are, so these are the spots nearest the part of the chart you last looked at."
                  : "We don’t know where you are, so these are the spots nearest the middle of Ireland."}
              </p>
            )}
          {placesDue ? (
            <div className={s.cards()} data-finder-loading>
              {Array.from(
                {
                  length: Math.min(
                    4,
                    scope === "near" || searching
                      ? 4
                      : Math.max(1, starred.length),
                  ),
                },
                (_, k) => (
                  <CardSkeleton
                    key={k}
                    words={k === 0 ? "Loading the spots…" : undefined}
                  />
                ),
              )}
            </div>
          ) : ranked.length ? (
            <HoverContext.Provider value={hover}>
              <ul
                className={s.cards()}
                data-finder-cards
                data-day-chosen={isToday ? undefined : day}
              >
                {ranked.map((item, order) => {
                  const plan = plans.get(item.spot.id);
                  return (
                    <li
                      key={item.spot.id}
                      className="min-w-0"
                      onMouseEnter={
                        onHover ? () => onHover(item.spot.id) : undefined
                      }
                      onMouseLeave={onHover ? () => onHover(null) : undefined}
                    >
                      <SpotCard
                        spot={item.spot}
                        km={item.km}
                        row={hours.get(item.spot.id)}
                        strip={strip}
                        day={plan?.day ?? null}
                        dayName={dayName}
                        isToday={isToday}
                        days={plan?.days ?? []}
                        readings={
                          readings.get(item.spot.id) ?? {
                            sky: [],
                            air: [],
                            sea: [],
                            tides: [],
                          }
                        }
                        picked={pick}
                        shown={shown}
                        roseAt={roseAt}
                        now={now}
                        rider={rider}
                        units={units}
                        starred={starred.includes(item.spot.id)}
                        phone={phone}
                        reducedMotion={reducedMotion}
                        onToggleStar={() => onToggleStar(item.spot.id)}
                        onPick={(time) => setPicked(pickHour(time, standing))}
                        onChooseDay={chooseDay}
                        onChart={() => onInChart(item.spot, roseAt)}
                        order={order}
                        best={item.best}
                      />
                    </li>
                  );
                })}
              </ul>
            </HoverContext.Provider>
          ) : (
            <p className={s.empty()} data-finder-empty>
              {searching ? (
                "No spot by that name."
              ) : scope === "favourites" ? (
                <>
                  Star a spot and it shows here. Find one by name above, see the{" "}
                  <Link
                    href={scopeAddress(window.location.href, "near")}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey)
                        return;
                      event.preventDefault();
                      chooseScope("near");
                    }}
                  >
                    spots near you
                  </Link>
                  , or <Link href="/spot">browse every spot</Link>.
                </>
              ) : waiting ? (
                "Finding spots near you…"
              ) : known ? (
                "No spots within 30 km of you."
              ) : (
                ""
              )}
            </p>
          )}
        </section>
        {/* The room the chart stands in beside the list (src/App.tsx). */}
        {beside && <div className="finder-side" aria-hidden="true" />}
      </div>
    </div>
  );
}
