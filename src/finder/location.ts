/**
 * Where the rider is, for "near you": the browser is asked once, when the
 * rider presses "Use my location" under the line that says why it is
 * wanted, never on its own. A yes is kept on this device and the place is
 * read again quietly on later visits (the browser does not ask twice); a no
 * is kept too, and the browser is never asked again. Without a place, the
 * finder looks round where the chart was last centred (src/lastView.ts).
 */
import { useEffect, useState } from "react";
import { chartCentre, type LatLon } from "../lastView";
import { IRELAND_CENTRE } from "./finder";

export const LOCATION_KEY = "wingfoil.finder.location.v1";

type Answer = { at: LatLon } | { refused: true };

function stored(): Answer | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "null");
    if (v?.refused === true) return { refused: true };
    if (v?.at && Number.isFinite(v.at.lat) && Number.isFinite(v.at.lon))
      return { at: { lat: v.at.lat, lon: v.at.lon } };
  } catch {
    // Nothing kept, or nothing readable: as if never asked.
  }
  return null;
}

function keep(answer: Answer) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(answer));
  } catch {
    // Best effort: the answer still holds for this page.
  }
}

/** Where the place came from: the rider's browser, the chart, or neither. */
export type PlaceSource = "rider" | "chart" | "ireland";

export interface RiderPlace {
  at: LatLon;
  source: PlaceSource;
  /** The browser is being asked. */
  asking: boolean;
  /** The browser said no before, and is not asked again. */
  refused: boolean;
  /** The browser can say where the rider is at all. */
  locates: boolean;
}

type Place = Pick<RiderPlace, "at" | "source">;

const fallback = (): Place => {
  const chart = chartCentre();
  return chart
    ? { at: chart, source: "chart" }
    : { at: IRELAND_CENTRE, source: "ireland" };
};

const initial = (): Place => {
  const answer = stored();
  return answer && "at" in answer
    ? { at: answer.at, source: "rider" }
    : fallback();
};

/** Whether the rider's place was kept from an earlier yes. */
export const knownBefore = (): boolean => {
  const answer = stored();
  return answer !== null && "at" in answer;
};

const geolocation = () =>
  typeof navigator !== "undefined" ? (navigator.geolocation ?? null) : null;

/**
 * How long the finder waits on a first answer before it lists the places
 * round where it would look without one. A browser's question left
 * unanswered is never timed out by the browser; the place still comes in
 * if the rider answers later.
 */
export const ASK_WAIT_MS = 8000;

/**
 * The rider's place. `ask` is whether the browser may be asked now (the
 * rider pressed "Use my location", or said yes before and is on Near you):
 * once, unless it said no before. `asking` is true
 * from the first render that may ask, so the finder never shows the places
 * round another place before the browser has had its chance to answer.
 */
export function useRiderPlace(ask: boolean): RiderPlace {
  const [place, setPlace] = useState<Place>(initial);
  // The browser has answered, or the finder has stopped waiting on it.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ask) return;
    const answer = stored();
    if (answer && "refused" in answer) return;
    const geo = geolocation();
    if (!geo) return;
    let live = true;
    // Asked for the first time, the finder waits on the answer, a while;
    // known already, the kept place stands while it is read again.
    const wait = answer
      ? 0
      : window.setTimeout(() => live && setSettled(true), ASK_WAIT_MS);
    geo.getCurrentPosition(
      (position) => {
        const at = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        keep({ at });
        window.clearTimeout(wait);
        if (!live) return;
        setPlace({ at, source: "rider" });
        setSettled(true);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) keep({ refused: true });
        window.clearTimeout(wait);
        if (!live) return;
        if (!answer) setPlace(fallback());
        setSettled(true);
      },
      { maximumAge: 600000, timeout: 15000 },
    );
    return () => {
      live = false;
      window.clearTimeout(wait);
    };
  }, [ask]);
  // Never asked before, and about to be or being asked.
  const kept = stored();
  const asking = ask && !settled && geolocation() !== null && kept === null;
  return {
    ...place,
    asking,
    refused: kept !== null && "refused" in kept,
    locates: geolocation() !== null,
  };
}
