import { useEffect, useState } from "react";
import type { ViewBounds } from "../force5/src/squares";

/** The part of a MapLibre map this needs: where it looks, and when it stops. */
export interface ViewSource {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
  on(type: "moveend", listener: () => void): unknown;
  off(type: "moveend", listener: () => void): unknown;
}

const same = (a: ViewBounds | null, b: ViewBounds) =>
  !!a &&
  a.west === b.west &&
  a.south === b.south &&
  a.east === b.east &&
  a.north === b.north;

/**
 * What the map shows, read once the camera settles (`moveend`) and never
 * while it moves: the squares in view (`squaresInView`) are worked out from it,
 * so a pan or a flight asks for squares once, where it comes to rest. Null
 * until there is a map.
 */
export function useViewBounds(map: ViewSource | null | undefined): ViewBounds | null {
  const [bounds, setBounds] = useState<ViewBounds | null>(null);
  useEffect(() => {
    if (!map) return;
    const read = () => {
      const b = map.getBounds();
      const next = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      };
      setBounds((shown) => (same(shown, next) ? shown : next));
    };
    read();
    map.on("moveend", read);
    return () => {
      map.off("moveend", read);
    };
  }, [map]);
  return map ? bounds : null;
}
