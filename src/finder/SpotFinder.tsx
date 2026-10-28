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
 * Beside it, the list's order (the best of the week, the nearest, A to Z),
 * the fewest stars a place is to have, and the model the stars are rated
 * from, the rider's own, as the spot page and the display options set it.
 * Near you never asks the browser where the rider is unasked: without
 * their place it says why it is wanted, with a "Use my location" button,
 * over the spots nearest where the chart was, which give no distances.
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
import { Funnel, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { modelName, STARS_MODELS } from "../../force5/src/lead";
import { isChartAddress } from "../../force5/src/siteNav";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Link } from "../../ui/Link";
import { PageHeader } from "../../ui/PageHeader";
import { SearchField } from "../../ui/SearchField";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
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
  orderSpots,
  pickHour,
  rankSpots,
  scopeAddress,
  scopeInAddress,
  shownColumn,
  weekBest,
  withStars,
  type Listed,
  type Order,
  type Scope,
} from "./finder";

export type { Scope };
import { HoverContext, hoverStore } from "./hover";
import { knownBefore, useRiderPlace } from "./location";
import { CardSkeleton, SpotCard } from "./SpotCard";
import { useReadings } from "./useReadings";

const styles = tv({
  slots: {
    root: "flex flex-col bg-ground paper-grain font-body text-ink antialiased",
    // Beside the chart the list scrolls in its own box, under a head that
    // stays. Alone, it scrolls the page itself, the head held at the top: a
    // phone's browser then folds its bars away as the reader scrolls, as it
    // never does for a box of its own, and nothing at the foot of the
    // screen (the button to the map) waits under them.
    split: "fixed inset-0",
    page: "relative min-h-dvh",
    body: "flex min-h-0 flex-1",
    list: [
      "min-h-0 min-w-0 flex-1 px-4.5 pt-3.5 pb-10",
      "max-wide:px-2.5 max-wide:pt-2.5 max-wide:pb-20",
    ],
    scroller: "overflow-y-auto overscroll-contain",
    // Under the chart's width, room at the foot for the button to the map.
    alone: "pb-24 max-wide:pb-24",
    // The head, held at the top of the page as it scrolls.
    head: "sticky top-0",
    // In the head: which spots, and the magnifier that opens the search.
    switches: "flex items-center gap-2",
    // A search or a filter at work: a dot on the magnifier, said in its name.
    searchButton: "relative",
    searchDot:
      "pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full border border-card bg-pen",
    // The search, over the page: a spot's name on a rule to write on, as the
    // chart's, then the filters under their funnel.
    find: "w-full",
    filters: "grid gap-3",
    filtersHead:
      "flex items-center gap-1.5 border-0 border-t border-line pt-3 font-mono text-eyebrow font-semibold tracking-eyebrow text-ink uppercase",
    // Over the cards while a search or a filter is at work: what it is,
    // and the way back to the whole tab.
    using:
      "mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-prose text-ink-2 max-wide:mb-2.5",
    usingWords: "min-w-0 flex-1",
    // Near you without the rider's place: why it is wanted, and the one
    // way to give it.
    ask: "m-0 mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-prose text-ink-2",
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
  { value: "near", label: "Nearby" },
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
  // location", under the line that says why; a place kept from an earlier
  // yes is read again quietly on Near you.
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
  // A spot's name typed in the search, and the search open over the page.
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  // The search's field takes the focus as it opens: the dialog's own first
  // stop is its close, and a rider opens it to type a name.
  const findField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (finding) findField.current?.focus();
  }, [finding]);
  const searching = query.trim().length > 0;
  // The day drawn hour by hour on every card; null is today.
  const [chosen, setChosen] = useState<string | null>(null);
  // The hour picked on that day's row, for every card; null is the hour the
  // day stands at (now, today).
  const [picked, setPicked] = useState<number | null>(null);
  // The time under a mouse, shared by every card without drawing them again.
  const [hover] = useState(hoverStore);

  // The list's order, and the fewest stars a place has in its six days.
  const [order, setOrder] = useState<Order>("best");
  const [fewest, setFewest] = useState(0);

  const chooseScope = (next: Scope) => {
    setScope(next);
    setNamed(true);
    setQuery("");
  };

  // Where "near you" and the distances are measured from: the rider's
  // place once the browser has said. Without it, the places nearest where
  // the chart was last centred, or the middle of Ireland, with no distances;
  // and none while the browser is first asked.
  const known = place.source === "rider";
  // A search or a filter at work on the tab's list (an order counts, a
  // nearest first without the rider's place being the best first): said
  // over the cards with the way back to the whole of it, and by a dot on
  // the magnifier in the head.
  const ordered = order === "near" && !known ? "best" : order;
  const narrowing = searching || fewest > 0 || ordered !== "best";
  const narrowingWords = [
    searching && `Spots named “${query.trim()}”`,
    fewest > 0 && (fewest === 5 ? "5 stars" : `${fewest}+ stars`),
    ordered === "near" && "Nearest first",
    ordered === "name" && "A to Z",
  ]
    .filter(Boolean)
    .join(" · ");
  const clearNarrowing = () => {
    setQuery("");
    setFewest(0);
    setOrder("best");
  };
  const filtersId = useId();
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
    // Nearest first means nothing without the rider's place.
    const by = order === "near" && !known ? "best" : order;
    return withStars(
      orderSpots(searching ? rated : rankSpots(rated), by),
      fewest,
    );
  }, [
    listed,
    searching,
    order,
    known,
    fewest,
    hours,
    version,
    strip,
    dates,
    hourKey,
  ]);

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
      className={s.root({ class: beside ? s.split() : s.page() })}
      data-spot-finder
      data-scope={scope}
      data-beside-chart={beside || undefined}
    >
      <PageHeader
        menu={menu}
        headRef={headRef}
        className={beside ? undefined : s.head()}
      >
        <div className={s.switches()}>
          <Segmented
            aria-label="Which spots"
            size="sm"
            options={SCOPES}
            value={scope}
            onChange={chooseScope}
          />
          <Button
            variant="raised"
            size="sm"
            icon
            className={s.searchButton()}
            aria-label={
              narrowing
                ? "Find a spot and filter (in use)"
                : "Find a spot and filter"
            }
            aria-haspopup="dialog"
            title="Find a spot"
            onClick={() => setFinding(true)}
            data-finder-search
          >
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            {narrowing && <span className={s.searchDot()} aria-hidden="true" />}
          </Button>
        </div>
      </PageHeader>
      <Dialog
        open={finding}
        title="Find a spot"
        onClose={() => setFinding(false)}
        actions={
          <>
            {narrowing && (
              <Button variant="quiet" onClick={clearNarrowing}>
                Clear
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => setFinding(false)}
              data-finder-show
            >
              {placesDue || waiting
                ? "Show spots"
                : ranked.length === 1
                  ? "Show 1 spot"
                  : `Show ${ranked.length} spots`}
            </Button>
          </>
        }
      >
        <SearchField
          size="md"
          className={s.find()}
          aria-label="Find a spot"
          placeholder="A spot’s name…"
          autoComplete="off"
          enterKeyHint="search"
          ref={findField}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter shows the spots. Held, or the focus handed back to the
            // magnifier takes the same key and opens the search again.
            if (event.key !== "Enter") return;
            event.preventDefault();
            setFinding(false);
          }}
          data-finder-find
        />
        <div className={s.filters()} role="group" aria-labelledby={filtersId}>
          <span className={s.filtersHead()} id={filtersId}>
            <Funnel size={13} strokeWidth={1.75} aria-hidden="true" />
            Filters
          </span>
          <Field label="Order" htmlFor={`${filtersId}order`}>
            <Select
              id={`${filtersId}order`}
              value={ordered}
              onChange={(event) => setOrder(event.target.value as Order)}
              data-finder-order
            >
              <option value="best">Best first</option>
              {known && <option value="near">Nearest</option>}
              <option value="name">A to Z</option>
            </Select>
          </Field>
          <Field
            label="Stars in the next six days"
            htmlFor={`${filtersId}stars`}
          >
            <Select
              id={`${filtersId}stars`}
              active={fewest > 0}
              value={fewest}
              onChange={(event) => setFewest(Number(event.target.value))}
              data-finder-stars
            >
              <option value={0}>Any stars</option>
              <option value={3}>3+ stars</option>
              <option value={4}>4+ stars</option>
              <option value={5}>5 stars</option>
            </Select>
          </Field>
          <Field label="Model for the stars" htmlFor={`${filtersId}model`}>
            <Select
              id={`${filtersId}model`}
              value={model}
              onChange={(event) => onModel(event.target.value)}
              data-finder-model
            >
              {STARS_MODELS.map((id) => (
                <option key={id} value={id}>
                  {modelName(id)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
      <div className={s.body()}>
        <section
          className={s.list({ class: beside ? s.scroller() : s.alone() })}
          aria-label={
            searching
              ? "Spots found"
              : scope === "near"
                ? "Spots nearby"
                : "Favourites"
          }
          aria-busy={waiting || placesDue || undefined}
          data-finder-list
        >
          {narrowing && (
            <p className={s.using()} data-finder-using>
              <span className={s.usingWords()}>{narrowingWords}</span>
              <Button variant="quiet" size="sm" onClick={clearNarrowing}>
                Clear
              </Button>
            </p>
          )}
          {!searching &&
            scope === "near" &&
            !known &&
            !waiting &&
            !place.refused &&
            place.locates && (
              <p className={s.ask()} data-finder-ask>
                <span>
                  Nearby lists the spots within 30 km of where you are. To find
                  them, your browser will ask to share your location.
                </span>
                <Button variant="pill" onClick={() => setAsked(true)}>
                  Use my location
                </Button>
              </p>
            )}
          {!searching &&
            scope === "near" &&
            !known &&
            !waiting &&
            // Over the cards' shapes as well, so it does not push them
            // down when they land.
            (ranked.length > 0 || placesDue) && (
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
              {listed.length && fewest > 0 ? (
                fewest === 5 ? (
                  "No spot on this list has 5 stars in the next six days."
                ) : (
                  `No spot on this list has ${fewest} stars or more in the next six days.`
                )
              ) : searching ? (
                "No spot by that name."
              ) : scope === "favourites" ? (
                <>
                  Star a spot and it shows here. Find one by name with the
                  search above, see the{" "}
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
