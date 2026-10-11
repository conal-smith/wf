import { describe, expect, it } from "vitest";
import { requireModel, type ModelAvailability } from "../force5/src/manifests";
import { pointerOf, windManifest } from "../force5/src/testing";
import { SQUARE_RETRY_MS, lostModels } from "./useSpotSquares";

const model = (manifest: ModelAvailability["manifest"]): ModelAvailability => ({
  id: "harmonie",
  entry: requireModel("harmonie"),
  manifest,
  wind: manifest as ModelAvailability["wind"],
  wave: null,
  weather: null,
  available: !!manifest,
  error: manifest ? null : "Forecast data answered 404.",
});

describe("spot squares that could not be read", () => {
  const run = pointerOf(windManifest({ model: "harmonie" }));

  it("are told apart from a model that had no pointer to begin with", () => {
    expect(lostModels([model(run)], [model(run)])).toBe(false);
    expect(lostModels([model(run)], [model(null)])).toBe(true);
    expect(lostModels([model(null)], [model(null)])).toBe(false);
  });

  it("are read again a few times, sooner first, then left", () => {
    expect(SQUARE_RETRY_MS.length).toBeGreaterThan(1);
    expect([...SQUARE_RETRY_MS]).toEqual(
      [...SQUARE_RETRY_MS].sort((a, b) => a - b),
    );
  });
});
