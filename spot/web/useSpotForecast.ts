/**
 * One riding place's forecast, read in the browser through the MCP server's own
 * reduction (mcp/api/forecast.ts): every live model's series for the spot,
 * reduced to one consensus line per hour, with the waves, weather, tides, sea
 * temperature and runs behind it. An agent and this page read the same numbers.
 */
import { useEffect, useState } from "react";
import {
  findSpot,
  loadSpots,
  spotForecast,
  type RidingSpot,
  type SpotForecast,
} from "../../mcp/api/forecast";
import type { ForecastSource } from "../../mcp/api/httpSource";
import { siteSource } from "../../shared/web/forecastSource";
import {
  FORECAST_DAYS,
  HOUR,
  LEAD_HOURS,
  dublinDate,
  dublinMidnight,
} from "./spot";

export type SpotState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** No place has this id; `candidates` are the places it might have meant. */
  | { kind: "unknown"; id: string; candidates: RidingSpot[] }
  /** `/spot` with no id: the index of every place. */
  | { kind: "index"; spots: RidingSpot[] }
  | { kind: "ready"; spot: RidingSpot; forecast: SpotForecast };

/** The hours asked for: from before today's midnight to the last day's end. */
export function forecastWindow(now: number) {
  const from = dublinMidnight(dublinDate(now)) - LEAD_HOURS * HOUR;
  return {
    from,
    to: from + (LEAD_HOURS + FORECAST_DAYS * 24) * HOUR,
    stepHours: 1,
  };
}

/** The places an unknown id might have meant: by its words, then none. */
export function candidatesFor(
  spots: readonly RidingSpot[],
  id: string,
): RidingSpot[] {
  const words = id.replace(/[-_]+/g, " ");
  const match = findSpot(spots, words);
  if (match.spot) return [match.spot];
  // A long id that names a beach and its county can miss as a whole; its
  // longest word on its own usually finds the place.
  if (!match.candidates.length) {
    const longest = words.split(" ").sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) {
      const retry = findSpot(spots, longest);
      return retry.spot ? [retry.spot] : retry.candidates.slice(0, 6);
    }
  }
  return match.candidates.slice(0, 6);
}

let shared: ForecastSource | null = null;
const source = () => (shared ??= siteSource());

export function useSpotForecast(id: string | null, attempt = 0): SpotState {
  const [state, setState] = useState<SpotState>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    (async () => {
      const spots = await loadSpots(source());
      if (id === null) return { kind: "index", spots } as const;
      const spot = spots.find((place) => place.id === id);
      if (!spot)
        return {
          kind: "unknown",
          id,
          candidates: candidatesFor(spots, id),
        } as const;
      const now = Date.now();
      const forecast = await spotForecast(source(), spot, forecastWindow(now), {
        now,
      });
      return { kind: "ready", spot, forecast } as const;
    })().then(
      (next) => {
        if (current) setState(next);
      },
      (error: unknown) => {
        if (current)
          setState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "The forecast could not be read.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [id, attempt]);
  return state;
}
