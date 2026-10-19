// The verification job scores the hours the stars come from with a Python
// replica of `placeConsensus` (force5/ingest/consensus.py). This holds the
// TypeScript to the fixture both sides share, for each choice of models it
// lists; force5/ingest/test_consensus.py holds the Python to the same numbers.
// If this fails after a change to the rule, regenerate the fixture (npx tsx
// force5/blend/consensus-fixture.ts) and bring the replica back into line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConsensus } from "../../src/ratings";
import { DEFAULT_STARS_FROM } from "./lead";
import { windModels } from "./manifests";
import type { Manifest } from "./weather";

interface Fixture {
  blendIds: string[];
  spots: string[];
  axis: string[];
  manifests: Manifest[];
  blendModels: string[];
  leads: [string, string][];
  expected: Record<
    string,
    Record<
      string,
      Record<"median" | "gust" | "from", (number | null)[]> & {
        model: (string | null)[];
      }
    >
  >;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../ingest/fixtures/blend-consensus.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

describe("the hours the verification replicates", () => {
  it("computes the fixture's expected hours for every choice of models", () => {
    for (const [model, then] of fixture.leads)
      for (const spot of fixture.spots) {
        const got = placeConsensus(
          fixture.manifests,
          fixture.blendIds,
          spot,
          fixture.axis,
          { model, then },
        );
        const want = fixture.expected[`${model}>${then}`][spot];
        expect(got.model).toEqual(want.model);
        for (const key of ["median", "gust", "from"] as const) {
          expect(got[key].length).toBe(want[key].length);
          got[key].forEach((value, i) => {
            if (want[key][i] === null) expect(value).toBeNull();
            else expect(value).toBeCloseTo(want[key][i] as number, 9);
          });
        }
      }
  });

  it("covers the default choice", () => {
    expect(fixture.leads).toContainEqual([
      DEFAULT_STARS_FROM.model,
      DEFAULT_STARS_FROM.then,
    ]);
  });

  it("reads the models the replica reads", () => {
    expect(windModels().map((entry) => entry.id)).toEqual(fixture.blendModels);
  });
});
