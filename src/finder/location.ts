/**
 * Where the rider is, for "near you": the browser is asked once, the first
 * time the rider chooses it. A yes is kept on this device and the place is
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
}

const fallback = (): RiderPlace => {
  const chart = chartCentre();
  return chart
    ? { at: chart, source: "chart", asking: false }
    : { at: IRELAND_CENTRE, source: "ireland", asking: false };
};

const initial = (): RiderPlace => {
  const answer = stored();
  return answer && "at" in answer
    ? { at: answer.at, source: "rider", asking: false }
    : fallback();
};

/**
 * The rider's place. `ask` is whether the browser may be asked now (the
 * rider has chosen "near you"): once, unless it said no before.
 */
export function useRiderPlace(ask: boolean): RiderPlace {
  const [place, setPlace] = useState<RiderPlace>(initial);
  useEffect(() => {
    if (!ask) return;
    const answer = stored();
    if (answer && "refused" in answer) return;
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo) return;
    let live = true;
    // Asked for the first time, the finder waits on the answer; known
    // already, the kept place stands while it is read again.
    if (!answer) setPlace((p) => ({ ...p, asking: true }));
    geo.getCurrentPosition(
      (position) => {
        const at = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        keep({ at });
        if (live) setPlace({ at, source: "rider", asking: false });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) keep({ refused: true });
        if (live && !answer) setPlace(fallback());
      },
      { maximumAge: 600000, timeout: 15000 },
    );
    return () => {
      live = false;
    };
  }, [ask]);
  return place;
}
