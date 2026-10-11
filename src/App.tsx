// The map's own stylesheets, in its chunk: src/main.tsx lazy-loads this file,
// and the other sections never ask for MapLibre's CSS or the chart's.
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import "./dock.css";
import "./panels.css";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { X } from "lucide-react";
import { WindMap } from "../force5/src";
import type {
  ChartLayers,
  FoilView,
  MapControls as Controls,
} from "../force5/src/WindMap";
import {
  areaAt,
  areasAt,
  foilColours,
  foilRamp,
  foilReadout,
  nearestArea,
  waterLevelAt,
  type FoilArea,
} from "../force5/src/foilDepth";
import { elevationAt } from "../force5/src/foilProbe";
import FoilLegend from "./FoilLegend";
import MapInfo from "./MapInfo";
import { MapInfoOpen, type InfoSection } from "./mapInfoContext";
import { useFoilDepth } from "./useFoilDepth";
import { rideStops as rideStopsFor } from "../force5/src/chartStyle";
import type { LightState } from "../force5/src/lights";
import { rideWedge } from "../force5/src/rideWedge";
import { WIND_STYLES, type WindStyle } from "../force5/src/windLayer";
import ForecastDock, { type DockView } from "./ForecastDock";
import MapControls, { type MapPanel } from "./MapControls";
import MapHead from "./MapHead";
import SidePanel from "./SidePanel";
import { InfoPop } from "./InfoPop";
import useRunRefresh, {
  loadNewerRun,
  RunRecovery,
  type RunSwap,
} from "./useRunRefresh";
import { useMarineModels, useModelAvailability, useSpotTide } from "./useBlend";
import { useRatings } from "./useRatings";
import { ALL_SQUARES, useSpotSquaresState } from "./useSpotSquares";
import {
  blendColumnModels,
  ownBlendModels,
  trustedSpotBlend,
} from "./spotBlend";
import { useBlendSquares, useSpotBlend } from "./useSpotBlend";
import { useViewBounds } from "./useViewBounds";
import { squaresToRead } from "../force5/src/squares";
import { usePointSeries } from "./usePointSeries";
import {
  offshoreMark,
  pointHours as pointHoursFrom,
  type PlaceHour,
  type RatedPlace,
} from "./ratings";
import {
  clock,
  dayBest,
  dayShort,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
} from "./strip";
import { ridingLocations, spotFromSearch } from "./locations";
import { takeEarly } from "../force5/src/boot";
import {
  loadManifest,
  ManifestUnavailableError,
  windModels,
} from "../force5/src/manifests";
import { runLabel } from "../force5/src/revalidate";
import { loadModel, MODELS, type ModelId } from "../force5/src/models";
// The display options, only when asked for from the map's controls.
const DisplayFilter = lazy(() => import("./DisplayFilter"));
// Gust is a launcher in the corner until he is asked: his code comes once
// the chart is up, not before it.
const Companion = lazy(() =>
  import("../companion/web/Companion").then((m) => ({ default: m.Companion })),
);
import type { MapAction } from "../companion/shared/protocol";
import { parseRider } from "../force5/src/prefs";
import {
  dockColumns,
  frameForTime,
  type ColumnModel,
} from "../force5/src/timeline";
import { tideAt } from "../force5/src/tides";
import { FEATURES } from "../shared/web/features";
import { favourites } from "../shared/web/favourites";
import {
  compass,
  dayLabel,
  defaultPrefs,
  freshness,
  loadFrame,
  loadPrefs,
  nearestFrame,
  savePrefs,
  timeLabel,
  type Frame,
  type Manifest,
  type Prefs,
  type Spot,
} from "../force5/src";

const FIRST_SPOT = "brandon";
const WIND_KEY = "wingfoil.map.wind.v1";
const LAYERS_KEY = "wingfoil.map.layers.v1";
const MORE_KEY = "wingfoil.map.more.v1";
/** The focus is on the point tapped on the map, not a riding place. */
const AT_POINT = "@point";

/** A point tapped on the map, as the dock names it. */
interface Picked {
  lon: number;
  lat: number;
  name: string;
  coords: string;
}
const degrees = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
const PHONE = "(max-width: 720px)";

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Best effort: the choice still holds for this page.
    }
  },
};

const DEFAULT_LAYERS: ChartLayers = {
  tints: true,
  soundings: true,
  relief: true,
  names: true,
  foil: false,
};

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setMatch(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return match;
}

/** Follows a value at most every `ms` while it keeps changing, then settles on it. */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - performance.now();
    if (wait <= 0) {
      last.current = performance.now();
      setOut(value);
      return;
    }
    const timer = window.setTimeout(() => {
      last.current = performance.now();
      setOut(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return out;
}

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  useEffect(() => setPrefs(loadPrefs()), []);
  const changePrefs = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  const rider = prefs.rider;
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  // The reader's place in the forecast is a valid time, never an index.
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const chosenTime = useRef(false);
  const [point, setPoint] = useState<Spot | null>(null);
  const [error, setError] = useState("");
  const [frameError, setFrameError] = useState("");
  const [retry, setRetry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const phone = useMedia(PHONE);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [more, setMore] = useState(() => store.get(MORE_KEY) === "1");
  const chooseMore = (next: boolean) => {
    setMore(next);
    store.set(MORE_KEY, next ? "1" : "0");
  };
  /** The layers, your spots or the display options, beside the map's controls. */
  const [panel, setPanel] = useState<MapPanel>(null);
  /** The information dialog's part to open at, or null while it is shut. */
  const [info, setInfo] = useState<InfoSection | null>(null);
  const [view, setView] = useState<DockView>("table");
  const [windStyle, setWindStyle] = useState<WindStyle>(() => {
    const saved = store.get(WIND_KEY) as WindStyle | null;
    return saved && WIND_STYLES.includes(saved) ? saved : "ink";
  });
  const [layers, setLayers] = useState<ChartLayers>(() => {
    try {
      return {
        ...DEFAULT_LAYERS,
        ...JSON.parse(store.get(LAYERS_KEY) ?? "{}"),
      };
    } catch {
      return DEFAULT_LAYERS;
    }
  });
  const chooseWind = (style: WindStyle) => {
    setWindStyle(style);
    store.set(WIND_KEY, style);
  };
  const chooseLayers = (next: ChartLayers) => {
    setLayers(next);
    store.set(LAYERS_KEY, JSON.stringify(next));
  };
  const controls = useRef<Controls | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [scale, setScale] = useState("");
  // The foilable-depth area nearest the map's centre, for the foil key's tide
  // station. Kept as an id, so a pan that stays near one area renders nothing,
  // and only looked up once the layer has loaded its areas.
  const foilAreas = useRef<readonly FoilArea[] | null>(null);
  const [foilNearId, setFoilNearId] = useState<string | null>(null);
  // Gust comes once the chart is drawn and the page has a moment to spare.
  const [gustDue, setGustDue] = useState(false);
  useEffect(() => {
    if (!mapReady || gustDue) return;
    const idle =
      window.requestIdleCallback ??
      ((f: () => void) => window.setTimeout(f, 1200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => setGustDue(true), { timeout: 3000 });
    return () => cancel(handle);
  }, [mapReady, gustDue]);

  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(110);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const modelRequest = useRef<AbortController | null>(null);
  const [pendingModel, setPendingModel] = useState<ModelId | null>(null);
  const [modelError, setModelError] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const modelEpoch = useRef(0);
  useEffect(() => {
    if (!modelNotice) return;
    const timer = window.setTimeout(() => setModelNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [modelNotice]);
  useEffect(() => () => modelRequest.current?.abort(), []);

  /* ---- the rider's spots ---- */
  const fav = favourites();
  const favState = useSyncExternalStore(fav.subscribe, fav.get);
  const starred = favState.starred;
  const frequent = useMemo(() => fav.frequent(6), [favState]);

  /* ---- the first load: the map model's manifest and the places ---- */
  useEffect(() => {
    const controller = new AbortController();
    const spotsUrl = `${import.meta.env.BASE_URL}spots.json`;
    Promise.all([
      // Through the manifest cache, which the availability sweep reads too: one
      // download and one parse of the map's model, not one each.
      loadManifest("harmonie", controller.signal).catch((e) => {
        throw e instanceof ManifestUnavailableError
          ? new Error(
              "The forecast snapshot is missing. Run npm run weather:refresh:harmonie, then reload.",
            )
          : e;
      }),
      // Started by the page's head on a map URL (force5/src/boot.ts).
      (
        takeEarly(spotsUrl) ??
        fetch(spotsUrl, { signal: controller.signal, cache: "no-cache" })
      ).then(async (r) => {
        if (!r.ok) throw new Error("The riding places could not be loaded.");
        return r.json();
      }),
    ])
      .then(([validated, s]) => {
        if (controller.signal.aborted) return;
        setManifest(validated);
        const places = ridingLocations(s) as Spot[];
        setSpots(places);
        // The opening time is the strip's (the layout effect below), worked out
        // before the first frame is asked for, so that frame is the one shown.
        // Only a run with no daylight hour in the strip opens on the nearest frame.
        const now = Date.now();
        if (
          !stripColumns(
            dockColumns(
              [{ id: validated.model, manifest: validated, ensemble: false }],
              now,
            ),
            now,
          ).length
        )
          setSelectedTime(
            validated.frames[nearestFrame(validated.frames)].validTime,
          );
        const linked = spotFromSearch(location.search, places) as
          Spot | undefined;
        setPoint(
          linked ?? places.find((spot) => spot.id === FIRST_SPOT) ?? places[0],
        );
        if (linked) setFocusId(linked.id);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to open forecast data.",
          );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    const now = () => setClockNow(Date.now());
    const interval = window.setInterval(now, 60000);
    document.addEventListener("visibilitychange", now);
    window.addEventListener("focus", now);
    return () => {
      media.removeEventListener("change", change);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", now);
      window.removeEventListener("focus", now);
    };
  }, []);

  useEffect(() => {
    if (!dock.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setDockHeight(entry.target.getBoundingClientRect().height),
    );
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, [error, !!manifest]);

  /* ---- the published blend, and the models only when they are wanted ---- */
  const spotBlend = useSpotBlend(!!pendingModel);
  // The blend is published for every wind model; a reader who has left some
  // out gets theirs worked out here, from the manifests, as before.
  const ownBlend = ownBlendModels(
    prefs.blendModels,
    windModels().map((model) => model.id),
  );
  const pointer = trustedSpotBlend(spotBlend.blend, ownBlend, clockNow);
  // The lights read the spot squares in view, once the camera settles, and
  // the open spot's and the reader's own wherever they are: never every place.
  const mapView = useViewBounds(mapReady ? controls.current?.map : null);
  const ownPlaces = useMemo(() => {
    const ids = new Set([
      point?.id ?? FIRST_SPOT,
      ...starred,
      ...frequent.map((v) => v.id),
    ]);
    return spots.filter((spot) => ids.has(spot.id));
  }, [spots, point?.id, starred, frequent]);
  const blendSquares = useBlendSquares(
    pointer,
    useMemo(
      () =>
        pointer
          ? squaresToRead(mapView, pointer.spots.squares, ownPlaces)
          : null,
      [pointer, mapView, ownPlaces],
    ),
    spotBlend.recheck,
  );
  // Squares that cannot be read are as good as no blend at all.
  const published = blendSquares.failed ? null : pointer;
  const [wantModels, setWantModels] = useState(false);
  // The display options list every wind model, and say which answered.
  useEffect(() => {
    if (panel === "options") setWantModels(true);
  }, [panel]);
  const { models } = useModelAvailability(
    !!pendingModel,
    undefined,
    wantModels || ownBlend || (spotBlend.resolved && !published),
  );

  /* ---- the week's columns, and the strip of them the dock shows ---- */
  const columnModels = useMemo<ColumnModel[]>(() => {
    // The blend's own runs, so the columns are the times it has values for.
    if (published) return blendColumnModels(published);
    const list = models
      .filter((model) => model.wind !== null)
      .map((model) => ({
        id: model.id,
        manifest: model.wind!,
        ensemble: model.entry.ensemble,
      }));
    if (!manifest) return list;
    const mine = { id: manifest.model, manifest, ensemble: false };
    const at = list.findIndex((model) => model.id === manifest.model);
    if (at === -1) return [...list, mine];
    return list.map((model, index) => (index === at ? mine : model));
  }, [models, manifest, published]);
  const columns = useMemo(() => {
    const built = dockColumns(columnModels, clockNow);
    return built.length
      ? built
      : manifest
        ? manifest.frames.map((f) => ({
            validTime: f.validTime,
            model: manifest.model,
          }))
        : [];
  }, [columnModels, manifest, clockNow]);
  const stripKey = columns.map((c) => `${c.validTime}|${c.model}`).join(",");
  const strip = useMemo(
    () => stripColumns(columns, clockNow),
    [stripKey, clockNow - (clockNow % 3600000)],
  );
  const days = useMemo(() => stripDays(strip), [strip]);
  const axis = useMemo(() => strip.map((c) => c.validTime), [strip]);
  const stripRef = useRef(strip);
  stripRef.current = strip;

  // The page opens on now, or first light when it is dark; after that the
  // time is the reader's. A layout effect, so the opening time is in before
  // the first paint and before any frame is asked for: until it is, there is
  // no map time, and no frame is loaded (the frame effect below).
  useLayoutEffect(() => {
    if (chosenTime.current || !strip.length) return;
    setSelectedTime(strip[openingColumn(strip, Date.now())].validTime);
  }, [strip]);
  const selected = useMemo(
    () =>
      strip.length && selectedTime
        ? nearestColumn(strip, Date.parse(selectedTime))
        : 0,
    [strip, selectedTime],
  );
  /**
   * A tab left open all morning comes back to an hour already gone: it lands
   * on now instead, and only then. A time the reader chose ahead is theirs.
   */
  const selectedRef = useRef(selectedTime);
  selectedRef.current = selectedTime;
  useEffect(() => {
    const seen = () => {
      if (document.visibilityState !== "visible") return;
      const s = stripRef.current;
      const at = selectedRef.current;
      const now = Date.now();
      if (!s.length || !at || Date.parse(at) + 3600000 >= now) return;
      setSelectedTime(s[openingColumn(s, now)].validTime);
    };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);
  const selectColumn = useCallback((at: number) => {
    const column = stripRef.current[at];
    if (!column) return;
    chosenTime.current = true;
    setModelNotice("");
    setSelectedTime(column.validTime);
  }, []);

  /* ---- the map's frame follows the time, a little behind a fast scrub ---- */
  // The first time set goes to the map at once; a scrub after it is throttled.
  const mapTime = useThrottled(selectedTime, 200) ?? selectedTime;
  const commitRun = ({ manifest: next, frame: nextFrame }: RunSwap) => {
    modelEpoch.current++;
    setManifest(next);
    setFrame(nextFrame);
    if (selectedTime && Date.parse(selectedTime) + 3600000 < Date.now()) {
      const s = stripRef.current;
      if (s.length) setSelectedTime(s[openingColumn(s, Date.now())].validTime);
    }
    setFrameError("");
    setModelError("");
    setModelNotice(`Updated to the ${runLabel(next.runTime)} run.`);
  };
  const paintedIndex =
    manifest && frame
      ? manifest.frames.findIndex((f) => f.hour === frame.hour)
      : -1;
  const requestedIndex =
    manifest && mapTime
      ? (frameForTime(manifest.frames, Date.parse(mapTime)) ??
        (paintedIndex >= 0
          ? paintedIndex
          : nearestFrame(manifest.frames, Date.parse(mapTime))))
      : 0;
  useEffect(() => {
    // No frame before the page knows its opening time: one asked for sooner
    // (the run's first, and its prefetch) would only be thrown away.
    if (!manifest || pendingModel || !mapTime) return;
    const controller = new AbortController();
    const epoch = modelEpoch.current;
    const current = () =>
      !controller.signal.aborted && epoch === modelEpoch.current;
    setFrameError("");
    loadFrame(manifest, requestedIndex)
      .then((data) => {
        if (!current()) return;
        setFrame(data);
        if (requestedIndex + 1 < manifest.frames.length)
          void loadFrame(manifest, requestedIndex + 1, { base: false }).catch(
            () => {},
          );
      })
      .catch(async (e) => {
        if (!current()) return;
        const swap = await loadNewerRun(
          manifest,
          manifest.frames[requestedIndex].validTime,
          controller.signal,
        ).catch(() => null);
        if (!current()) return;
        if (swap) return commitRun(swap);
        setFrameError(e.message);
      });
    return () => controller.abort();
  }, [manifest, requestedIndex, retry, pendingModel, !mapTime]);

  const activeIndex = paintedIndex >= 0 ? paintedIndex : requestedIndex;
  const loading = !frame || activeIndex !== requestedIndex;
  const forecast = manifest?.frames[activeIndex];
  const staleness = manifest ? freshness(manifest) : "fresh";

  const chooseModel = async (id: ModelId, wanted?: string) => {
    if (!manifest || !frame || (id === manifest.model && !wanted)) return;
    modelRequest.current?.abort();
    const controller = new AbortController();
    modelRequest.current = controller;
    modelEpoch.current++;
    setPendingModel(id);
    setModelError("");
    setModelNotice("");
    setFrameError("");
    const targetTime = wanted ?? selectedTime ?? frame.validTime;
    try {
      const next = await loadModel(id, targetTime, controller.signal);
      if (controller.signal.aborted) return;
      setManifest(next.manifest);
      setFrame(next.frame);
      if (
        Math.abs(Date.parse(next.frame.validTime) - Date.parse(targetTime)) >
        3600000
      )
        setModelNotice(
          `${next.manifest.modelName} on the map from ${dayLabel(next.frame.validTime)} ${timeLabel(next.frame.validTime)}.`,
        );
    } catch (e) {
      if (!controller.signal.aborted)
        setModelError(
          `Could not switch to ${MODELS.find((m) => m.id === id)?.name}. ${manifest.modelName} is still shown. ${e instanceof Error ? e.message : ""}`,
        );
    } finally {
      if (modelRequest.current === controller) setPendingModel(null);
    }
  };
  /**
   * A tile of the run on screen could not be read — one the map needs for the
   * view, or one of a bare point's hours: the run may have been replaced and
   * its directory deleted. Look for a newer run, as a failed frame does, until
   * the pointer has been compared once for the run on screen (`RunRecovery`);
   * a tile that fails for any other reason leaves the coarser tiles drawn, or
   * the point's retry, as before.
   */
  const [recovery] = useState(() => new RunRecovery());
  const recoverRun = (model: string, run: string) => {
    if (!manifest || pendingModel || model !== manifest.model) return;
    if (run !== manifest.run) return;
    const epoch = modelEpoch.current;
    const time = selectedTime ?? frame?.validTime;
    if (!time) return;
    const shown = manifest;
    recovery.attempt(
      shown.base,
      () => loadNewerRun(shown, time, new AbortController().signal),
      (swap) => {
        if (epoch === modelEpoch.current) commitRun(swap);
      },
    );
  };
  useRunRefresh({
    manifest,
    validTime: selectedTime ?? frame?.validTime ?? null,
    switching: !!pendingModel,
    playing: false,
    onRun: commitRun,
  });

  /* ---- every place's hours, rated: the lights, the dock and the panel ---- */
  const places = useMemo<RatedPlace[]>(
    () =>
      spots.map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        facing: s.facing ?? null,
      })),
    [spots],
  );
  const first = useMemo(
    () => [point?.id ?? FIRST_SPOT, ...starred, ...frequent.map((v) => v.id)],
    [point?.id, starred, frequent],
  );
  // The reader's own blend reads the same squares from every wind model; the
  // published blend needs none of them.
  const windOnly = useMemo(
    () => models.filter((model) => model.wind !== null),
    [models],
  );
  const ownSquares = useMemo(
    () =>
      published
        ? null
        : squaresToRead(
            mapView,
            windOnly.flatMap((model) => model.wind!.spots.squares),
            ownPlaces,
          ),
    [published, mapView, windOnly, ownPlaces],
  );
  // `rated.squares` is what was read, not what was asked: a square some model
  // could not read keeps its places pending, and the rest are rated.
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
  const lights = useMemo(() => {
    const out = new Map<string, LightState>();
    // The riding wedge is the open spot's alone: on every light at once it
    // buried the chart, and it is a reading of one place, not an overview.
    const open = picked ? null : (point?.id ?? null);
    for (const spot of spots) {
      const row = hours.get(spot.id);
      const hour = row?.[selected];
      out.set(spot.id, {
        pending: !row,
        stars: hour?.rating ? hour.rating.stars : null,
        dark: !!hour && !hour.daylight,
        from: hour?.from ?? null,
        windKn: hour?.windKn ?? null,
        compass: hour?.from != null ? compass(hour.from) : null,
        mark: offshoreMark(hour?.rating ?? null, rider),
        wedge:
          spot.id === open && hour?.rating
            ? rideWedge(
                rider,
                hour.windKn,
                hour.gustKn,
                hour.from,
                spot.facing ?? null,
              )
            : null,
      });
    }
    return out;
  }, [spots, hours, version, selected, rider, picked, point?.id]);
  const named = useMemo(() => new Set(starred), [starred]);
  const column = strip[selected];
  const lightLabel = useCallback(
    (spot: Spot, s: LightState | undefined) =>
      `${spot.name}${spot.county ? `, ${spot.county}` : ""}${
        !s || s.pending
          ? ""
          : `: ${column ? clock(column.time) : ""} ${
              s.dark || s.stars === null
                ? "dark"
                : `${s.stars} star${s.stars === 1 ? "" : "s"}`
            }${s.compass && s.windKn !== null ? `, ${s.compass} ${Math.round(s.windKn)} knots` : ""}${
              s.mark === "struck"
                ? ", offshore"
                : s.mark === "cross-off"
                  ? ", cross-offshore"
                  : ""
            }`
      }`,
    [column?.time],
  );
  const rideStops = useMemo(
    () => rideStopsFor(rider, getComputedStyle(document.documentElement)),
    [JSON.stringify(rider)],
  );
  const selectedDay = days.find(
    (d) => selected >= d.start && selected < d.start + d.count,
  );

  /* ---- foilable depth at the selected tide ---- */
  const foilState = useFoilDepth(layers.foil);
  // Read from the stylesheet only once the layer is wanted.
  const foilPalette = useMemo(
    () =>
      layers.foil
        ? foilColours(getComputedStyle(document.documentElement))
        : null,
    [layers.foil],
  );
  useEffect(() => {
    const areas = foilState.manifest?.areas ?? null;
    foilAreas.current = areas;
    const c = controls.current?.map?.getCenter();
    if (areas && c) setFoilNearId(nearestArea(areas, c.lng, c.lat)?.id ?? null);
  }, [foilState.manifest]);
  const foilTime = column?.time ?? null;
  // Each area's water level at the hour (the station's tide, or behind a
  // weir the basin's own), and the station's tide it came from.
  const foilTides = useMemo(() => {
    const out: Record<string, { water: number; sea: number } | null> = {};
    for (const area of foilState.manifest?.areas ?? []) {
      const tide = foilState.tides[area.station];
      if (!tide || foilTime === null) {
        out[area.id] = null;
        continue;
      }
      const at = (time: number) => tideAt(tide.curve, time);
      const sea = at(foilTime);
      const water = waterLevelAt(area, at, foilTime);
      out[area.id] = sea === null || water === null ? null : { water, sea };
    }
    return out;
  }, [foilState, foilTime]);
  const foilViews = useMemo<FoilView[] | null>(() => {
    const m = foilState.manifest;
    if (!layers.foil || !m || !foilPalette) return null;
    return m.areas.flatMap((area) => {
      const tide = foilTides[area.id]?.water;
      if (tide === undefined) return [];
      return [
        {
          id: area.id,
          url: new URL(
            `${import.meta.env.BASE_URL}${area.url}`,
            window.location.href,
          ).href,
          bounds: area.bounds,
          minzoom: area.minzoom,
          maxzoom: area.maxzoom,
          tileSize: area.tileSize,
          color: foilRamp(tide, foilPalette, {
            dryCeiling: area.dryCeilingMetres,
            floor: m.floorMetres,
            noSurvey: m.noSurveyMetres,
          }),
          attribution: m.attribution,
        },
      ];
    });
  }, [layers.foil, foilState.manifest, foilTides, foilPalette]);
  /** The seabed under the last point tapped while the layer was on. */
  const [foilProbe, setFoilProbe] = useState<{
    lon: number;
    lat: number;
    area: string;
    z: number | "unsurveyed" | null;
  } | null>(null);
  const probed =
    foilProbe &&
    picked &&
    foilProbe.lon === picked.lon &&
    foilProbe.lat === picked.lat
      ? foilProbe
      : null;
  const foilArea = foilState.manifest
    ? (probed && foilState.manifest.areas.find((a) => a.id === probed.area)) ||
      (picked && areaAt(foilState.manifest.areas, picked.lon, picked.lat)) ||
      foilState.manifest.areas.find((a) => a.id === foilNearId) ||
      foilState.manifest.areas[0]
    : null;
  const foilStation = foilArea
    ? (foilState.tides[foilArea.station]?.station.name ?? foilArea.station)
    : null;
  const probeFoil = (lon: number, lat: number) => {
    const m = foilState.manifest;
    // A basin's box overlaps its area's: the first archive with water under
    // the point is the side of the weir it is on.
    const candidates = layers.foil && m ? areasAt(m.areas, lon, lat) : [];
    if (!m || !candidates.length) {
      setFoilProbe(null);
      return;
    }
    (async () => {
      for (const area of candidates) {
        const url = new URL(
          `${import.meta.env.BASE_URL}${area.url}`,
          window.location.href,
        ).href;
        const z = await elevationAt(area, url, lon, lat, m);
        if (z !== null) return { area: area.id, z };
      }
      return { area: candidates[candidates.length - 1].id, z: null };
    })()
      .then((found) => setFoilProbe({ lon, lat, ...found }))
      .catch(() => setFoilProbe(null));
  };
  const probedLevel = probed ? foilTides[probed.area] : null;
  const foilProbeText =
    probed &&
    foilArea?.id === probed.area &&
    probedLevel &&
    foilTime !== null &&
    foilStation
      ? foilReadout(
          probed.z,
          probedLevel.water,
          clock(foilTime),
          foilStation,
          undefined,
          foilArea.level ? probedLevel.sea : undefined,
        )
      : null;

  /* ---- choosing a spot ---- */
  const tide = useSpotTide(picked ? undefined : point?.id);
  const selectSpot = (spot: Spot, fly = true) => {
    setPicked(null);
    setPoint(spot);
    setFocusId(spot.id);
    fav.visit(spot.id);
    if (fly) controls.current?.flyTo(spot);
  };
  /** A tap on the open map: that point's forecast in the dock, and the focus on it. */
  const pickPoint = (at: {
    lon: number;
    lat: number;
    place: string | null;
  }) => {
    const coords = degrees(at.lat, at.lon);
    setPicked({
      lon: at.lon,
      lat: at.lat,
      name: at.place ?? coords,
      coords: at.place ? coords : "",
    });
    setFocusId(AT_POINT);
    probeFoil(at.lon, at.lat);
  };
  const clearFocus = () => setFocusId(null);
  useEffect(() => {
    if (!mapReady) return;
    controls.current?.fitIreland(0);
    const map = controls.current?.map;
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      const mpp =
        (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom());
      let n = mpp * 3779.5;
      const p = 10 ** (Math.floor(Math.log10(n)) - 1);
      n = Math.round(n / p) * p;
      setScale(`SCALE 1 : ${n.toLocaleString("en-IE").replace(/,/g, " ")}`);
      const areas = foilAreas.current;
      if (areas) setFoilNearId(nearestArea(areas, c.lng, c.lat)?.id ?? null);
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [mapReady]);
  // A linked spot is flown to once the chart is up.
  useEffect(() => {
    if (mapReady && point && focusId === point.id)
      controls.current?.flyTo(point);
  }, [mapReady]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      if (panel) setPanel(null);
      else clearFocus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [panel]);

  /* ---- Gust moving the map, at the rider's ask ---- */
  const highlightTimer = useRef<number | undefined>(undefined);
  const companionAction = (action: MapAction) => {
    if (action.type === "select_spot") {
      const spot = spots.find((s) => s.id === action.id);
      if (spot) selectSpot(spot);
    } else if (action.type === "set_time") {
      if (strip.length)
        selectColumn(nearestColumn(strip, Date.parse(action.iso)));
    } else {
      clearTimeout(highlightTimer.current);
      const marked = action.ids.flatMap((id) => [
        ...document.querySelectorAll<HTMLElement>(
          `.spot-marker[data-spot-id="${CSS.escape(id)}"]`,
        ),
      ]);
      document
        .querySelectorAll(".spot-marker.gust-highlight")
        .forEach((el) => el.classList.remove("gust-highlight"));
      marked.forEach((el) => el.classList.add("gust-highlight"));
      highlightTimer.current = window.setTimeout(
        () => marked.forEach((el) => el.classList.remove("gust-highlight")),
        4500,
      );
    }
  };
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  /* ---- a point tapped on the map: read out of the map model's frames ---- */
  const pickedPoint = useMemo(
    () =>
      picked ? { name: picked.name, lat: picked.lat, lon: picked.lon } : null,
    [picked],
  );
  const series = usePointSeries(picked ? manifest : null, pickedPoint);
  const seriesFailed = !series.named && !series.pending && series.failures > 0;
  useEffect(() => {
    if (seriesFailed && manifest) recoverRun(manifest.model, manifest.run);
  }, [seriesFailed]);
  const pickedHours = useMemo<PlaceHour[] | undefined>(
    () =>
      picked && manifest
        ? pointHoursFrom(manifest.frames, series.values, picked, axis)
        : undefined,
    [picked, manifest, series.values, axis],
  );
  const dockSpot: Spot | null = picked
    ? {
        id: "",
        name: picked.name,
        county: picked.coords,
        lat: picked.lat,
        lon: picked.lon,
        note: "",
        facing: null,
      }
    : point;

  /* ---- what the pen writes beside the selected light ---- */
  const pointHours: PlaceHour[] | undefined = picked
    ? pickedHours
    : point
      ? hours.get(point.id)
      : undefined;
  const penNote = useMemo(() => {
    if (!dockSpot || !pointHours || !selectedDay) return "";
    const best = dayBest(
      pointHours.map((h) => h.rating),
      selectedDay,
      clockNow,
      strip.map((c) => c.time),
    );
    if (!best) return "";
    // Which day: the note is the selected day's best, and the dock may be
    // showing any day of the fortnight.
    const day = dayShort(selectedDay.noon);
    if (!best.stars) return `${day}: no stars`;
    const r = pointHours[best.from].rating!;
    const span =
      best.from === best.to
        ? clock(strip[best.from].time)
        : `${clock(strip[best.from].time).slice(0, 2)}–${clock(strip[best.to].time).slice(0, 2)}`;
    return `${day} ${"★".repeat(best.stars)} ${span}, ${r.wing.own ?? r.wing.recommended} m²`;
  }, [dockSpot?.id, picked, pointHours, selectedDay, strip, clockNow, version]);

  const marine = useMarineModels(more && mapReady);
  const focusAt =
    focusId === AT_POINT
      ? picked
      : focusId && point && focusId === point.id
        ? point
        : null;

  /* ---- the run that reaches the hour, when the map's does not ---- */
  const beyondMap =
    !!manifest &&
    !!column &&
    frameForTime(manifest.frames, column.time) === null;
  const reachable =
    beyondMap && column
      ? (MODELS.find((m) => m.id === column.model) ?? null)
      : null;

  const spotById = useMemo(
    () => new Map(spots.map((s) => [s.id, s] as const)),
    [spots],
  );
  const dayStars = (id: string) => {
    const row = hours.get(id);
    if (!row || !selectedDay) return null;
    return (
      dayBest(
        row.map((h) => h.rating),
        selectedDay,
      )?.stars ?? null
    );
  };

  const sources = (
    <>
      <ul>
        <li>
          Wind: {manifest?.modelName ?? "HARMONIE"} on the map
          {manifest ? ` (${runLabel(manifest.runTime)} run)` : ""}; the stars
          blend {prefs.blendModels.length} models
        </li>
        <li>Depths: EMODnet Bathymetry, metres below chart datum</li>
        {foilState.manifest && (
          <li>
            Foilable depth (pilot areas): {foilState.manifest.attribution}{" "}
            Heights above LAT against Marine Institute tide predictions.
          </li>
        )}
        <li>
          Coast and places: ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
          ,{" "}
          <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>
        </li>
        <li>Tides: Marine Institute predictions</li>
        <li>
          Places: Fáilte Ireland (CC BY 4.0), OpenStreetMap (ODbL) and linked
          guides; not verified launches
        </li>
      </ul>
      <p className="ip-small">
        A model cannot see every headland. Check{" "}
        <a href="https://www.met.ie/warnings" target="_blank" rel="noreferrer">
          Met Éireann warnings
        </a>{" "}
        and the water before you go. Not for navigation.
      </p>
    </>
  );

  const status = pendingModel
    ? `Loading ${MODELS.find((m) => m.id === pendingModel)?.name}…`
    : modelError || modelNotice
      ? modelError || modelNotice
      : frameError
        ? frameError
        : null;

  const shell = (
    <div
      className={`app-shell${phone ? " is-phone" : ""}${focusId ? " is-focus" : ""}`}
      style={{ "--dock-height": `${dockHeight}px` } as React.CSSProperties}
    >
      {error ? (
        <main className="fatal-error chart-box">
          <h1>The forecast isn’t ready yet.</h1>
          <p role="alert">{error}</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      ) : (
        <main className="workspace">
          <section className="map-panel" aria-label="Wind chart">
            <MapHead
              spots={spots}
              starred={starred}
              dayStars={dayStars}
              onPick={(spot) => selectSpot(spot)}
            />
            <MapControls
              onZoomIn={() => controls.current?.zoomIn()}
              onZoomOut={() => controls.current?.zoomOut()}
              open={panel}
              onOpen={setPanel}
              spots={() => (
                <SidePanel
                  spots={spotById}
                  starred={starred}
                  frequent={frequent}
                  hours={hours}
                  columns={strip}
                  day={selectedDay}
                  now={clockNow}
                  onGo={(spot) => {
                    // Chosen: the panel's work is done, and the chart under
                    // it is where the spot is about to be.
                    setPanel(null);
                    selectSpot(spot);
                  }}
                  onToggleStar={(id) => fav.toggle(id)}
                />
              )}
              options={(close) => (
                <Suspense fallback={null}>
                  <DisplayFilter
                    prefs={prefs}
                    onChange={changePrefs}
                    models={models.filter(
                      (model) => model.entry.kind === "wind",
                    )}
                    onClose={close}
                  />
                </Suspense>
              )}
              infoOpen={!!info}
              onInfo={setInfo}
              windStyle={windStyle}
              onWindStyle={chooseWind}
              layers={layers}
              onLayersChange={chooseLayers}
              rideStops={rideStops}
              rider={rider}
              model={manifest?.model}
              modelDisabled={!frame || !!pendingModel}
              onModel={(id) => void chooseModel(id)}
            />
            {/* After the boxes: the keys reach the menu, the search and the
                controls before the lights. */}
            <WindMap
              frame={frame}
              spots={spots}
              lights={lights}
              named={named}
              lightLabel={lightLabel}
              selectedId={picked ? null : (point?.id ?? null)}
              focus={focusAt ? { lon: focusAt.lon, lat: focusAt.lat } : null}
              mark={focusAt ? { lon: focusAt.lon, lat: focusAt.lat } : null}
              picked={picked ? { lon: picked.lon, lat: picked.lat } : null}
              onPick={pickPoint}
              windStyle={windStyle}
              rideStops={rideStops}
              layers={layers}
              foil={foilViews}
              reducedMotion={reducedMotion}
              bottomInset={dockHeight}
              phone={phone}
              penNote={focusAt ? penNote : null}
              onSelect={(spot) => selectSpot(spot)}
              onReady={(c) => {
                controls.current = c;
                setMapReady(!!c);
              }}
              onTilesFailed={(failed) => recoverRun(failed.model, failed.run)}
            />
            {(status || (loading && frame)) && (
              <div
                className={`frame-status chart-box${modelError || frameError ? " is-error" : ""}`}
                role="status"
              >
                <span>
                  {status ??
                    `Loading ${forecast ? timeLabel(manifest!.frames[requestedIndex].validTime) : "wind"}…`}
                </span>
                {pendingModel && (
                  <button
                    onClick={() => {
                      modelRequest.current?.abort();
                      setPendingModel(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
                {frameError && !pendingModel && (
                  <button onClick={() => setRetry((v) => v + 1)}>Retry</button>
                )}
                {(modelError || modelNotice) && (
                  <button
                    aria-label="Dismiss"
                    onClick={() => {
                      setModelError("");
                      setModelNotice("");
                    }}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            <div className="map-footer" ref={dock}>
              {/* The small print rides on the dock's top edge, in the dock's
                  own layout: never a frame behind it (map.css). */}
              <div className="map-print">
                <InfoPop label="Sources and small print" wide>
                  {sources}
                </InfoPop>
                <span className="map-model" data-run-state={staleness}>
                  {manifest?.modelName ?? ""}
                  {staleness === "expired"
                    ? " · archived"
                    : staleness === "stale"
                      ? " · older run"
                      : ""}
                </span>
              </div>
              {dockSpot && strip.length > 0 && (
                <ForecastDock
                  spot={dockSpot}
                  isPoint={!!picked}
                  pointPending={!!picked && series.pending}
                  more={more}
                  onMore={chooseMore}
                  marine={marine}
                  columns={strip}
                  days={days}
                  hours={pointHours}
                  selected={selected}
                  onSelect={(at) => selectColumn(at)}
                  now={clockNow}
                  prefs={prefs}
                  models={models}
                  onWantModels={() => setWantModels(true)}
                  starred={!picked && starred.includes(dockSpot.id)}
                  onToggleStar={() => fav.toggle(dockSpot.id)}
                  tide={picked ? null : tide.tide}
                  phone={phone}
                  view={view}
                  onView={setView}
                  reducedMotion={reducedMotion}
                  reachable={reachable}
                  onShowOnMap={() =>
                    reachable && column
                      ? void chooseModel(reachable.id, column.validTime)
                      : undefined
                  }
                />
              )}
            </div>
          </section>
        </main>
      )}
      {!error && gustDue && FEATURES.gust && (
        <Suspense fallback={null}>
          <Companion
            context={{
              spot:
                point && !picked ? { id: point.id, name: point.name } : null,
              time: selectedTime,
              rider: prefs.rider,
            }}
            onAction={companionAction}
            onRiderSaved={(r) =>
              changePrefs({ ...prefs, rider: parseRider(r) })
            }
            launcherBottom={dockHeight + 24}
            panelBottom={dockHeight + 12}
          />
        </Suspense>
      )}
      {info && (
        <MapInfo
          at={info}
          onClose={() => setInfo(null)}
          scale={scale}
          rideStops={rideStops}
          rider={rider}
          spotId={picked ? null : (point?.id ?? null)}
          foil={
            <FoilLegend
              on={layers.foil}
              area={foilArea}
              station={foilStation}
              tide={foilArea ? (foilTides[foilArea.id]?.water ?? null) : null}
              sea={
                foilArea?.level ? (foilTides[foilArea.id]?.sea ?? null) : null
              }
              when={
                foilTime !== null
                  ? `${dayShort(foilTime)} ${clock(foilTime)}`
                  : ""
              }
              readout={foilProbeText}
              error={foilState.error}
            />
          }
          sources={sources}
        />
      )}
    </div>
  );
  // The "?"s by the stars, in the dock and the panel, open the dialog too.
  return <MapInfoOpen.Provider value={setInfo}>{shell}</MapInfoOpen.Provider>;
}
