import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelAvailability } from "../force5/src/manifests";
import { spotSquare } from "../force5/src/squares";
import type { Rider } from "../force5/src/stars";
import type { Manifest } from "../force5/src/weather";
import { placeHours, type PlaceHour, type RatedPlace } from "./ratings";
import { spotBlendHours, type BlendRun } from "./spotBlend";

/** Places worked out per slice of main-thread time, and how long a slice may run. */
const SLICE_MS = 12;

/** What one place's row is worked out from. */
export interface RatingSource {
  /** The published blend with the places of its squares read so far, or null. */
  published: Pick<BlendRun, "times" | "spotBlend"> | null;
  /** Without a published blend: the wind manifests, their squares merged in. */
  manifests: readonly Manifest[];
  blendModels: readonly string[];
  /** The squares whose data is in hand; null for every square. */
  known: ReadonlySet<string> | null;
}

/**
 * One place's row, or null where there is none to give: a place whose square
 * has not been read (its light stays pending, never reads as calm), or one the
 * published blend does not know.
 */
export function ratePlace(
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
  { published, manifests, blendModels, known }: RatingSource,
): PlaceHour[] | null {
  if (known && !known.has(spotSquare(place.lat, place.lon))) return null;
  return published
    ? spotBlendHours(published, place, axis, rider)
    : placeHours(manifests, blendModels, place, axis, rider);
}

/**
 * Every place's hours on the strip, rated for this rider: the lights, the
 * dock and the panel of the rider's spots all read this one table, so a light
 * and the dock can never disagree about an hour.
 *
 * It is worked out a few places at a time between frames, the places the
 * reader is looking at first (`first`), so the map opens and stays smooth
 * while the rest fill in. A new run, a change of rider or of the blend's
 * models starts it again; until a place is done its light reads as pending.
 *
 * With `published`, the blend worked out when the forecast was published
 * (src/spotBlend.ts), each place is only rated, and the manifests are not read:
 * the caller passes it only while the reader's blend is the default one.
 *
 * `loaded` names the spot squares whose data is in hand, from the published
 * blend or the models alike; null means every square. A place in any other
 * square gets no row, so its light stays pending: the map reads only the
 * squares in view, and a place it has not read is unknown, not calm.
 */
export function useRatings(
  models: readonly ModelAvailability[],
  blendModels: readonly string[],
  places: readonly RatedPlace[],
  axis: readonly string[],
  rider: Rider,
  first: readonly string[],
  published: Pick<BlendRun, "times" | "spotBlend"> | null = null,
  loaded: readonly string[] | null = null,
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
  // What the hours are worked out from; a new one starts the table again.
  const source = published ?? manifests;
  const loadedKey = loaded === null ? null : [...loaded].sort().join(",");
  const known = useMemo(
    () => (loadedKey === null ? null : new Set(loadedKey.split(","))),
    [loadedKey],
  );
  const hoursFor = (place: RatedPlace) =>
    ratePlace(place, axis, rider, { published, manifests, blendModels, known });

  // What the table was last worked out for, apart from its source.
  const basis = useRef({ blendKey, places, axisKey, riderKey });

  useEffect(() => {
    const done = new Map<string, PlaceHour[]>();
    const before = table.current;
    const same =
      basis.current.blendKey === blendKey &&
      basis.current.places === places &&
      basis.current.axisKey === axisKey &&
      basis.current.riderKey === riderKey;
    basis.current = { blendKey, places, axisKey, riderKey };
    table.current = done;
    if ((!published && !manifests.length) || !axis.length || !places.length) {
      setVersion((v) => v + 1);
      return;
    }
    // Only the data moved on — more squares read as the map moved, or the next
    // run — so the rows in hand stay up until each is worked out again, rather
    // than every light blinking to pending at each pan. A row whose square is
    // no longer read goes at once.
    if (same)
      for (const place of places) {
        const row = before.get(place.id);
        if (row && (!known || known.has(spotSquare(place.lat, place.lon))))
          done.set(place.id, row);
      }
    setVersion((v) => v + 1);
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
        const row = hoursFor(place);
        if (row) done.set(place.id, row);
        else done.delete(place.id);
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
  }, [source, blendKey, places, axisKey, riderKey, loadedKey]);

  // A place asked for first after the run began is done at once.
  useEffect(() => {
    if ((!published && !manifests.length) || !axis.length) return;
    let added = false;
    for (const id of first) {
      if (table.current.has(id)) continue;
      const place = places.find((p) => p.id === id);
      if (!place) continue;
      const row = hoursFor(place);
      if (!row) continue;
      table.current.set(id, row);
      added = true;
    }
    if (added) setVersion((v) => v + 1);
  }, [firstKey, source, axisKey, riderKey, blendKey, loadedKey]);

  return { hours: table.current, version };
}
