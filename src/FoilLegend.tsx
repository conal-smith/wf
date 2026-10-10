import {
  FOIL_CLEARANCE_METRES,
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
  when,
  readout,
  error,
  clearance = FOIL_CLEARANCE_METRES,
}: {
  /** The layer is drawn; off, there is no tide or survey to report. */
  on: boolean;
  area: FoilArea | null;
  station: string | null;
  tide: number | null;
  /** "Sat 18:00". */
  when: string;
  readout: string | null;
  error: string | null;
  clearance?: number;
}) {
  return (
    <div className="foil-key">
      {!on ? (
        <p className="foil-at">
          Off. Turn it on in Layers, under Chart: &ldquo;Foilable depth at the
          tide (pilot)&rdquo;.
        </p>
      ) : error ? (
        <p className="foil-at is-error" role="status">
          {error}
        </p>
      ) : area && station ? (
        <p className="foil-at" role="status" data-foil-tide={tide ?? ""}>
          {tide === null
            ? `No tide prediction at ${station} for ${when}.`
            : `${when} · tide ${tide.toFixed(1)} m above LAT at ${station}`}
        </p>
      ) : (
        <p className="foil-at">Loading the survey…</p>
      )}
      <ul>
        <li>
          <i className="fk fk-deep" aria-hidden="true" />
          Deep enough, {clearance.toFixed(1)} m or more
        </li>
        <li>
          <i className="fk fk-shallow" aria-hidden="true" />
          Wet, too shallow for the mast
        </li>
        <li>
          <i className="fk fk-dry" aria-hidden="true" />
          Dry at this tide
        </li>
        <li>
          <i className="fk fk-unsurveyed" aria-hidden="true" />
          Always wet, depth not surveyed
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
        {on && area ? `; survey ${surveyLine(area)}` : ""}. Pilot areas only.
        Not for navigation.
      </p>
    </div>
  );
}
