/**
 * The map's first two requests, made by the page before its code has loaded.
 *
 * The built index.html already preloads the map's chunks on a map URL (the
 * `preloadTheMap` plugin in vite.config.ts). Left at that, the map's forecast
 * would still wait for the entry to run, for the map's chunk to run, and only
 * then be asked for: the manifest and the riding places were the last thing on
 * the critical path to a drawn map, and the longest. So the same few lines of
 * the page start those two requests too, alongside the chunks, and keep the
 * responses here until the map takes them with `takeEarly` instead of asking
 * again.
 *
 * Deliberately free of React and of every app: the page and vite.config.ts
 * both read it.
 */

declare global {
  interface Window {
    /** Requests started by the page's head, by URL, until someone takes them. */
    __f5early?: Record<string, Promise<Response>>;
  }
}

/**
 * The response the page already asked for, once: a second caller (a later
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

/**
 * The statement the page's head runs for `urls`. They are asked for exactly as
 * their callers ask — `no-cache`, so a revalidation and never a stale copy —
 * because the caller uses this response in place of its own. A failure nobody
 * comes for (a fast back button) is caught here so it is not reported as
 * unhandled; the caller still sees it.
 */
export function earlyFetches(urls: readonly string[]): string {
  return (
    `if(typeof fetch=="function"){var e=window.__f5early={};` +
    `${JSON.stringify(urls)}.forEach(function(u){` +
    `e[u]=fetch(u,{cache:"no-cache"});e[u].catch(function(){})})}`
  );
}
