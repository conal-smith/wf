import { CURRENTS_CAVEAT } from "../force5/src/currents";
import { TIDAL_STREAM_SITES } from "../force5/src/tidalStreams";

/**
 * The Currents layer's part of the map's information: what its arrows are,
 * where they come from, and the caveat. A chunk of its own, loaded when the
 * dialog opens, so the page carries none of it until then.
 */
export default function CurrentsKey() {
  return (
    <>
      <dl className="cur-key">
        <dt>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
            <path className="cur-k-model" d="M4 10H29M23 6.5L30 10L23 13.5" />
          </svg>
        </dt>
        <dd>
          The model&rsquo;s surface current, where the water runs to: the longer
          the arrow, the faster. Figures in your units once you zoom in.
        </dd>
        <dt>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
            <path
              className="cur-k-stream"
              d="M4 10H29M23 6.5L30 10L23 13.5M5 10L1 6M9 10L5 6"
            />
          </svg>
        </dt>
        <dd>
          A channel&rsquo;s flood stream, feathered; its ebb is a plain arrow,
          and a ring is slack water. Worked out from the tide, below.
        </dd>
      </dl>
      <p>
        The arrows are the Marine Institute&rsquo;s North East Atlantic ROMS
        model, tides included, hourly for three days. At 1 to 2 km it has the
        timing and the direction of the streams, but not a narrow channel or a
        harbour mouth, so in these the stream comes from the pilotage guides:
        its spring rate each way and when it turns, scaled by the day&rsquo;s
        tide.
      </p>
      <ul className="cur-sites">
        {TIDAL_STREAM_SITES.map((site) => (
          <li key={site.id}>
            <b>{site.name}</b>: flood {site.flood.springKnots} kn, ebb{" "}
            {site.ebb.springKnots} kn at springs; {site.timing}.{" "}
            {site.sources.map((source, index) => (
              <span key={source.url}>
                {index ? ", " : "From "}
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title.split(":")[0]}
                </a>
              </span>
            ))}
            .
          </li>
        ))}
      </ul>
      <p className="ip-small">
        {CURRENTS_CAVEAT} The Marine Institute says its forecasts must not be
        used for safety-critical decisions. Model © Marine Institute, CC BY 4.0.
      </p>
    </>
  );
}
