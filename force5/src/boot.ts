/**
 * The map's first two requests, made by the entry before the map's code has
 * arrived.
 *
 * The built index.html preloads the map's chunks on a map URL (the
 * `preloadTheMap` plugin in vite.config.ts). Left at that, the map's forecast
 * would still wait for the map's chunk — MapLibre and all, the largest file
 * on the page — to arrive and run before it was asked for: the manifest and
 * the riding places were the last thing on the critical path to a usable
 * dock, and the longest. So `src/main.tsx` starts those two requests as soon
 * as it runs on a map URL, and keeps the responses here until the map takes
 * them with `takeEarly` instead of asking again.
 *
 * The trade, measured on a phone profile (1.6 Mbit/s, 150 ms): the dock is
 * usable ~2.6 s sooner (5.9 s to 3.3 s), and the page's first paint, which
 * waits for the map's chunk, comes ~0.45 s later, because the manifest's
 * 90 kB now shares the line with that chunk. Started from the page's head
 * instead the cost was the same; asked for by the map once its chunk has run,
 * the dock gained only ~0.5 s. src/useBlend.ts then holds the other models
 * back until this one is in, so it does not share the line with them either;
 * with a published blend they are not asked for at all until the reader needs
 * them (src/App.tsx, `wantModels`).
 *
 * Deliberately free of React and of every app: the entry imports it.
 */
import { modelEntry } from "./catalog";
import { chosenModel, parseStarsChoice } from "./lead";
import { forecastUrl } from "./urls";

declare global {
  interface Window {
    /** Requests started by the entry, by URL, until someone takes them. */
    __f5early?: Record<string, Promise<Response>>;
  }
}

/** force5/src/prefs.ts `PREFS_KEY`, named again so the entry need not import the preferences. */
const STORED_PREFS = "force5.prefs.v1";

/**
 * The model the map opens on: the one the rider picked (force5/src/lead.ts),
 * read straight from what this device stored, HARMONIE if they never did or
 * storage cannot be read. src/App.tsx opens on the same one.
 */
export function storedMapModel(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): string {
  try {
    const raw = storage?.getItem(STORED_PREFS);
    const rider = raw ? (JSON.parse(raw) as { rider?: unknown })?.rider : null;
    return chosenModel(
      rider && typeof rider === "object"
        ? parseStarsChoice((rider as { starsFrom?: unknown }).starsFrom)
        : undefined,
    );
  } catch {
    return chosenModel(undefined);
  }
}

/**
 * What the map asks for first, as src/App.tsx names it: the rider's model's
 * manifest and the places. Not the blend the lights are rated from
 * (src/spotBlend.ts): the lights also wait for MapLibre, the largest file on
 * the page, so asked for here it only shared the line with the dock's
 * manifest and delayed the first paint, for stars no sooner.
 */
export const mapFirstRequests = (model = storedMapModel()): string[] => [
  forecastUrl(modelEntry(model)?.manifestUrl ?? "weather/harmonie.json"),
  `${import.meta.env.BASE_URL}spots.json`,
];

/**
 * Start `urls`, exactly as their callers ask for them — `no-cache`, so a
 * revalidation and never a stale copy — because the caller uses this response
 * in place of its own. A failure nobody comes for (a fast back button) is
 * caught here so it is not reported as unhandled; the caller still sees it.
 */
export function startEarly(urls: readonly string[]): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const early: Record<string, Promise<Response>> = {};
  for (const url of urls) {
    early[url] = fetch(url, { cache: "no-cache" });
    early[url].catch(() => {});
  }
  window.__f5early = early;
}

/**
 * The response the entry already asked for, once: a second caller (a later
 * revalidation, say) must make its own request rather than read a body that
 * has gone.
 */
export function takeEarly(url: string): Promise<Response> | undefined {
  if (typeof window === "undefined") return undefined;
  const early = window.__f5early;
  const hit = early?.[url];
  if (hit) delete early![url];
  return hit;
}
