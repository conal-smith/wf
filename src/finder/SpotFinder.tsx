/**
 * The spot finder, the home page at /: where is good for this rider, on one
 * day at a time. The places (their favourites, or every one round them: it
 * opens on the favourites once there are some, else on the places round the
 * rider, so a first visit is never empty) as cards, the best first: the most
 * stars on the day shown, then the nearest. Each card is the place from
 * above with the ride rose on it, and the day hour by hour from first light
 * to last as two bars, the wind and the stars (src/finder/SpotCard.tsx).
 *
 * Over the cards, one row: Favourites or Nearby, how many spots the list
 * holds, and a filter button. The filter opens a sheet with the fewest stars
 * a place is to have, the list's order (the best first, the nearest, A to Z)
 * and the model the stars are rated from (the rider's own, as the spot page
 * and Settings set it); a dot on the button says the list is narrowed or
 * reordered. Under it, the day: ‹ Today › steps through today and the five
 * days after it (src/finder/DaySteps.tsx). It opens on today, and once
 * today's rows are over (the hour after last light, finder.ts `todayOver`)
 * on tomorrow, at the hour it opens on. A spot is found by name with the top bar's search
 * (ui/SpotSearch.tsx), which goes to its page. The tab is in the
 * address (`/?tab=favourites`, finder.ts `TAB_PARAM`) once one is chosen, so
 * either can be linked to, kept and reloaded.
 * Near you never asks the browser where the rider is unasked: without
 * their place it is the spots nearest where the chart was, which give no
 * distances, and nothing over the cards says so. "Use my location" is in the
 * filter sheet.
 *
 * The home page (since 26 October 2026). On a wide screen the chart stands
 * beside the list, drawn by src/App.tsx over the room the list leaves it
 * (`beside`); the list tells it which places it shows, at which hour, which
 * card is under the pointer and where the rider is. Under that width the
 * list is alone, with a button to the chart. No timeline at its head, and
 * not tied to the chart's time. The cards keep one time between them, as a
 * dashboard's charts do: the day stepped to is the day on every card, and an
 * hour picked on one card's bars is picked on every card, its rose turned to
 * it, and on the chart beside them. Today, the hour they stand at is the
 * hour now, the nearest one (19:59 is 20:00, finder.ts `nearestHour`); any
 * other day, the hour it opens on. A card opens its spot's page; the chart
 * is a button away in the top bar. No legend: the stars and the wind's
 * colours are the site's own, said once on the Info page.
 *
 * A page of the map's bundle, drawn by src/App.tsx under the chart and
 * loaded as a chunk of its own. Its wind and its
 * stars are the chart's own rated hours, handed in; the places it lists are
 * handed back (`onWant`), so the chart reads their squares and rates them
 * first. Their sky, air, sea and tide it reads itself, as the dock reads a
 * place's (src/finder/useReadings.ts).
 */
import { useEffect, useMemo, useState } from "react";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { modelName, STARS_CHOICES } from "../../force5/src/lead";
import { isChartAddress } from "../../force5/src/siteNav";
import { MapPin, SlidersHorizontal } from "lucide-react";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Dialog } from "../../ui/Dialog";
import { Link } from "../../ui/Link";
import { Segmented } from "../../ui/Segmented";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import { irishDate, onDay, openingColumn, type StripColumn } from "../strip";
import {
  HOUR,
  bestStars,
  cardDates,
  columnsByTime,
  dayOpening,
  dayRow,
  listFor,
  nearestHour,
  openingDay,
  openingScope,
  orderSpots,
  pickHour,
  rankSpots,
  scopeAddress,
  scopeInAddress,
  shownColumn,
  withStars,
  type Listed,
  type Order,
  type Scope,
} from "./finder";

export type { Scope };
import { DaySteps } from "./DaySteps";
import { HoverContext, hoverStore } from "./hover";
import { knownBefore, useRiderPlace } from "./location";
import { CardSkeleton, SpotCard, type SpotCardProps } from "./SpotCard";
import { useReadings } from "./useReadings";
import {
  isStale,
  latestReading,
  pairStation,
  type WindStation,
} from "../../force5/src/windObs";

const styles = tv({
  slots: {
    // The list on the ground, the cards a shade off it; under the top bar
    // (src/App.tsx draws the bar, fixed at the top of the window).
    root: "flex flex-col bg-ground font-body text-ink antialiased",
    // Beside the chart the list scrolls in its own box under the bar. Alone,
    // it scrolls the page itself: a phone's browser then folds its bars
    // away as the reader scrolls, as it never does for a box of its own.
    split: "fixed inset-x-0 top-16 bottom-0 max-wide:top-14",
    page: "relative min-h-dvh pt-16 max-wide:pt-14",
    body: "flex min-h-0 flex-1",
    list: [
      "min-h-0 min-w-0 flex-1 px-3.5 pt-4 pb-10",
      "max-wide:px-3 max-wide:pt-3 max-wide:pb-20",
    ],
    scroller: "overflow-y-auto overscroll-contain",
    // Room at the foot of a phone's list.
    alone: "pb-24 max-wide:pb-24",
    // The list's head, one row: which spots, how many, and the filter.
    head: "flex items-center gap-2.5 px-0.5 pb-3",
    title:
      "m-0 min-w-0 flex-1 truncate text-right font-body text-body font-medium text-ink-muted",
    filter: "relative shrink-0",
    // On the filter button: the list is narrowed or reordered.
    dot: "pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-pen",
    // The filter sheet: a group a heading, its choices under it.
    filters: "grid gap-5",
    group: "m-0 grid gap-2 border-0 p-0",
    groupName: "m-0 p-0 font-body text-body font-medium text-ink-muted",
    filterRow: "flex flex-wrap items-center gap-2",
    // One card a row beside the chart; alone on a wide window, two, so a
    // card's hours never stretch across the screen.
    cards: "m-0 grid list-none grid-cols-1 items-start gap-2 p-0",
    cardsAlone: "rail:grid-cols-2",
    empty:
      "rounded-surface bg-sunken on-card px-4 py-3.5 text-prose leading-normal text-ink-2",
  },
});

const SCOPES = [
  { value: "favourites", label: "Favourites" },
  { value: "near", label: "Nearby" },
] as const;

/** The fewest stars a place is to have on the day shown, as chips. */
const FEWEST = [
  { value: 0, label: "Any stars" },
  { value: 3, label: "3+ stars" },
  { value: 4, label: "4+ stars" },
  { value: 5, label: "5 stars" },
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
   * The places the finder lists, which it needs rated, and which list (the
   * tab), so the chart beside it is fitted again when the list is another.
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
  /** The list is drawn: the chart beside it may be made. */
  onDrawn?: () => void;
  /** The model the stars are rated from, the rider's own, as on the spot page. */
  model: string;
  /** The rider picks another: theirs from now on, everywhere. */
  onModel: (id: string) => void;
  /**
   * The list is on the screen, not waiting under the full chart. The tab it
   * opens on is chosen, and the browser asked where the rider is, only once
   * it is.
   */
  onScreen?: boolean;
  /**
   * The weather stations and buoys with their readings (force5/src/windObs.ts),
   * or null until read: a card on today says what its nearest one measured.
   */
  stations?: readonly WindStation[] | null;
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
    beside = false,
    onHover,
    onShown,
    onPlace,
    onDrawn,
    onScreen = true,
    model,
    onModel,
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
  // The browser is asked where the rider is only when they press "Use my
  // location" in the filter sheet; a place kept from an earlier yes is read
  // again quietly on Near you.
  const [asked, setAsked] = useState(false);
  const place = useRiderPlace(
    asked || (onScreen && scope === "near" && knownBefore()),
  );
  useEffect(() => {
    if (onScreen && kept === null) setScope(scope);
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
  useEffect(() => onDrawn?.(), []);
  // The day stepped to, drawn hour by hour on every card; null is the day the
  // finder opens on (today, or tomorrow once today is over).
  const [chosen, setChosen] = useState<string | null>(null);
  // The hour picked on that day's row, for every card; null is the hour the
  // day stands at (now, today).
  const [picked, setPicked] = useState<number | null>(null);
  // The time under a mouse, shared by every card without drawing them again.
  const [hover] = useState(hoverStore);

  // The list's order, and the fewest stars a place has on the day shown.
  const [order, setOrder] = useState<Order>("best");
  const [fewest, setFewest] = useState(0);
  // The filter sheet.
  const [filtering, setFiltering] = useState(false);

  const chooseScope = (next: Scope) => {
    setScope(next);
    setNamed(true);
  };

  // Where "near you" and the distances are measured from: the rider's
  // place once the browser has said. Without it, the places nearest where
  // the chart was last centred, or the middle of Ireland, with no distances;
  // and none while the browser is first asked.
  const known = place.source === "rider";
  // A filter at work on the tab's list (an order counts, a nearest first
  // without the rider's place being the best first): Clear takes the list
  // back to the whole of it.
  const ordered = order === "near" && !known ? "best" : order;
  const narrowing = fewest > 0 || ordered !== "best";
  const clearNarrowing = () => {
    setFewest(0);
    setOrder("best");
  };
  const waiting = scope === "near" && place.asking;
  // The places themselves not read yet (src/App.tsx reads them with the
  // forecast's first manifest): the shapes of the cards to come, not the
  // empty list's words.
  const placesDue =
    spots.length === 0 && !waiting && (scope === "near" || starred.length > 0);
  const listed = useMemo(
    () => (waiting ? [] : listFor(scope, spots, starred, place.at, known)),
    [scope, spots, starred, place.at, known, waiting],
  );

  const wanted = listed.map((l) => l.spot.id);
  const wantKey = wanted.join(",");
  const listKey = scope;
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

  // Every half hour: the date, and the hour now as `nearestHour` says it.
  const halfHour = Math.floor(now / (HOUR / 2));
  const dates = useMemo(() => cardDates(now), [halfHour]);
  const listedSpots = useMemo(() => listed.map((l) => l.spot), [listed]);
  // The day the finder opens on: today, or tomorrow once today's rows are
  // over at every place listed.
  const opensOn = useMemo(
    () => openingDay(dates, listedSpots, now),
    [dates, listedSpots, halfHour],
  );
  // A day stepped to yesterday that is gone now is the opening day again.
  const day = chosen !== null && dates.includes(chosen) ? chosen : opensOn;
  const isToday = day === dates[0];
  // An hour picked on another day is not one of this day's to show.
  const pick = picked !== null && irishDate(picked) === day ? picked : null;
  const chooseDay = (date: string) => {
    setChosen(date === opensOn ? null : date);
    setPicked(null);
  };
  const byTime = useMemo(() => columnsByTime(strip), [strip]);
  // A tab's places, the best on the day first, then in the order asked.
  const ranked: Listed[] = useMemo(() => {
    const rated = listed.map(({ spot, km }) => ({
      spot,
      km,
      best: bestStars(hours.get(spot.id), strip, [day], now),
    }));
    // Nearest first means nothing without the rider's place.
    const by = order === "near" && !known ? "best" : order;
    return withStars(orderSpots(rankSpots(rated), by), fewest);
  }, [listed, order, known, fewest, hours, version, strip, day, halfHour]);

  const axis = useMemo(() => strip.map((c) => c.validTime), [strip]);
  const readings = useReadings(listedSpots, axis);
  // Each listed place's nearest station, and its latest reading while it is
  // fresh enough to be the wind now: a card on today says it.
  const stations = props.stations ?? null;
  const measuredNow = useMemo(() => {
    const out = new Map<string, NonNullable<SpotCardProps["measured"]>>();
    if (!stations) return out;
    for (const spot of listedSpots) {
      const paired = pairStation(spot, stations);
      const reading = paired ? latestReading(paired.station, now) : null;
      if (paired && reading && !isStale(reading, now))
        out.set(spot.id, { paired, reading });
    }
    return out;
  }, [stations, listedSpots, now]);

  // The day's row, at each place's own light.
  const rows = useMemo(
    () =>
      new Map(
        listedSpots.map((spot) => [
          spot.id,
          dayRow(strip, spot, day, now, byTime),
        ]),
      ),
    [listedSpots, strip, byTime, day, halfHour],
  );

  // Where the day stands with no hour picked: now, today, as the chart
  // would open; any other day, the hour it opens on.
  const opening = isToday
    ? strip.length
      ? openingColumn(strip, now)
      : null
    : dayOpening(strip, day, now);
  const roseAt = shownColumn(strip, pick, opening, byTime);
  const noon = Date.parse(`${day}T12:00:00Z`);
  const standing = isToday
    ? nearestHour(now)
    : opening === null
      ? noon
      : strip[opening].time;
  const shown = pick ?? standing;
  useEffect(() => onShown?.(shown), [shown]);
  const headId = "finder-heading";
  // The count beside the heading, once the list is the list.
  const counted = !waiting && !placesDue;
  // "today", "tomorrow", "on Thursday": the day shown, in a sentence.
  const onTheDay = onDay(noon, now);
  const canAsk =
    scope === "near" && !known && !waiting && !place.refused && place.locates;
  const grid = s.cards({ class: beside ? undefined : s.cardsAlone() });

  return (
    <div
      className={s.root({ class: beside ? s.split() : s.page() })}
      data-spot-finder
      data-scope={scope}
      data-beside-chart={beside || undefined}
    >
      <div className={s.body()}>
        <section
          className={s.list({ class: beside ? s.scroller() : s.alone() })}
          aria-labelledby={headId}
          aria-busy={waiting || placesDue || undefined}
          data-finder-list
        >
          <div className={s.head()}>
            <Segmented
              aria-label="Which spots"
              options={SCOPES}
              value={scope}
              onChange={chooseScope}
            />
            <h1 className={s.title()} id={headId} data-finder-heading>
              <span className="sr-only">
                {scope === "near" ? "Near you" : "Favourites"}
                {counted && " · "}
              </span>
              {counted &&
                (ranked.length === 1 ? "1 spot" : `${ranked.length} spots`)}
            </h1>
            <Button
              variant="quiet"
              icon
              aria-label={narrowing ? "Filter, on" : "Filter"}
              aria-haspopup="dialog"
              className={s.filter()}
              onClick={() => setFiltering(true)}
              data-finder-filter
              data-narrowed={narrowing || undefined}
            >
              <SlidersHorizontal
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {narrowing && <i className={s.dot()} aria-hidden="true" />}
            </Button>
          </div>
          <DaySteps dates={dates} day={day} now={now} onDay={chooseDay} />
          <Dialog
            open={filtering}
            title="Filter"
            onClose={() => setFiltering(false)}
            actions={
              <>
                {narrowing && (
                  <Button
                    variant="quiet"
                    onClick={clearNarrowing}
                    data-finder-clear
                  >
                    Clear
                  </Button>
                )}
                <Button variant="primary" onClick={() => setFiltering(false)}>
                  Done
                </Button>
              </>
            }
          >
            <div className={s.filters()} data-finder-filters>
              <fieldset className={s.group()}>
                <legend className={s.groupName()}>Stars {onTheDay}</legend>
                <div className={s.filterRow()}>
                  {FEWEST.map((choice) => (
                    <Chip
                      key={choice.value}
                      pressed={fewest === choice.value}
                      onClick={() => setFewest(choice.value)}
                      data-finder-stars={choice.value}
                    >
                      {choice.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <div className={s.group()}>
                <p className={s.groupName()}>Sort</p>
                <Segmented
                  aria-label="Order"
                  options={[
                    { value: "best", label: "Best first" },
                    ...(known
                      ? [{ value: "near" as const, label: "Nearest" }]
                      : []),
                    { value: "name", label: "A to Z" },
                  ]}
                  value={ordered}
                  onChange={setOrder}
                />
              </div>
              <div className={s.group()}>
                <p className={s.groupName()}>Model for the stars</p>
                <Segmented
                  aria-label="Model for the stars"
                  options={STARS_CHOICES.map((id) => ({
                    value: id,
                    label: modelName(id),
                  }))}
                  value={model}
                  onChange={onModel}
                />
              </div>
              {canAsk && (
                <div className={s.group()}>
                  <p className={s.groupName()}>Location</p>
                  <div className={s.filterRow()}>
                    <Button
                      size="sm"
                      onClick={() => {
                        setAsked(true);
                        setFiltering(false);
                      }}
                    >
                      <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />
                      Use my location
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Dialog>
          {placesDue ? (
            <div className={grid} data-finder-loading>
              {Array.from(
                {
                  length: Math.min(
                    4,
                    scope === "near" ? 4 : Math.max(1, starred.length),
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
              <ul className={grid} data-finder-cards data-day={day}>
                {ranked.map((item) => {
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
                        day={rows.get(item.spot.id) ?? null}
                        isToday={isToday}
                        measured={
                          isToday
                            ? (measuredNow.get(item.spot.id) ?? null)
                            : null
                        }
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
                        best={item.best}
                      />
                    </li>
                  );
                })}
              </ul>
            </HoverContext.Provider>
          ) : (
            <p className={s.empty()} data-finder-empty>
              {listed.length && fewest > 0 ? (
                fewest === 5 ? (
                  `No spot on this list has 5 stars ${onTheDay}.`
                ) : (
                  `No spot on this list has ${fewest} stars or more ${onTheDay}.`
                )
              ) : scope === "favourites" ? (
                <>
                  Save a spot and it shows here. Find one by name with the
                  search at the top, see the{" "}
                  <Link
                    href={scopeAddress(window.location.href, "near")}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey)
                        return;
                      event.preventDefault();
                      chooseScope("near");
                    }}
                  >
                    spots nearby
                  </Link>
                  , or <Link href="/spot">browse every spot</Link>.
                </>
              ) : waiting ? (
                "Finding spots nearby…"
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
