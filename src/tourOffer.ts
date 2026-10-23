/**
 * Whether to offer the tour: on a first visit only, and never to a robot.
 * The one part of the tour on the map's default load, so it is kept to a few
 * lines; the offer and the tour are chunks of their own (src/TourPrompt.tsx,
 * src/Tour.tsx).
 *
 * A first visit is a browser that has kept nothing of the site's: no tour
 * key and none of the map's own (its spots, its preferences, its layers), so
 * a rider who came before there was a tour is never stopped by one. Skipped,
 * declined or finished, the tour key is written and it is not offered again.
 *
 * Automation is never offered it: a browser driven by WebDriver or Playwright
 * says so (`navigator.webdriver`), and a crawler by its name. The e2e suite's
 * specs about the tour ask for it by `TOUR_TEST_KEY`, so no other spec
 * meets it.
 */
export const TOUR_KEY = "wingfoil.tour.v1";
export const TOUR_TEST_KEY = "wingfoil.tour.e2e";

interface Visit {
  storage: Pick<Storage, "length" | "key" | "getItem"> | null;
  webdriver: boolean;
  agent: string;
}

export function offerTour({ storage, webdriver, agent }: Visit): boolean {
  try {
    if (!storage || storage.getItem(TOUR_KEY)) return false;
    if (!storage.getItem(TOUR_TEST_KEY)) {
      if (
        webdriver ||
        /bot|crawl|spider|slurp|headless|lighthouse/i.test(agent)
      )
        return false;
      for (let i = 0; i < storage.length; i++)
        if (/^(wingfoil|force5)\./.test(storage.key(i) ?? "")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const tourOffered = () =>
  offerTour({
    storage: (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })(),
    webdriver: navigator.webdriver,
    agent: navigator.userAgent,
  });

/** The tour skipped, declined or finished: not offered again. */
export function tourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "seen");
  } catch {
    // Best effort: it is not offered again on this page either way.
  }
}
