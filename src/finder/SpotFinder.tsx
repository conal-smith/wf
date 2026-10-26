/**
 * The spot finder, the home page at /: where is good for this rider this week. The
 * places (their favourites, or every one round them) as cards, the best
 * first: the most stars in today and the five days after it, the soonest,
 * then the nearest. Each card is the place from above with the ride rose on
 * it, today hour by hour from first light to last, and the next five days
 * (src/finder/SpotCard.tsx). The approved design is
 * backlog/mockups/2026-10-25-spot-list-cards.html, its "7e".
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
import { Segmented } from "../../ui/Segmented";
import { Wordmark } from "../../ui/Wordmark";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
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
  hourOf,
  listFor,
  pickHour,
  rankSpots,
  shownColumn,
  weekBest,
  type Listed,
  type Scope,
} from "./finder";

export type { Scope };
import { HoverContext, hoverStore } from "./hover";
import { useRiderPlace } from "./location";
import { SpotCard } from "./SpotCard";
import { useReadings } from "./useReadings";

const styles = tv({
  slots: {
    root: "fixed inset-0 flex flex-col bg-ground paper-grain font-body text-ink antialiased",
    head: [
      "relative z-header flex items-center gap-3 border-0 border-b-3 border-double border-ink bg-ground px-4.5 py-3",
      "max-wide:gap-2 max-wide:px-3 max-wide:py-2.5",
    ],
    lead: "flex flex-1 items-center gap-3",
    body: "flex min-h-0 flex-1",
    list: [
      "min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4.5 pt-3.5 pb-10",
      "max-wide:px-2.5 max-wide:pt-2.5 max-wide:pb-20",
    ],
    // Under the chart's width, room at the foot for the button to the map.
    alone: "pb-24 max-wide:pb-24",
    // One column, two where each card has its room (`cards:`, 1180px).
    cards:
      "m-0 grid list-none grid-cols-1 items-start gap-3.5 p-0 cards:grid-cols-2",
    empty: "py-8 text-prose text-ink-2",
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
  /** The places the finder lists, which it needs rated, and which list. */
  onWant: (ids: readonly string[], scope: Scope) => void;
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
  } = props;
  const s = styles();
  const [scope, setScope] = useState<Scope>("favourites");
  const [asked, setAsked] = useState(false);
  const place = useRiderPlace(asked);
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
  };

  // Where "near you" and the distances are measured from: the rider's
  // place once the browser has said, else where the chart was last centred.
  const known = place.source === "rider";
  const listed = useMemo(
    () =>
      listFor(
        scope,
        spots,
        starred,
        scope === "near" || known ? place.at : null,
      ),
    [scope, spots, starred, place.at, known],
  );

  const wanted = listed.map((l) => l.spot.id);
  const wantKey = wanted.join(",");
  useEffect(() => onWant(wanted, scope), [wantKey, scope]);
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
  const ranked: Listed[] = useMemo(
    () =>
      rankSpots(
        listed.map(({ spot, km }) => ({
          spot,
          km,
          best: weekBest(hours.get(spot.id), strip, dates, now),
        })),
      ),
    [listed, hours, version, strip, dates, hourKey],
  );

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
      <header className={s.head()} ref={headRef}>
        <span className={s.lead()}>
          {menu}
          {!phone && <Wordmark size="sm" />}
        </span>
        <Segmented
          aria-label="Which spots"
          options={SCOPES}
          value={scope}
          onChange={chooseScope}
        />
      </header>
      <div className={s.body()}>
        <section
          className={s.list({ class: beside ? undefined : s.alone() })}
          aria-label={scope === "near" ? "Spots near you" : "Favourites"}
          aria-busy={place.asking || undefined}
          data-finder-list
        >
          {ranked.length ? (
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
              {scope === "favourites"
                ? "Star a spot and it shows here."
                : place.asking
                  ? ""
                  : "No spots within 30 km."}
            </p>
          )}
        </section>
        {/* The room the chart stands in beside the list (src/App.tsx). */}
        {beside && <div className="finder-side" aria-hidden="true" />}
      </div>
    </div>
  );
}
