import type { LidarIndex } from "../force5/src/lidar";

const metres = (m: number) => (m < 0 ? `−${-m}` : String(m));

/**
 * The key to the LiDAR layer, in the map's information dialog (src/MapInfo.tsx):
 * its colours, from the index that names the tiles drawn with them, so the two
 * cannot disagree, and the surveys it is made of. Loaded only with the layer
 * on (src/App.tsx says where to turn it on otherwise).
 */
export default function LidarKey({
  index,
  error,
}: {
  index: LidarIndex | null;
  error: string | null;
}) {
  const ramp = index?.ramp ?? [];
  const at = (i: number) => (i / Math.max(ramp.length - 1, 1)) * 100;
  return (
    <div className="foil-key" data-lidar-key>
      {error ? (
        <p className="foil-at is-error" role="status">
          {error}
        </p>
      ) : !index ? (
        <p className="foil-at">Loading the LiDAR data…</p>
      ) : (
        <p className="foil-at" role="status">
          {index.sources.length} surveys
          {index.areaKm2 ? `, ${Math.round(index.areaKm2)} km²` : ""}, in the
          dashed outlines
        </p>
      )}
      <p className="foil-small fk-title">
        Height of the ground above the lowest tide (LAT), metres
      </p>
      {ramp.length > 0 && (
        <>
          <div
            className="fk-scale"
            aria-hidden="true"
            style={{
              background: `linear-gradient(to right, ${ramp.map(([, c], i) => `${c} ${at(i)}%`).join(", ")})`,
            }}
          />
          <div className="fk-ticks" aria-hidden="true">
            {ramp.map(([m], i) =>
              // Two labels close by under the lowest tide: −20 says it.
              m < 0 && m > ramp[0][0] ? null : (
                <span key={m} style={{ left: `${at(i)}%` }}>
                  {metres(m)}
                </span>
              ),
            )}
          </div>
        </>
      )}
      <p className="foil-small">
        The dock&rsquo;s tides are on the same datum: ground under the
        tide&rsquo;s height is under water. Blue is below the lowest tide, aqua
        to sand the foreshore from low water to high, grey buff above the tides;
        shaded from the north-west.
      </p>
      {index && (
        <ul className="foil-small" data-lidar-sources>
          {index.sources.map((s) => (
            <li key={s.id}>
              {s.name}: {s.kind}, {s.flown}, {s.resolution}; {s.licence}
            </li>
          ))}
        </ul>
      )}
      <p className="foil-small">
        Flown 2006&ndash;2012: banks and channels have moved since. Where water
        stood as it flew, a land survey saw its surface, not the bed. Not for
        navigation.
      </p>
    </div>
  );
}
