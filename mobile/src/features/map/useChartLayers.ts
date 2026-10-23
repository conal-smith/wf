/**
 * What the chart lays under and over its lines, each loaded only once it is
 * asked for and then only for the view (src/useSatellite.ts,
 * src/useFoilDepth.ts, for the app): the satellite's index the first time an
 * image is chosen, and the foilable-depth index the first time that layer is
 * on and a tide curve per station in view.
 *
 * The two indexes ship inside the app, as the riding places do: they are
 * the site's own files (public/), they change only with a release, and the
 * archives they name are content-versioned on the data host, so an index in
 * the bundle never points at a file that has gone. Read when first wanted.
 */
import { useEffect, useMemo, useState } from "react";
import foilJson from "../../../../public/foildepth/index.json";
import satelliteJson from "../../../../public/satellite/index.json";
import {
  validateFoilManifest,
  type FoilArea,
  type FoilManifest,
} from "../../../../force5/src/foilDepth";
import type { SatelliteOption } from "../../../../force5/src/satellite";
import {
  nearestSatelliteStation,
  satelliteLayers,
  satelliteNote,
  validateSatelliteManifest,
  type SatelliteManifest,
  type SatelliteStation,
} from "../../../../force5/src/satelliteIndex";
import { tideForStation } from "../../../../force5/src/tides";
import { forecastUrl } from "../../../../force5/src/urls";
import { tideManifest } from "../../../../src/useBlend";
import { siteUrl } from "../../config/env";
import type { ChartView, Tides } from "./foilLogic";

// Metro's inlineRequires reads each file the first time it is used.
const satelliteIndex = () => Promise.resolve<unknown>(satelliteJson);
const foilIndex = () => Promise.resolve<unknown>(foilJson);

/* ---- the satellite ---- */

export interface SatelliteLayer {
  id: string;
  /** `pmtiles://` and the archive's URL. */
  url: string;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  attribution: string;
}

export interface SatelliteState {
  layers: SatelliteLayer[];
  option: "high" | "low" | null;
  station: SatelliteStation | null;
  /** "Satellite: high tide (≈4.6 m)", or null when off. */
  note: string | null;
  attribution: string | null;
  error: string | null;
}

export function useSatellite(option: SatelliteOption, view: ChartView | null): SatelliteState {
  const [manifest, setManifest] = useState<SatelliteManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wanted = option !== "off" && !manifest;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    satelliteIndex()
      .then((raw) => {
        if (controller.signal.aborted) return;
        setManifest(validateSatelliteManifest(raw));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "The satellite imagery is unavailable.");
      });
    return () => controller.abort();
  }, [wanted]);

  return useMemo<SatelliteState>(() => {
    if (!manifest)
      return { layers: [], option: null, station: null, note: null, attribution: null, error: option === "off" ? null : error };
    const station = view
      ? nearestSatelliteStation(manifest.areas, (view.west + view.east) / 2, (view.south + view.north) / 2)
      : null;
    return {
      option: option === "off" ? null : option,
      layers:
        option === "off" || !view
          ? []
          : satelliteLayers(manifest, option, view, view.zoom).map((layer) => ({
              id: `satellite-${layer.id}-${option}`,
              url: `pmtiles://${forecastUrl(layer.path)}`,
              minzoom: layer.minzoom,
              maxzoom: layer.maxzoom,
              tileSize: layer.tileSize,
              attribution: manifest.attribution,
            })),
      station,
      note: satelliteNote(option, station),
      attribution: manifest.attribution,
      error: null,
    };
  }, [option, view, manifest, error]);
}

/* ---- foilable depth ---- */

/** An area's archive: under the index's `base` on the data host, or beside the site. */
export const foilArchiveUrl = (manifest: FoilManifest, area: FoilArea) =>
  manifest.base ? forecastUrl(`${manifest.base}${area.url}`) : siteUrl(area.url);

const TIDE_ERROR = "Tide predictions are unavailable, so the depths cannot follow the tide.";

/** The foilable-depth index, loaded the first time the layer is on and kept after. */
export function useFoilIndex(enabled: boolean): { manifest: FoilManifest | null; error: string | null } {
  const [state, setState] = useState<{ manifest: FoilManifest | null; error: string | null }>({
    manifest: null,
    error: null,
  });
  const loaded = !!state.manifest;
  useEffect(() => {
    if (!enabled || loaded) return;
    const controller = new AbortController();
    foilIndex()
      .then((raw) => {
        if (!controller.signal.aborted) setState({ manifest: validateFoilManifest(raw as FoilManifest), error: null });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setState({ manifest: null, error: e instanceof Error ? e.message : "Tidal depth is unavailable." });
      });
    return () => controller.abort();
  }, [enabled, loaded]);
  return state;
}

/**
 * The tide curves of `stations` (those of the areas in view), each loaded
 * the first time it is asked for and kept: a pan along the coast fetches a
 * curve per new station and never all of them.
 */
export function useTides(stations: readonly string[]): { tides: Tides; error: string | null } {
  const [state, setState] = useState<{ tides: Tides; error: string | null }>({ tides: {}, error: null });
  // The curves wanted and not yet here, as one key: a pan that keeps the
  // same stations in view starts nothing.
  const key = stations.filter((id) => !state.tides[id]).sort().join("|");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    (async () => {
      const manifest = await tideManifest(controller.signal);
      const got: Tides = {};
      for (const id of key.split("|")) {
        const tide = await tideForStation(manifest, id, controller.signal);
        if (tide) got[id] = tide;
      }
      return got;
    })()
      .then((got) => {
        if (!controller.signal.aborted) setState((s) => ({ tides: { ...s.tides, ...got }, error: null }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error: TIDE_ERROR }));
      });
    return () => controller.abort();
  }, [key]);
  return state;
}
