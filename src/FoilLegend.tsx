import {
  FOIL_CLEARANCE_METRES,
  levelLine,
  surveyLine,
  type FoilArea,
} from "../force5/src/foilDepth";

/**
 * The key to the foilable-depth layer, in the map's information dialog
 * (src/MapInfo.tsx) rather than over the chart: the three colours, the tide
 * and the hour they are drawn for, a tapped point's water, and what the
 * picture cannot know. With the layer off, the colours and where to turn it
 * on.
 */
export default function FoilLegend({
  on,
  area,
  station,
  tide,
  sea = null,
  when,
  readout,
  error,
  clearance = FOIL_CLEARANCE_METRES,
  floor = -5,
}: {
  /** The layer is drawn; off, there is no tide or survey to report. */
  on: boolean;
  area: FoilArea | null;
  station: string | null;
  /** The water level the colours are drawn for, above LAT. */
  tide: number | null;
  /** Behind a weir, the station's tide that `tide` follows; else null. */
  sea?: number | null;
  /** "Sat 18:00". */
  when: string;
  readout: string | null;
  error: string | null;
  clearance?: number;
  /** The depth cut, metres above LAT (the index's floorMetres, −5). */
  floor?: number;
}) {
  return (
    <div className="foil-key">
      {!on ? (
        <p className="foil-at">
          Off. Turn it on in Layers, under Chart: &ldquo;Foilable depth at the
          tide&rdquo;.
        </p>
      ) : error ? (
        <p className="foil-at is-error" role="status">
          {error}
        </p>
      ) : area && station ? (
        <p
          className="foil-at"
          role="status"
          data-foil-tide={tide ?? ""}
          data-foil-sea={sea ?? tide ?? ""}
        >
          {tide === null
            ? `No tide prediction at ${station} for ${when}.`
            : `${when} · ${levelLine(tide, station, sea ?? undefined)}`}
        </p>
      ) : (
        <p className="foil-at">Loading the survey…</p>
      )}
      <p className="foil-small fk-title">Depth of water at this tide</p>
      <div
        className="fk-scale"
        aria-hidden="true"
        style={{
          // The map's own scale (depthScale), 0 to 6 m.
          background: `linear-gradient(to right, var(--map-foil-edge) 0%, var(--map-foil-shallow) ${((clearance - 0.02) / 6) * 100}%, var(--map-foil-enough) ${(clearance / 6) * 100}%, var(--map-foil-deep) 50%, var(--map-foil-deeper) 100%)`,
        }}
      />
      <div className="fk-ticks" aria-hidden="true">
        <span>0</span>
        <span style={{ left: `${(clearance / 6) * 100}%` }}>{clearance} m</span>
        <span style={{ left: "50%" }}>3 m</span>
        <span style={{ left: "100%" }}>6 m+</span>
      </div>
      <p className="foil-small" data-foil-floor>
        The water&rsquo;s depth now, so a rising tide carries it to 6 m and
        more. Where the bottom is over {-floor} m under the lowest tide (LAT),
        nothing is drawn: it is deep enough at any tide, and the chart&rsquo;s
        depth tints show it.
      </p>
      <ul>
        <li>
          <i className="fk fk-enough" aria-hidden="true" />
          Deep enough, {clearance} m or more
        </li>
        <li>
          <i className="fk fk-shallow" aria-hidden="true" />
          Wet, too shallow for the mast
        </li>
        <li>
          <i className="fk fk-line" aria-hidden="true" />
          The waterline at this tide
        </li>
        <li>
          <i className="fk fk-dry" aria-hidden="true" />
          Dry at this tide
        </li>
      </ul>
      {on &&
        (readout ? (
          <p className="foil-probe">{readout}</p>
        ) : (
          <p className="foil-small">
            Tap the water on the chart, and its depth at this hour is read out
            here.
          </p>
        ))}
      <p className="foil-small">
        Approximate: astronomical tide, no surge or waves
        {on && area ? `; survey ${surveyLine(area)}` : ""}. Each stretch of
        coast follows its nearest tide station. The shore is
        OpenStreetMap&rsquo;s coastline; the foreshore&rsquo;s heights come from
        satellite images at known tides where there are some, and where no
        survey reached the depth is estimated from the surveys round it (a tap
        says so). Not for navigation.
      </p>
    </div>
  );
}
