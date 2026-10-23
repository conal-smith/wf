import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { Dialog } from "../ui/Dialog";
import { StarGlyphs } from "../ui/StarGlyphs";
import { DEPTHS } from "../force5/src/chartStyle";
import { STARS_HREF } from "../force5/src/siteNav";
import { windColor } from "../force5/src/weather";
import type { Rider } from "../force5/src/stars";
import { KnotScale } from "./KnotScale";
import type { InfoSection } from "./mapInfoContext";
import { riderLine } from "./riderLine";

/** The Currents layer's key, its own chunk: few readers open it. */
const CurrentsKey = lazy(() => import("./CurrentsKey"));

const SECTION_ID: Record<InfoSection, string> = {
  key: "map-info-key",
  stars: "map-info-stars",
  foil: "map-info-foil",
  lidar: "map-info-lidar",
  currents: "map-info-currents",
  sources: "map-info-sources",
};

/**
 * Everything the map explains, behind "About the map" in the site menu: what
 * its marks mean, how the stars are given, the tidal-depth layer's colours
 * and tide, and where it all comes from. One dialog over the dimmed chart, so
 * none of it sits on the map; mounted only while open. A "?" by the stars, or
 * the "i" by the tidal depth's switch or the LiDAR's, opens it at its own part.
 */
export default function MapInfo({
  at,
  open = true,
  onClose,
  scale,
  rider,
  spotId,
  foil,
  lidar,
  sources,
  satellite = null,
  satelliteError = null,
}: {
  at: InfoSection;
  /** False while it fades out, once shut. */
  open?: boolean;
  onClose: () => void;
  scale: string;
  rider: Rider;
  /** The open spot, for the stars page's worked example. */
  spotId: string | null;
  /** The tidal-depth key (src/FoilLegend.tsx). */
  foil: ReactNode;
  /** The LiDAR layer's key (src/LidarKey.tsx). */
  lidar: ReactNode;
  sources: ReactNode;
  /** "Satellite: high tide (≈4.6 m)" while the image is on, else null. */
  satellite?: string | null;
  /** Why the image is not drawn, when it was asked for and could not be. */
  satelliteError?: string | null;
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
      open={open}
      title="About the map"
      size="wide"
      className="map-info"
      onClose={onClose}
    >
      {section(
        "key",
        "Map key",
        <MapKey
          scale={scale}
          satellite={satellite}
          satelliteError={satelliteError}
        />,
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
            Dark hours aren&rsquo;t rated. Your weight and level are in the
            display options, in the menu at the top left.
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
      {section("foil", "Tidal depth", foil)}
      {section("lidar", "LiDAR data", lidar)}
      {section(
        "currents",
        "Currents",
        <Suspense fallback={<p>Loading…</p>}>
          <CurrentsKey />
        </Suspense>,
      )}
      {section("sources", "Sources", sources)}
    </Dialog>
  );
}

/** What the lights, the wind, the pen and the depths on the chart mean. */
function MapKey({
  scale,
  satellite,
  satelliteError,
}: {
  scale: string;
  satellite: string | null;
  satelliteError: string | null;
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
          Wedge, on the spot you open with the range ring or no mark: the
          headings you can hold out to sea at your level in this wind. The
          longer the wedge, the better powered you are; it pulses faster with
          more stars.
        </dd>
        <dt>
          <KeyRose />
        </dt>
        <dd>
          Loupe, round the chosen spot: about the headings you can hold at your
          level in this hour&rsquo;s wind, out to sea and home, the no-go upwind
          hatched, the way you drift if you fall, and the offshore winds in red.
          Its rim is half a nautical mile (or a kilometre) away.
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
      </dl>
      <h4>Coloured wind and coloured arrows</h4>
      <KnotScale />
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
      {(satellite || satelliteError) && (
        <p
          className={`datum k-sat${satelliteError ? " is-error" : ""}`}
          role="status"
        >
          {satelliteError ??
            `${satellite}. Sentinel-2's clear looks at that tide, at the nearest tide station; the land is one summer composite in both.`}
        </p>
      )}
    </div>
  );
}

/** The loupe's rose as the key shows it: no-go, the tack out, the needle, the offshore red. */
function KeyRose() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="-17 -17 34 34"
      aria-hidden="true"
      className="k-rose"
    >
      <path
        className="k-rose-nogo"
        d="M0 0L-10.4 -10.4A14.7 14.7 0 0 1 10.4 -10.4Z"
      />
      <path className="k-rose-out" d="M0 0L13.8 5A14.7 14.7 0 0 1 5 13.8Z" />
      <path className="k-rose-off" d="M-11.3 11.3A16 16 0 0 1 -16 0" />
      <circle className="k-rose-rim" r="14.7" />
      <path
        className="k-rose-needle"
        style={{ fill: `rgb(${windColor(16).join(",")})` }}
        d="M0 -8L-2 -16.5L0 -15L2 -16.5Z"
      />
    </svg>
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
