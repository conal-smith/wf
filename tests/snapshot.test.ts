import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sample, validateFrame, validateManifest } from "../force5/src/weather";
import type { Spot } from "../force5/src/weather";

describe.each(["latest", "harmonie", "ecmwf", "gfs"])(
  "downloaded real %s forecast snapshot",
  (name) => {
    it("all files match the manifest and all spot summaries match their wind grid", () => {
      const m = validateManifest(
        JSON.parse(readFileSync(`public/weather/${name}.json`, "utf8")),
      );
      const spots: Spot[] = JSON.parse(
        readFileSync("public/spots.json", "utf8"),
      );
      m.frames.forEach((info, i) => {
        const frame = validateFrame(
          JSON.parse(readFileSync(`public/${info.url}`, "utf8")),
          m,
          info,
        );
        for (const spot of spots) {
          const wind = sample(frame, spot.lon, spot.lat)!;
          const summary = m.spotForecasts[spot.id][i];
          expect(summary.validTime).toBe(info.validTime);
          for (const field of ["u", "v", "gust"] as const) {
            if (wind[field] === null || summary[field] === null) {
              expect(wind[field]).toBeNull();
              expect(summary[field]).toBeNull();
              expect(
                m.gustAvailable === false ||
                  m.gustMissingHours?.includes(info.hour),
              ).toBeTruthy();
              continue;
            }
            expect(Math.abs(wind[field] - summary[field])).toBeLessThanOrEqual(
              0.00501,
            );
          }
        }
      });
    });
  },
);
