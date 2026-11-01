import { describe, expect, it } from "vitest";
import { problem } from "../scripts/conventional-commits.mjs";

describe("Conventional Commit headers", () => {
  it.each([
    "feat: add the spot report",
    "fix(e2e): wait for the chart to rest before hovering a light",
    "feat(spot)!: drop the old day table",
    "ci: check commit messages on pull requests",
    "chore(deps): bump vite to 8.1",
    "docs(release.yml): explain the promote step",
  ])("accepts %s", (subject) => {
    expect(problem(subject)).toBeNull();
  });

  it.each([
    ["Make the spot page a spot report", /type\(scope\): summary/],
    ["Merge pull request #241 from x/y", /type\(scope\): summary/],
    ["feature: add a thing", /not a type/],
    ["Feat: add a thing", /type\(scope\): summary/],
    ["feat:add a thing", /type\(scope\): summary/],
    ["feat(): add a thing", /type\(scope\): summary/],
    ["fix: the end.", /full stop/],
    [`feat: ${"a".repeat(100)}`, /keep it to 100/],
  ])("rejects %s", (subject, why) => {
    expect(problem(subject)).toMatch(why);
  });
});
