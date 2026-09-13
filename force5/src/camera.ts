import type { Grid } from "./weather";

const y = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const latitude = (value: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Cover the visible map with real data, like CSS cover rather than contain.
 * The camera centre includes the area hidden behind the forecast dock.
 * No forecast pixels are stretched or extrapolated beyond the source grid.
 */
export function coverageCamera(
  grid: Pick<Grid, "west" | "east" | "north" | "south">,
  width: number,
  height: number,
  bottomInset: number,
  preferred?: [number, number],
  currentZoom = 0,
) {
  const visibleHeight = Math.max(1, height - bottomInset);
  const west = (grid.west + 180) / 360,
    east = (grid.east + 180) / 360;
  const north = y(grid.north),
    south = y(grid.south);
  const scale =
    Math.max(width / (east - west), visibleHeight / (south - north)) * 1.08;
  const zoom = Math.max(Math.log2(scale / 512), currentZoom);
  const pixels = 512 * 2 ** zoom;
  // Leave a few pixels inside every edge, including after selection panning.
  const halfWidth = (width / 2 + 4) / pixels,
    halfHeight = (visibleHeight / 2 + 4) / pixels;
  const cx = clamp(
    preferred ? (preferred[0] + 180) / 360 : (west + east) / 2,
    west + halfWidth,
    east - halfWidth,
  );
  const cy = clamp(
    preferred ? y(preferred[1]) : (north + south) / 2,
    north + halfHeight,
    south - halfHeight,
  );
  return {
    center: [cx * 360 - 180, latitude(cy + bottomInset / (2 * pixels))] as [
      number,
      number,
    ],
    zoom,
  };
}
