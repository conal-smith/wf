/**
 * The map, with the AI page, "How the stars work" and the spot pages opened
 * over it rather than in its place.
 *
 * Each of those is a bundle of its own (src/main.tsx), and a link to one used
 * to be a page load: coming back from /ai rebooted the map, its manifests,
 * its tiles and every layer drawn again. Opened from the map, they are now
 * drawn over it, with the URL pushed, while the map stays mounted underneath,
 * hidden and inert. Back, the page's own way back to the chart and Escape all
 * take the rider to the map exactly as it was.
 *
 * Only links are taken over: a page loaded at /ai or /spot/… is drawn alone,
 * as before, and a link to the marketplace, the community or the map on
 * another spot (`/?spot=…`) is still a page load. The map is the spot finder
 * (`/`) or the full chart (`/?map`, `/?spot=…`), whichever the page opened
 * over; a link to the one it was is the way back to it as it was, and a link
 * to the other brings that one up in the map's place. The site menu's
 * Settings (`/?settings`) is the way back with Settings open over whichever
 * it is.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import {
  CHART_HREF,
  FINDER_HREF,
  asksChart,
  asksSettings,
  isAiPath,
  isChartAddress,
  isSpotPath,
} from "../force5/src/siteNav";

const AiApp = React.lazy(() => import("../ai/web/AiApp"));
const SpotApp = React.lazy(() => import("../spot/web/SpotApp"));

/**
 * Said on the window once a page over the map has handed the reader back to
 * it for Settings: the map (src/App.tsx) opens the Settings dialog.
 */
export const SETTINGS_EVENT = "wingfoil:settings";

/** The paths drawn over the map when a link from it asks for one. */
export const isOverPath = (pathname: string) =>
  isAiPath(pathname) || isSpotPath(pathname);

/** How many pages over the map this history entry is, 0 for the map itself. */
const depth = (): number => {
  const state = window.history.state as { overMap?: unknown } | null;
  return typeof state?.overMap === "number" ? state.overMap : 0;
};

const here = () =>
  window.location.pathname + window.location.search + window.location.hash;

/**
 * The link a click follows on this origin, or null when it should be left to
 * the browser: another tab or window, a download, a modified click.
 */
export function followedLink(event: MouseEvent): URL | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  const target = event.target as Element | null;
  const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || link.hasAttribute("download")) return null;
  if (link.target && link.target !== "_self") return null;
  const url = new URL(link.href, window.location.href);
  return url.origin === window.location.origin ? url : null;
}

export default function PagesOverMap({ map }: { map: React.ReactNode }) {
  // The page over the map (its path, query and hash), or null for the map.
  const [over, setOver] = useState<string | null>(null);
  // The map's own query when the first page opened over it: a link back to
  // the map with another (`/?spot=…`) is a page load, as the map reads it once.
  const mapSearch = useRef(window.location.search);
  const page = useRef<HTMLDivElement>(null);
  // Settings was asked for from a page over the map: once the map is back
  // and no longer inert, it opens Settings.
  const settings = useRef(false);

  useEffect(() => {
    const back = () => {
      const pages = depth();
      if (pages) window.history.go(-pages);
      else {
        window.history.pushState(null, "", "/" + mapSearch.current);
        setOver(null);
      }
    };
    const click = (event: MouseEvent) => {
      const url = followedLink(event);
      if (!url) return;
      if (isOverPath(url.pathname)) {
        event.preventDefault();
        if (!depth()) mapSearch.current = window.location.search;
        // Whatever on the map had focus (the site menu's row) lets go, and the
        // menu closes behind it as it does when focus leaves.
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        window.history.pushState({ overMap: depth() + 1 }, "", url);
        window.scrollTo(0, 0);
        setOver(here());
      } else if (
        over &&
        ((url.pathname === "/" && !url.search) || asksChart(url))
      ) {
        // The spot finder or the full chart (the menu's rows, a way back
        // named Chart): the map as it was if it is that one, or that one in
        // its place, the map hearing of it as it hears Back and Forward.
        event.preventDefault();
        const chart = asksChart(url);
        const was = isChartAddress({
          pathname: "/",
          search: mapSearch.current,
        });
        if (chart === was) back();
        else {
          window.history.pushState(null, "", chart ? CHART_HREF : FINDER_HREF);
          setOver(null);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      } else if (over && asksSettings(url)) {
        event.preventDefault();
        settings.current = true;
        back();
      } else if (
        over &&
        url.pathname === "/" &&
        (!url.search || url.search === mapSearch.current)
      ) {
        event.preventDefault();
        back();
      }
    };
    // Escape on a page over the map is the way back to it, unless a dialog
    // or a menu of the page's is open (Escape is theirs), and the map's own
    // Escape (clearing its focus) does not see it.
    const escape = (event: KeyboardEvent) => {
      if (!over || event.key !== "Escape") return;
      if (page.current?.querySelector("dialog[open], [aria-expanded='true']"))
        return;
      event.stopImmediatePropagation();
      back();
    };
    const pop = () =>
      setOver(isOverPath(window.location.pathname) ? here() : null);
    document.addEventListener("click", click);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("click", click);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("popstate", pop);
    };
  }, [over]);

  useEffect(() => {
    if (over || !settings.current) return;
    settings.current = false;
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  }, [over]);

  const path = over ? new URL(over, window.location.origin).pathname : "";
  return (
    <>
      {/* Hidden rather than removed: the map keeps its size, its tiles and
          its layers, and draws nothing while a page is over it. */}
      <div
        className={over ? "map-under-page" : undefined}
        inert={over ? true : undefined}
        aria-hidden={over ? true : undefined}
      >
        {map}
      </div>
      {over && (
        <div ref={page}>
          <Suspense fallback={null}>
            {isAiPath(path) ? <AiApp key={over} /> : <SpotApp key={over} />}
          </Suspense>
        </div>
      )}
    </>
  );
}
