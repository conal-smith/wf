// The verification job scores the blend with a Python replica of
// `placeConsensus` (force5/ingest/consensus.py). This holds the TypeScript to
// the fixture both sides share; force5/ingest/test_consensus.py holds the
// Python to the same numbers. If this fails after a change to the blend,
// regenerate the fixture (npx tsx force5/blend/consensus-fixture.ts) and bring
// the replica back into line.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConsensus } from "../../src/ratings";
import { windModels } from "./manifests";
import type { Manifest } from "./weather";

interface Fixture {
  blendIds: string[];
  spots: string[];
  axis: string[];
  manifests: Manifest[];
  blendModels: string[];
  expected: Record<
    string,
    Record<"median" | "gust" | "from", (number | null)[]>
  >;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../ingest/fixtures/blend-consensus.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

describe("the blend the verification replicates", () => {
  it("computes the fixture's expected consensus", () => {
    for (const spot of fixture.spots) {
      const got = placeConsensus(
        fixture.manifests,
        fixture.blendIds,
        spot,
        fixture.axis,
      );
      for (const key of ["median", "gust", "from"] as const) {
        const want = fixture.expected[spot][key];
        expect(got[key].length).toBe(want.length);
        got[key].forEach((value, i) => {
          if (want[i] === null) expect(value).toBeNull();
          else expect(value).toBeCloseTo(want[i] as number, 9);
        });
      }
    }
  });

  it("reads the models the replica reads", () => {
    expect(windModels().map((entry) => entry.id)).toEqual(fixture.blendModels);
  });
});
