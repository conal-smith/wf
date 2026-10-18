/**
 * The forecast every screen reads: the 15-day strip of hours, every place's
 * hours rated for this rider, the hour and the spot chosen. It is the site's
 * map screen (src/App.tsx, "the published blend, and the models only when
 * they are wanted") without the map, so the chart's lights, the dock, the
 * spot page and the list of the rider's spots can never disagree about an
 * hour: they read one table, worked out by the site's own hooks.
 *
 *  - The published blend (src/spotBlend.ts) is what the stars come from. Its
 *    squares are read for the chart's view (setView, from the map) and for
 *    the open, starred and most-opened spots, wherever they are.
 *  - The models' manifests are fetched only when something needs them: a
 *    rider who has left a model out of the blend, a blend too old to trust,
 *    or a screen that lists the models (wantModels).
 */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { windModels, type ModelAvailability } from "../../../force5/src/manifests";
import { squaresToRead, type ViewBounds } from "../../../force5/src/squares";
import { ratedRider, type Rider } from "../../../force5/src/stars";
import { dockColumns, type ColumnModel } from "../../../force5/src/timeline";
import type { Spot } from "../../../force5/src/weather";
import type { PlaceHour, RatedPlace } from "../../../src/ratings";
import {
  blendColumnModels,
  ownBlendModels,
  trustedSpotBlend,
  type LoadedBlend,
} from "../../../src/spotBlend";
import {
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
  type StripColumn,
  type StripDay,
} from "../../../src/strip";
import { useModelAvailability } from "../../../src/useBlend";
import { useRatings } from "../../../src/useRatings";
import { useBlendSquares, useSpotBlend } from "../../../src/useSpotBlend";
import { ALL_SQUARES, useSpotSquaresState } from "../../../src/useSpotSquares";
import { useFavourites } from "./favourites";
import { usePrefs } from "./prefs";
import { allSpots, spotById } from "./spots";

export interface Forecast {
  /** Every riding place, with the shore it faces. */
  spots: readonly Spot[];
  /** The strip's hours (Irish days, night included and never rated). */
  strip: readonly StripColumn[];
  days: readonly StripDay[];
  /** The strip's valid times, the axis every place's hours are on. */
  axis: readonly string[];
  /** Every place's hours, rated for `rider`, by spot id; a place not yet read is absent. */
  hours: ReadonlyMap<string, PlaceHour[]>;
  /** Bumps whenever `hours` gains rows (the map's lights redraw on it). */
  version: number;
  /** Who the hours are rated for, as a rating reads them (stars.ts `ratedRider`). */
  rider: Rider;
  /** The published blend with the squares read so far, or null. */
  published: LoadedBlend | null;
  /** The wind models' manifests, once asked for. */
  models: readonly ModelAvailability[];
  /** True once the first answer about the blend (or its absence) is in. */
  resolved: boolean;
  /** The index into `strip` of the hour chosen. */
  selected: number;
  /** Choose an hour by its valid time (ISO). */
  selectTime: (iso: string) => void;
  /** The open spot, or null for the whole chart. */
  spot: Spot | null;
  openSpot: (id: string | null) => void;
  /** The chart tells the forecast what it can see, so it reads those squares. */
  setView: (view: ViewBounds | null) => void;
  /** Something wants the models listed (the model list, a chart that needs them). */
  wantModels: () => void;
  /** Now, to the minute; moves on when the app comes back to the front. */
  now: number;
}

const ForecastContext = createContext<Forecast | null>(null);

function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return now;
}

export function ForecastProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  // Rated with the rating in use: one of the rider's own kept aside while a
  // level rates neither rates nor, when it alone changes, re-rates the table.
  const riderKey = JSON.stringify(ratedRider(prefs.rider));
  const rider = useMemo(() => JSON.parse(riderKey) as Rider, [riderKey]);
  const { store, starred, frequent } = useFavourites();
  const now = useClock();
  const spots = allSpots();

  const [spotId, setSpotId] = useState<string | null>(null);
  const spot = spotId ? (spotById(spotId) ?? null) : null;
  const [view, setView] = useState<ViewBounds | null>(null);
  const [modelsWanted, setModelsWanted] = useState(false);
  const [chosenTime, setChosenTime] = useState<string | null>(null);

  /* ---- the published blend, and the models only when they are wanted ---- */
  const spotBlend = useSpotBlend(false);
  const ownBlend = ownBlendModels(
    prefs.blendModels,
    windModels().map((model) => model.id),
  );
  const pointer = trustedSpotBlend(spotBlend.blend, ownBlend, now);
  const ownPlaces = useMemo(() => {
    const ids = new Set([...(spotId ? [spotId] : []), ...starred, ...frequent.map((v) => v.id)]);
    return spots.filter((s) => ids.has(s.id));
  }, [spots, spotId, starred, frequent]);
  const blendSquares = useBlendSquares(
    pointer,
    useMemo(
      () => (pointer ? squaresToRead(view, pointer.spots.squares, ownPlaces) : null),
      [pointer, view, ownPlaces],
    ),
    spotBlend.recheck,
  );
  const published = blendSquares.failed ? null : pointer;
  const { models, resolved: modelsResolved } = useModelAvailability(
    false,
    undefined,
    modelsWanted || ownBlend || (spotBlend.resolved && !published),
  );

  /* ---- the week's columns, and the strip of them the dock shows ---- */
  const columnModels = useMemo<ColumnModel[]>(() => {
    if (published) return blendColumnModels(published);
    return models
      .filter((model) => model.wind !== null)
      .map((model) => ({ id: model.id, manifest: model.wind!, ensemble: model.entry.ensemble }));
  }, [models, published]);
  const columns = useMemo(() => dockColumns(columnModels, now), [columnModels, now]);
  const stripKey = columns.map((c) => `${c.validTime}|${c.model}`).join(",");
  const hour = now - (now % 3_600_000);
  const strip = useMemo(
    () => stripColumns(columns, now),
    // Rebuilt when the columns change or the hour turns, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stripKey, hour],
  );
  const days = useMemo(() => stripDays(strip), [strip]);
  const axis = useMemo(() => strip.map((c) => c.validTime), [strip]);
  const selected = useMemo(() => {
    if (!strip.length) return 0;
    return chosenTime
      ? nearestColumn(strip, Date.parse(chosenTime))
      : openingColumn(strip, now);
  }, [strip, chosenTime, now]);

  /* ---- every place's hours, rated ---- */
  const places = useMemo<RatedPlace[]>(
    () => spots.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, facing: s.facing ?? null })),
    [spots],
  );
  const first = useMemo(
    () => [...(spotId ? [spotId] : []), ...starred, ...frequent.map((v) => v.id)],
    [spotId, starred, frequent],
  );
  const windOnly = useMemo(() => models.filter((model) => model.wind !== null), [models]);
  const ownSquares = useMemo(
    () =>
      published
        ? null
        : squaresToRead(
            view,
            windOnly.flatMap((model) => model.wind!.spots.squares),
            ownPlaces,
          ),
    [published, view, windOnly, ownPlaces],
  );
  const rated = useSpotSquaresState(windOnly, ownSquares, true);
  const { hours, version } = useRatings(
    rated.models,
    prefs.blendModels,
    places,
    axis,
    rider,
    first,
    published ? blendSquares.blend : null,
    published
      ? (blendSquares.blend?.loaded ?? [])
      : rated.squares === ALL_SQUARES
        ? null
        : (rated.squares ?? []),
  );

  const openSpot = useCallback(
    (id: string | null) => {
      setSpotId(id);
      if (id) store.visit(id);
    },
    [store],
  );
  const wantModels = useCallback(() => setModelsWanted(true), []);

  const value = useMemo<Forecast>(
    () => ({
      spots,
      strip,
      days,
      axis,
      hours,
      version,
      rider,
      published: published ? blendSquares.blend : null,
      models,
      resolved: spotBlend.resolved && (!!published || modelsResolved),
      selected,
      selectTime: setChosenTime,
      spot,
      openSpot,
      setView,
      wantModels,
      now,
    }),
    // `hours` is one Map mutated in place; `version` says when it changed.
    [spots, strip, days, axis, hours, version, rider, published, blendSquares.blend, models, spotBlend.resolved, modelsResolved, selected, spot, openSpot, wantModels, now],
  );
  return <ForecastContext value={value}>{children}</ForecastContext>;
}

export function useForecast(): Forecast {
  const value = use(ForecastContext);
  if (!value) throw new Error("useForecast outside ForecastProvider");
  return value;
}

/** One place's hours, or null until its square has been read. */
export function useSpotHours(id: string | null | undefined): PlaceHour[] | null {
  const { hours, version } = useForecast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (id ? (hours.get(id) ?? null) : null), [hours, version, id]);
}
