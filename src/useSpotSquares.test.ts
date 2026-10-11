import { describe, expect, it } from "vitest";
import { requireModel, type ModelAvailability } from "../force5/src/manifests";
import { pointerOf, windManifest } from "../force5/src/testing";
import { SQUARE_RETRY_MS, lostModels, shownAnswer } from "./useSpotSquares";

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

describe("the answer shown while the next is read", () => {
  const earlier = [model(pointerOf(windManifest({ model: "harmonie" })))];
  const newer = [
    model(
      pointerOf(
        windManifest({ model: "harmonie", runTime: "2026-09-14T03:00:00Z" }),
      ),
    ),
  ];
  const last = {
    models: earlier,
    key: "n52w008",
    answer: { models: earlier, squares: ["n52w008"] },
  };

  it("stays for the same squares when a new run arrives", () => {
    expect(shownAnswer(last, newer, "n52w008", false)).toBe(last.answer);
    expect(shownAnswer(last, earlier, "n52w008", false)).toBe(last.answer);
  });

  it("is never another place's, unless the reader only adds places", () => {
    expect(shownAnswer(last, newer, "n54w010", false).models).toEqual([]);
    expect(shownAnswer(last, newer, "n52w008,n54w010", true)).toBe(last.answer);
  });

  it("is nothing when nothing is asked", () => {
    expect(shownAnswer(last, newer, null, true).squares).toBeNull();
    expect(shownAnswer(last, [], "n52w008", false).models).toEqual([]);
    expect(shownAnswer(null, newer, "n52w008", true).models).toEqual([]);
  });
});
