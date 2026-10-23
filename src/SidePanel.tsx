import { StarGlyphs } from "../ui/StarGlyphs";
import type { Spot } from "../force5/src/weather";
import type { SpotVisit } from "../shared/web/favourites";
import { InfoPop } from "./InfoPop";
import { StarToggle, StarsHelp } from "./glyphs";
import { hourWind, type PlaceHour } from "./ratings";
import { clock, dayShort, type StripColumn } from "./strip";

interface Props {
  spots: ReadonlyMap<string, Spot>;
  starred: readonly string[];
  frequent: readonly SpotVisit[];
  hours: ReadonlyMap<string, PlaceHour[]>;
  columns: readonly StripColumn[];
  /** The column the map shows, as the lights read it. */
  selected: number;
  onGo: (spot: Spot) => void;
  onToggleStar: (id: string) => void;
}

/** One of the rider's spots, with its hour at the time the map shows. */
function Entry({
  spot,
  hour,
  starred,
  seen,
  onGo,
  onToggleStar,
}: {
  spot: Spot;
  hour: PlaceHour | undefined;
  starred: boolean;
  seen?: SpotVisit;
  onGo: (spot: Spot) => void;
  onToggleStar: (id: string) => void;
}) {
  // An hour with no rating (dark, or not reached) shows nothing.
  const rating = hour?.rating ?? null;
  return (
    <li>
      <StarToggle
        on={starred}
        name={spot.name}
        onToggle={() => onToggleStar(spot.id)}
      />
      <button type="button" className="fv-go" onClick={() => onGo(spot)}>
        <b>{spot.name}</b>
        {/* The hour's wind. It used to end in the visit count, "· 1×",
            which read as nothing in particular; the count still orders the
            list, and the title says it. */}
        <span
          title={
            seen
              ? `Opened ${seen.count === 1 ? "once" : `${seen.count} times`} on this device`
              : undefined
          }
        >
          {rating && hour ? hourWind(hour) : ""}
        </span>
      </button>
      {rating ? (
        <StarGlyphs
          stars={rating.stars}
          potential={rating.potential}
          size={10}
        />
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * Your spots: the starred and the often opened, each with its stars and wind
 * at the hour the map shows. Opened from the site menu
 * (src/MapControls.tsx `chartTools`), in a dialog over the map as the layers
 * are, on a phone as on a wide screen; it used to sit over the chart all the time, and
 * on a phone as a strip over the dock.
 */
export default function SidePanel(props: Props) {
  const {
    spots,
    starred,
    frequent,
    hours,
    columns,
    selected,
    onGo,
    onToggleStar,
  } = props;
  const column = columns[selected];
  const entry = (id: string, seen?: SpotVisit) => {
    const spot = spots.get(id);
    if (!spot) return null;
    return (
      <Entry
        key={id}
        spot={spot}
        hour={hours.get(id)?.[selected]}
        starred={starred.includes(id)}
        seen={seen}
        onGo={onGo}
        onToggleStar={onToggleStar}
      />
    );
  };
  const looked = frequent.filter((v) => spots.has(v.id)).slice(0, 4);

  return (
    <aside id="map-spots" className="side" aria-label="Your spots">
      <div className="side-head">
        <span className="when">
          {column
            ? `${dayShort(column.time).toUpperCase()} ${Number(column.date.slice(8))} ${clock(column.time)}`
            : ""}
        </span>
      </div>
      <h4>
        Starred <StarsHelp />
      </h4>
      <ul className="fvl">
        {starred.length ? (
          starred.map((id) => entry(id))
        ) : (
          <li className="none">Tap the red star on a spot to keep it here.</li>
        )}
      </ul>
      <h4>Often opened</h4>
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
