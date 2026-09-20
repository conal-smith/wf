import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * There is no DOM here, so the effect is run by hand: `useEffect` hands back
 * what it was given, and `document` is a title and nothing else.
 */
describe("usePageTitle", () => {
  let effect: (() => () => void) | undefined;

  async function mounted<T>(load: () => Promise<T>): Promise<T> {
    vi.resetModules();
    vi.doMock("react", async (original) => ({
      ...(await original<typeof import("react")>()),
      useEffect: (run: () => () => void) => {
        effect = run;
      },
    }));
    vi.stubGlobal("document", { title: "wingfoil.ie" });
    return load();
  }

  afterEach(() => {
    effect = undefined;
    vi.doUnmock("react");
    vi.unstubAllGlobals();
  });

  it("names the tab while the page is up, then puts back what was there", async () => {
    const { usePageTitle } = await mounted(() => import("./usePageTitle"));
    usePageTitle("Foil setup for light wind", "Community");
    const unmount = effect!();
    expect(document.title).toBe(
      "Foil setup for light wind — wingfoil.ie Community",
    );
    unmount();
    expect(document.title).toBe("wingfoil.ie");
  });

  it("is still `— wingfoil.ie Market` from the marketplace's own hook", async () => {
    const market = await mounted(() => import("../../market/web/components"));
    market.usePageTitle("My account");
    effect!();
    expect(document.title).toBe("My account — wingfoil.ie Market");
  });
});
