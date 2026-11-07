import type { ReactNode } from "react";
import { DepthScale } from "./DepthScale";
import { KnotScale } from "./KnotScale";
import { RainScale } from "./RainScale";

/**
 * The colour scales of what the chart is painted in just now, at its foot on
 * the left, above the small print: clear of the rail and of Gust, who stand
 * at the right. One a layer, and each only while its colours are on the map.
 */
export default function MapScales({
  wind,
  depth,
  rain,
}: {
  wind: boolean;
  depth: boolean;
  rain: boolean;
}) {
  const scales: [string, string, ReactNode][] = [];
  if (wind) scales.push(["wind", "Wind", <KnotScale key="wind" />]);
  if (depth) scales.push(["depth", "Water", <DepthScale key="depth" />]);
  if (rain) scales.push(["rain", "Rain", <RainScale key="rain" />]);
  if (!scales.length) return null;
  return (
    <div className="map-scales" data-map-scales>
      {scales.map(([id, name, scale]) => (
        <div key={id} className="map-scale chart-box" data-map-scale={id}>
          <span className="map-scale-name">{name}</span>
          {scale}
        </div>
      ))}
    </div>
  );
}
