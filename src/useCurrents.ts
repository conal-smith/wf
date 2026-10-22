import { useEffect, useState } from "react";
import type { CurrentFeature } from "../force5/src/currents";
import type { Units } from "../force5/src/units";

export interface CurrentsState {
  /** The arrows of the hour shown, or null until they are read. */
  features: CurrentFeature[] | null;
  /** What is missing from them, if anything. */
  note: string | null;
}

const OFF: CurrentsState = { features: null, note: null };

/**
 * The Currents layer's arrows at `time`, while the layer is on. Off, it reads
 * nothing and imports nothing: the reading and the maths are a chunk of their
 * own (src/currentsData.ts), loaded the first time a rider turns the layer on.
 */
export function useCurrents(
  enabled: boolean,
  time: number | null,
  units: Units,
): CurrentsState {
  const [state, setState] = useState<CurrentsState>(OFF);
  const at = enabled && time !== null && Number.isFinite(time) ? time : null;
  useEffect(() => {
    if (at === null) {
      setState(OFF);
      return;
    }
    let live = true;
    import("./currentsData")
      .then(({ currentsAt }) => currentsAt(at, units))
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {
        if (live)
          setState({
            features: [],
            note: "Currents are unavailable just now.",
          });
      });
    return () => {
      live = false;
    };
  }, [at, units]);
  return at === null ? OFF : state;
}
