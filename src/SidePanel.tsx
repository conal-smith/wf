import { StarGlyphs } from "../ui/StarGlyphs";
import type { RideStop } from "../force5/src/chartStyle";
import { DEPTHS } from "../force5/src/chartStyle";
import type { Rider } from "../force5/src/stars";
import { compass, type Spot } from "../force5/src/weather";
import type { SpotVisit } from "../shared/web/favourites";
import { InfoPop } from "./InfoPop";
import { KnotScale } from "./KnotScale";
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

export type SideTab = "yours" | "key";

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
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  /** On a phone the panel is a strip of starred spots, unless the key is open. */
  strip: boolean;
  rideStops: readonly RideStop[];
  rider: Rider;
  scale: string;
  sources: React.ReactNode;
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
    tab,
    onTab,
    strip,
    rideStops,
    rider,
    scale,
    sources,
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

  if (strip)
    return (
      <aside className="side side-strip chart-box" aria-label="Your spots">
        <span className="sbest">best {dayName}</span>
        <ul className="fvl">
          {starred.length
            ? starred.map((id) => entry(id))
            : looked.map((v) => entry(v.id, v))}
          {!starred.length && !looked.length && (
            <li className="none">Star a spot to keep it here.</li>
          )}
        </ul>
      </aside>
    );

  return (
    <aside className="side chart-box" aria-label="Your spots and the key">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-yours"
          aria-selected={tab === "yours"}
          aria-controls="tp-yours"
          onClick={() => onTab("yours")}
        >
          Your spots
        </button>
        <button
          type="button"
          role="tab"
          id="tab-key"
          aria-selected={tab === "key"}
          aria-controls="tp-key"
          onClick={() => onTab("key")}
        >
          Key
        </button>
        <span className="when">
          {dayName.toUpperCase()} {day ? Number(day.date.slice(8)) : ""}
        </span>
      </div>
      {tab === "yours" ? (
        <div id="tp-yours" role="tabpanel" aria-labelledby="tab-yours">
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
                Starred spots and the ones you open are kept on this device,
                and the spot pages share them.
              </p>
            </InfoPop>
          </div>
        </div>
      ) : (
        <div id="tp-key" role="tabpanel" aria-labelledby="tab-key" className="key">
          <p className="k-t1">IRELAND</p>
          <p className="k-t2">Wing Foil Chart</p>
          <p className="k-scale">{scale}</p>
          <dl>
            <dt>
              <KeyLight stars={4} arrow />
            </dt>
            <dd>Stars at the hour shown; the arrow blows downwind.</dd>
            <dt>
              <KeyLight stars={4} arrow wedge />
            </dt>
            <dd>
              Wedge, on the spot you open: the headings you can hold out to sea
              at your level in this wind. Longer the better powered; it pulses
              faster with more stars.
            </dd>
            <dt>
              <KeyLight stars={5} />
            </dt>
            <dd>Five stars, in magenta</dd>
            <dt>
              <KeyLight stars={2} />
            </dt>
            <dd>One or two stars: a plain ring</dd>
            <dt>
              <KeyLight stars={0} />
            </dt>
            <dd>Dashed: no stars at this hour</dd>
            <dt>
              <KeyLight stars={1} struck />
            </dt>
            <dd>Offshore: not safe</dd>
            <dt>
              <KeyLight stars={3} arrow cross />
            </dt>
            <dd>Red arrow: cross-offshore. Fine at an angle; not for learners.</dd>
            <dt>
              <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true" className="k-wind">
                <path d="M3 15 C10 13 16 8 31 5" strokeWidth="1.4" />
                <path d="M5 18 C12 16 18 12 26 10" strokeWidth="1" className="faint" />
              </svg>
            </dt>
            <dd>Wind, at the hour shown</dd>
            <dt>
              <svg width="34" height="24" viewBox="-17 -12 34 24" aria-hidden="true" className="k-loop">
                <path d="M-14 4 C-10 -9 10 -10 13 3 C11 10 -10 11 -14 4Z" strokeWidth="1.6" />
              </svg>
            </dt>
            <dd>Best window: two stars or more</dd>
          </dl>
          <h4>Wash and coloured arrows</h4>
          <KnotScale stops={rideStops} rider={rider} />
          <div className="tints" aria-label="Depth tints">
            {[0, 1, 2, 5, 10, 20, 50].map((d) => (
              <span
                key={d}
                style={{
                  background: `var(--map-d${DEPTHS.includes(d as (typeof DEPTHS)[number]) ? d : 50})`,
                }}
              >
                {d === 50 ? "50+" : d}
              </span>
            ))}
          </div>
          <p className="datum">Depths in metres below chart datum</p>
          <div className="kf">
            <StarsHelp />
            <InfoPop label="Sources" wide>
              {sources}
            </InfoPop>
          </div>
        </div>
      )}
    </aside>
  );
}

/** A light as the key shows it. */
function KeyLight({
  stars,
  arrow = false,
  struck = false,
  cross = false,
  wedge = false,
}: {
  stars: number;
  arrow?: boolean;
  struck?: boolean;
  cross?: boolean;
  wedge?: boolean;
}) {
  const level = struck ? "off" : `s${stars}`;
  return (
    <svg
      width="34"
      height={arrow ? 34 : 24}
      viewBox={arrow ? "-17 -17 34 34" : "-17 -12 34 24"}
      aria-hidden="true"
      className={`k-light lt-key ${level}${cross ? " xoff" : ""}`}
    >
      {wedge && (
        <path className="lt-key-wedge" d="M0 0L15 0A15 15 0 0 1 6.3 13.6Z" />
      )}
      {arrow && (
        <path
          className="lt-arrow"
          d="M5.5 -5.5L13 -13M8.2 -13.4L13.6 -13.6L13.4 -8.2"
        />
      )}
      <circle className="lt-ring" r="7.6" />
      {struck && (
        <line className="lt-strike" x1="-5.6" y1="5.6" x2="5.6" y2="-5.6" />
      )}
      <text className="lt-n" y="3.4" textAnchor="middle">
        {stars}
      </text>
    </svg>
  );
}
