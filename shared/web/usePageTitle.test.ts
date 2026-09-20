import { describe, expect, it } from "vitest";
import { pageTitle } from "./usePageTitle";

describe("pageTitle", () => {
  it("puts the section after the site's name", () => {
    expect(pageTitle("Foil setup for light wind", "Community")).toBe(
      "Foil setup for light wind — wingfoil.ie Community",
    );
  });

  it("leaves the marketplace's titles as they were", () => {
    expect(pageTitle("My account", "Market")).toBe(
      "My account — wingfoil.ie Market",
    );
  });
});
