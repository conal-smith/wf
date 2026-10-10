import { StarGlyphs } from "../ui/StarGlyphs";
import { compass, type Spot } from "../force5/src/weather";
import type { SpotVisit } from "../shared/web/favourites";
import { InfoPop } from "./InfoPop";
import { StarToggle, StarsHelp } from "./glyphs";
import type { PlaceHour } from "./ratings";
import {
  clock,
  dayBest,
  dayShort,
  hourLabel,
  type StripColumn,
  type StripDay,
} from "./strip";

interface Props {
  spots: ReadonlyMap<string, Spot>;
  starred: readonly string[];
  frequent: readonly SpotVisit[];
  hours: ReadonlyMap<string, PlaceHour[]>;
  columns: readonly StripColumn[];
  day: StripDay | undefined;
  now: number;
  onGo: (spot: Spot) => void;
  onToggleStar: (id: string) => void;
}

/** One of the rider's spots, with the selected day's best. */
function Entry({
  spot,
  hours,
  columns,
  day,
  now,
  starred,
  seen,
  onGo,
  onToggleStar,
}: {
  spot: Spot;
  hours: PlaceHour[] | undefined;
  columns: readonly StripColumn[];
  day: StripDay | undefined;
  now: number;
  starred: boolean;
  seen?: SpotVisit;
  onGo: (spot: Spot) => void;
  onToggleStar: (id: string) => void;
}) {
  const ratings = hours?.map((h) => h.rating);
  const best =
    ratings && day
      ? dayBest(
          ratings,
          day,
          now,
          columns.map((c) => c.time),
        )
      : null;
  const at = best ? hours![best.from] : undefined;
  const wind =
    at && at.from !== null && at.windKn !== null
      ? `${compass(at.from)} ${Math.round(at.windKn)}${at.gustKn !== null ? `g${Math.round(at.gustKn)}` : ""}`
      : "";
  const when = !best
    ? hours
      ? "done for the day"
      : ""
    : !best.stars
      ? "no stars"
      : best.from === best.to
        ? clock(columns[best.from].time)
        : `${hourLabel(columns[best.from].time)}–${hourLabel(columns[best.to].time)}`;
  return (
    <li>
      <StarToggle
        on={starred}
        name={spot.name}
        onToggle={() => onToggleStar(spot.id)}
      />
      <button type="button" className="fv-go" onClick={() => onGo(spot)}>
        <b>{spot.name}</b>
        {/* The day's best and its wind. It used to end in the visit count,
            "· 1×", which read as nothing in particular; the count still
            orders the list, and the title says it. */}
        <span
          title={
            seen
              ? `Opened ${seen.count === 1 ? "once" : `${seen.count} times`} on this device`
              : undefined
          }
        >
          {[when, wind].filter(Boolean).join(" · ")}
        </span>
      </button>
      {best && ratings ? (
        <StarGlyphs
          stars={best.stars}
          potential={ratings[best.from]!.potential}
          size={10}
        />
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * Your spots: the starred and the often opened, each with the selected day's
 * best. Behind the star under Layers (src/MapControls.tsx), opening beside
 * the controls as the layers do, on a phone as on a wide screen; it used to
 * sit over the chart all the time, and on a phone as a strip over the dock.
 */
export default function SidePanel(props: Props) {
  const {
    spots,
    starred,
    frequent,
    hours,
    columns,
    day,
    now,
    onGo,
    onToggleStar,
  } = props;
  const dayName = day ? dayShort(day.noon) : "";
  const entry = (id: string, seen?: SpotVisit) => {
    const spot = spots.get(id);
    if (!spot) return null;
    return (
      <Entry
        key={id}
        spot={spot}
        hours={hours.get(id)}
        columns={columns}
        day={day}
        now={now}
        starred={starred.includes(id)}
        seen={seen}
        onGo={onGo}
        onToggleStar={onToggleStar}
      />
    );
  };
  const looked = frequent.filter((v) => spots.has(v.id)).slice(0, 4);

  return (
    <aside id="map-spots" className="side chart-box" aria-label="Your spots">
      <div className="side-head">
        <h3>Your spots</h3>
        <span className="when">
          {dayName.toUpperCase()} {day ? Number(day.date.slice(8)) : ""}
        </span>
      </div>
      <h4>
        Starred · best {dayName} <StarsHelp />
      </h4>
      <ul className="fvl">
        {starred.length ? (
          starred.map((id) => entry(id))
        ) : (
          <li className="none">Tap the red star on a spot to keep it here.</li>
        )}
      </ul>
      <h4>Often opened · best {dayName}</h4>
      <ul className="fvl">
        {looked.length ? (
          looked.map((v) => entry(v.id, v))
        ) : (
          <li className="none">Spots you open show up here.</li>
        )}
      </ul>
      <div className="sign">
        <span>On this device</span>
        <InfoPop label="About your spots">
          <p>
            Starred spots and the ones you open are kept on this device, and
            the spot pages share them.
          </p>
        </InfoPop>
      </div>
    </aside>
  );
}
