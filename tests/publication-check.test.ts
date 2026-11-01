import { describe, expect, it } from "vitest";
import { denylist, findings } from "../scripts/publication-check.mjs";

describe("what may be published", () => {
  it.each([
    "Open http://build-box.tail1234.ts.net:8790/ to see it",
    "The site is then `https://<machine>.<tailnet>.ts.net/` for your devices",
    "Paths like /Users/dev/wingfoil and /home/runner/work/wf",
    "A provider's /home/SWAN/OUTPUT/irish_shelf path",
    "Ask aoife@example.com, or noreply@anthropic.com",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "A windy day at 100 km, version 100.2.3",
    "Retailers, tailwinds and a detail",
  ])("passes %s", (text) => {
    expect(findings(text)).toEqual([]);
  });

  it.each([
    ["Open http://studio-host.tail9f3c2a.ts.net:8790/", /tailnet name/],
    ["the tailnet tail9f3c2a", /tailnet id/],
    ["ssh 100.101.12.7", /Tailscale address/],
    ["from /Users/someone/code/wf", /home directory/],
    ["write to rider.person@gmail.com", /email address/],
  ])("fails %s", (text, why) => {
    expect(findings(text).join("\n")).toMatch(why);
  });

  it("fails a denylisted name without repeating it", () => {
    const deny = denylist("# competitors\nacme\\s?forecast\n\nrivalwind");
    expect(deny).toHaveLength(2);
    const found = findings("Laid out as on Acme Forecast's map", deny);
    expect(found).toEqual(["a denylisted name (PUBLICATION_DENYLIST)"]);
    expect(findings("Laid out as a narrow list", deny)).toEqual([]);
  });

  it("matches a line starting with = by case", () => {
    const deny = denylist("=\\bGusty\\b");
    expect(findings("as Gusty draws it", deny)).toHaveLength(1);
    expect(findings("a gusty day", deny)).toEqual([]);
  });
});
