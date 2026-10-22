/**
 * The chart (the site's map, src/App.tsx, for a phone): every riding place as
 * a light at the hour chosen, the wind three ways, the depths, the satellite
 * and the foilable depth at the tide, "Find a spot…", where am I, and the
 * dock in a sheet under it all once a spot is open. Opens on the whole of
 * Ireland, the chart the full height, unless a spot is open; a link
 * (`?spot=<id>&t=<iso>`, a notification's) opens its spot at its hour and
 * flies there.
 */
import type BottomSheet from "@gorhom/bottom-sheet";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { CameraRef, MapRef, ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, StyleSheet, View, type TextInput } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { areaAt, foilReadout, nearestArea } from "../../../../force5/src/foilDepth";
import { isLakeWater, nearestSpotOnWater, pointSourceNote } from "../../../../force5/src/pointSource";
import { freshwaterSpots } from "../../../../force5/src/tides";
import type { Spot } from "../../../../force5/src/weather";
import { MAP_MODEL_IDS } from "../../../../force5/src/models";
import { pointHandovers } from "../../../../force5/src/timeline";
import { handedPointHours } from "../../../../src/ratings";
import { clock, dayShort } from "../../../../src/strip";
import { usePointSeries } from "../../../../src/usePointSeries";
import { done, refused, tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { useForecast } from "../../data/forecast";
import { useFavourites } from "../../data/favourites";
import { usePrefs } from "../../data/prefs";
import { spotById } from "../../data/spots";
import { colors, hitTarget, radius, shadow, space } from "../../theme/tokens";
import { holdUpdates } from "../updates/hold";
import { ChartHeader } from "./ChartHeader";
import { ChartMap, type FocusMark } from "./ChartMap";
import { FitGlyph, Instrument, InstrumentStack, KeyGlyph, LayersGlyph, LocateGlyph } from "./ChartControls";
import { moreCells } from "../dock/dockLogic";
import { useMarine, usePointTide } from "../dock/useDockData";
import { DockSheet, PEEK } from "./DockSheet";
import {
  foilLayers,
  foilLevels,
  foilInView,
  stationsWanted,
  type ChartView,
  type FoilLayer,
} from "./foilLogic";
import { InfoSheet } from "./InfoSheet";
import { LayersSheet } from "./LayersSheet";
import { lightFeatures, lightStates, wedgePolygon } from "./lightsLogic";
import {
  boundsOf,
  degrees,
  flightMs,
  focusRadius,
  IRELAND_BOUNDS,
  LAYERS_KEY,
  modelLabel,
  parseLayers,
  project,
  sameView,
  scaleLabel,
  seaward,
  SPOT_ZOOM,
  store,
  viewFromBounds,
  WIND_KEY,
  type Camera,
  type MapLayers,
} from "./mapLogic";
import { appFoilColours } from "./mapStyle";
import { PointSheet, type Picked } from "./PointSheet";
import { foilArchiveUrl, useFoilIndex, useSatellite, useTides } from "./useChartLayers";
import { useFoilProbe } from "./useFoilProbe";
import { useMapModel } from "./useMapModel";
import { showsLines, useArrows, useFrameTiles, useParticleField, useWash } from "./useWind";
import { parseWindStyle, type WindStyle } from "./windLogic";
import { WindParticles } from "./WindParticles";

const HEAD = hitTarget;

/** Keep what was once drawn mounted (its tiles stay), hidden while it is out of view. */
function useKept<T extends { id: string }>(now: readonly T[]): (T & { visible: boolean })[] {
  const [kept, setKept] = useState<ReadonlyMap<string, T>>(() => new Map());
  let next = kept;
  for (const item of now)
    if (next.get(item.id) !== item) {
      if (next === kept) next = new Map(kept);
      (next as Map<string, T>).set(item.id, item);
    }
  // Adjusting state from what was rendered (react.dev, "storing information from previous renders").
  if (next !== kept) setKept(next);
  return useMemo(() => {
    const shown = new Set(now.map((item) => item.id));
    return [...next.values()].map((item) => ({ ...item, visible: shown.has(item.id) }));
  }, [next, now]);
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

export default function ChartScreen() {
  const insets = useSafeAreaInsets();
  const forecast = useForecast();
  const { spots, hours, version, selected, strip, days, axis, spot, openSpot, setView, selectTime, rider } = forecast;
  const { prefs } = usePrefs();
  const { starred } = useFavourites();
  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const params = useLocalSearchParams<{ spot?: string; t?: string }>();

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const dockRef = useRef<BottomSheet>(null);
  const layersRef = useRef<BottomSheetModal>(null);
  const infoRef = useRef<BottomSheetModal>(null);
  const pointRef = useRef<BottomSheetModal>(null);
  const searchRef = useRef<TextInput>(null);

  /* ---- the rider's choices, kept as the site keeps them ---- */
  const [windStyle, setWindStyle] = useState<WindStyle>(() => parseWindStyle(store.get(WIND_KEY)));
  const [layers, setLayers] = useState<MapLayers>(() => parseLayers(store.get(LAYERS_KEY)));
  const chooseWind = useCallback((style: WindStyle) => {
    setWindStyle(style);
    store.set(WIND_KEY, style);
  }, []);
  const chooseLayers = useCallback((next: MapLayers) => {
    setLayers(next);
    store.set(LAYERS_KEY, JSON.stringify(next));
  }, []);

  /* ---- the camera, at rest ---- */
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rest, setRest] = useState<{ center: [number, number]; zoom: number; bounds: number[] } | null>(null);
  const [moving, setMoving] = useState(false);
  const [ready, setReady] = useState(false);
  const camera = useMemo<Camera | null>(
    () => (rest && size.width ? { center: rest.center, zoom: rest.zoom, width: size.width, height: size.height } : null),
    [rest, size],
  );
  const chartView = useMemo<ChartView | null>(() => (camera ? { ...boundsOf(camera), zoom: camera.zoom } : null), [camera]);
  const release = useRef<(() => void) | null>(null);
  const onMoving = useCallback(() => {
    setMoving(true);
    // No update banner over a camera in the rider's hands.
    release.current ??= holdUpdates();
  }, []);
  const onIdle = useCallback((event: ViewStateChangeEvent) => {
    release.current?.();
    release.current = null;
    setMoving(false);
    setRest((was) =>
      was && was.zoom === event.zoom && was.center[0] === event.center[0] && was.center[1] === event.center[1]
        ? was
        : { center: [event.center[0], event.center[1]], zoom: event.zoom, bounds: [...event.bounds] },
    );
  }, []);
  useEffect(() => () => release.current?.(), []);

  // The forecast reads the squares in view, once the camera has rested a moment.
  const lastView = useRef<ReturnType<typeof viewFromBounds>>(null);
  useEffect(() => {
    const view = viewFromBounds(rest?.bounds);
    if (!view || sameView(view, lastView.current)) return;
    const timer = setTimeout(() => {
      lastView.current = view;
      setView(view);
    }, 250);
    return () => clearTimeout(timer);
  }, [rest, setView]);

  const tabInset = Platform.OS === "ios" ? insets.bottom : 0;
  // The dock's peek covers the foot of the chart only once a spot opens it.
  const dockInset = spot ? PEEK + tabInset : tabInset;
  const edges = useMemo(() => ({ top: insets.top + HEAD + space.lg, left: space.lg, right: hitTarget + space.xl }), [insets.top]);
  const padding = useMemo(() => ({ ...edges, bottom: dockInset + space.lg }), [edges, dockInset]);
  // A spot is flown to above the peek its dock opens with, there or not yet.
  const spotPadding = useMemo(() => ({ ...edges, bottom: PEEK + tabInset + space.lg }), [edges, tabInset]);

  const flyTo = useCallback(
    (center: [number, number], zoom: number, framed = padding) => {
      const from = camera ?? { center, zoom, width: size.width || 1, height: size.height || 1 };
      cameraRef.current?.flyTo({
        center,
        zoom,
        padding: framed,
        duration: reducedMotion ? 0 : flightMs(from, { center, zoom }),
        easing: "fly",
      });
    },
    [camera, size, padding, reducedMotion],
  );
  const flyToSpot = useCallback(
    (s: Spot) => flyTo(seaward(s), Math.max(camera?.zoom ?? 0, SPOT_ZOOM), spotPadding),
    [flyTo, camera?.zoom, spotPadding],
  );
  const fitIreland = useCallback(() => {
    cameraRef.current?.fitBounds(IRELAND_BOUNDS, { padding, duration: reducedMotion ? 0 : 1200 });
  }, [padding, reducedMotion]);

  /* ---- choosing a spot, a point ---- */
  const [focusOn, setFocusOn] = useState<"spot" | "point" | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detent, setDetent] = useState<"peek" | "open">("peek");

  const selectSpot = useCallback(
    (s: Spot, fly = true) => {
      setPicked(null);
      pointRef.current?.dismiss();
      openSpot(s.id);
      setFocusOn("spot");
      dockRef.current?.snapToIndex(0);
      if (fly) flyToSpot(s);
    },
    [openSpot, flyToSpot],
  );
  const onLight = useCallback(
    (id: string) => {
      const s = spotById(id);
      if (!s) return;
      tick();
      selectSpot(s);
    },
    [selectSpot],
  );

  const onPick = useCallback(
    async (lon: number, lat: number, x: number, y: number) => {
      if (searchOpen) {
        setSearchOpen(false);
        searchRef.current?.blur();
        return;
      }
      tick();
      const coords = degrees(lat, lon);
      setPicked({ lon, lat, name: coords, coords: "", lake: false });
      setFocusOn("point");
      pointRef.current?.present();
      // The nearest town or village, within a few kilometres (WindMap.tsx `nearestPlace`).
      const near = await mapRef.current
        ?.queryRenderedFeatures(
          [
            [x - 70, y - 70],
            [x + 70, y + 70],
          ],
          { layers: ["places", "places-near"] },
        )
        .catch(() => []);
      let best: string | null = null;
      let distance = 6;
      for (const f of near ?? []) {
        if (f.geometry?.type !== "Point") continue;
        const [px, py] = f.geometry.coordinates;
        const km = Math.hypot((px - lon) * 111.32 * Math.cos((lat * Math.PI) / 180), (py - lat) * 110.57);
        const name = f.properties?.["name:en"] ?? f.properties?.name;
        if (km < distance && typeof name === "string") {
          distance = km;
          best = name;
        }
      }
      if (best) setPicked((p) => (p && p.lon === lon && p.lat === lat ? { ...p, name: best, coords } : p));
      // On a lake, by the basemap's water there (isLakeWater): no sea's tide.
      const water = await mapRef.current?.queryRenderedFeatures([x, y], { layers: ["water"] }).catch(() => []);
      if (isLakeWater((water ?? []).map((f) => f.properties?.class)))
        setPicked((p) => (p && p.lon === lon && p.lat === lat ? { ...p, lake: true } : p));
    },
    [searchOpen],
  );
  const closePoint = useCallback(() => {
    pointRef.current?.dismiss();
  }, []);
  const pointDismissed = useCallback(() => {
    setPicked(null);
    setFocusOn((f) => (f === "point" ? null : f));
  }, []);

  /* ---- a link: ?spot=<id>&t=<iso> ---- */
  const linked = useRef<string | null>(null);
  useEffect(() => {
    const id = typeof params.spot === "string" ? params.spot : null;
    const t = typeof params.t === "string" ? params.t : null;
    if (!id && !t) return;
    if (t && Number.isFinite(Date.parse(t))) selectTime(t);
    const linkedSpot = id ? spotById(id) : undefined;
    if (linkedSpot) {
      // Flown to once the chart is up (below). The link is an outside event
      // (a notification, another screen), which is what an effect is for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      selectSpot(linkedSpot, false);
      linked.current = linkedSpot.id;
    }
    router.setParams({ spot: undefined, t: undefined });
  }, [params.spot, params.t, selectTime, selectSpot]);
  // Flown to once the chart is up: a linked spot, or the one open when the chart opened.
  const opened = useRef(false);
  useEffect(() => {
    if (!ready || !size.width) return;
    const target = linked.current ? spotById(linked.current) : !opened.current ? spot : null;
    opened.current = true;
    linked.current = null;
    if (target) flyToSpot(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.width, params.spot]);

  /* ---- where am I ---- */
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const cameraZoom = camera?.zoom ?? 0;
  const locate = useCallback(async () => {
    setLocating(true);
    setLocateNote(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        refused();
        setLocateNote("Location is off for Wingfoil.");
        return;
      }
      const found =
        (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const here = { lat: found.coords.latitude, lon: found.coords.longitude };
      setMe(here);
      done();
      flyTo([here.lon, here.lat], Math.max(cameraZoom, 8.5));
      setSearchOpen(true);
    } catch {
      refused();
      setLocateNote("Could not tell where you are.");
    } finally {
      setLocating(false);
    }
  }, [flyTo, cameraZoom]);

  /* ---- the lights ---- */
  const openId = picked ? null : (spot?.id ?? null);
  // `hours` is one Map mutated in place; `version` says when it has changed.
  const table = useMemo(() => ({ hours, version }), [hours, version]);
  const states = useMemo(
    () => lightStates(spots, table.hours, selected, rider, openId),
    [spots, table, selected, rider, openId],
  );
  const named = useMemo(() => new Set(starred), [starred]);
  const lights = useMemo(() => lightFeatures(spots, states, openId, named), [spots, states, openId, named]);
  const wedge = useMemo(() => {
    const s = openId ? states.get(openId) : null;
    const at = openId ? spotById(openId) : null;
    if (!s?.wedge || !at || !camera) return { type: "FeatureCollection" as const, features: [] };
    const feature = lights.features.find((f) => f.properties.id === openId);
    return {
      type: "FeatureCollection" as const,
      features: [wedgePolygon(at.lon, at.lat, s.wedge, camera.zoom, feature?.properties.level ?? "s0", feature?.properties.mark ?? "")],
    };
  }, [openId, states, camera, lights]);
  const holes = useMemo(() => {
    if (!camera) return [];
    const out: number[] = [];
    for (const s of spots) {
      const [x, y] = project(camera, s.lon, s.lat);
      if (x > -12 && y > -12 && x < camera.width + 12 && y < camera.height + 12) out.push(x, y);
    }
    return out;
  }, [camera, spots]);

  /* ---- the wind ---- */
  const model = useMapModel();
  // The rider's model and run, or past its end the model drawn in its place.
  const runLabel = model.manifest
    ? modelLabel({ name: model.manifest.modelName, run: model.run, staleness: model.staleness }, model.handover)
    : null;
  const tiles = useFrameTiles(model.frame, camera, model.recover);
  const animate = focused && appActive && !reducedMotion;
  const linesWanted = animate && showsLines(windStyle);
  const field = useParticleField(model.frame, camera, tiles, linesWanted);
  const arrows = useArrows(
    model.frame,
    camera,
    tiles,
    windStyle === "arrows" ? "colour" : reducedMotion && windStyle === "ink" ? "ink" : null,
  );
  const queryWater = useCallback(async () => {
    const found = (await mapRef.current?.queryRenderedFeatures({ layers: ["water"] })) ?? [];
    return found.map((f) => f.geometry).filter(Boolean);
  }, []);
  const wash = useWash(model.frame, camera, tiles, windStyle === "wash" && focused, queryWater);

  /* ---- the satellite, and the foilable depth at the hour's tide ---- */
  const satellite = useSatellite(layers.satellite, chartView);
  const satelliteKept = useKept(satellite.layers);
  const foilIndex = useFoilIndex(layers.foil);
  const column = strip[selected];
  const foilTime = column?.time ?? null;
  const probe = useFoilProbe(picked, layers.foil, foilIndex.manifest);
  const centre = camera?.center ?? null;
  const probeArea = probe?.area ?? null;
  const keyArea = useMemo(() => {
    const m = foilIndex.manifest;
    if (!m) return null;
    return (
      (probeArea && m.areas.find((a) => a.id === probeArea)) ||
      (picked && areaAt(m.areas, picked.lon, picked.lat)) ||
      (centre && nearestArea(m.areas, centre[0], centre[1])) ||
      m.areas[0] ||
      null
    );
  }, [foilIndex.manifest, probeArea, picked, centre]);
  const inView = useMemo(() => foilInView(foilIndex.manifest, chartView), [foilIndex.manifest, chartView]);
  const stationKey = layers.foil ? stationsWanted([...inView, keyArea]).join("|") : "";
  const stations = useMemo(() => (stationKey ? stationKey.split("|") : []), [stationKey]);
  const tides = useTides(stations);
  const foilState = useMemo(
    () => ({ manifest: foilIndex.manifest, tides: tides.tides, error: foilIndex.error ?? tides.error }),
    [foilIndex, tides],
  );
  const levels = useMemo(
    () => foilLevels(foilIndex.manifest?.areas ?? [], tides.tides, foilTime),
    [foilIndex.manifest, tides.tides, foilTime],
  );
  const palette = useMemo(() => appFoilColours(), []);
  const foilNow = useMemo<FoilLayer[]>(
    () =>
      foilLayers({
        on: layers.foil,
        manifest: foilState.manifest,
        levels,
        view: chartView,
        palette,
        foilUrl: foilArchiveUrl,
      }),
    [layers.foil, foilState.manifest, levels, chartView, palette],
  );
  const foilKept = useKept(foilNow);
  const foilStation = keyArea ? (foilState.tides[keyArea.station]?.station.name ?? keyArea.station) : null;
  const keyLevel = keyArea ? levels[keyArea.id] : null;
  const probeLevel = probe?.area ? levels[probe.area] : null;
  const readout =
    !probe || !layers.foil
      ? null
      : !probe.area
        ? "No survey here: the foilable depth is drawn round the coast."
        : !probe.done
          ? null
          : probeLevel && foilTime !== null && foilStation && keyArea?.id === probe.area
            ? foilReadout(
                probe.z,
                probeLevel.water,
                clock(foilTime),
                foilStation,
                undefined,
                keyArea.level ? probeLevel.sea : undefined,
                foilState.manifest?.floorMetres,
              )
            : null;

  /* ---- a point's own forecast ---- */
  const pickedPoint = useMemo(() => (picked ? { name: picked.name, lat: picked.lat, lon: picked.lon } : null), [picked]);
  // Past the end of the rider's run the point goes on in the run the chart
  // hands over to there, as a spot's hours go on in ECMWF's past HARMONIE's.
  const { columnModels, now } = forecast;
  const pointHanded = useMemo(
    () =>
      picked && model.manifest
        ? pointHandovers(
            columnModels,
            MAP_MODEL_IDS,
            { id: model.manifest.model, frames: model.manifest.frames },
            strip,
            now,
          )
        : [],
    [picked, columnModels, model.manifest, strip, now],
  );
  const series = usePointSeries(picked ? model.manifest : null, pickedPoint, pointHanded);
  const pickedHours = useMemo(
    () =>
      picked && model.manifest
        ? handedPointHours(model.manifest.frames, series.values, series.handed, picked, axis)
        : undefined,
    [picked, model.manifest, series.values, series.handed, axis],
  );

  // Its tide, the nearest station's; its waves, weather and sea, the nearest
  // riding place's on the same water within 15 km (src/App.tsx).
  const pointTide = usePointTide(picked);
  const pointSources = useMemo(
    () =>
      picked
        ? nearestSpotOnWater(spots, picked.lat, picked.lon, {
            lake: picked.lake,
            freshwater: pointTide.manifest ? freshwaterSpots(pointTide.manifest) : null,
          })
        : null,
    [picked, spots, pointTide.manifest],
  );
  const lender = pointSources?.source?.spot ?? null;
  const pointMarine = useMarine(lender, axis, !!picked);
  const pointMore = useMemo(
    () => (lender ? moreCells(strip, pointMarine.waves, pointMarine.weather, pointMarine.sea) : null),
    [lender, strip, pointMarine.waves, pointMarine.weather, pointMarine.sea],
  );

  /* ---- the focus: everything away from the chosen spot or point goes quiet ---- */
  const focusAt = focusOn === "point" ? picked : focusOn === "spot" ? spot : null;
  const focus = useMemo<FocusMark | null>(
    () =>
      focusAt && camera
        ? { lon: focusAt.lon, lat: focusAt.lat, radius: focusRadius(camera, focusAt.lat, PEEK + tabInset) }
        : null,
    // The quiet is redrawn for the zoom, not for every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusAt?.lon, focusAt?.lat, camera?.zoom, size, tabInset],
  );

  /* ---- what the search list shows: each place at the hour the lights show ---- */
  const hourAt = useCallback(
    (id: string) => {
      const hour = table.hours.get(id)?.[selected];
      return hour?.rating ? hour : null;
    },
    [table, selected],
  );

  const showOnChart = useCallback(() => {
    if (!spot) return;
    setFocusOn("spot");
    dockRef.current?.snapToIndex(0);
    flyToSpot(spot);
  }, [spot, flyToSpot]);

  const scale = camera ? scaleLabel(camera.center[1], camera.zoom) : "";

  return (
    <View
      style={styles.screen}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
      }}
    >
      <ChartMap
        mapRef={mapRef}
        cameraRef={cameraRef}
        padding={padding}
        layers={layers}
        lights={lights}
        wedge={wedge}
        arrows={arrows}
        arrowsInk={windStyle !== "arrows"}
        wash={wash}
        satellite={satelliteKept}
        foil={foilKept}
        focus={focus}
        picked={picked}
        me={me}
        onLight={onLight}
        onPick={onPick}
        onMoving={onMoving}
        onIdle={onIdle}
        onReady={() => setReady(true)}
      />
      <WindParticles field={field} holes={holes} on={linesWanted} moving={moving} />

      {/* The head: "Find a spot…", and the run the map draws. */}
      <View style={[styles.head, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <ChartHeader
          inputRef={searchRef}
          spots={spots}
          starred={starred}
          hourAt={hourAt}
          units={prefs.units}
          me={me}
          open={searchOpen}
          onOpen={setSearchOpen}
          onPick={(s) => selectSpot(s)}
        />
        {!searchOpen ? (
          <View style={styles.notes} pointerEvents="box-none">
            {runLabel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={runLabel.spoken}
                onPress={() => layersRef.current?.present()}
                hitSlop={{ top: 7, bottom: 7 }}
                style={styles.run}
              >
                <T variant="label" caps color={runLabel.warn ? "warn" : "ink2"}>
                  {runLabel.text}
                </T>
              </Pressable>
            ) : null}
            {model.status || (model.beyond && model.reachable) || locateNote ? (
              <View style={styles.status} accessibilityLiveRegion="polite">
                <T variant="body" color={model.status?.error ? "warn" : "ink"} style={styles.flex}>
                  {model.status?.text ??
                    (model.beyond && model.reachable
                      ? `${model.manifest?.modelName ?? "This model"}’s run ends before this hour.`
                      : locateNote)}
                </T>
                {model.pendingModel ? (
                  <StatusAction label="Cancel" onPress={model.cancel} />
                ) : model.status?.error ? (
                  <StatusAction label="Retry" onPress={model.retry} />
                ) : model.status ? (
                  <StatusAction label="Dismiss" onPress={model.dismiss} />
                ) : model.beyond && model.reachable ? (
                  <StatusAction
                    label={`Show ${model.reachable.name}`}
                    onPress={() => column && model.chooseModel(model.reachable!.id, column.validTime)}
                  />
                ) : locateNote ? (
                  <StatusAction label="Settings" onPress={() => void Linking.openSettings()} />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* The instruments, down the right-hand edge. */}
      <View style={[styles.rail, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <InstrumentStack>
          <Instrument label="Layers" hint="The wind, the chart, the satellite and the model" onPress={() => layersRef.current?.present()}>
            <LayersGlyph />
          </Instrument>
          <Instrument label="Map key" hint="What the marks mean, and the sources" onPress={() => infoRef.current?.present()}>
            <KeyGlyph />
          </Instrument>
        </InstrumentStack>
        <InstrumentStack>
          <Instrument label="Where am I" hint="Shows you on the chart and the spots nearest you" busy={locating} pressed={!!me} onPress={() => void locate()}>
            <LocateGlyph active={!!me} />
          </Instrument>
          <Instrument
            label="All of Ireland"
            onPress={() => {
              setFocusOn(null);
              fitIreland();
            }}
          >
            <FitGlyph />
          </Instrument>
        </InstrumentStack>
      </View>

      {spot ? (
        <DockSheet
          sheetRef={dockRef}
          bottomInset={tabInset}
          detent={detent}
          onDetent={setDetent}
          onOpenSpotPage={(id) => router.push(`/spot/${id}` as never)}
          onShowOnChart={showOnChart}
        />
      ) : null}

      <PointSheet
        sheetRef={pointRef}
        picked={picked}
        hours={pickedHours}
        pending={series.pending}
        failed={!series.pending && series.failures > 0 && !pickedHours?.some((h) => h.windKn !== null)}
        strip={strip}
        days={days}
        selected={selected}
        onSelect={selectTime}
        foil={readout}
        foilOn={layers.foil && !!foilState.manifest}
        tide={pointTide.tide}
        tideNote={pointTide.loading ? "" : pointTide.error}
        lent={pointSources ? pointSourceNote(pointSources) : null}
        more={pointMore}
        onClose={closePoint}
        onDismiss={pointDismissed}
      />

      <LayersSheet
        sheetRef={layersRef}
        onClose={() => layersRef.current?.dismiss()}
        windStyle={windStyle}
        onWindStyle={chooseWind}
        layers={layers}
        onLayers={chooseLayers}
        satelliteStation={satellite.station}
        satelliteError={satellite.error}
        model={model.manifest?.model}
        run={model.run}
        staleness={model.staleness}
        pendingModel={model.pendingModel}
        modelDisabled={!model.frame || !!model.pendingModel}
        onModel={(id) => model.chooseModel(id)}
        onFoilKey={() => {
          layersRef.current?.dismiss();
          infoRef.current?.present();
        }}
        reducedMotion={reducedMotion}
      />

      <InfoSheet
        sheetRef={infoRef}
        onClose={() => infoRef.current?.dismiss()}
        scale={scale}
        rider={rider}
        spotId={openId}
        satellite={satellite.note}
        satelliteError={satellite.error}
        satelliteAttribution={satellite.attribution}
        model={model.manifest ? { name: model.manifest.modelName, run: model.run } : null}
        blendModels={prefs.blendModels.length}
        foil={{
          on: layers.foil,
          area: keyArea,
          station: foilStation,
          tide: keyLevel?.water ?? null,
          sea: keyArea?.level ? (keyLevel?.sea ?? null) : null,
          when: foilTime !== null ? `${dayShort(foilTime)} ${clock(foilTime)}` : "",
          readout,
          error: foilState.error,
          floor: foilState.manifest?.floorMetres ?? -5,
          attribution: foilState.manifest?.attribution ?? null,
        }}
      />
    </View>
  );
}

function StatusAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [styles.action, pressed && styles.actionDown]}
    >
      <T variant="label" caps>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sea },
  flex: { flex: 1 },
  head: { position: "absolute", left: space.md, right: space.md + hitTarget + space.sm },
  notes: { marginTop: space.xs, gap: space.xs, alignItems: "flex-start" },
  run: {
    minHeight: hitTarget - 14,
    justifyContent: "center",
    paddingHorizontal: space.sm,
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.box,
  },
  status: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingLeft: space.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.box,
    boxShadow: shadow.surface,
  },
  action: { minHeight: hitTarget, paddingHorizontal: space.md, justifyContent: "center" },
  actionDown: { backgroundColor: colors.sunken },
  rail: { position: "absolute", right: space.md, gap: space.sm },
});
