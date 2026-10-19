/**
 * Rewrite the `expected` half of the consensus fixture from the site's own rule.
 *
 *   npx tsx force5/blend/consensus-fixture.ts
 *
 * The verification job scores the hours the stars come from with a Python
 * replica of `placeConsensus` (force5/ingest/consensus.py). The fixture is what
 * holds the two together: its inputs are fixed, and its `expected` values are
 * whatever the TypeScript computes from them, for each choice of models in
 * `leads` (force5/src/lead.ts). Run this after changing the rule, then make
 * force5/ingest/test_consensus.py pass again.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { placeConsensus } from "../../src/ratings";
import { windModels } from "../src/manifests";
import type { Manifest } from "../src/weather";

const path = new URL("../ingest/fixtures/blend-consensus.json", import.meta.url);
const fixture = JSON.parse(readFileSync(path, "utf8"));
const expected: Record<string, Record<string, unknown>> = {};
for (const [model, then] of fixture.leads as [string, string][]) {
  const byPlace: Record<string, unknown> = {};
  for (const spot of fixture.spots as string[]) {
    const c = placeConsensus(
      fixture.manifests as Manifest[],
      fixture.blendIds,
      spot,
      fixture.axis,
      { model, then },
    );
    byPlace[spot] = { median: c.median, gust: c.gust, from: c.from, model: c.model };
  }
  expected[`${model}>${then}`] = byPlace;
}
fixture.blendModels = windModels().map((entry) => entry.id);
fixture.expected = expected;
writeFileSync(path, JSON.stringify(fixture, null, 1) + "\n");
console.log(
  `Wrote ${Object.keys(expected).length} choices of ${fixture.spots.length} places to ${path.pathname}`,
);
