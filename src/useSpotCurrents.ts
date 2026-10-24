import { useEffect, useState } from "react";
import type { CurrentReading } from "../force5/src/currentReading";

export interface SpotCurrents {
  /** One reading per dock column; null where there is none. */
  columns: (CurrentReading | null)[];
  /** Said once across the row in place of the readings, or null. */
  note: string | null;
  /** The model the readings are from, for the cells' titles. */
  model: string | null;
}

const OFF: SpotCurrents = { columns: [], note: null, model: null };
const READING: SpotCurrents = { ...OFF, note: "Current: reading…" };

/** The place the dock is about: a riding place by its id, a point by none. */
export interface CurrentsPlace {
  id?: string;
  lat: number;
  lon: number;
}

/**
 * The surface current at a place on the dock's columns, while its rows below
 * the fold are open (src/currentsData.ts, loaded then and not before). A
 * riding place reads the series the ingest publishes for it; a tapped point,
 * the nearest cell with water in the map's frames. Another place's readings
 * are never shown while this one's are read.
 */
export function useSpotCurrents(
  enabled: boolean,
  place: CurrentsPlace | null,
  axis: readonly string[],
): SpotCurrents {
  const id = place?.id;
  const lat = place?.lat;
  const lon = place?.lon;
  // The axis is rebuilt every render: its ends and length stand in for it.
  const axisKey = axis.length ? `${axis[0]}/${axis.at(-1)}/${axis.length}` : "";
  const on = enabled && lat !== undefined && lon !== undefined && !!axisKey;
  const key = on ? `${id ?? ""}@${lat},${lon}/${axisKey}` : null;
  // The answer, with the question it answers.
  const [state, setState] = useState<{ key: string; row: SpotCurrents } | null>(
    null,
  );
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const columns = [...axis];
    const answer = (row: SpotCurrents) => {
      if (live) setState({ key, row });
    };
    import("./currentsData")
      .then((data) =>
        id
          ? data.spotCurrentRow({ id, lat: lat!, lon: lon! }, columns)
          : data.pointCurrentRow(lat!, lon!, columns),
      )
      .then(answer, () =>
        answer({ ...OFF, note: "Current: could not be read" }),
      );
    return () => {
      live = false;
    };
  }, [key]);
  if (key === null) return OFF;
  return state?.key === key ? state.row : READING;
}
