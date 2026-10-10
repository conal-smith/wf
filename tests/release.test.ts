import { describe, expect, it } from "vitest";
import {
  configureIndexHtml,
  nightliesNewestFirst,
  nightlyGate,
  nightlyVersion,
  promotionCheck,
  releaseVersion,
  releasesNewestFirst,
} from "../scripts/release/release.mjs";

const at = (iso: string) => new Date(iso);
const A = "a".repeat(40);
const B = "b".repeat(40);

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
