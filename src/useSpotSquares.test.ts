import { describe, expect, it } from "vitest";
import { requireModel, type ModelAvailability } from "../force5/src/manifests";
import { pointerOf, windManifest } from "../force5/src/testing";
import {
  ALL_SQUARES,
  SQUARE_RETRY_MS,
  SquareRetries,
  lostModels,
  readSquares,
  shownAnswer,
} from "./useSpotSquares";

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
    // A model that read some of its squares is still there, and is read again.
    expect(
      lostModels([model(run)], [{ ...model(run), unread: ["n52w008"] }]),
    ).toBe(true);
  });

  it("are left out of the squares the answer carries, so their places stay pending", () => {
    const partial = { ...model(run), unread: ["n52w008"] };
    expect(readSquares(["n52w008", "n52w012"], [model(run), partial])).toEqual(
      ["n52w012"],
    );
    expect(readSquares(["n52w008", "n52w012"], [model(run)])).toEqual([
      "n52w008",
      "n52w012",
    ]);
    // Every square: what the runs list, less the one that failed.
    expect(readSquares(ALL_SQUARES, [model(run)])).toBe(ALL_SQUARES);
    expect(readSquares(ALL_SQUARES, [partial])).toEqual(
      run.spots.squares.filter((square) => square !== "n52w008"),
    );
  });

  it("are read again from the first wait for each set of squares asked", () => {
    const models = [model(run)];
    const retries = new SquareRetries();
    expect(retries.attempt(models, "n52w008")).toBe(0);
    for (let i = 0; i < SQUARE_RETRY_MS.length; i++)
      retries.failed(models, "n52w008");
    expect(retries.attempt(models, "n52w008")).toBe(SQUARE_RETRY_MS.length);
    // Another set of squares starts afresh, and so does coming back: the
    // exhausted count is not carried, so the first set is read again.
    expect(retries.attempt(models, "n54w010")).toBe(0);
    retries.failed(models, "n54w010");
    expect(retries.attempt(models, "n54w010")).toBe(1);
    expect(retries.attempt(models, "n52w008")).toBe(0);
    // New models (a new run) are a new question too.
    expect(retries.attempt([model(run)], "n52w008")).toBe(0);
    // A failure reported for a question no longer asked counts for nothing.
    retries.failed(models, "n52w008");
    expect(retries.attempt(models, "n54w010")).toBe(0);
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
