import { describe, expect, it } from "vitest";
import { coverageCamera } from "../force5/src/camera";

const grid = { west: -10.9, east: -5.1, south: 51, north: 55.7 };
const mercY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
describe("default camera covers the visible viewport with real forecast data", () => {
  for (const [width, height, dock] of [
    [390, 844, 290],
    [1440, 1000, 290],
    [844, 390, 250],
    [320, 640, 290],
  ]) {
    it(`${width} x ${height}, including off-centre spot selection`, () => {
      for (const point of [undefined, [-10.024, 52.276], [-5.5, 55.6]] as (
        [number, number] | undefined
      )[]) {
        const camera = coverageCamera(grid, width, height, dock, point);
        const scale = 512 * 2 ** camera.zoom;
        const x = (camera.center[0] + 180) / 360,
          y = mercY(camera.center[1]);
        expect(x - width / (2 * scale)).toBeGreaterThan(
          (grid.west + 180) / 360,
        );
        expect(x + width / (2 * scale)).toBeLessThan((grid.east + 180) / 360);
        expect(y - height / (2 * scale)).toBeGreaterThan(mercY(grid.north));
        expect(y + (height / 2 - dock) / scale).toBeLessThan(mercY(grid.south));
      }
    });
  }
});
