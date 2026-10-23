import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelAvailability } from "../force5/src/manifests";
import { spotSquare } from "../force5/src/squares";
import type { Rider } from "../force5/src/stars";
import type { Manifest } from "../force5/src/weather";
import { sameStarsFrom, starsFromAt } from "../force5/src/lead";
import { placeHours, type PlaceHour, type RatedPlace } from "./ratings";
import { spotBlendHours, type BlendRun } from "./spotBlend";

/** Places worked out per slice of main-thread time, and how long a slice may run. */
const SLICE_MS = 12;

/** The published blend as the ratings read it. */
export type PublishedHours = Pick<
  BlendRun,
  "times" | "spotBlend" | "sources" | "lead"
>;

/** What one place's row is worked out from. */
export interface RatingSource {
  /** The published blend with the places of its squares read so far, or null. */
  published: PublishedHours | null;
  /**
   * The wind manifests, their squares merged in: every place without a
   * published blend, and with one, any place whose stars come from other
   * models than the blend's (a spot the rider rates from a model of its own).
   */
  manifests: readonly Manifest[];
  blendModels: readonly string[];
  /** The published blend's squares in hand; null for every square. */
  known: ReadonlySet<string> | null;
  /** The models' squares in hand; null for every square. */
  modelsKnown?: ReadonlySet<string> | null;
}

/**
 * Whether a place's hours come from the published blend: there is one, and
 * this rider's stars here come from the models it was built with.
 */
export const fromPublished = (
  published: Pick<BlendRun, "lead"> | null,
  place: Pick<RatedPlace, "id">,
  rider: Rider,
): boolean =>
  !!published &&
  sameStarsFrom(published.lead, starsFromAt(rider.starsFrom, place.id));

/**
 * One place's row, or null where there is none to give: a place whose square
 * has not been read (its light stays pending, never reads as calm), or one the
 * published blend does not know.
 */
export function ratePlace(
  place: RatedPlace,
  axis: readonly string[],
  rider: Rider,
  { published, manifests, blendModels, known, modelsKnown }: RatingSource,
): PlaceHour[] | null {
  const square = spotSquare(place.lat, place.lon);
  if (fromPublished(published, place, rider)) {
    if (known && !known.has(square)) return null;
    return spotBlendHours(published!, place, axis, rider);
  }
  // Worked out from the models: with a published blend in use, only the
  // squares read for this purpose count, and none means none yet.
  const have = published ? (modelsKnown ?? new Set<string>()) : known;
  if (have && !have.has(square)) return null;
  if (!manifests.length) return null;
  return placeHours(manifests, blendModels, place, axis, rider);
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
 * the caller passes it only while the reader's blend and stars are the
 * default. A spot the rider rates from a model of its own is the exception,
 * worked out from `models` all the same (`ratePlace`).
 *
 * `loaded` names the spot squares whose data is in hand, from the published
 * blend or, without one, the models; null means every square. `modelsLoaded`
 * names the models' squares in hand beside a published blend. A place in any
 * other square gets no row, so its light stays pending: the map reads only the
 * squares in view, and a place it has not read is unknown, not calm. A row
 * worked out from this run before the map moved off its square is kept.
 */
export function useRatings(
  models: readonly ModelAvailability[],
  blendModels: readonly string[],
  places: readonly RatedPlace[],
  axis: readonly string[],
  rider: Rider,
  first: readonly string[],
  published: PublishedHours | null = null,
  loaded: readonly string[] | null = null,
  modelsLoaded: readonly string[] | null = null,
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
  // How high the rider points moves the wedge and the loupe, never a star:
  // a change to it rates nothing again.
  const { pointing: _pointing, ...rated } = rider;
  const riderKey = JSON.stringify(rated);
  const blendKey = [...blendModels].sort().join(",");
  // What the hours are worked out from; a new one starts the table again.
  // Beside a published blend the models count only for a spot the rider
  // rates from a model of its own.
  const own = !!rider.starsFrom?.spots;
  const source = published ?? manifests;
  const second = published && own ? manifests : null;
  const loadedKey = loaded === null ? null : [...loaded].sort().join(",");
  const known = useMemo(
    () => (loadedKey === null ? null : new Set(loadedKey.split(","))),
    [loadedKey],
  );
  const modelsKey =
    modelsLoaded === null ? null : [...modelsLoaded].sort().join(",");
  const modelsKnown = useMemo(
    () => (modelsKey === null ? null : new Set(modelsKey.split(","))),
    [modelsKey],
  );
  const hoursFor = (place: RatedPlace) =>
    ratePlace(place, axis, rider, {
      published,
      manifests,
      blendModels,
      known,
      modelsKnown,
    });

  // The runs the rows are worked out from: the published blend's sources,
  // or the models'. Not the squares read from them, which come and go.
  const runKey = [
    ...(published ? published.sources.map((src) => `${src.id}@${src.run}`) : []),
    ...(!published || second
      ? manifests.map((manifest) => `${manifest.model}@${manifest.run}`)
      : []),
  ].join(",");

  // What the table was last worked out for, apart from its source.
  const basis = useRef({ blendKey, places, axisKey, riderKey, runKey });

  /** Whether the square a place's row was read from is still read. */
  const stillKnown = (place: RatedPlace) => {
    const square = spotSquare(place.lat, place.lon);
    const have = fromPublished(published, place, rider)
      ? known
      : published
        ? (modelsKnown ?? new Set<string>())
        : known;
    return !have || have.has(square);
  };

  useEffect(() => {
    const done = new Map<string, PlaceHour[]>();
    const before = table.current;
    const same =
      basis.current.blendKey === blendKey &&
      basis.current.places === places &&
      basis.current.axisKey === axisKey &&
      basis.current.riderKey === riderKey;
    const sameRun = same && basis.current.runKey === runKey;
    basis.current = { blendKey, places, axisKey, riderKey, runKey };
    table.current = done;
    if ((!published && !manifests.length) || !axis.length || !places.length) {
      setVersion((v) => v + 1);
      return;
    }
    // Only the data moved on — more squares read as the map moved, or the next
    // run — so the rows in hand stay up (with the next run, until each is
    // worked out again), rather than every light blinking to pending at each
    // pan. A row whose square is no longer read stays while its run does: the
    // map moved off it, and its hours are what they were (a light off the
    // chart still says its stars and wind to a screen reader, with a spot's
    // forecast open or not). With the next run it goes at once, never to be
    // worked out again from data that has gone.
    const kept = new Set<string>();
    if (same)
      for (const place of places) {
        const row = before.get(place.id);
        if (!row) continue;
        if (stillKnown(place)) done.set(place.id, row);
        else if (sameRun) {
          done.set(place.id, row);
          kept.add(place.id);
        }
      }
    setVersion((v) => v + 1);
    // Within the same run a row in hand is already the row: only the places
    // without one are worked out. Each zoom in or out changes the squares in
    // view, and every place was rated again at each, under the next gesture.
    const todo = sameRun ? places.filter((p) => !done.has(p.id)) : places;
    if (!todo.length) return;
    const wanted = new Set(first);
    const order = [
      ...todo.filter((p) => wanted.has(p.id)),
      ...todo.filter((p) => !wanted.has(p.id)),
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
        else if (!kept.has(place.id)) done.delete(place.id);
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
  }, [
    source,
    second,
    blendKey,
    places,
    axisKey,
    riderKey,
    loadedKey,
    modelsKey,
    runKey,
  ]);

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
  }, [firstKey, source, second, axisKey, riderKey, blendKey, loadedKey, modelsKey]);

  return { hours: table.current, version };
}
