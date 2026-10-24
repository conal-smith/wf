/**
 * The spot finder, at /spots: where is best for this rider, and when. The
 * places (their favourites, or every one round them) rated at one hour,
 * best first, each with its picture from above and the ride rose on it, and
 * pinned on a plain map beside the list. The hour is chosen on the week's
 * timeline under the head, and is the chart's own selected time.
 *
 * A page of the map's bundle, drawn by src/App.tsx in the chart's place and
 * loaded as a chunk of its own the first time it is opened. It fetches
 * nothing the chart does not: the rated hours, the strip of columns and the
 * frame for the map are the chart's, handed in. The places it lists are
 * handed back (`onWant`), so the chart reads their squares and rates them
 * first.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { List, Map as MapGlyph } from "lucide-react";
import type { Rider } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import { windCss, type Frame, type Spot } from "../../force5/src/weather";
import { Button } from "../../ui/Button";
import { Wordmark } from "../../ui/Wordmark";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import { clock, dayShort, type StripColumn, type StripDay } from "../strip";
import {
  listFor,
  nearestSpot,
  rankSpots,
  timelineDays,
  type Listed,
  type Scope,
} from "./finder";
import FinderMap from "./FinderMap";
import { useRiderPlace } from "./location";
import { SpotCard } from "./SpotCard";
import { Timeline } from "./Timeline";
import { WhereWhen } from "./WhereWhen";

const styles = tv({
  slots: {
    root: "fixed inset-0 flex flex-col bg-ground paper-grain font-body text-ink antialiased",
    head: [
      "relative z-header flex items-center gap-3 border-0 border-b-3 border-double border-ink bg-ground px-4.5 py-3",
      "wide:grid wide:grid-cols-3",
      "max-wide:gap-2 max-wide:px-3 max-wide:py-2.5",
    ],
    lead: "flex items-center gap-3",
    ask: "wide:justify-self-center max-wide:flex-1",
    body: "relative min-h-0 flex-1 wide:grid wide:grid-cols-5",
    list: [
      "h-full overflow-y-auto overscroll-contain px-4.5 pt-4.5 pb-10 wide:col-span-3",
      "max-wide:px-3 max-wide:pt-3 max-wide:pb-24",
    ],
    cards:
      "m-0 grid list-none grid-cols-1 gap-x-4 gap-y-4.5 p-0 wide:grid-cols-2",
    empty: "py-8 text-prose text-ink-2",
    side: "wide:col-span-2 wide:py-3 wide:pr-3",
    mapBox:
      "size-full overflow-hidden rounded-dialog border border-ink shadow-float",
    phoneMap: "absolute inset-0 z-popover bg-ground",
    toggle: "fixed bottom-4.5 left-1/2 z-panel -translate-x-1/2 shadow-sheet",
  },
});

export interface FinderProps {
  spots: readonly Spot[];
  /** The chart's table of rated hours, and its version. */
  hours: ReadonlyMap<string, PlaceHour[]>;
  version: number;
  strip: readonly StripColumn[];
  days: readonly StripDay[];
  /** The chart's selected column, and whether it is the hour now. */
  selected: number;
  isNow: boolean;
  onSelect: (at: number) => void;
  starred: readonly string[];
  onToggleStar: (id: string) => void;
  rider: Rider;
  units: Units;
  /** The frame the chart has for the hour, for the map's wind; null for none. */
  frame: Frame | null;
  reducedMotion: boolean;
  phone: boolean;
  /** The places the finder needs rated: its list's, and the one its timeline reads. */
  onWant: (ids: readonly string[]) => void;
  /** The chart, on a place, at the hour chosen. */
  onInChart: (spot: Spot) => void;
  /** The site menu, with its rows for this page. */
  menu: ReactNode;
}

export default function SpotFinder(props: FinderProps) {
  const {
    spots,
    hours,
    version,
    strip,
    days,
    selected,
    isNow,
    onSelect,
    starred,
    onToggleStar,
    rider,
    units,
    frame,
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
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mapOn, setMapOn] = useState(false);
  // On a phone the map is made the first time it is shown, and kept.
  const [mapMade, setMapMade] = useState(!phone);
  useEffect(() => {
    if (!phone || mapOn) setMapMade(true);
  }, [phone, mapOn]);
  const timeline = useRef<HTMLDivElement>(null);

  const chooseScope = (next: Scope) => {
    if (next === "near") setAsked(true);
    setScope(next);
    setOpen(null);
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
  // The timeline's wind is the place nearest the rider, or nearest the
  // middle of the places listed.
  const reference = useMemo(() => {
    if (known || scope === "near" || !listed.length) return place.at;
    const n = listed.length;
    return {
      lat: listed.reduce((a, l) => a + l.spot.lat, 0) / n,
      lon: listed.reduce((a, l) => a + l.spot.lon, 0) / n,
    };
  }, [known, scope, listed, place.at]);
  const near = useMemo(() => nearestSpot(spots, reference), [spots, reference]);

  const wanted = [...listed.map((l) => l.spot.id), ...(near ? [near.id] : [])];
  const wantKey = wanted.join(",");
  useEffect(() => onWant(wanted), [wantKey]);

  const ranked: Listed[] = useMemo(
    () =>
      rankSpots(
        listed.map(({ spot, km }) => ({
          spot,
          km,
          hour: hours.get(spot.id)?.[selected] ?? null,
        })),
      ),
    [listed, hours, version, selected],
  );

  const week = useMemo(
    () => timelineDays(strip, days, reference),
    [strip, days, reference.lat, reference.lon],
  );
  const column = strip[selected];
  const day = week.find((d) => d.date === column?.date)?.hours ?? [];
  const nearRow = near ? hours.get(near.id) : undefined;
  const colourAt = (at: number) => {
    const kn = nearRow?.[at]?.windKn;
    return kn == null ? null : windCss(kn);
  };
  const when =
    isNow || !column
      ? "Now"
      : `${dayShort(column.time)} ${Number(column.date.slice(8))}, ${clock(column.time)}`;

  // Pressing a card opens it on the map; on a phone the map comes up.
  const openOnMap = (id: string) => {
    setOpen(id);
    if (phone) setMapOn(true);
  };

  const listKey = `${scope}|${listed.map((l) => l.spot.id).join(",")}`;
  const map = mapMade && (
    <FinderMap
      frame={frame}
      list={ranked}
      around={place.at}
      aroundKey={listKey}
      hover={hover}
      onHover={setHover}
      open={open}
      onOpen={setOpen}
      hours={hours}
      day={day}
      selected={selected}
      rider={rider}
      units={units}
      starred={starred}
      onToggleStar={onToggleStar}
      onInChart={onInChart}
      reducedMotion={reducedMotion}
      phone={phone}
    />
  );

  return (
    <div className={s.root()} data-spot-finder data-scope={scope}>
      <header className={s.head()}>
        <span className={s.lead()}>
          {menu}
          {!phone && <Wordmark size="sm" />}
        </span>
        <WhereWhen
          className={s.ask()}
          scope={scope}
          onScope={chooseScope}
          when={when}
          onWhen={() => timeline.current?.focus()}
        />
      </header>
      <Timeline
        ref={timeline}
        days={week}
        strip={strip}
        stripDays={days}
        selected={selected}
        onSelect={onSelect}
        colourAt={colourAt}
      />
      <div className={s.body()}>
        <section
          className={s.list()}
          aria-label={scope === "near" ? "Spots near you" : "Favourites"}
          aria-busy={place.asking || undefined}
          inert={phone && mapOn ? true : undefined}
        >
          {ranked.length ? (
            <ul className={s.cards()}>
              {ranked.map((item) => (
                <li key={item.spot.id}>
                  <SpotCard
                    spot={item.spot}
                    hour={item.hour}
                    row={hours.get(item.spot.id)}
                    day={day}
                    selected={selected}
                    rider={rider}
                    units={units}
                    starred={starred.includes(item.spot.id)}
                    lit={hover === item.spot.id}
                    onToggleStar={() => onToggleStar(item.spot.id)}
                    onOpen={() => openOnMap(item.spot.id)}
                    onHover={(on) =>
                      setHover((h) =>
                        on ? item.spot.id : h === item.spot.id ? null : h,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
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
        {phone ? (
          mapMade && (
            <div className={s.phoneMap()} hidden={!mapOn}>
              {map}
            </div>
          )
        ) : (
          <div className={s.side()}>
            <div className={s.mapBox()}>{map}</div>
          </div>
        )}
      </div>
      {phone && (
        <Button
          variant="primary"
          size="md"
          className={s.toggle()}
          onClick={() => setMapOn((on) => !on)}
          data-map-toggle
        >
          {mapOn ? (
            <>
              <List size={15} strokeWidth={1.75} aria-hidden="true" /> List
            </>
          ) : (
            <>
              <MapGlyph size={15} strokeWidth={1.75} aria-hidden="true" /> Map
            </>
          )}
        </Button>
      )}
    </div>
  );
}
