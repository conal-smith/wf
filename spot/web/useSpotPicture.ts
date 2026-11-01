/**
 * A place's satellite picture (satellite.ts), once the list of pictures is
 * read: null until then, and for a place the list has no picture of (or none
 * published yet). The spot report lays the chart's loupe over it
 * (report/PhotoLoupe.tsx), and each nearby spot shows it small.
 */
import { useEffect, useState } from "react";
import { loadSpotPictures, spotPicture, type SpotPicture } from "./satellite";

export function useSpotPicture(spot: {
  id: string;
  lat: number;
  lon: number;
}): SpotPicture | null {
  const [picture, setPicture] = useState<SpotPicture | null>(null);
  useEffect(() => {
    let current = true;
    void loadSpotPictures().then((pictures) => {
      if (current) setPicture(pictures && spotPicture(pictures, spot));
    });
    return () => {
      current = false;
    };
  }, [spot]);
  return picture;
}
