import { useEffect, type ReactNode } from "react";
import { Dialog } from "../ui/Dialog";
import { StarGlyphs } from "../ui/StarGlyphs";
import type { RideStop } from "../force5/src/chartStyle";
import { DEPTHS } from "../force5/src/chartStyle";
import { STARS_HREF } from "../force5/src/siteNav";
import type { Rider } from "../force5/src/stars";
import { KnotScale } from "./KnotScale";
import type { InfoSection } from "./mapInfoContext";
import { riderLine } from "./RatingDetail";

const SECTION_ID: Record<InfoSection, string> = {
  key: "map-info-key",
  stars: "map-info-stars",
  foil: "map-info-foil",
  sources: "map-info-sources",
};

/**
 * Everything the map explains, behind the "i" under Layers: what its marks
 * mean, how the stars are given, the foilable-depth layer's colours and
 * tide, and where it all comes from. One dialog over the dimmed chart, so
 * none of it sits on the map; mounted only while open. A "?" by the stars, or
 * the "i" by the foil layer, opens it at its own part.
 */
export default function MapInfo({
  at,
  onClose,
  scale,
  rideStops,
  rider,
  spotId,
  foil,
  sources,
}: {
  at: InfoSection;
  onClose: () => void;
  scale: string;
  rideStops: readonly RideStop[];
  rider: Rider;
  /** The open spot, for the stars page's worked example. */
  spotId: string | null;
  /** The foilable-depth key (src/FoilLegend.tsx). */
  foil: ReactNode;
  sources: ReactNode;
}) {
  // The dialog is open by the time this runs (a child's effects come first),
  // so the part asked for can be brought up in its scroll.
  useEffect(() => {
    if (at !== "key")
      document
        .getElementById(SECTION_ID[at])
        ?.scrollIntoView({ block: "start" });
  }, []);
  const section = (id: InfoSection, title: string, body: ReactNode) => (
    <section
      id={SECTION_ID[id]}
      className="mi-part"
      aria-labelledby={`${SECTION_ID[id]}-h`}
    >
      <h3 id={`${SECTION_ID[id]}-h`}>{title}</h3>
      {body}
    </section>
  );
  return (
    <Dialog
      open
      title="About the map"
      size="wide"
      className="map-info"
      onClose={onClose}
    >
      {section(
        "key",
        "Map key",
        <MapKey scale={scale} rideStops={rideStops} rider={rider} />,
      )}
      {section(
        "stars",
        "Star ratings",
        <>
          <ul className="mi-glyphs">
            <li>
              <StarGlyphs stars={3} potential={5} size={12} />
              <span>
                Solid stars are the rating. Outlined stars are what the wind
                speed alone would have earned, before anything was taken off.
              </span>
            </li>
            <li>
              <StarGlyphs stars={1} potential={2} size={12} />
              <span>
                A dot is a star out of reach: not even the wind speed alone
                would have earned it.
              </span>
            </li>
          </ul>
          <p>
            Dark hours aren&rsquo;t rated. Hover or tap an hour&rsquo;s stars in
            the dock for why it has them; your weight and level are in its
            display options.
          </p>
          <p className="ip-fig">Rated for {riderLine(rider)}</p>
          <p>
            <a
              href={
                spotId
                  ? `${STARS_HREF}?spot=${encodeURIComponent(spotId)}`
                  : STARS_HREF
              }
            >
              How the stars work, in full →
            </a>
          </p>
        </>,
      )}
      {section("foil", "Foilable depth", foil)}
      {section("sources", "Sources", sources)}
    </Dialog>
  );
}

/** What the lights, the wind, the pen and the depths on the chart mean. */
function MapKey({
  scale,
  rideStops,
  rider,
}: {
  scale: string;
  rideStops: readonly RideStop[];
  rider: Rider;
}) {
  return (
    <div className="key">
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
          Wedge, on the spot you open: the headings you can hold out to sea at
          your level in this wind. Longer the better powered; it pulses faster
          with more stars.
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
          <svg
            width="34"
            height="20"
            viewBox="0 0 34 20"
            aria-hidden="true"
            className="k-wind"
          >
            <path d="M3 15 C10 13 16 8 31 5" strokeWidth="1.4" />
            <path
              d="M5 18 C12 16 18 12 26 10"
              strokeWidth="1"
              className="faint"
            />
          </svg>
        </dt>
        <dd>Wind, at the hour shown</dd>
        <dt>
          <svg
            width="34"
            height="24"
            viewBox="-17 -12 34 24"
            aria-hidden="true"
            className="k-loop"
          >
            <path
              d="M-14 4 C-10 -9 10 -10 13 3 C11 10 -10 11 -14 4Z"
              strokeWidth="1.6"
            />
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
    </div>
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
