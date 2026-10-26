/**
 * The spot finder, at /spots: where is good for this rider this week. The
 * places (their favourites, or every one round them) as cards, the best
 * first: the most stars in today and the five days after it, the soonest,
 * then the nearest. Each card is the place from above with the ride rose on
 * it, today hour by hour from first light to last, and the next five days
 * (src/finder/SpotCard.tsx). The approved design is
 * backlog/mockups/2026-10-25-spot-list-cards.html, its "7e".
 *
 * A page of its own: no map and no timeline at its head, and not tied to the
 * chart's time. The cards keep one time between them, as a dashboard's
 * charts do: a day pressed among the next ones is drawn hour by hour on
 * every card in today's place (today goes among the others, to come back
 * to); an hour picked on one card's day is picked on every card, its rose
 * turned to it; and a mouse over a card's hours, or over a day, draws a
 * dotted line at that time on every card (src/finder/hover.ts). The picture
 * opens the chart there, at the hour its rose shows. No legend: the stars
 * and the wind's colours are the site's own, said once on the Info page.
 *
 * A page of the map's bundle, drawn by src/App.tsx in the chart's place and
 * loaded as a chunk of its own the first time it is opened. Its wind and its
 * stars are the chart's own rated hours, handed in; the places it lists are
 * handed back (`onWant`), so the chart reads their squares and rates them
 * first. Their sky, air, sea and tide it reads itself, as the dock reads a
 * place's (src/finder/useReadings.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { Spot } from "../../force5/src/weather";
import { PageHeader } from "../../ui/PageHeader";
import { Segmented } from "../../ui/Segmented";
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
import { HoverContext, hoverStore } from "./hover";
import { useRiderPlace } from "./location";
import { SpotCard } from "./SpotCard";
import { useReadings } from "./useReadings";

const styles = tv({
  slots: {
    root: "fixed inset-0 flex flex-col bg-ground paper-grain font-body text-ink antialiased",
    list: [
      "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4.5 pt-3.5 pb-10",
      "max-wide:px-2.5 max-wide:pt-2.5 max-wide:pb-20",
    ],
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
  /** The places the finder needs rated: its list's. */
  onWant: (ids: readonly string[]) => void;
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
  useEffect(() => onWant(wanted), [wantKey]);

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
  const dayName = isToday
    ? { short: "Today", long: "Today" }
    : {
        short: `${dayShort(noon)} ${Number(day.slice(8))}`,
        long: `${dayLong(noon)} ${Number(day.slice(8))}`,
      };

  return (
    <div className={s.root()} data-spot-finder data-scope={scope}>
      <PageHeader menu={menu} wordmark={!phone}>
        <Segmented
          aria-label="Which spots"
          options={SCOPES}
          value={scope}
          onChange={chooseScope}
        />
      </PageHeader>
      <section
        className={s.list()}
        aria-label={scope === "near" ? "Spots near you" : "Favourites"}
        aria-busy={place.asking || undefined}
      >
        {ranked.length ? (
          <HoverContext.Provider value={hover}>
            <ul
              className={s.cards()}
              data-day-chosen={isToday ? undefined : day}
            >
              {ranked.map((item, order) => {
                const plan = plans.get(item.spot.id);
                return (
                  <li key={item.spot.id} className="min-w-0">
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
    </div>
  );
}
