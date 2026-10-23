// The map's own stylesheets, in its chunk: src/main.tsx lazy-loads this file,
// and the other sections never ask for MapLibre's CSS or the chart's.
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import "./dock.css";
import "./panels.css";
import {
  lazy,
  startTransition,
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
  parseSatelliteOption,
  SATELLITE_ATTRIBUTION,
  type SatelliteOption,
} from "../force5/src/satellite";
import { useSatellite } from "./useSatellite";
import { useLidar } from "./useLidar";
import {
  areaAt,
  areasAt,
  areasInView,
  FOIL_MIN_ZOOM,
  FOIL_ZOOM_NOTE,
  foilColours,
  foilRamp,
  foilReadout,
  nearestArea,
  waterLevelAt,
  type FoilArea,
  type FoilPoint,
} from "../force5/src/foilDepth";
import { elevationAt } from "../force5/src/foilProbe";
import { useFadeOut } from "../ui/Backdrop";
import { MapInfoOpen, type InfoSection } from "./mapInfoContext";
import { foilArchiveUrl, useFoilDepth } from "./useFoilDepth";
import { useCurrents } from "./useCurrents";
import type { LightState } from "../force5/src/lights";
import { knotsIn, unitName } from "../force5/src/units";
import { rideWedge } from "../force5/src/rideWedge";
import { WIND_STYLES, type WindStyle } from "../force5/src/windLayer";
import { isFocusStyle, loupeRose, type FocusStyle } from "../force5/src/focus";
import ForecastDock, { type DockView } from "./ForecastDock";
import MapControls, { chartTools, type MapPanel } from "./MapControls";
import MapHead from "./MapHead";
import { CustomiseGlyph, TourGlyph } from "./chartGlyphs";
import { tourOffered, tourSeen } from "./tourOffer";
import SidePanel from "./SidePanel";
import { InfoPop } from "./InfoPop";
import useRunRefresh, {
  loadNewerRun,
  RunRecovery,
  type RunSwap,
} from "./useRunRefresh";
import {
  useMarineModels,
  useModelAvailability,
  useTideManifest,
} from "./useBlend";
import { useRatings } from "./useRatings";
import { ALL_SQUARES, useSpotSquaresState } from "./useSpotSquares";
import {
  blendColumnModels,
  ownBlendModels,
  placesRatedApart,
  trustedSpotBlend,
} from "./spotBlend";
import { useBlendSquares, useSpotBlend } from "./useSpotBlend";
import { useViewBounds } from "./useViewBounds";
import { squaresToRead } from "../force5/src/squares";
import { usePointSeries } from "./usePointSeries";
import {
  handedPointHours,
  offshoreMark,
  type PlaceHour,
  type RatedPlace,
} from "./ratings";
import {
  clock,
  dayShort,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
} from "./strip";
import { ridingLocations } from "./locations";
import { openingSpot, spotAddress } from "./openingSpot";
import { takeEarly } from "../force5/src/boot";
import {
  loadManifest,
  MANIFEST_REVALIDATE_MS,
  ManifestUnavailableError,
  windModels,
} from "../force5/src/manifests";
import { runLabel } from "../force5/src/revalidate";
import { starsFromAt, starsFromText } from "../force5/src/lead";
import {
  loadModel,
  MAP_MODEL_IDS,
  MODELS,
  type ModelId,
} from "../force5/src/models";
// The display options, only when asked for from the map's controls.
const DisplayFilter = lazy(() => import("./DisplayFilter"));
// The map's information: a chunk of its own, fetched when it first opens.
const MapInfo = lazy(() => import("./MapInfo"));
// Gust is a launcher in the corner until he is asked: his code comes once
// the chart is up, not before it.
const Companion = lazy(() =>
  import("../companion/web/Companion").then((m) => ({ default: m.Companion })),
);
// A rider's own star rating, set in a dialog of its own, only when asked for.
const YourStarsDialog = lazy(() => import("../spot/web/YourStarsDialog"));
// The account's copy of the rider, on a device that has signed in before.
const AccountRider = lazy(() => import("../shared/web/AccountRider"));
/** The LiDAR layer's key: with the map's information, and only its part. */
const LidarKey = lazy(() => import("./LidarKey"));
// Customise and the tour, each only when asked for; the tour's offer only on
// a first visit (src/tourOffer.ts).
const Customise = lazy(() => import("./Customise"));
const Tour = lazy(() => import("./Tour"));
const TourPrompt = lazy(() => import("./TourPrompt"));
import type { MapAction } from "../companion/shared/protocol";
import { parseRider, withCustomStars } from "../force5/src/prefs";
import type { CustomRating } from "../force5/src/stars";
import {
  announcePrefs,
  onPrefsChange,
  signedInHint,
} from "../shared/web/riderSync";
import {
  dockColumns,
  frameForTime,
  handoverModel,
  handoverStart,
  mapReach,
  pointHandovers,
  type ColumnModel,
} from "../force5/src/timeline";
import { freshwaterSpots, tideAt } from "../force5/src/tides";
import { nearestSpotOnWater } from "../force5/src/pointSource";
import { FEATURES } from "../shared/web/features";
import { favourites } from "../shared/web/favourites";
import {
  compass,
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

const WIND_KEY = "wingfoil.map.wind.v1";
const LAYERS_KEY = "wingfoil.map.layers.v1";
const FOCUS_KEY = "wingfoil.map.focus.v1";
const MORE_KEY = "wingfoil.map.more.v1";
/** The focus is on the point tapped on the map, not a riding place. */
const AT_POINT = "@point";
/**
 * What is open over the chart and shuts on a press away from it: the site
 * menu and the search's list in the head, each said open on the control it
 * hangs from, and the layers, your spots, the options or the map's
 * information in their dialog.
 */
const OVER_THE_CHART = '.map-head [aria-expanded="true"], dialog[open]';

/** Where the map was tapped, as the map hands it over. */
interface TappedAt {
  lon: number;
  lat: number;
  place: string | null;
  lake: boolean;
}
/** The state of a history entry of the map's own: a tapped point's. */
interface MapEntry {
  mapPoint?: TappedAt;
}
/** A point tapped on the map, as the dock names it. */
interface Picked {
  lon: number;
  lat: number;
  name: string;
  coords: string;
  /** On a lake in the basemap: water the sea does not reach, so no tide. */
  lake: boolean;
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

/** The chart's switches and, in the same store, the satellite's choice. */
type MapLayers = ChartLayers & { satellite: SatelliteOption };

const DEFAULT_LAYERS: MapLayers = {
  tints: true,
  soundings: true,
  relief: true,
  names: true,
  foil: true,
  // Off, and nothing of it loaded, until the rider asks for it.
  lidar: false,
  // Off by default: nothing of it is read until a rider asks for it.
  currents: false,
  satellite: "off",
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

/**
 * Follows a value at most every `ms` while it keeps changing, then settles on
 * it. What follows is never urgent: a key's hour commits at once and runs its
 * effects there and then, and the value set straight after it, urgent too,
 * was one more render queued behind each key. Keys coming faster than the
 * page could draw them never let that queue empty, and React stopped the page
 * with "Maximum update depth exceeded".
 */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - performance.now();
    if (wait <= 0) {
      last.current = performance.now();
      startTransition(() => setOut(value));
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
  // A rating adopted from the account, or changed in another tab.
  useEffect(() => onPrefsChange(() => setPrefs(loadPrefs())), []);
  const changePrefs = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  // The rider's own star rating: the dialog, once opened, stays mounted so
  // it can hand the focus back as it closes.
  const [starsOpen, setStarsOpen] = useState(false);
  const [starsWanted, setStarsWanted] = useState(false);
  const openStars = () => {
    setStarsWanted(true);
    setStarsOpen(true);
  };
  const setCustomStars = (custom: CustomRating | null) => {
    changePrefs(withCustomStars(prefs, custom));
    announcePrefs("device");
  };
  const [syncAccount] = useState(
    () => signedInHint() || Boolean(import.meta.env.VITE_MARKET_DEV_USER),
  );
  const rider = prefs.rider;
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  // The reader's place in the forecast is a valid time, never an index.
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const chosenTime = useRef(false);
  const [point, setPoint] = useState<Spot | null>(null);
  /**
   * Whether the opening spot has been worked out (it waits for the places):
   * until then the dock is not drawn, so a linked spot never comes in over a
   * moment of "no spot".
   */
  const [opened, setOpened] = useState(false);
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
  /** The layers, your spots or the display options, in a dialog over the map. */
  const [panel, setPanel] = useState<MapPanel>(null);
  /** The information dialog's part to open at, or null while it is shut. */
  const [info, setInfo] = useState<InfoSection | null>(null);
  /** The part it is drawn at: kept while it fades out, once shut. */
  const infoShown = useFadeOut(info);
  /** Customise, the tour, or the first visit's offer of it, over the chart. */
  const [guide, setGuide] = useState<"offer" | "tour" | "customise" | null>(
    () => (tourOffered() ? "offer" : null),
  );
  /** Customise is kept while it fades out, once shut. */
  const customiseShown = useFadeOut(guide === "customise");
  const [view, setView] = useState<DockView>("table");
  const [windStyle, setWindStyle] = useState<WindStyle>(() => {
    const saved = store.get(WIND_KEY) as WindStyle | null;
    return saved && WIND_STYLES.includes(saved) ? saved : "ink";
  });
  const [layers, setLayers] = useState<MapLayers>(() => {
    try {
      const saved = JSON.parse(store.get(LAYERS_KEY) ?? "{}");
      return {
        ...DEFAULT_LAYERS,
        ...saved,
        satellite: parseSatelliteOption(saved.satellite),
      };
    } catch {
      return DEFAULT_LAYERS;
    }
  });
  const chooseWind = (style: WindStyle) => {
    setWindStyle(style);
    store.set(WIND_KEY, style);
  };
  /** The mark round the chosen spot: the range ring unless the rider chose otherwise. */
  const [focusStyle, setFocusStyle] = useState<FocusStyle>(() => {
    const saved = store.get(FOCUS_KEY);
    return isFocusStyle(saved) ? saved : "ring";
  });
  const chooseFocusStyle = (style: FocusStyle) => {
    setFocusStyle(style);
    store.set(FOCUS_KEY, style);
  };
  const chooseLayers = (next: MapLayers) => {
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
  // The chart's view after each move: which foil areas are drawn, and whose
  // tide curves are fetched (only theirs).
  const [chartView, setChartView] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
    zoom: number;
  } | null>(null);
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
        // Only a run with no hour in the strip opens on the nearest frame.
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
        // No default place, and no dock until a spot is chosen: only a link
        // opens on one, focused (src/openingSpot.ts). A remembered or starred
        // spot waits for the reader to tap it.
        const linked = openingSpot(location.search, places);
        setPoint(linked);
        setOpened(true);
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
  // So is one whose stars come from other models than the published blend's.
  const pointer = trustedSpotBlend(
    spotBlend.blend,
    ownBlend,
    clockNow,
    starsFromAt(rider.starsFrom),
  );
  // The lights read the spot squares in view, once the camera settles, and
  // the open spot's and the reader's own wherever they are: never every place.
  const mapView = useViewBounds(mapReady ? controls.current?.map : null);
  // With no spot open, that is the squares in view and the reader's own.
  const ownPlaces = useMemo(() => {
    const ids = new Set([
      ...(point ? [point.id] : []),
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
  // A spot the rider rates from a model of its own is worked out from that
  // model's square, beside the published blend that rates every other.
  const ratedApart = useMemo(
    () => placesRatedApart(spots, rider, published),
    [spots, rider, published],
  );
  const [wantModels, setWantModels] = useState(false);
  // The display options list every wind model, and say which answered.
  useEffect(() => {
    if (panel === "options") setWantModels(true);
  }, [panel]);
  const { models } = useModelAvailability(
    !!pendingModel,
    undefined,
    wantModels ||
      ownBlend ||
      (spotBlend.resolved && !published) ||
      ratedApart.length > 0,
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

  // The page opens on now, night or day; after that the
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

  /* ---- past the reader's run, the run that covers the hour ---- */
  const mapAt = mapTime ? Date.parse(mapTime) : NaN;
  const mapIndex = strip.length && mapTime ? nearestColumn(strip, mapAt) : -1;
  const mapColumn = strip[mapIndex];
  // A run whose manifest could not be read is passed over for five minutes,
  // the manifest cache's own span, so the next run that covers the hour (GFS,
  // past ECMWF) is drawn rather than nothing; after that it is asked again.
  const [handoverFailed, setHandoverFailed] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  /** The runs the map can hand over to now: the columns', less any just failed. */
  const handable = useMemo(
    () =>
      columnModels.filter(
        (model) =>
          !(
            clockNow - (handoverFailed.get(model.id) ?? -Infinity) <
            MANIFEST_REVALIDATE_MS
          ),
      ),
    [columnModels, clockNow, handoverFailed],
  );
  /**
   * The model the map hands over to where the reader's run does not reach the
   * hour: the one the dock's column there comes from (force5/src/timeline.ts).
   * Worked out from the runs the columns are built from, so it holds with no
   * spot open and no dock on screen. The reader's choice stays `manifest`, and
   * the map goes back to it as soon as the hour is inside its run again.
   */
  const handoverId = useMemo(
    () =>
      manifest
        ? handoverModel(
            handable,
            MAP_MODEL_IDS,
            { id: manifest.model, frames: manifest.frames },
            mapAt,
            mapColumn,
            clockNow,
          )
        : null,
    [handable, manifest, mapAt, mapColumn?.model, clockNow],
  );
  // Kept once loaded, so a scrub back and forth across the seam swaps between
  // two runs already in hand rather than reading a manifest at every crossing.
  const [handover, setHandover] = useState<Manifest | null>(null);
  /** A newer run of the hand-over's model, found after one of its tiles failed. */
  const commitHandover = ({ manifest: next, frame: nextFrame }: RunSwap) => {
    setHandover(next);
    setFrame(nextFrame);
    setFrameError("");
  };
  useEffect(() => {
    if (!handoverId) return;
    const controller = new AbortController();
    // Through the manifest cache: the run in hand comes straight back, and one
    // older than five minutes is checked against its ETag, not read again.
    loadManifest(handoverId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setHandover(next);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHandoverFailed((failed) =>
            new Map(failed).set(handoverId, Date.now()),
          );
      });
    return () => controller.abort();
  }, [handoverId]);
  const handing =
    handoverId &&
    handover?.model === handoverId &&
    frameForTime(handover.frames, mapAt) !== null
      ? handover
      : null;
  /** The hand-over's run is still on its way: the map waits for it. */
  const handoverDue = !!handoverId && handover?.model !== handoverId;
  /** The run the map draws from: the reader's own, or the one handed over to. */
  const mapRun = handing ?? manifest;

  // A frame belongs to one run: an hour of HARMONIE's is not ECMWF's, even
  // where their lead hours match.
  const paintedIndex =
    mapRun && frame && frame.model === mapRun.model && frame.run === mapRun.run
      ? mapRun.frames.findIndex((f) => f.hour === frame.hour)
      : -1;
  const requestedIndex =
    mapRun && mapTime
      ? (frameForTime(mapRun.frames, mapAt) ??
        (paintedIndex >= 0 ? paintedIndex : nearestFrame(mapRun.frames, mapAt)))
      : 0;
  const painted = paintedIndex >= 0 && paintedIndex === requestedIndex;
  useEffect(() => {
    // No frame before the page knows its opening time: one asked for sooner
    // (the run's first, and its prefetch) would only be thrown away.
    if (!mapRun || pendingModel || !mapTime) return;
    // Only when there is one: on every hour, a render queued for nothing.
    if (frameError) setFrameError("");
    if (painted) return;
    const controller = new AbortController();
    const epoch = modelEpoch.current;
    const current = () =>
      !controller.signal.aborted && epoch === modelEpoch.current;
    const own = mapRun === manifest;
    loadFrame(mapRun, requestedIndex)
      .then((data) => {
        if (!current()) return;
        setFrame(data);
        if (requestedIndex + 1 < mapRun.frames.length)
          void loadFrame(mapRun, requestedIndex + 1, { base: false }).catch(
            () => {},
          );
      })
      .catch(async (e) => {
        if (!current()) return;
        const swap = await loadNewerRun(
          mapRun,
          mapRun.frames[requestedIndex].validTime,
          controller.signal,
        ).catch(() => null);
        if (!current()) return;
        if (swap) return own ? commitRun(swap) : commitHandover(swap);
        setFrameError(e.message);
      });
    return () => controller.abort();
    // The reader's run as well as the drawn one: a newer run of theirs swapped
    // in while the hand-over is drawn replaces the frame, which is asked again.
  }, [
    mapRun,
    manifest,
    requestedIndex,
    retry,
    pendingModel,
    !mapTime,
    painted,
  ]);

  /**
   * Whether the map has a run that reaches the hour it is at. Where neither
   * the reader's run nor a hand-over does, it draws no wind, rather than the
   * last frame it painted: the lights and the dock read the hour itself, and
   * two hours shown as one moment is wrong. While the hand-over's run is on
   * its way the frame on screen stands, as it does through any scrub.
   */
  const mapDraws =
    !mapRun ||
    !mapTime ||
    frameForTime(mapRun.frames, mapAt) !== null ||
    handoverDue;
  const loading = !frame || handoverDue || !painted;
  const staleness = mapRun ? freshness(mapRun) : "fresh";

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
      // A run that does not reach the time hands it over (`handoverModel`),
      // and the label where the map names its model says so.
      setManifest(next.manifest);
      setFrame(next.frame);
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
    if (pendingModel) return;
    // The reader's run, or the one handed over to past it.
    const shown = [manifest, handing].find(
      (m) => m && m.model === model && m.run === run,
    );
    if (!shown) return;
    const epoch = modelEpoch.current;
    const time = selectedTime ?? frame?.validTime;
    if (!time) return;
    recovery.attempt(
      shown.base,
      () => loadNewerRun(shown, time, new AbortController().signal),
      (swap) => {
        if (epoch !== modelEpoch.current) return;
        if (shown === manifest) commitRun(swap);
        else commitHandover(swap);
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
    () => [
      ...(point ? [point.id] : []),
      ...starred,
      ...frequent.map((v) => v.id),
    ],
    [point?.id, starred, frequent],
  );
  // The reader's own blend reads the same squares from every wind model; the
  // published blend needs none of them.
  const windOnly = useMemo(
    () => models.filter((model) => model.wind !== null),
    [models],
  );
  const ownSquares = useMemo(() => {
    const listed = windOnly.flatMap((model) => model.wind!.spots.squares);
    if (!published) return squaresToRead(mapView, listed, ownPlaces);
    return ratedApart.length ? squaresToRead(null, listed, ratedApart) : null;
  }, [published, mapView, windOnly, ownPlaces, ratedApart]);
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
    published
      ? rated.squares === ALL_SQUARES
        ? null
        : (rated.squares ?? [])
      : null,
  );
  const lights = useMemo(() => {
    const out = new Map<string, LightState>();
    // The riding wedge is the open spot's alone: on every light at once it
    // buried the chart, and it is a reading of one place, not an overview.
    // Under the loupe it goes: the rose is the same thing, bigger.
    const open = picked ? null : (point?.id ?? null);
    const loupeOn = focusStyle === "loupe" && !!open && focusId === open;
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
          spot.id === open && !loupeOn && hour?.rating
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
  }, [
    spots,
    hours,
    version,
    selected,
    rider,
    picked,
    point?.id,
    focusStyle,
    focusId,
  ]);
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
            }${s.compass && s.windKn !== null ? `, ${s.compass} ${knotsIn(s.windKn, prefs.units)} ${unitName(prefs.units)}` : ""}${
              s.mark === "struck"
                ? ", offshore"
                : s.mark === "cross-off"
                  ? ", cross-offshore"
                  : ""
            }`
      }`,
    [column?.time, prefs.units],
  );

  /* ---- the satellite image under the chart ---- */
  // Its index and code load the first time an image is chosen; then only the
  // areas in view are drawn. The station nearest the map's centre gives the
  // panel and the key the tide each image was taken at.
  const satellite = useSatellite(layers.satellite, chartView);
  // The chosen tide's image is drawn whole once its tiles are in (WindMap).
  const [satelliteLoading, setSatelliteLoading] = useState(false);
  const chooseSatellite = (option: SatelliteOption) =>
    chooseLayers({ ...layers, satellite: option });

  /* ---- the LiDAR surveys' ground heights ---- */
  const lidar = useLidar(layers.lidar);

  /* ---- foilable depth at the selected tide ---- */
  // The stations whose curves are wanted: those of the areas in view, of the
  // key's area and of a tapped point's. Set after each render that changes
  // them (they depend on the index the hook loads).
  const [foilStations, setFoilStations] = useState<string[]>([]);
  // Out past the layer's zoom nothing of it is fetched or drawn: not the
  // index, a tide curve, an archive, nor a tapped point's depth.
  const foilFar = !chartView || chartView.zoom < FOIL_MIN_ZOOM;
  const foilState = useFoilDepth(layers.foil && !foilFar, foilStations);
  // The Currents layer at the hour the map shows; nothing at all while off.
  const currents = useCurrents(layers.currents, mapAt, prefs.units);
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
  // Only the areas over the chart's view are drawn, and only theirs fetched.
  const foilInView = useMemo(
    () =>
      foilState.manifest && chartView && !foilFar
        ? areasInView(foilState.manifest.areas, chartView, chartView.zoom)
        : [],
    [foilState.manifest, chartView, foilFar],
  );
  const foilViews = useMemo<FoilView[] | null>(() => {
    const m = foilState.manifest;
    if (!layers.foil || !m || !foilPalette) return null;
    return foilInView.flatMap((area) => {
      const tide = foilTides[area.id]?.water;
      if (tide === undefined) return [];
      return [
        {
          id: area.id,
          url: foilArchiveUrl(m, area),
          bounds: area.bounds,
          minzoom: area.minzoom,
          maxzoom: area.maxzoom,
          tileSize: area.tileSize,
          color: foilRamp(tide, foilPalette, {
            dryCeiling: area.dryCeilingMetres,
            floor: m.floorMetres,
            // A set that estimates the beds no survey reached writes no
            // no-survey value, and its padded land crosses it.
            noSurvey:
              m.estimateBlue === undefined ? m.noSurveyMetres : undefined,
            deep: m.deepMetres,
          }),
          attribution: m.attribution,
        },
      ];
    });
  }, [
    layers.foil,
    foilState.manifest,
    foilState.tides,
    foilInView,
    foilTides,
    foilPalette,
  ]);
  /** The seabed under the last point tapped while the layer was on. */
  const [foilProbe, setFoilProbe] = useState<{
    lon: number;
    lat: number;
    area: string;
    z: FoilPoint;
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
  const stationsKey = layers.foil
    ? [
        ...new Set(
          [...foilInView, foilArea].flatMap((a) => (a ? [a.station] : [])),
        ),
      ]
        .sort()
        .join("|")
    : "";
  useEffect(() => {
    setFoilStations(stationsKey ? stationsKey.split("|") : []);
  }, [stationsKey]);
  const probeFoil = (lon: number, lat: number) => {
    const m = foilState.manifest;
    // A pilot wins where it is, and a basin's box overlaps its area's: the
    // first archive with water under the point is the side of the weir it is
    // on. Elsewhere it is the one region whose station is nearest.
    const candidates =
      layers.foil && m && !foilFar ? areasAt(m.areas, lon, lat) : [];
    if (!m || !candidates.length) {
      setFoilProbe(null);
      return;
    }
    (async () => {
      let last: FoilPoint = null;
      for (const area of candidates) {
        const z = await elevationAt(area, foilArchiveUrl(m, area), lon, lat, m);
        if (z !== null && z !== "none") return { area: area.id, z };
        last = z;
      }
      return { area: candidates[candidates.length - 1].id, z: last };
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
          foilState.manifest?.floorMetres,
        )
      : null;

  /* ---- choosing a spot ---- */
  const tideManifest = useTideManifest(!!picked);
  // The riding place a point borrows its waves, weather and sea from: the
  // nearest on the same water (a lake's for a lake), within 15 km.
  const pointSource = useMemo(
    () =>
      picked
        ? nearestSpotOnWater(spots, picked.lat, picked.lon, {
            lake: picked.lake,
            freshwater: tideManifest ? freshwaterSpots(tideManifest) : null,
          })
        : null,
    [picked, spots, tideManifest],
  );
  /**
   * Each spot chosen is a step in the page's history, with the spot in its
   * link (`/?spot=keel`, src/openingSpot.ts): the link can be shared, Back
   * goes to the spot before or, from the first, closes the dock, and Forward
   * comes back. A tapped point is a step too, with no spot in the link, and
   * the point in the entry's state; a tap after a tap only moves it.
   */
  const remember = (id: string | null, at?: TappedAt) => {
    const href = spotAddress(location.href, id);
    const state: MapEntry = at ? { mapPoint: at } : {};
    const here = window.history.state as MapEntry | null;
    if (at && here?.mapPoint) window.history.replaceState(state, "", href);
    else if (
      at ||
      here?.mapPoint ||
      href !== location.pathname + location.search + location.hash
    )
      window.history.pushState(state, "", href);
  };
  const selectSpot = (spot: Spot, fly = true) => {
    showSpot(spot, fly);
    fav.visit(spot.id);
    remember(spot.id);
  };
  const showSpot = (spot: Spot, fly = true) => {
    setPicked(null);
    setPoint(spot);
    setFocusId(spot.id);
    if (fly) controls.current?.flyTo(spot);
  };
  /** A tap on the open map: that point's forecast in the dock, and the focus on it. */
  const pickPoint = (at: TappedAt) => {
    showPoint(at);
    remember(null, at);
  };
  const showPoint = (at: TappedAt) => {
    const coords = degrees(at.lat, at.lon);
    setPicked({
      lon: at.lon,
      lat: at.lat,
      name: at.place ?? coords,
      coords: at.place ? coords : "",
      lake: at.lake,
    });
    setFocusId(AT_POINT);
    probeFoil(at.lon, at.lat);
  };
  const clearFocus = () => setFocusId(null);
  /**
   * A tap on the open chart. With a spot or point chosen it lets go of it,
   * as Escape does, and moves nothing: the dock keeps it until another is
   * chosen or it is closed (#109). With none, it picks the point tapped.
   */
  const tapChart = (at: TappedAt) => (focusId ? clearFocus() : pickPoint(at));
  const hideDock = () => {
    setPicked(null);
    setPoint(null);
    setFocusId(null);
  };
  /**
   * The dock's close: no spot nor point, and the chart alone, as a step in
   * the history like a choice (Back opens the dock again).
   */
  const closeDock = () => {
    hideDock();
    remember(null);
  };
  // Back and Forward through the spots and points chosen: the dock follows
  // the link. An entry that already shows what the dock shows changes
  // nothing (the way back from a page over the map lands on one), so the
  // chart is not flown anywhere it was not.
  const popped = useRef(() => {});
  popped.current = () => {
    if (location.pathname !== "/") return;
    const at = (window.history.state as MapEntry | null)?.mapPoint;
    if (at) {
      if (picked?.lon !== at.lon || picked?.lat !== at.lat) showPoint(at);
      return;
    }
    const spot = openingSpot(location.search, spots);
    if (spot) {
      if (picked || point?.id !== spot.id) showSpot(spot);
    } else if (picked || point) hideDock();
  };
  useEffect(() => {
    const pop = () => popped.current();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
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
      const b = map.getBounds();
      setChartView({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
        zoom: map.getZoom(),
      });
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

  // Escape is a tap on the open chart from the keys: it shuts what is open
  // over the chart first (the site menu and the search take theirs before
  // it reaches here), and lets go of the spot or point chosen after.
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
  // Past the end of the reader's run the point goes on in the run the map
  // hands over to there, as a spot's hours go on in ECMWF's past HARMONIE's:
  // read from the reader's run alone, its cells went empty for days.
  const pointHanded = useMemo(
    () =>
      picked && manifest
        ? pointHandovers(
            handable,
            MAP_MODEL_IDS,
            { id: manifest.model, frames: manifest.frames },
            strip,
            clockNow,
          )
        : [],
    [!!picked, handable, manifest, strip, clockNow],
  );
  const series = usePointSeries(
    picked ? manifest : null,
    pickedPoint,
    pointHanded,
  );
  const seriesFailed = !series.named && !series.pending && series.failures > 0;
  useEffect(() => {
    if (seriesFailed && manifest) recoverRun(manifest.model, manifest.run);
  }, [seriesFailed]);
  const pickedHours = useMemo<PlaceHour[] | undefined>(
    () =>
      picked && manifest
        ? handedPointHours(
            manifest.frames,
            series.values,
            series.handed,
            picked,
            axis,
          )
        : undefined,
    [picked, manifest, series.values, series.handed, axis],
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

  /** With no spot chosen there is no dock, and nothing at the chart's foot. */
  const dockOpen = opened && !!dockSpot && strip.length > 0;

  const pointHours: PlaceHour[] | undefined = picked
    ? pickedHours
    : point
      ? hours.get(point.id)
      : undefined;

  const marine = useMarineModels(more && mapReady);
  const focusAt =
    focusId === AT_POINT
      ? picked
      : focusId && point && focusId === point.id
        ? point
        : null;

  /* ---- the loupe's ride rose: the dock's hour, at the focus ---- */
  // What the dock shows, whichever model it comes from, even past the end of
  // the map's run: the rose reads the place, not the map.
  const roseHour =
    focusAt && focusStyle === "loupe" ? pointHours?.[selected] : undefined;
  const roseFacing = picked ? null : (point?.facing ?? null);
  const rose = useMemo(
    () =>
      roseHour ? loupeRose(rider, roseHour, roseFacing, prefs.units) : null,
    [
      roseHour?.windKn,
      roseHour?.gustKn,
      roseHour?.from,
      roseHour?.daylight,
      !!roseHour,
      rider,
      roseFacing,
      prefs.units,
    ],
  );

  /* ---- the hour past the reader's run: the hand-over, or why no wind ---- */
  const reach = manifest && mapTime ? mapReach(manifest.frames, mapAt) : null;
  const beyondMap = !!reach && !reach.drawn;
  /** Where the reader's run stops: said in the label and in the layers. */
  const reachNote =
    manifest && reach && !reach.drawn
      ? `${manifest.modelName} ${reach.side === "after" ? "ends" : "starts"} ${dayShort(Date.parse(reach.edge))} ${clock(Date.parse(reach.edge))}`
      : null;
  /** The model drawn in its place, by name, once it is drawn or on its way. */
  const handoverName =
    beyondMap && (handing || handoverDue)
      ? (handing?.modelName ??
        MODELS.find((m) => m.id === handoverId)?.name ??
        null)
      : null;
  /**
   * When the hand-over starts (or, before the reader's run, when it stops):
   * the first column of the stretch past the reader's run that the same model
   * owns, so the label names the hour the other model's wind begins, not the
   * reader's last.
   */
  const beyond = reach && !reach.drawn ? reach : null;
  const handoverAt = useMemo(
    () =>
      handoverName && beyond ? handoverStart(strip, mapIndex, beyond) : null,
    [handoverName, beyond?.side, beyond?.edge, mapIndex, strip],
  );
  const handoverWhen =
    handoverAt === null ? "" : `${dayShort(handoverAt)} ${clock(handoverAt)}`;
  // Only where nothing can be handed over: the chip lets the reader ask for
  // the run the dock's column comes from, if it could not be read by itself.
  const reachable =
    beyondMap && !handing && !handoverDue && column
      ? (MODELS.find((m) => m.id === column.model) ?? null)
      : null;

  const spotById = useMemo(
    () => new Map(spots.map((s) => [s.id, s] as const)),
    [spots],
  );
  /** A place's hour at the time the map shows, where it is rated. */
  const hourAt = (id: string) => {
    const hour = hours.get(id)?.[selected];
    return hour?.rating ? hour : null;
  };

  const sources = (
    <>
      <ul>
        <li>
          Wind: {manifest?.modelName ?? "HARMONIE"} on the map
          {manifest ? ` (${runLabel(manifest.runTime)} run)` : ""}
          {handing
            ? `, ${handing.modelName} (${runLabel(handing.runTime)} run) at the hours it does not reach`
            : ""}
          ; the stars rate one model&rsquo;s own forecast,{" "}
          {starsFromText(starsFromAt(rider.starsFrom))}, and{" "}
          {prefs.blendModels.length} models give the agreement beside them
        </li>
        <li>Depths: EMODnet Bathymetry, metres below chart datum</li>
        {foilState.manifest && (
          <li>
            Tidal depth: {foilState.manifest.attribution} Heights above LAT
            against the tide predictions below.
          </li>
        )}
        {lidar.index && <li>{lidar.index.attribution}</li>}
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
        <li>
          Tides: Marine Institute predictions (CC BY 4.0); in Northern Ireland,
          wingfoil.ie&rsquo;s own from the Environment Agency&rsquo;s tide
          gauges (Open Government Licence v3.0) and the EOT20 ocean tide model
          (DGFI-TUM, CC BY 4.0)
        </li>
        {layers.currents && (
          <li>
            Currents: the Marine Institute&rsquo;s NE Atlantic ROMS model (CC BY
            4.0), and channels&rsquo; tidal streams from published pilotage
            guides; a rough guide, not for safety
          </li>
        )}
        <li>
          Satellite imagery and intertidal heights:{" "}
          {satellite.attribution ?? SATELLITE_ATTRIBUTION}
        </li>
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

  // The site menu is the one way in to the chart's own tools: Customise
  // first, and the tour last.
  const menuTools = useMemo(
    () => [
      {
        id: "customise",
        label: "Customise",
        glyph: <CustomiseGlyph />,
        onSelect: () => setGuide("customise"),
      },
      ...chartTools(setPanel, setInfo),
      {
        id: "tour",
        label: "Take the tour",
        glyph: <TourGlyph />,
        onSelect: () => setGuide("tour"),
      },
    ],
    [],
  );
  const leaveTour = () => {
    tourSeen();
    setGuide(null);
  };

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
              hourAt={hourAt}
              onPick={(spot) => selectSpot(spot)}
              tools={menuTools}
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
                  selected={selected}
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
                    onCustomiseStars={() => {
                      close();
                      openStars();
                    }}
                    onStarsOn={(next) => {
                      changePrefs(next);
                      // On or off the rider's own: the account keeps that.
                      if (next.starsUpdatedAt !== prefs.starsUpdatedAt)
                        announcePrefs("device");
                    }}
                    models={models.filter(
                      (model) => model.entry.kind === "wind",
                    )}
                    spot={point && !picked ? point : null}
                  />
                </Suspense>
              )}
              onInfo={setInfo}
              windStyle={windStyle}
              onWindStyle={chooseWind}
              layers={layers}
              onLayersChange={(next) => chooseLayers({ ...layers, ...next })}
              satellite={layers.satellite}
              onSatellite={chooseSatellite}
              focusStyle={focusStyle}
              onFocusStyle={chooseFocusStyle}
              satelliteTides={satellite.station}
              satelliteLoading={satelliteLoading}
              model={manifest?.model}
              modelNote={
                reachNote && mapColumn
                  ? handoverName
                    ? `${reachNote}: ${handoverName} is on the map at ${dayShort(mapColumn.time)} ${clock(mapColumn.time)}, and ${manifest?.modelName} comes back within its own hours.`
                    : `${reachNote}: no wind on the map at ${dayShort(mapColumn.time)} ${clock(mapColumn.time)}.${reachable && reachable.id !== manifest?.model ? ` ${reachable.name} reaches it.` : ""}`
                  : null
              }
              currentsNote={currents.note}
              foilNote={foilFar ? FOIL_ZOOM_NOTE : null}
              onResetLayers={() => {
                chooseWind("ink");
                chooseLayers(DEFAULT_LAYERS);
                chooseFocusStyle("ring");
              }}
              modelDisabled={!frame || !!pendingModel}
              onModel={(id) => void chooseModel(id)}
            />
            {/* After the boxes: the keys reach the menu, the search and the
                controls before the lights. */}
            <WindMap
              frame={mapDraws ? frame : null}
              spots={spots}
              lights={lights}
              named={named}
              lightLabel={lightLabel}
              selectedId={picked ? null : (point?.id ?? null)}
              focus={focusAt ? { lon: focusAt.lon, lat: focusAt.lat } : null}
              focusStyle={focusStyle}
              units={prefs.units}
              rose={rose}
              mark={focusAt ? { lon: focusAt.lon, lat: focusAt.lat } : null}
              picked={picked ? { lon: picked.lon, lat: picked.lat } : null}
              covered={() => !!document.querySelector(OVER_THE_CHART)}
              onPick={tapChart}
              windStyle={windStyle}
              layers={layers}
              foil={foilViews}
              currents={currents.features}
              satellite={satellite.image}
              lidar={lidar.view}
              reducedMotion={reducedMotion}
              bottomInset={dockHeight}
              phone={phone}
              onSelect={(spot) => selectSpot(spot)}
              onReady={(c) => {
                controls.current = c;
                setMapReady(!!c);
              }}
              onTilesFailed={(failed) => recoverRun(failed.model, failed.run)}
              onSatelliteLoading={setSatelliteLoading}
            />
            {(status || (loading && frame)) && (
              <div
                className={`frame-status chart-box${modelError || frameError ? " is-error" : ""}`}
                role="status"
              >
                <span>
                  {status ??
                    `Loading ${mapRun && mapTime && !handoverDue ? timeLabel(mapRun.frames[requestedIndex].validTime) : "wind"}…`}
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
            <div
              className={`map-footer${dockOpen ? "" : " is-bare"}`}
              ref={dock}
            >
              {/* The small print rides on the dock's top edge, in the dock's
                  own layout: never a frame behind it (map.css). */}
              <div className="map-print">
                <InfoPop label="Sources and small print" wide>
                  {sources}
                </InfoPop>
                <span
                  className="map-model"
                  data-run-state={staleness}
                  data-reach={
                    handoverName ? "handover" : reachNote ? "beyond" : undefined
                  }
                >
                  {handoverName ? (
                    // "ECMWF on the map from Sat 09:00"; on a phone, where
                    // the spot's tools stand beside it, "ECMWF from Sat 09:00".
                    <>
                      {handoverName}
                      <span className="map-model-more"> on the map</span>
                      {` ${beyond?.side === "before" ? "until" : "from"} ${handoverWhen}`}
                    </>
                  ) : reachNote ? (
                    <>
                      {reachNote}
                      <span className="map-model-more"> · no wind drawn</span>
                    </>
                  ) : (
                    (manifest?.modelName ?? "")
                  )}
                  {staleness === "expired"
                    ? " · archived"
                    : staleness === "stale"
                      ? " · older run"
                      : ""}
                </span>
              </div>
              {/* With no spot chosen there is no dock: the chart has the
                  screen, at the hour the page opened on. */}
              {dockOpen && dockSpot && (
                <ForecastDock
                  spot={dockSpot}
                  isPoint={!!picked}
                  pointSource={pointSource}
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
                  onCustomStars={openStars}
                  onStarsFrom={() => setPanel("options")}
                  models={models}
                  onWantModels={() => setWantModels(true)}
                  starred={
                    !!dockSpot && !picked && starred.includes(dockSpot.id)
                  }
                  onToggleStar={() => dockSpot && fav.toggle(dockSpot.id)}
                  onClose={closeDock}
                  phone={phone}
                  view={picked ? "table" : view}
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
      {starsWanted && (
        <Suspense fallback={null}>
          <YourStarsDialog
            open={starsOpen}
            rider={prefs.rider}
            units={prefs.units}
            onClose={() => setStarsOpen(false)}
            onSave={(custom) => {
              setCustomStars(custom);
              setStarsOpen(false);
            }}
            onDelete={() => {
              setCustomStars(null);
              setStarsOpen(false);
            }}
          />
        </Suspense>
      )}
      {syncAccount && (
        <Suspense fallback={null}>
          <AccountRider />
        </Suspense>
      )}
      {customiseShown && (
        <Suspense fallback={null}>
          <Customise
            open={guide === "customise"}
            prefs={prefs}
            starred={starred}
            spots={spots}
            hours={hours}
            times={strip.map((c) => c.time)}
            prefer={first}
            centre={controls.current?.map.getCenter() ?? null}
            onClose={() => setGuide(null)}
            onSave={(next, toggle) => {
              changePrefs(next);
              if (next.starsUpdatedAt !== prefs.starsUpdatedAt)
                announcePrefs("device");
              toggle.forEach((id) => fav.toggle(id));
              setGuide(null);
            }}
          />
        </Suspense>
      )}
      {guide && guide !== "customise" && (
        <Suspense fallback={null}>
          {guide === "tour" ? (
            <Tour
              phone={phone}
              spot={picked ? null : (point?.id ?? null)}
              onSpot={(id) => {
                const spot = id && spotById.get(id);
                if (spot) showSpot(spot);
                else hideDock();
              }}
              view={view}
              onView={setView}
              focusStyle={focusStyle}
              onFocusStyle={setFocusStyle}
              onPanel={setPanel}
              onEnd={(customise) => {
                tourSeen();
                setGuide(customise ? "customise" : null);
              }}
            />
          ) : (
            mapReady &&
            !dockOpen && (
              <TourPrompt onTour={() => setGuide("tour")} onNo={leaveTour} />
            )
          )}
        </Suspense>
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
              changePrefs({
                ...prefs,
                rider: parseRider({ ...prefs.rider, ...r }),
              })
            }
            // Over the spot's tools on the dock's edge, while there is a dock.
            launcherBottom={dockHeight + (dockOpen ? 72 : 24)}
            panelBottom={dockHeight + 12}
          />
        </Suspense>
      )}
      {infoShown && (
        <Suspense fallback={null}>
          <MapInfo
            at={infoShown}
            open={info !== null}
            onClose={() => setInfo(null)}
            scale={scale}
            rider={rider}
            starsFrom={starsFromAt(rider.starsFrom)}
            blendModels={prefs.blendModels}
            spotId={picked ? null : (point?.id ?? null)}
            foil={{
              on: layers.foil,
              far: foilFar,
              area: foilArea,
              station: foilStation,
              tide: foilArea ? (foilTides[foilArea.id]?.water ?? null) : null,
              sea: foilArea?.level
                ? (foilTides[foilArea.id]?.sea ?? null)
                : null,
              when:
                foilTime !== null
                  ? `${dayShort(foilTime)} ${clock(foilTime)}`
                  : "",
              readout: foilProbeText,
              error: foilState.error,
              floor: foilState.manifest?.floorMetres,
            }}
            lidar={
              // Off, its key's code is not loaded either.
              layers.lidar ? (
                <Suspense fallback={null}>
                  <LidarKey index={lidar.index} error={lidar.error} />
                </Suspense>
              ) : (
                <div className="foil-key" data-lidar-key>
                  <p className="foil-at">
                    Off. Turn it on in Layers, under Ground:
                    &ldquo;LiDAR&rdquo;.
                  </p>
                </div>
              )
            }
            sources={sources}
            satellite={satellite.note}
            satelliteError={satellite.error}
            satelliteTides={satellite.station}
          />
        </Suspense>
      )}
    </div>
  );
  // The "?"s by the stars, in the dock and the panel, open the dialog too.
  return <MapInfoOpen.Provider value={setInfo}>{shell}</MapInfoOpen.Provider>;
}
