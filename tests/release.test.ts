import { describe, expect, it } from "vitest";
import {
  aheadOfProduction,
  configureIndexHtml,
  nightliesNewestFirst,
  nightlyGate,
  nightlyVersion,
  promoteCheck,
  promotionCheck,
  releaseVersion,
  releasesNewestFirst,
  stagedNewestFirst,
  stagedRecord,
  stagedVersion,
  stagingPassed,
  verifyStaged,
} from "../scripts/release/release.mjs";

const at = (iso: string) => new Date(iso);
const A = "a".repeat(40);
const B = "b".repeat(40);
const HASH = (c: string) => c.repeat(64);

describe("versions", () => {
  it("names a nightly for its UTC date and run", () => {
    expect(nightlyVersion(at("2026-10-10T23:30:00-02:00"), 42)).toBe(
      "2026.10.11-nightly.42",
    );
    expect(() => nightlyVersion(at("2026-10-10T00:00:00Z"), "")).toThrow();
  });

  it("names a release for the day, counting up when the day already shipped", () => {
    const now = at("2026-10-10T09:00:00Z");
    expect(releaseVersion(now, [])).toBe("2026.10.10");
    expect(releaseVersion(now, ["v2026.10.10"])).toBe("2026.10.10.2");
    expect(releaseVersion(now, ["v2026.10.10", "v2026.10.10.2"])).toBe(
      "2026.10.10.3",
    );
    expect(releaseVersion(now, ["v2026.10.10-nightly.7"])).toBe("2026.10.10");
  });

  it("orders nightlies and releases newest first, by date then counter", () => {
    const tags = [
      "v2026.10.09-nightly.9",
      "v2026.10.10-nightly.10",
      "v2026.10.10-nightly.12",
      "v2026.10.10",
      "v2026.10.10.2",
      "v2026.09.30",
      "not-a-tag",
    ];
    expect(nightliesNewestFirst(tags)).toEqual([
      "v2026.10.10-nightly.12",
      "v2026.10.10-nightly.10",
      "v2026.10.09-nightly.9",
    ]);
    expect(releasesNewestFirst(tags)).toEqual([
      "v2026.10.10.2",
      "v2026.10.10",
      "v2026.09.30",
    ]);
  });
});

describe("the nightly gate", () => {
  it("builds when there is no nightly yet", () => {
    expect(nightlyGate({ head: A, last: null, lastIsAncestor: false }).build).toBe(true);
  });

  it("skips when main has nothing the last nightly did not build", () => {
    const last = { tag: "v2026.10.10-nightly.4", commit: A };
    expect(nightlyGate({ head: A, last, lastIsAncestor: true }).build).toBe(false);
  });

  it("builds when main has moved on", () => {
    const last = { tag: "v2026.10.10-nightly.4", commit: A };
    expect(nightlyGate({ head: B, last, lastIsAncestor: true }).build).toBe(true);
  });

  it("refuses, loudly, when main was rewritten under the last nightly", () => {
    const last = { tag: "v2026.10.10-nightly.4", commit: A };
    expect(() => nightlyGate({ head: B, last, lastIsAncestor: false })).toThrow(
      /no longer contains/,
    );
  });
});

describe("promotion", () => {
  it("needs a nightly, and promotes each commit once", () => {
    expect(() => promotionCheck({ nightly: null, releasedAt: undefined })).toThrow(
      /no nightly/,
    );
    const nightly = { tag: "v2026.10.10-nightly.4", commit: A };
    expect(() => promotionCheck({ nightly, releasedAt: "v2026.10.09" })).toThrow(
      /already released as v2026.10.09/,
    );
    expect(() => promotionCheck({ nightly, releasedAt: undefined })).not.toThrow();
  });
});

describe("staging, then promoting", () => {
  const images = {
    version: "2026.10.10-nightly.4",
    commit: A,
    images: { forecast: "f@sha256:1", web: "w@sha256:2", market: "m@sha256:3" },
  };
  const sha256 = { "images.json": HASH("1"), "site.tar.gz": HASH("2") };
  const record = (overrides = {}) =>
    stagedRecord({
      tag: "v2026.10.11-rc.57",
      version: "2026.10.11-rc.57",
      nightlyTag: "v2026.10.10-nightly.4",
      commit: A,
      images,
      sha256,
      runId: 1234,
      runAttempt: "1",
      siteDeployed: true,
      siteUrl: "https://staging.example.pages.dev/",
      forecastBase: "https://data.example.com/",
      at: "2026-10-11T10:00:00Z",
      ...overrides,
    });
  const candidate = { tag: "v2026.10.11-rc.57", commit: A };
  const passed = { name: "Staging", status: "completed", conclusion: "success" };
  const ok = {
    candidate,
    staged: record(),
    stagingJob: passed,
    releasedAt: undefined,
    production: null,
    containsProduction: false,
    pagesProject: "wingfoil",
  };

  it("names a candidate for its day and the run that staged it, and orders them", () => {
    expect(stagedVersion(at("2026-10-11T09:00:00Z"), 57)).toBe("2026.10.11-rc.57");
    expect(() => stagedVersion(at("2026-10-11T09:00:00Z"), "x")).toThrow();
    const tags = ["v2026.10.11-rc.57", "v2026.10.11-rc.60", "v2026.10.10-rc.61", "v2026.10.11", "v2026.10.11-nightly.9"];
    expect(stagedNewestFirst(tags)).toEqual(["v2026.10.11-rc.60", "v2026.10.11-rc.57", "v2026.10.10-rc.61"]);
    // A candidate is neither a nightly nor a release, so neither train counts it.
    expect(nightliesNewestFirst(tags)).toEqual(["v2026.10.11-nightly.9"]);
    expect(releasesNewestFirst(tags)).toEqual(["v2026.10.11"]);
  });

  it("records the digests, the files' hashes, the nightly and the staging run", () => {
    const staged = record();
    expect(staged).toMatchObject({
      tag: "v2026.10.11-rc.57",
      nightly: "v2026.10.10-nightly.4",
      commit: A,
      images: images.images,
      sha256,
      staging: { job: "Staging", runId: "1234", runAttempt: 1, siteDeployed: true },
    });
    expect(record({ siteDeployed: false }).staging).toMatchObject({ siteDeployed: false, siteUrl: "" });
    expect(() => record({ tag: "v2026.10.11" })).toThrow(/Not a staged tag/);
    expect(() => record({ commit: B })).toThrow(/images.json is for/);
    expect(() => record({ sha256: { "images.json": HASH("1") } })).toThrow(/site.tar.gz/);
  });

  it("calls a staging passed only when its job completed successfully", () => {
    expect(stagingPassed(passed)).toBe(true);
    expect(stagingPassed({ ...passed, conclusion: "failure" })).toBe(false);
    expect(stagingPassed({ status: "in_progress", conclusion: null })).toBe(false);
    expect(stagingPassed(undefined)).toBe(false);
  });

  it("promotes a candidate that passed staging and is ahead of production", () => {
    expect(() => promoteCheck(ok)).not.toThrow();
    const production = { tag: "v2026.10.09", commit: B };
    expect(() => promoteCheck({ ...ok, production, containsProduction: true })).not.toThrow();
  });

  it("refuses nothing staged, a record for something else, and a staging that failed", () => {
    expect(() => promoteCheck({ ...ok, candidate: null })).toThrow(/Nothing has been staged/);
    expect(() => promoteCheck({ ...ok, staged: record({ commit: B, images: { ...images, commit: B } }) })).toThrow(
      /does not describe it/,
    );
    expect(() => promoteCheck({ ...ok, stagingJob: undefined })).toThrow(/no Staging job/);
    expect(() => promoteCheck({ ...ok, stagingJob: { ...passed, conclusion: "failure" } })).toThrow(
      /did not pass staging.*failure/,
    );
    expect(() => promoteCheck({ ...ok, stagingJob: { status: "in_progress", conclusion: null } })).toThrow(
      /in_progress/,
    );
  });

  it("refuses a commit already released, and anything production has moved past", () => {
    expect(() => promoteCheck({ ...ok, releasedAt: "v2026.10.10" })).toThrow(/already released as v2026.10.10/);
    const production = { tag: "v2026.10.10", commit: B };
    expect(() => promoteCheck({ ...ok, production, containsProduction: false })).toThrow(
      /does not contain v2026.10.10.*only moves forward/,
    );
    // Staging refuses the same, before half an hour of tests.
    expect(() =>
      aheadOfProduction({ candidate: { tag: "v2026.10.08-nightly.1", commit: A }, production, containsProduction: false }),
    ).toThrow(/does not contain/);
    expect(() => aheadOfProduction({ candidate, production: null, containsProduction: false })).not.toThrow();
  });

  it("refuses a site production would get that staging never deployed", () => {
    const unstaged = record({ siteDeployed: false });
    expect(() => promoteCheck({ ...ok, staged: unstaged })).toThrow(/without a site deployment/);
    // With no Pages project, production deploys no site either: fine.
    expect(() => promoteCheck({ ...ok, staged: unstaged, pagesProject: "" })).not.toThrow();
  });

  it("checks the downloaded files are byte for byte what staging tested", () => {
    const staged = record();
    const files = { staged, tag: candidate.tag, ref: A, images, sha256 };
    expect(() => verifyStaged(files)).not.toThrow();
    expect(() => verifyStaged({ ...files, sha256: { ...sha256, "site.tar.gz": HASH("3") } })).toThrow(
      /site.tar.gz is not the file staging tested/,
    );
    expect(() => verifyStaged({ ...files, ref: B })).toThrow(/not b{12}/);
    expect(() =>
      verifyStaged({ ...files, images: { ...images, images: { ...images.images, web: "w@sha256:9" } } }),
    ).toThrow(/web image/);
    expect(() => verifyStaged({ ...files, tag: "v2026.10.11-rc.58" })).toThrow(/not v2026.10.11-rc.58/);
  });
});

describe("pointing a build at an environment's data", () => {
  const html = "<html>\n  <head>\n    <title>x</title>\n  </head>\n</html>";

  it("adds the meta tag forecastUrl reads, with a trailing slash", () => {
    const out = configureIndexHtml(html, "https://data.example.com/staging");
    expect(out).toContain(
      '<meta name="wingfoil:forecast-base" content="https://data.example.com/staging/" />',
    );
    expect(out.indexOf("wingfoil:forecast-base")).toBeLessThan(out.indexOf("</head>"));
  });

  it("replaces an earlier one rather than adding a second", () => {
    const once = configureIndexHtml(html, "https://staging.example.com/");
    const twice = configureIndexHtml(once, "https://data.example.com/");
    expect(twice.match(/wingfoil:forecast-base/g)).toHaveLength(1);
    expect(twice).toContain('content="https://data.example.com/"');
  });

  it("refuses plain http except on this machine, and anything not a URL", () => {
    expect(() => configureIndexHtml(html, "http://data.example.com/")).toThrow(/https/);
    expect(() => configureIndexHtml(html, "data.example.com")).toThrow(/Not a URL/);
    expect(configureIndexHtml(html, "http://127.0.0.1:9000/b/")).toContain(
      'content="http://127.0.0.1:9000/b/"',
    );
  });
});
