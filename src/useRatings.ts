import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelAvailability } from "../force5/src/manifests";
import type { Rider } from "../force5/src/stars";
import type { Manifest } from "../force5/src/weather";
import { placeHours, type PlaceHour, type RatedPlace } from "./ratings";

/** Places worked out per slice of main-thread time, and how long a slice may run. */
const SLICE_MS = 12;

/**
 * Every place's hours on the strip, rated for this rider: the lights, the
 * dock and the panel of the rider's spots all read this one table, so a light
 * and the dock can never disagree about an hour.
 *
 * It is worked out a few places at a time between frames, the places the
 * reader is looking at first (`first`), so the map opens and stays smooth
 * while the rest fill in. A new run, a change of rider or of the blend's
 * models starts it again; until a place is done its light reads as pending.
 */
export function useRatings(
  models: readonly ModelAvailability[],
  blendModels: readonly string[],
  places: readonly RatedPlace[],
  axis: readonly string[],
  rider: Rider,
  first: readonly string[],
): { hours: ReadonlyMap<string, PlaceHour[]>; version: number } {
  const manifests = useMemo<Manifest[]>(
    () =>
      models
        .filter((model) => model.wind !== null)
        .map((model) => model.wind!),
    [models],
  );
  const table = useRef(new Map<string, PlaceHour[]>());
  const [version, setVersion] = useState(0);
  const firstKey = first.join(",");
  const axisKey = axis.length
    ? `${axis[0]}|${axis[axis.length - 1]}|${axis.length}`
    : "";
  const riderKey = JSON.stringify(rider);
  const blendKey = [...blendModels].sort().join(",");

  useEffect(() => {
    const done = new Map<string, PlaceHour[]>();
    table.current = done;
    setVersion((v) => v + 1);
    if (!manifests.length || !axis.length || !places.length) return;
    const wanted = new Set(first);
    const order = [
      ...places.filter((p) => wanted.has(p.id)),
      ...places.filter((p) => !wanted.has(p.id)),
    ];
    let next = 0;
    let handle = 0;
    let cancelled = false;
    const work = () => {
      handle = 0;
      if (cancelled) return;
      const until = performance.now() + SLICE_MS;
      do {
        const place = order[next++];
        done.set(
          place.id,
          placeHours(manifests, blendModels, place, axis, rider),
        );
      } while (next < order.length && performance.now() < until);
      // One repaint per slice, never one per place.
      setVersion((v) => v + 1);
      if (next < order.length) handle = window.setTimeout(work, 0);
    };
    // The first slice at once: the dock's own spot should not wait a frame.
    work();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // The keys stand in for the arrays, which are rebuilt every render.
  }, [manifests, blendKey, places, axisKey, riderKey]);

  // A place asked for first after the run began is done at once.
  useEffect(() => {
    if (!manifests.length || !axis.length) return;
    let added = false;
    for (const id of first) {
      if (table.current.has(id)) continue;
      const place = places.find((p) => p.id === id);
      if (!place) continue;
      table.current.set(
        id,
        placeHours(manifests, blendModels, place, axis, rider),
      );
      added = true;
    }
    if (added) setVersion((v) => v + 1);
  }, [firstKey, manifests, axisKey, riderKey, blendKey]);

  return { hours: table.current, version };
}
