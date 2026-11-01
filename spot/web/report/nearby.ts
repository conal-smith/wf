/**
 * The spots around this one, with the wind there now and today's best stars
 * for this rider: the strip under the name, and the column beside the picture
 * on a wide window. Read after the page has drawn, one spot at a time, from
 * the same published forecast (the source keeps the model files it has read,
 * so a nearby spot costs its own sums, not the downloads again).
 */
import { useEffect, useState } from "react";
import { shoreFacing } from "../../../force5/src/shoreFacing";
import type { Rider } from "../../../force5/src/stars";
import {
  loadSpots,
  spotForecast,
  type NearbySpot,
} from "../../../mcp/api/forecast";
import { dublinDate, rateForecastHour } from "../spot";
import { forecastWindow, source } from "../useSpotForecast";

export const NEARBY_SHOWN = 9;

export interface NearbyReading {
  id: string;
  name: string;
  distanceKm: number;
  /** The wind now, knots; null until read, or with none. */
  windKn: number | null;
  /** Today's best stars in daylight for this rider; null until read. */
  best: number | null;
}

export function useNearby(
  nearby: readonly NearbySpot[] | undefined,
  rider: Rider,
  now: number,
): NearbyReading[] {
  const [readings, setReadings] = useState<NearbyReading[]>([]);
  useEffect(() => {
    const list = (nearby ?? []).slice(0, NEARBY_SHOWN);
    setReadings(
      list.map((n) => ({
        id: n.id,
        name: n.name,
        distanceKm: n.distance_km,
        windKn: null,
        best: null,
      })),
    );
    if (!list.length) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      let spots;
      try {
        spots = await loadSpots(source());
      } catch {
        return;
      }
      const today = dublinDate(now);
      for (const n of list) {
        if (!current) return;
        const spot = spots.find((s) => s.id === n.id);
        if (!spot) continue;
        try {
          const forecast = await spotForecast(
            source(),
            spot,
            forecastWindow(now),
            { now },
          );
          const facing = shoreFacing(spot.id);
          let windKn: number | null = null;
          let best = 0;
          for (const hour of forecast.hours) {
            const time = Date.parse(hour.time);
            if (windKn === null && hour.wind && time + 3600000 > now)
              windKn = hour.wind.wind_kn;
            if (dublinDate(time) !== today) continue;
            best = Math.max(
              best,
              rateForecastHour(hour, facing, rider)?.stars ?? 0,
            );
          }
          if (!current) return;
          setReadings((was) =>
            was.map((r) => (r.id === n.id ? { ...r, windKn, best } : r)),
          );
        } catch {
          // One spot that will not read leaves its card without figures.
        }
      }
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [nearby, rider, now]);
  return readings;
}
