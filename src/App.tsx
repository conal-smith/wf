// The map's own stylesheets, in its chunk: src/main.tsx lazy-loads this file,
// and the other sections never ask for MapLibre's CSS or the chart's.
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import "./dock.css";
import "./panels.css";
import {
  lazy,
  memo,
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
import { List as ListGlyph, Map as MapGlyph, Maximize2, X } from "lucide-react";
import { Button } from "../ui/Button";
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
import { useRain } from "./useRain";
import type { LightState } from "../force5/src/lights";
import { speedWords } from "../force5/src/units";
import { rideWedge } from "../force5/src/rideWedge";
import { parseWindLayers, type WindLayers } from "../force5/src/windLayer";
import { isFocusStyle, loupeRose, type FocusStyle } from "../force5/src/focus";
import ForecastDock, { type DockView } from "./ForecastDock";
import MapControls, { type MapPanel } from "./MapControls";
import MapHead from "./MapHead";
import { LAYER_DEFAULTS } from "./layerGroups";
import { tourOffered, tourSeen } from "./tourOffer";
import { SiteMenu } from "../force5/src/SiteMenu";
import {
  CHART_HREF,
  FINDER_HREF,
  MAP_ASKS,
  OLD_SETTINGS_PARAM,
  asksSettings,
  isChartAddress,
  mapAsk,
  type MapAsk,
  mapSpotHref,
  tidySearch,
} from "../force5/src/siteNav";
import { MAP_ASK_EVENT } from "./PagesOverMap";
import { saveChartCentre } from "./lastView";
import { InfoPop } from "./InfoPop";
import useRunRefresh, {
  loadNewerRun,
  RunRecovery,
  type RunSwap,
} from "./useRunRefresh";
import {
  useMarineModels,
  useModelAvailability,
  usePointTide,
  useSpotTide,
} from "./useBlend";
import { useRatings } from "./useRatings";
import { ALL_SQUARES, useSpotSquaresState } from "./useSpotSquares";
import { blendColumnModels, trustedSpotBlend } from "./spotBlend";
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
  dayLong,
  dayShort,
  irishDate,
  nearestColumn,
  openingColumn,
  stripColumns,
  stripDays,
} from "./strip";
import { ridingLocations } from "./locations";
import { openingSpot, spotAddress } from "./openingSpot";
import {
  clipTo,
  fitPadding,
  inView,
  panelRect,
  spotsBounds,
  type Rect,
} from "./chartPanel";
import { storedMapModel, takeEarly } from "../force5/src/boot";
import {
  loadManifest,
  MANIFEST_REVALIDATE_MS,
  ManifestUnavailableError,
} from "../force5/src/manifests";
import { runLabel } from "../force5/src/revalidate";
import { chosenModel, leadText, starsFromAt } from "../force5/src/lead";
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
// The account's copy of the rider, on a device that has signed in before.
const AccountRider = lazy(() => import("../shared/web/AccountRider"));
// The spot finder, the home page, drawn from the chart's own rated hours, in
// a chunk of its own.
// Drawn again only when what it is given changes: not with every move of the
// chart beside it, nor every frame it loads.
const SpotFinder = lazy(() =>
  import("./finder/SpotFinder").then((m) => ({ default: memo(m.default) })),
);
// The chart itself, and MapLibre with it: a chunk of its own, so the list
// on the home page is drawn before the map is downloaded and read. An
// address that opens on the full chart asks for it at once.
const loadWindMap = () => import("../force5/src/WindMap");
const WindMap = lazy(loadWindMap);
if (isChartAddress(window.location)) void loadWindMap();
// Settings and the tour, each only when asked for; the tour's offer only on
// a first visit (src/tourOffer.ts).
const Settings = lazy(() => import("./Settings"));
const Tour = lazy(() => import("./Tour"));
const TourPrompt = lazy(() => import("./TourPrompt"));
import type { MapAction } from "../companion/shared/protocol";
import { parseRider, withRiderModel } from "../force5/src/prefs";
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
import { useWarnings } from "./useWarnings";
import { placeWarnings } from "../force5/src/warnings";
import { useWaterQuality } from "./useWaterQuality";
import { spotWaterQuality } from "../force5/src/waterQuality";
import { favourites } from "../shared/web/favourites";
import {
  compass,
  freshness,
  nearestFrame,
  timeLabel,
  type Frame,
  type Manifest,
  type Spot,
} from "../force5/src/weather";
import { loadFrame } from "../force5/src/tiledField";
import {
  defaultPrefs,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "../force5/src/prefs";

/** The wind's two layers, the coloured wind and the particles, as JSON. */
const WIND_KEY = "wingfoil.map.wind.v2";
/**
 * The wind's one style of three, as the chart kept it until 2026-10-25: read
 * once into the two layers (windLayer.ts `parseWindLayers`) while there is
 * nothing under the new key, and left where it is.
 */
const OLD_WIND_KEY = "wingfoil.map.wind.v1";
const LAYERS_KEY = "wingfoil.map.layers.v1";
const FOCUS_KEY = "wingfoil.map.focus.v1";
const MORE_KEY = "wingfoil.map.more.v1";
/** The layers' rail, open or shut on this device. */
const RAIL_KEY = "wingfoil.map.rail.v1";
/** The focus is on the point tapped on the map, not a riding place. */
const AT_POINT = "@point";
/**
 * What is open over the chart and shuts on a press away from it: the site
 * menu and the search's list in the head, each said open on the control it
 * hangs from, and the layers, the options or the map's
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
/** Beside the list a light's name shows under the pointer, not for a star. */
const NO_NAMES: ReadonlySet<string> = new Set();
/** Room for the chart beside the spot finder's list, as the home page has it. */
const SPLIT = "(min-width: 1100px)";
/** How long the chart takes to open out from beside the list, or back. */
const OPEN_MS = 420;

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

/** The chart's defaults (src/layerGroups.tsx). */
const DEFAULT_LAYERS: MapLayers = {
  ...LAYER_DEFAULTS.layers,
  satellite: LAYER_DEFAULTS.satellite,
};

/**
 * Runs `then` once the next frame is painted: a frame's own callbacks run
 * before its paint, and a task queued from one runs after it.
 */
const afterPaint = (then: () => void) =>
  requestAnimationFrame(() => window.setTimeout(then));

/**
 * The first stop for the keys on the list and the chart, out of sight until
 * it has the focus: past the menu and the chart's lights to what the page is
 * for (#222). On the full chart, the forecast in the dock, or with none open
 * the search, which finds a spot by its name without the chart.
 */
const SKIP = {
  list: { label: "Skip to the spots", to: "[data-finder-list]" },
  dock: { label: "Skip to the forecast", to: ".dock" },
  search: { label: "Skip to the search", to: '.map-head [role="combobox"]' },
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

/** The spot finder, the home page, or the full chart opened over it. */
type Page = "finder" | "chart";

/** The state of a history entry: how many steps on from the list it is. */
interface ListEntry {
  fromList?: number;
}

export default function App() {
  /**
   * The spot finder, the home page, with the chart beside it on a wide
   * screen; or the full chart, the same chart opened out over the whole
   * screen (`/?map`, or a spot's `/?spot=keel`). One app, one set of data,
   * and one map, which is never taken down once it is made: the panel
   * beside the list and the full chart are the same map in a bigger box.
   */
  const [page, setPage] = useState<Page>(() =>
    isChartAddress(window.location) ? "chart" : "finder",
  );
  const pageRef = useRef(page);
  pageRef.current = page;
  /** Room for the chart beside the list. */
  const split = useMedia(SPLIT);
  const splitRef = useRef(split);
  splitRef.current = split;
  /**
   * Whether the map is made. Beside the list, once the list is drawn and the
   * page has a moment; under that width, the first time the chart is opened.
   * Once made it is kept.
   */
  const [mapWanted, setMapWanted] = useState(page === "chart");
  const [finderDrawn, setFinderDrawn] = useState(false);
  /** The map is made, and knows what it shows (force5/src/WindMap.tsx). */
  const [mapMade, setMapMade] = useState(false);
  useEffect(() => {
    if (mapWanted) return;
    if (page === "chart") return setMapWanted(true);
    if (!split || !finderDrawn) return;
    const idle =
      window.requestIdleCallback ??
      ((f: () => void) => window.setTimeout(f, 300));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => setMapWanted(true), { timeout: 1500 });
    return () => cancel(handle);
  }, [mapWanted, page, split, finderDrawn]);
  /** The places the spot finder lists, which it needs rated first. */
  const [finderWant, setFinderWant] = useState<readonly string[]>([]);
  /** Which list it is (Favourites, Near you), for the chart beside it to fit. */
  const [finderScope, setFinderScope] = useState<string>("");
  /** The time the cards show, which the lights beside them show too. */
  const [finderShown, setFinderShown] = useState<number | null>(null);
  /** Where the rider is, once their browser has said: the blue dot. */
  const [riderAt, setRiderAt] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  useEffect(() => setPrefs(loadPrefs()), []);
  // A rating adopted from the account, or changed in another tab.
  useEffect(() => onPrefsChange(() => setPrefs(loadPrefs())), []);
  const changePrefs = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  const [syncAccount] = useState(
    () => signedInHint() || Boolean(import.meta.env.VITE_MARKET_DEV_USER),
  );
  const rider = prefs.rider;
  // The one model the rider picked: the map draws it, the dock gives its wind
  // and the stars rate it, ECMWF past the end of its run (force5/src/lead.ts).
  const riderModel = chosenModel(rider.starsFrom) as ModelId;
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
  /** The display options, in a dialog over the map. */
  const [panel, setPanel] = useState<MapPanel>(null);
  // The layers' rail, the one way to the layers: Layers opens and shuts it,
  // and this device keeps it as it was left.
  const [railOpen, setRailOpen] = useState(() => store.get(RAIL_KEY) === "1");
  const pressLayers = () => {
    setRailOpen(!railOpen);
    store.set(RAIL_KEY, railOpen ? "0" : "1");
  };
  /** The information dialog's part to open at, or null while it is shut. */
  const [info, setInfo] = useState<InfoSection | null>(null);
  /** The part it is drawn at: kept while it fades out, once shut. */
  const infoShown = useFadeOut(info);
  /** Settings, the tour, or the first visit's offer of it, over the chart. */
  const [guide, setGuide] = useState<"offer" | "tour" | "settings" | null>(
    () =>
      asksSettings(location) ? "settings" : tourOffered() ? "offer" : null,
  );
  /** Settings is kept while it fades out, once shut. */
  const settingsShown = useFadeOut(guide === "settings");
  const [view, setView] = useState<DockView>("table");
  const [wind, setWind] = useState<WindLayers>(() =>
    parseWindLayers(store.get(WIND_KEY), store.get(OLD_WIND_KEY)),
  );
  const [layers, setLayers] = useState<MapLayers>(() => {
    try {
      // The LiDAR layer was taken off on 2026-10-24: a rider's stored choice
      // of it is dropped, and goes from the store with their next change.
      const { lidar: _lidar, ...saved } = JSON.parse(
        store.get(LAYERS_KEY) ?? "{}",
      );
      return {
        ...DEFAULT_LAYERS,
        ...saved,
        satellite: parseSatelliteOption(saved.satellite),
      };
    } catch {
      return DEFAULT_LAYERS;
    }
  });
  const chooseWind = (next: WindLayers) => {
    setWind(next);
    store.set(WIND_KEY, JSON.stringify(next));
  };
  /** The mark round the chosen spot: the range ring unless the rider chose otherwise. */
  const [focusStyle, setFocusStyle] = useState<FocusStyle>(() => {
    const saved = store.get(FOCUS_KEY);
    return isFocusStyle(saved) ? saved : LAYER_DEFAULTS.focusStyle;
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
  // The list under the full chart: drawn at once on the home page, and on a
  // link to the chart once the chart is up and the page has a moment, so
  // its pictures and readings never hold the chart back. Kept once drawn.
  const finderSeen = useRef(false);
  if (page === "finder" || gustDue) finderSeen.current = true;

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
  // A link to a spot that is not on the map (`/?spot=does-not-exist`): the
  // chart opens as it would with none, and says so until dismissed or a
  // spot is chosen, so the rider knows the link was wrong (#225).
  const [missingSpot, setMissingSpot] = useState<string | null>(null);
  useEffect(() => {
    if (point) setMissingSpot(null);
  }, [point]);

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
      // download and one parse of the map's model, not one each. The rider's
      // model, as the page's head asked for it (force5/src/boot.ts); HARMONIE
      // if theirs cannot be read, and the map says so when it tries again.
      (async () => {
        const first = storedMapModel();
        try {
          return await loadManifest(first, controller.signal);
        } catch (e) {
          if (first === "harmonie" || controller.signal.aborted) throw e;
          return loadManifest("harmonie", controller.signal);
        }
      })().catch((e) => {
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
        const asked = new URLSearchParams(location.search).get("spot");
        if (asked && !linked) setMissingSpot(asked);
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
  // The published blend rates HARMONIE, then ECMWF: a rider who picked
  // another model gets their hours worked out here, from the models. Which
  // models they put in the blend moves no star, so it never matters here.
  const pointer = trustedSpotBlend(
    spotBlend.blend,
    clockNow,
    starsFromAt(rider.starsFrom),
  );
  // The lights read the spot squares in view, once the camera settles, and
  // the open spot's and the reader's own wherever they are: never every place.
  const mapView = useViewBounds(mapReady ? controls.current?.map : null);
  // With no spot open, that is the squares in view and the reader's own, and
  // the places the spot finder lists.
  const finderIds = finderWant;
  const ownPlaces = useMemo(() => {
    const ids = new Set([
      ...(point ? [point.id] : []),
      ...starred,
      ...frequent.map((v) => v.id),
      ...finderIds,
    ]);
    return spots.filter((spot) => ids.has(spot.id));
  }, [spots, point?.id, starred, frequent, finderIds]);
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
    wantModels || (spotBlend.resolved && !published),
    riderModel,
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
    // (the run's first, and its prefetch) would only be thrown away. And
    // none before there is a map to draw it, with its view (a phone on the
    // list has none): before that, a frame is read for the whole grid.
    if (!mapRun || pendingModel || !mapTime || !mapMade) return;
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
    mapMade,
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
      if (!controller.signal.aborted) {
        setModelError(
          `Could not switch to ${MODELS.find((m) => m.id === id)?.name}. ${manifest.modelName} is still shown. ${e instanceof Error ? e.message : ""}`,
        );
        stayOn(manifest.model);
      }
    } finally {
      if (modelRequest.current === controller) setPendingModel(null);
    }
  };
  /**
   * A switch that failed or was cancelled: the rider's model is the one still
   * drawn, so the stars never rate a model the map is not showing.
   */
  const stayOn = (model: string) =>
    setPrefs((was) => {
      if (chosenModel(was.rider.starsFrom) === model) return was;
      const next = { ...was, rider: withRiderModel(was.rider, model) };
      savePrefs(next);
      return next;
    });
  /**
   * The rider picks a model: theirs from now on, for the map, the dock and the
   * stars alike, and the map moves to it (at `wanted`, where given).
   */
  const pickRiderModel = (id: ModelId, wanted?: string) => {
    if (id !== riderModel)
      changePrefs({ ...prefs, rider: withRiderModel(prefs.rider, id) });
    void chooseModel(id, wanted);
  };
  // A model picked elsewhere (the display options, the account, another tab)
  // moves the map to it too. Once per change: a run that cannot be read leaves
  // the map on the one it had, says so, and the rider back on it (`stayOn`).
  useEffect(() => {
    if (!manifest || !frame) return;
    if (manifest.model === riderModel || pendingModel === riderModel) return;
    void chooseModel(riderModel);
  }, [riderModel, !!frame]);
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
        county: s.county,
      })),
    [spots],
  );
  const first = useMemo(
    () => [
      ...finderIds,
      ...(point ? [point.id] : []),
      ...starred,
      ...frequent.map((v) => v.id),
    ],
    [point?.id, starred, frequent, finderIds],
  );
  // Without the published blend (another model picked, or none published) the
  // same squares are read from every wind model; with it, none of them.
  const windOnly = useMemo(
    () => models.filter((model) => model.wind !== null),
    [models],
  );
  const ownSquares = useMemo(() => {
    const listed = windOnly.flatMap((model) => model.wind!.spots.squares);
    return published ? null : squaresToRead(mapView, listed, ownPlaces);
  }, [published, mapView, windOnly, ownPlaces]);
  // `rated.squares` is what was read, not what was asked: a square some model
  // could not read keeps its places pending, and the rest are rated.
  const rated = useSpotSquaresState(windOnly, ownSquares, true);
  const warnings = useWarnings();
  const water = useWaterQuality();
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
    warnings,
    water,
  );
  // Beside the list, the lights are at the hour the cards show; on the full
  // chart, at the chart's own.
  const panelAt = useMemo(
    () =>
      finderShown === null || !strip.length
        ? selected
        : nearestColumn(strip, finderShown),
    [strip, finderShown, selected],
  );
  const lightAt = page === "chart" ? selected : panelAt;
  const lights = useMemo(() => {
    const out = new Map<string, LightState>();
    // The riding wedge is the open spot's alone: on every light at once it
    // buried the chart, and it is a reading of one place, not an overview.
    // Under the loupe it goes: the rose is the same thing, bigger.
    const open = picked ? null : (point?.id ?? null);
    const loupeOn = focusStyle === "loupe" && !!open && focusId === open;
    for (const spot of spots) {
      const row = hours.get(spot.id);
      const hour = row?.[lightAt];
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
    lightAt,
    rider,
    picked,
    point?.id,
    focusStyle,
    focusId,
  ]);
  const named = useMemo(() => new Set(starred), [starred]);
  const column = strip[selected];
  const lightColumn = strip[lightAt];
  const lightLabel = useCallback(
    (spot: Spot, s: LightState | undefined) =>
      `${spot.name}${spot.county ? `, ${spot.county}` : ""}${
        !s || s.pending
          ? ""
          : `: ${lightColumn ? clock(lightColumn.time) : ""} ${
              s.dark || s.stars === null
                ? "dark"
                : `${s.stars} star${s.stars === 1 ? "" : "s"}`
            }${s.compass && s.windKn !== null ? `, ${s.compass} ${speedWords(s.windKn, prefs.units)}` : ""}${
              s.mark === "struck"
                ? ", offshore"
                : s.mark === "cross-off"
                  ? ", cross-offshore"
                  : ""
            }`
      }`,
    [lightColumn?.time, prefs.units],
  );

  /* ---- the satellite image under the chart ---- */
  // Its index and code load the first time an image is chosen; then only the
  // areas in view are drawn. The station nearest the map's centre gives the
  // key the tide each image was taken at.
  const satellite = useSatellite(layers.satellite, chartView);
  const chooseSatellite = (option: SatelliteOption) =>
    chooseLayers({ ...layers, satellite: option });

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
  // The Rain layer at the hour the map shows: the rain of that column's own
  // hours, from the column before it, as the dock's rain row reads it.
  const rain = useRain(
    layers.rain,
    mapAt,
    mapIndex > 0 ? (strip[mapIndex - 1]?.time ?? null) : null,
  );
  const rainLine = rain.view
    ? `Shown: the rain ${dayShort(rain.view.from)} ${clock(rain.view.from)} to ${clock(rain.view.to)}${
        rain.view.to - rain.view.from > 3600000 ? ", per hour" : ""
      }.`
    : rain.note;
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
  const spotTide = useSpotTide(picked ? undefined : point?.id);
  // A tapped point takes its nearest station's tide, as a spot is linked to one.
  const pointTide = usePointTide(picked);
  const tide = picked ? pointTide : spotTide;
  // The riding place a point borrows its waves, weather and sea from: the
  // nearest on the same water (a lake's for a lake), within 15 km.
  const pointSource = useMemo(
    () =>
      picked
        ? nearestSpotOnWater(spots, picked.lat, picked.lon, {
            lake: picked.lake,
            freshwater: pointTide.manifest
              ? freshwaterSpots(pointTide.manifest)
              : null,
          })
        : null,
    [picked, spots, pointTide.manifest],
  );
  /**
   * Each spot chosen is a step in the page's history, with the spot in its
   * link (`/?spot=keel`, src/openingSpot.ts): the link can be shared, Back
   * goes to the spot before or, from the first, closes the dock, and Forward
   * comes back. A tapped point is a step too, with the full chart's own link
   * (`/?map`), and the point in the entry's state; a tap after a tap only
   * moves it. Each step counts how far it is from the list the chart was
   * opened from, if it was (`fromList`), so the List button goes back to it.
   */
  const remember = (id: string | null, at?: TappedAt) => {
    const href = spotAddress(location.href, id);
    const here = window.history.state as (MapEntry & ListEntry) | null;
    const steps = here?.fromList;
    const state: MapEntry & ListEntry = at ? { mapPoint: at } : {};
    if (at && here?.mapPoint)
      window.history.replaceState(
        steps ? { ...state, fromList: steps } : state,
        "",
        href,
      );
    else if (
      at ||
      here?.mapPoint ||
      href !== location.pathname + location.search + location.hash
    )
      window.history.pushState(
        steps ? { ...state, fromList: steps + 1 } : state,
        "",
        href,
      );
  };
  /**
   * A light pressed on the full chart. It is drawn as the open spot's at once,
   * and the dock, the flight and the step in the history wait until that is
   * painted, the dock drawn as a transition: drawn in the tap's own task, they
   * held its answer back by a third of a second and more (#250).
   */
  const openLight = (spot: Spot) => {
    controls.current?.choose(spot.id);
    afterPaint(() => startTransition(() => selectSpot(spot)));
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
   * Beside the list the chart picks nothing: it has no dock there.
   */
  const tapChart = (at: TappedAt) => {
    if (pageRef.current !== "chart") return;
    if (focusId) clearFocus();
    else pickPoint(at);
  };
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

  /* ---- the list and the full chart ---- */
  // On a wide screen the chart stands beside the list, in the room the list
  // leaves it under its head (src/chartPanel.ts); opened out, it is the same
  // map in a box the size of the screen, drawn as the chart was before it
  // had a list. The box grows, or shrinks back, under a clip that moves with
  // the compositor, and the map takes its new size once: at the start going
  // out, at the end coming back.
  const workspace = useRef<HTMLElement>(null);
  const [finderHead, setFinderHead] = useState<HTMLElement | null>(null);
  const [panelBox, setPanelBox] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!finderHead) return;
    const measure = () =>
      setPanelBox(
        panelRect(
          window.innerWidth,
          window.innerHeight,
          finderHead.getBoundingClientRect().bottom,
        ),
      );
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(finderHead);
    window.addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [finderHead]);
  const panelRef = useRef(panelBox);
  panelRef.current = panelBox;
  /** The panel the chart is opening out from, and its middle, until the next layout. */
  const opening = useRef<{
    from: Rect;
    middle: { lng: number; lat: number };
  } | null>(null);
  /** The chart shrinking back beside the list. */
  const closing = useRef<Animation | null>(null);
  /** The list showing under the full chart as it shrinks back beside it. */
  const [revealing, setRevealing] = useState(false);
  /** Where the middle of the panel stood on the full chart, coming back. */
  const backTo = useRef<{ lng: number; lat: number } | null>(null);
  const motionRef = useRef(reducedMotion);
  motionRef.current = reducedMotion;
  /** The full chart, out of the list: grown from beside it on a wide screen. */
  const toChart = () => {
    // Asked for again while it shrinks back: it stays as it is.
    if (closing.current) {
      closing.current.cancel();
      closing.current = null;
      backTo.current = null;
      setRevealing(false);
      return;
    }
    if (pageRef.current === "chart") return;
    const from = panelRef.current;
    const map = controls.current?.map;
    if (splitRef.current && map && from) {
      const { lng, lat } = map.getCenter();
      opening.current = { from, middle: { lng, lat } };
    }
    setPage("chart");
  };
  /** The list, the chart beside it again on a wide screen. No dock there. */
  const toList = () => {
    if (pageRef.current !== "chart" || closing.current) return;
    hideDock();
    setPanel(null);
    const el = workspace.current;
    const map = controls.current?.map;
    const to = panelRef.current;
    if (!splitRef.current || !el || !map || !to) return setPage("finder");
    const middle = map.unproject([
      to.left + to.width / 2,
      to.top + to.height / 2,
    ]);
    backTo.current = { lng: middle.lng, lat: middle.lat };
    if (motionRef.current || !el.animate) return setPage("finder");
    const shrink = el.animate(
      [
        { clipPath: "inset(0px 0px 0px 0px round 0px)" },
        {
          clipPath: clipTo(to, window.innerWidth, window.innerHeight, 18),
        },
      ],
      {
        duration: OPEN_MS,
        easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        fill: "forwards",
      },
    );
    closing.current = shrink;
    setRevealing(true);
    shrink.finished.then(
      () => {
        if (closing.current === shrink) setPage("finder");
      },
      () => {},
    );
  };
  useLayoutEffect(() => {
    const el = workspace.current;
    const map = controls.current?.map;
    if (page === "chart") {
      const open = opening.current;
      opening.current = null;
      if (!open || !el || !map) return;
      const { from, middle } = open;
      // As the map takes the whole screen, what was in the panel stays where
      // it was, and glides to the middle of the screen as the box opens
      // round it.
      const shift = () => {
        map.panBy(
          [
            window.innerWidth / 2 - (from.left + from.width / 2),
            window.innerHeight / 2 - (from.top + from.height / 2),
          ],
          { duration: 0 },
        );
        map.easeTo({
          center: middle,
          duration: motionRef.current ? 0 : OPEN_MS,
          easing: (t) => 1 - (1 - t) ** 3,
        });
      };
      map.once("resize", shift);
      window.setTimeout(() => map.off("resize", shift), OPEN_MS);
      if (motionRef.current || !el.animate) return;
      el.animate(
        [
          {
            clipPath: clipTo(from, window.innerWidth, window.innerHeight, 18),
          },
          { clipPath: "inset(0px 0px 0px 0px round 0px)" },
        ],
        { duration: OPEN_MS, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
      );
      return;
    }
    // Back beside the list: the clip goes as the box takes the panel's size,
    // in the same frame, and the map, resized, stands where the panel showed
    // it, then fits the places on the list.
    closing.current?.cancel();
    closing.current = null;
    setRevealing(false);
    const middle = backTo.current;
    backTo.current = null;
    if (!middle || !map) return;
    fitted.current = fitKey;
    const settle = () => {
      map.jumpTo({ center: middle });
      fitList(600);
    };
    map.once("resize", settle);
    window.setTimeout(() => map.off("resize", settle), 200);
  }, [page]);

  // Back and Forward through the spots and points chosen: the dock follows
  // the link, and between the list and the full chart, the page does. An
  // entry that already shows what the dock shows changes nothing (the way
  // back from a page over the map lands on one), so the chart is not flown
  // anywhere it was not.
  const popped = useRef(() => {});
  popped.current = () => {
    if (location.pathname !== "/") return;
    if (!isChartAddress(location)) {
      toList();
      return;
    }
    toChart();
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
    const map = controls.current?.map;
    // The full chart opens on the whole of Ireland; beside the list, the
    // chart is fitted to the places on it (below).
    if (pageRef.current === "chart") controls.current?.fitIreland(0);
    if (!map) return;
    const update = (moved?: unknown) => {
      const c = map.getCenter();
      // The finder's "near you" falls back on where the full chart was
      // centred; the whole of Ireland as it opens is nowhere in particular,
      // and the chart beside the list is wherever the list put it.
      if (moved && pageRef.current === "chart")
        saveChartCentre({ lat: c.lat, lon: c.lng });
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

  /* ---- the chart beside the list ---- */
  /** The places on the list, the only lights the chart beside it shows. */
  const listedSpots = useMemo(() => {
    const ids = new Set(finderWant);
    return spots.filter((spot) => ids.has(spot.id));
  }, [spots, finderWant]);
  /**
   * The chart beside the list is fitted to the places on it as it first
   * shows them, and again when the list changes between Favourites and Near
   * you, or the rider's place comes in: never on a hover.
   */
  const fitKey = `${finderScope}|${riderAt ? "rider" : ""}`;
  const fitted = useRef<string | null>(null);
  const fitList = (duration: number) => {
    const map = controls.current?.map;
    const bounds = spotsBounds(listedSpots);
    if (!map || !bounds) return;
    map.fitBounds(bounds, {
      padding: fitPadding,
      maxZoom: 11,
      duration: reducedMotion ? 0 : duration,
    });
  };
  useEffect(() => {
    if (!mapReady || page !== "finder" || !split || !listedSpots.length) return;
    if (fitted.current === fitKey) return;
    const first = fitted.current === null;
    fitted.current = fitKey;
    fitList(first ? 0 : 600);
  }, [mapReady, page, split, fitKey, listedSpots]);
  /** A card under the pointer: its light lit, and brought into view if it is not. */
  const hoverTimer = useRef(0);
  const hoverCard = useCallback(
    (id: string | null) => {
      controls.current?.light(id);
      window.clearTimeout(hoverTimer.current);
      if (!id || pageRef.current !== "finder" || !splitRef.current) return;
      // A moment's wait, so the pointer passing over the cards on its way
      // does not throw the chart about; the zoom is never changed.
      hoverTimer.current = window.setTimeout(() => {
        const map = controls.current?.map;
        const spot = spotById.get(id);
        if (!map || !spot) return;
        const at = map.project([spot.lon, spot.lat]);
        const box = map.getContainer();
        if (inView(at.x, at.y, box.clientWidth, box.clientHeight)) return;
        map.easeTo({
          center: [spot.lon, spot.lat],
          duration: motionRef.current ? 0 : 250,
        });
      }, 120);
    },
    [spots],
  );
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const cardOf = (id: string) =>
    document.querySelector<HTMLElement>(`[data-spot-card="${CSS.escape(id)}"]`);
  /** A light under the pointer beside the list: its card is outlined. */
  const hoverLight = (spot: Spot | null) => {
    if (pageRef.current !== "finder") return;
    document
      .querySelectorAll("[data-spot-card][data-lit]")
      .forEach((el) => el.removeAttribute("data-lit"));
    // An attribute React does not write, so a card drawn again keeps it.
    if (spot) cardOf(spot.id)?.setAttribute("data-lit", "");
    controls.current?.light(spot?.id ?? null);
  };
  /** A light pressed beside the list: the list scrolls to its card. */
  const showCard = (spot: Spot) => {
    const card = cardOf(spot.id);
    if (!card) return;
    card.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
  };
  // The wind's particles hold still while the list scrolls beside them, so
  // the page's frames are the list's, and run again once it stops.
  useEffect(() => {
    if (!mapReady) return;
    let timer = 0;
    const scrolled = (event: Event) => {
      if (
        pageRef.current !== "finder" ||
        !(event.target instanceof Element) ||
        !event.target.closest("[data-spot-finder]")
      )
        return;
      controls.current?.pauseWind(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => controls.current?.pauseWind(false), 200);
    };
    document.addEventListener("scroll", scrolled, {
      capture: true,
      passive: true,
    });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("scroll", scrolled, { capture: true });
      controls.current?.pauseWind(false);
    };
  }, [mapReady]);

  // Escape is a tap on the open chart from the keys: it shuts what is open
  // over the chart first (the site menu and the search take theirs before
  // it reaches here), then lets go of the spot or point chosen, then closes
  // the dock, and then, from the full chart, goes back to the list.
  const escaped = useRef(() => {});
  escaped.current = () => {
    if (panel) setPanel(null);
    else if (pageRef.current !== "chart") return;
    else if (focusId) clearFocus();
    else if (dockOpen) closeDock();
    else openList();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      escaped.current();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

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

  /**
   * With no spot chosen there is no dock, and nothing at the chart's foot;
   * and there is none beside the list, only on the full chart.
   */
  const dockOpen = opened && !!dockSpot && strip.length > 0 && page === "chart";
  // The riding place's Met Éireann warnings, for the dock's strip: the same
  // file and rule its stars were worked out with (src/useRatings.ts).
  const dockWarnings = useMemo(
    () =>
      dockSpot && !picked
        ? placeWarnings(warnings, dockSpot, clockNow).warnings
        : [],
    [warnings, dockSpot, picked, clockNow],
  );
  // And its bathing water notices, the same way.
  const dockWater = useMemo(
    () =>
      dockSpot && !picked
        ? spotWaterQuality(water, dockSpot.id, clockNow).notices
        : [],
    [water, dockSpot, picked, clockNow],
  );

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
          ; the stars rate one model&rsquo;s own forecast, the one you picked:{" "}
          {leadText(starsFromAt(rider.starsFrom))} past the end of its run. The
          blend of {prefs.blendModels.length} models is context beside them and
          moves no star
        </li>
        <li>Depths: EMODnet Bathymetry, metres below chart datum</li>
        {foilState.manifest && (
          <li>
            Tidal depth: {foilState.manifest.attribution} Heights above LAT
            against the tide predictions below.
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
        <li>
          Tides: Marine Institute predictions (CC BY 4.0); in Northern Ireland,
          wingfoil.ie&rsquo;s own from the Environment Agency&rsquo;s tide
          gauges (Open Government Licence v3.0) and the EOT20 ocean tide model
          (DGFI-TUM, CC BY 4.0)
        </li>
        {layers.rain && (
          <li>
            Rain: Deutscher Wetterdienst&rsquo;s ICON-EU model (CC BY 4.0), the
            rain in each hour
          </li>
        )}
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

  const missingStatus =
    missingSpot === null ? null : `Spot not found: “${missingSpot}”.`;
  const status = pendingModel
    ? `Loading ${MODELS.find((m) => m.id === pendingModel)?.name}…`
    : modelError || modelNotice
      ? modelError || modelNotice
      : frameError
        ? frameError
        : missingStatus;

  /* ---- the ways between the list and the full chart ---- */
  /**
   * The full chart, from the list: the Full chart button, the Map button,
   * the menu's Chart. A step in the history, so Back is the list again. It
   * opens at the hour the cards showed, as the lights beside them did.
   */
  const openChart = () => {
    if (pageRef.current === "chart") return;
    if (panelAt !== selected) selectColumn(panelAt);
    window.history.pushState(
      { fromList: 1 } satisfies ListEntry,
      "",
      CHART_HREF,
    );
    toChart();
  };
  /**
   * The list, from the full chart: the List button, the collapse, Escape,
   * the menu's Spot finder. Back through the steps taken since the list,
   * where the chart was opened from it; else a step on to it.
   */
  const openList = () => {
    if (pageRef.current !== "chart") return;
    const steps = (window.history.state as ListEntry | null)?.fromList;
    if (steps) {
      window.history.go(-steps);
      return;
    }
    window.history.pushState({}, "", FINDER_HREF);
    toList();
  };
  const openListRef = useRef(openList);
  openListRef.current = openList;
  const openChartRef = useRef(openChart);
  openChartRef.current = openChart;
  /** A card's picture: the full chart on its place, at the hour its rose showed, with its dock. */
  const openInChart = (spot: Spot, at: number | null) => {
    if (at !== null) selectColumn(at);
    setPicked(null);
    setPoint(spot);
    setFocusId(spot.id);
    fav.visit(spot.id);
    window.history.pushState(
      { fromList: 1 } satisfies ListEntry,
      "",
      mapSpotHref(spot.id),
    );
    const grown = pageRef.current === "finder" && splitRef.current;
    toChart();
    // Flown to once the chart has opened out; a map made just now flies
    // there as it comes up (above).
    if (controls.current)
      window.setTimeout(
        () => controls.current?.flyTo(spot),
        grown && !reducedMotion ? OPEN_MS : 0,
      );
  };
  /**
   * What the menu asks the map to open: Settings over whichever page it is,
   * what the map means, and on the full chart the display options or the
   * tour, which are the chart's.
   */
  const answer = useCallback((ask: MapAsk) => {
    if (ask === "settings") return setGuide("settings");
    if (ask === "about") return setInfo("key");
    openChartRef.current();
    if (ask === "options") setPanel("options");
    else setGuide("tour");
  }, []);
  // The site menu's navigation, the same on both and on every page: each row
  // is this bundle's own, in place of a page load.
  const menuGo = useMemo(
    () => ({
      chart: () => openChartRef.current(),
      finder: () => openListRef.current(),
      settings: () => answer("settings"),
      options: () => answer("options"),
      about: () => answer("about"),
      tour: () => answer("tour"),
    }),
    [answer],
  );
  // Asked for by another page's menu: a page load to the home page with the
  // word in its address (`/?options`, SETTINGS_HREF, the old /?customise),
  // answered now and taken out of the address; or a page over the map, which
  // hands the reader back to it first (src/PagesOverMap.tsx). Settings is
  // open already, from the first render.
  useEffect(() => {
    const asked = mapAsk(location);
    if (asked) {
      const url = new URL(location.href);
      for (const word of [...MAP_ASKS, OLD_SETTINGS_PARAM])
        url.searchParams.delete(word);
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + tidySearch(url.searchParams) + url.hash,
      );
      if (asked !== "settings") answer(asked);
    }
    const heard = (event: Event) =>
      answer((event as CustomEvent<MapAsk>).detail);
    window.addEventListener(MAP_ASK_EVENT, heard);
    return () => window.removeEventListener(MAP_ASK_EVENT, heard);
  }, [answer]);
  const finderMenu = useMemo(
    () => <SiteMenu current="finder" go={menuGo} />,
    [menuGo],
  );
  const openInChartRef = useRef(openInChart);
  openInChartRef.current = openInChart;
  const onInChart = useCallback(
    (spot: Spot, at: number | null) => openInChartRef.current(spot, at),
    [],
  );
  const onToggleStar = useCallback((id: string) => fav.toggle(id), [fav]);
  // A model picked on the list: the rider's from now on, as from the
  // display options or the spot page, and the map moves to it (above).
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onFinderModel = useCallback((id: string) => {
    const was = prefsRef.current;
    if (chosenModel(was.rider.starsFrom) === id) return;
    const next = { ...was, rider: withRiderModel(was.rider, id) };
    setPrefs(next);
    savePrefs(next);
  }, []);
  const onWant = useCallback((ids: readonly string[], scope: string) => {
    setFinderWant(ids);
    setFinderScope(scope);
  }, []);
  const onFinderHead = useCallback((el: HTMLElement | null) => {
    setFinderHead(el);
    if (el) setFinderDrawn(true);
  }, []);
  /** The button between the list and the full chart, at the foot. */
  const onChart = page === "chart";
  // Alone, the list scrolls the page (src/finder/SpotFinder.tsx), and under
  // the full chart it is out of the page's length (src/map.css): how far
  // down it was is kept while it is in the page, and given back to it when
  // it is again.
  const finderUnder = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  useEffect(() => {
    const keep = () => {
      const el = finderUnder.current;
      if (el && getComputedStyle(el).position !== "fixed")
        listScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", keep, { passive: true });
    return () => window.removeEventListener("scroll", keep);
  }, []);
  useLayoutEffect(() => {
    if (!onChart && listScroll.current) window.scrollTo(0, listScroll.current);
  }, [onChart]);
  const listButton = (onChart || !split) && (
    <Button
      variant="primary"
      size="md"
      className="list-toggle"
      onClick={onChart ? openList : openChart}
      data-map-toggle
    >
      {onChart ? (
        <>
          <ListGlyph size={15} strokeWidth={1.75} aria-hidden="true" /> List
        </>
      ) : (
        <>
          <MapGlyph size={15} strokeWidth={1.75} aria-hidden="true" /> Map
        </>
      )}
    </Button>
  );
  /** The hour the lights beside the list show, as the cards say it. */
  const panelWhen =
    lightColumn &&
    `Stars at ${clock(lightColumn.time)} ${
      irishDate(lightColumn.time) === irishDate(clockNow)
        ? "today"
        : `on ${dayLong(lightColumn.time)}`
    }`;
  const leaveTour = () => {
    tourSeen();
    setGuide(null);
  };

  /**
   * Where the chart is: opened out over the whole screen, standing beside
   * the list, or (under the width for that) out of sight behind it.
   */
  const mode = onChart ? "full" : split && panelBox ? "panel" : "hidden";
  const skip = !onChart ? SKIP.list : dockOpen ? SKIP.dock : SKIP.search;
  const skipTo = (event: React.MouseEvent) => {
    event.preventDefault();
    const to = document.querySelector<HTMLElement>(skip.to);
    if (!to) return;
    // A box the keys do not stop on still takes the focus from here.
    if (!to.hasAttribute("tabindex") && to.tabIndex < 0) to.tabIndex = -1;
    to.focus();
  };
  const shell = (
    <div
      className={`app-shell${phone ? " is-phone" : ""}${focusId ? " is-focus" : ""}`}
      data-view={page}
      data-chart={mode}
      style={
        {
          "--dock-height": `${dockHeight}px`,
          ...(panelBox && {
            "--panel-top": `${panelBox.top}px`,
            "--panel-left": `${panelBox.left}px`,
            "--panel-width": `${panelBox.width}px`,
            "--panel-height": `${panelBox.height}px`,
          }),
        } as React.CSSProperties
      }
    >
      {!error && (
        <Button
          variant="raised"
          size="sm"
          href="#"
          className="skip-link"
          data-skip-link
          onClick={skipTo}
        >
          {skip.label}
        </Button>
      )}
      {error ? (
        <main className="fatal-error chart-box">
          <h1>The forecast isn’t ready yet.</h1>
          <p role="alert">{error}</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      ) : (
        <>
          {/* The list, always there: under the full chart it waits, as it
            was, for the way back to it. */}
          <div
            className="finder-under"
            ref={finderUnder}
            data-shown={!onChart || revealing || undefined}
            inert={onChart || undefined}
            aria-hidden={onChart || undefined}
          >
            {finderSeen.current && (
              <Suspense fallback={null}>
                <SpotFinder
                  spots={spots}
                  hours={hours}
                  version={version}
                  strip={strip}
                  now={clockNow}
                  starred={starred}
                  onToggleStar={onToggleStar}
                  rider={rider}
                  units={prefs.units}
                  reducedMotion={reducedMotion}
                  phone={phone}
                  onWant={onWant}
                  onInChart={onInChart}
                  menu={finderMenu}
                  beside={split}
                  onHover={hoverCard}
                  onShown={setFinderShown}
                  onPlace={setRiderAt}
                  headRef={onFinderHead}
                  onScreen={!onChart}
                  model={riderModel}
                  onModel={onFinderModel}
                />
              </Suspense>
            )}
            {!onChart && listButton}
          </div>
          <main
            className="workspace"
            ref={workspace}
            data-chart={mode}
            inert={mode === "hidden" || undefined}
            aria-hidden={mode === "hidden" || undefined}
          >
            <section
              className="map-panel"
              aria-label={
                onChart ? "Wind chart" : "The chart, at the spots on the list"
              }
            >
              {!onChart && (
                <div className="panel-tools">
                  <Button
                    variant="pill"
                    size="sm"
                    className="panel-open"
                    onClick={openChart}
                    title="Open the full chart"
                    data-open-chart
                  >
                    <Maximize2
                      size={15}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    Full chart
                  </Button>
                  <div
                    className="zbox chart-box"
                    role="group"
                    aria-label="Zoom"
                  >
                    <Button
                      variant="quiet"
                      size="sm"
                      icon
                      aria-label="Zoom in"
                      title="Zoom in"
                      onClick={() => controls.current?.zoomIn()}
                    >
                      +
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      icon
                      aria-label="Zoom out"
                      title="Zoom out"
                      onClick={() => controls.current?.zoomOut()}
                    >
                      −
                    </Button>
                  </div>
                  {panelWhen && (
                    <span className="panel-when" data-panel-when>
                      {panelWhen}
                    </span>
                  )}
                </div>
              )}
              {onChart && (
                <>
                  <MapHead
                    spots={spots}
                    starred={starred}
                    hourAt={hourAt}
                    onPick={(spot) => selectSpot(spot)}
                    go={menuGo}
                  />
                  <MapControls
                    onZoomIn={() => controls.current?.zoomIn()}
                    onZoomOut={() => controls.current?.zoomOut()}
                    open={panel}
                    onOpen={setPanel}
                    rail={railOpen}
                    onLayers={pressLayers}
                    notes={{
                      foil: foilFar ? FOIL_ZOOM_NOTE : null,
                      currents: currents.note,
                    }}
                    layoutKey={`${dockOpen ? dockHeight : 0}`}
                    onCollapse={split ? openList : undefined}
                    options={() => (
                      <Suspense fallback={null}>
                        <DisplayFilter
                          prefs={prefs}
                          onChange={changePrefs}
                          models={models.filter(
                            (model) => model.entry.kind === "wind",
                          )}
                        />
                      </Suspense>
                    )}
                    wind={wind}
                    onWind={chooseWind}
                    layers={layers}
                    onLayersChange={(next) =>
                      chooseLayers({ ...layers, ...next })
                    }
                    satellite={layers.satellite}
                    onSatellite={chooseSatellite}
                    focusStyle={focusStyle}
                    onFocusStyle={chooseFocusStyle}
                  />
                </>
              )}
              {/* After the boxes: the keys reach the menu, the search and the
                controls before the lights. One map, made once and never
                taken down: beside the list it shows the list's places
                alone, at the cards' hour, with no loupe and no dock. */}
              {mapWanted && (
                <Suspense fallback={null}>
                  <WindMap
                    frame={mapDraws ? frame : null}
                    spots={onChart ? spots : listedSpots}
                    lights={lights}
                    named={onChart ? named : NO_NAMES}
                    lightLabel={lightLabel}
                    selectedId={onChart && !picked ? (point?.id ?? null) : null}
                    focus={
                      onChart && focusAt
                        ? { lon: focusAt.lon, lat: focusAt.lat }
                        : null
                    }
                    focusStyle={focusStyle}
                    units={prefs.units}
                    rose={onChart ? rose : null}
                    picked={
                      onChart && picked
                        ? { lon: picked.lon, lat: picked.lat }
                        : null
                    }
                    you={
                      riderAt ? { lon: riderAt.lon, lat: riderAt.lat } : null
                    }
                    covered={() => !!document.querySelector(OVER_THE_CHART)}
                    onPick={tapChart}
                    wind={wind}
                    layers={layers}
                    foil={foilViews}
                    currents={currents.features}
                    rain={rain.view}
                    satellite={satellite.image}
                    reducedMotion={reducedMotion}
                    bottomInset={dockOpen ? dockHeight : 0}
                    phone={phone}
                    onSelect={(spot) =>
                      pageRef.current === "chart"
                        ? openLight(spot)
                        : showCard(spot)
                    }
                    onHoverSpot={hoverLight}
                    onMade={() => setMapMade(true)}
                    onReady={(c) => {
                      controls.current = c;
                      setMapReady(!!c);
                    }}
                    onTilesFailed={(failed) =>
                      recoverRun(failed.model, failed.run)
                    }
                  />
                </Suspense>
              )}
              {onChart && (status || (loading && frame)) && (
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
                        if (manifest) stayOn(manifest.model);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  {frameError && !pendingModel && (
                    <button onClick={() => setRetry((v) => v + 1)}>
                      Retry
                    </button>
                  )}
                  {(modelError ||
                    modelNotice ||
                    (missingStatus !== null && status === missingStatus)) && (
                    <button
                      aria-label="Dismiss"
                      onClick={() => {
                        setModelError("");
                        setModelNotice("");
                        setMissingSpot(null);
                      }}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              {onChart && (
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
                        handoverName
                          ? "handover"
                          : reachNote
                            ? "beyond"
                            : undefined
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
                          <span className="map-model-more">
                            {" "}
                            · no wind drawn
                          </span>
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
                      models={models}
                      onWantModels={() => setWantModels(true)}
                      starred={
                        !!dockSpot && !picked && starred.includes(dockSpot.id)
                      }
                      onToggleStar={() => dockSpot && fav.toggle(dockSpot.id)}
                      warnings={dockWarnings}
                      water={dockWater}
                      tide={tide.tide}
                      onClose={closeDock}
                      phone={phone}
                      view={picked ? "table" : view}
                      onView={setView}
                      reducedMotion={reducedMotion}
                      reachable={reachable}
                      onShowOnMap={() =>
                        reachable && column
                          ? pickRiderModel(reachable.id, column.validTime)
                          : undefined
                      }
                      float={listButton}
                    />
                  )}
                  {/* The List button, at the foot with no dock, and with one
                  just above it, inside its layout, so it moves with it. */}
                  {!dockOpen && listButton}
                </div>
              )}
            </section>
          </main>
        </>
      )}
      {syncAccount && (
        <Suspense fallback={null}>
          <AccountRider />
        </Suspense>
      )}
      {settingsShown && (
        <Suspense fallback={null}>
          <Settings
            open={guide === "settings"}
            prefs={prefs}
            onClose={() => setGuide(null)}
            onSave={(next) => {
              changePrefs(next);
              if (next.starsUpdatedAt !== prefs.starsUpdatedAt)
                announcePrefs("device");
              setGuide(null);
            }}
          />
        </Suspense>
      )}
      {guide && guide !== "settings" && (
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
              layers={railOpen}
              onLayers={setRailOpen}
              onEnd={(customise) => {
                tourSeen();
                setGuide(customise ? "settings" : null);
              }}
            />
          ) : (
            mapReady &&
            onChart &&
            !dockOpen && (
              <TourPrompt onTour={() => setGuide("tour")} onNo={leaveTour} />
            )
          )}
        </Suspense>
      )}
      {!error && gustDue && FEATURES.gust && page === "chart" && (
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
            rain={{ on: layers.rain, line: rainLine }}
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
