import { useEffect, useState } from "react";
import type { RainAt } from "./rainData";

const OFF: RainAt = { view: null, note: null, reach: null };

/**
 * The Rain layer at the hour the map shows, while the layer is on: the mean
 * rain of the hours from `from` to `time` (one hour, for an hourly column).
 * Off, it reads nothing and imports nothing: the reading is a chunk of its
 * own (src/rainData.ts), loaded the first time a rider turns the layer on.
 */
export function useRain(
  enabled: boolean,
  time: number | null,
  from: number | null,
): RainAt {
  const [state, setState] = useState<RainAt>(OFF);
  const at = enabled && time !== null && Number.isFinite(time) ? time : null;
  const start =
    at !== null && from !== null && Number.isFinite(from) && from < at
      ? from
      : at === null
        ? null
        : at - 3600000;
  useEffect(() => {
    if (at === null || start === null) {
      setState(OFF);
      return;
    }
    let live = true;
    import("./rainData")
      .then(({ rainAt }) => rainAt(start, at))
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        if (live)
          setState({
            view: null,
            note: "Rain is unavailable just now.",
            reach: null,
          });
      });
    return () => {
      live = false;
    };
  }, [at, start]);
  return at === null ? OFF : state;
}
