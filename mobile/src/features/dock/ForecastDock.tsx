/**
 * The forecast dock: the open spot's fortnight under a fixed cursor, as the
 * site's dock (src/ForecastDock.tsx) draws it. The hours scroll sideways under
 * the cursor and the hour under it is the chart's: a light tick per hour, a
 * snap to each, and the time committed to the forecast a few times a second
 * while the finger moves and at once when it stops, so the chart is not
 * redrawn every frame. The cursor and its marks move on the UI thread.
 *
 * "peek" is the spot's name, the hour's stars, wind and the model the stars
 * came from, and the strip; "open"
 * is the week: the stars, the wind and its gusts in the wind's own colours,
 * where it goes, the wing, the tide, and under the fold the waves, the sky,
 * the air, the rain and the sea; or the models' blend in place of the table.
 */
import { useBottomSheetInternal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg from "react-native-svg";
import { modelName, spotOverride } from "../../../../force5/src/lead";
import { modelEntry } from "../../../../force5/src/manifests";
import { dayNights } from "../../../../force5/src/sun";
import { tideAt } from "../../../../force5/src/tides";
import { unitLabel } from "../../../../force5/src/units";
import { daylightOn } from "../../../../src/ratings";
import { clock, dayShort, stripGeometry, stripTrack, type StripDay } from "../../../../src/strip";
import { bandKnots } from "../../../../spot/web/spot";
import { Button } from "../../components/Button";
import {
  Chevron,
  DirectionGlyph,
  SeaTempGlyph,
  SkyGlyph,
  StarsMark,
  StarToggle,
  ThermometerGlyph,
  WavesGlyph,
  WindGlyph,
  WingGlyph,
} from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { RatingTip, type HourExplanation } from "../../components/RatingTip";
import { Rule } from "../../components/Rule";
import { Segmented } from "../../components/Segmented";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast, useSpotHours } from "../../data/forecast";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, hitTarget, radius, space, withAlpha } from "../../theme/tokens";
import { riderWords } from "../settings/settingsLogic";
import { SpotStarsChip } from "../settings/StarsFrom";
import { CustomStarsChip } from "../stars/StarRating";
import { holdUpdates } from "../updates/hold";
import { blendDrawing } from "./blendLogic";
import { DockDay } from "./DockDay";
import {
  COMMIT_MS,
  beyondMapModel,
  columnWidths,
  commitDue,
  dayTide,
  dockHandovers,
  dockRowOn,
  hourReading,
  moreCells,
  nearestCentre,
  prefsView,
  rowLayout,
  tideScale,
  trackCursorAt,
  trackParams,
  trackTimeAt,
  viewFromPrefs,
  windFigures,
  type DockRow,
  type DockView,
  type RowLayout,
  type TrackParams,
} from "./dockLogic";
import { createScrubStore, useDockBlend, useMarine, useScrub, useSpotTide, type ScrubStore } from "./useDockData";

/**
 * The contract the chart and the dock agree on. The dock feature replaces the
 * body; the props stay.
 */
export interface ForecastDockProps {
  /** The dock is in the chart's bottom sheet: "peek" shows the strip and the hour's line, "open" the week. */
  detent: "peek" | "open";
  /** Open the spot's own page (src/app/spot/[id].tsx). */
  onOpenSpotPage: (id: string) => void;
  /** Ask the chart to fly to the open spot. */
  onShowOnChart?: () => void;
}

/** The fold stays as the rider left it while the app is open. */
let moreOpen = false;

export function ForecastDock({ detent, onOpenSpotPage, onShowOnChart }: ForecastDockProps) {
  const forecast = useForecast();
  const { strip, days, axis, selected, selectTime, spot, now, resolved, models, wantModels } = forecast;
  const { prefs, update } = usePrefs();
  const { store: favourites, starred } = useFavourites();
  const hours = useSpotHours(spot?.id);
  const reducedMotion = useReducedMotion();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const scale = Math.max(1, Math.min(1.35, fontScale));
  const units = prefs.units;
  const view: DockView = viewFromPrefs(prefs.view);
  const [more, setMoreState] = useState(moreOpen);
  const setMore = (next: boolean) => {
    moreOpen = next;
    setMoreState(next);
  };
  const open = detent === "open";

  /* ---- geometry ---- */
  const { cw, coarse, label } = columnWidths(scale);
  const g = useMemo(() => stripGeometry(strip, cw, coarse), [strip, cw, coarse]);
  const [stripWidth, setStripWidth] = useState(Math.max(1, windowWidth - label));
  const track = useMemo(() => stripTrack(g, stripWidth), [g, stripWidth]);
  const params = useMemo(() => trackParams(g, stripWidth), [g, stripWidth]);
  const snaps = useMemo(() => strip.map((_, i) => track.scrollFor(i)), [strip, track]);
  const centres = useMemo(() => g.x.map((x, i) => x + g.w[i] / 2), [g]);
  const dayLayout = useMemo(
    () =>
      days.map((d) => {
        const end = d.start + d.count - 1;
        return { offset: g.x[d.start] ?? 0, length: (g.x[end] ?? 0) + (g.w[end] ?? 0) - (g.x[d.start] ?? 0) };
      }),
    [days, g],
  );

  /* ---- what the rows show ---- */
  const daylight = useMemo(
    () => (spot ? daylightOn(spot, axis) : axis.map(() => true)),
    // The sun goes by where the spot is, not by which object holds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spot?.lat, spot?.lon, axis],
  );
  const tide = useSpotTide(spot?.id);
  const marine = useMarine(spot, axis, open && more);
  const blend = useDockBlend(spot, models, prefs.blendModels, axis, open && view === "blend", wantModels);
  const cells = useMemo(
    () => (open && more && spot ? moreCells(strip, marine.waves, marine.weather, marine.sea) : null),
    [open, more, spot, strip, marine.waves, marine.weather, marine.sea],
  );
  const seaAvailable = cells?.seaAvailable ?? false;
  const on = useCallback((row: DockRow) => dockRowOn(prefs, row, seaAvailable), [prefs, seaAvailable]);
  const layout = useMemo(
    () => rowLayout({ detent, view, spot: !!spot, more, on, scale }),
    [detent, view, spot, more, on, scale],
  );
  const tides = useMemo(() => {
    const curve = tide.tide?.curve;
    const slot = layout.at.tide;
    if (!curve || !slot) return null;
    return days.map((d) => dayTide(curve, strip, d, g, slot.h));
  }, [tide.tide, layout.at.tide, days, strip, g]);
  const tideNote = tide.loading ? "" : (tide.error ?? (tide.tide ? null : "No tide station near"));
  const nowHour = now - (now % 3600000);
  const drawing = useMemo(() => {
    if (!layout.at.blend || !spot || !axis.length) return null;
    return blendDrawing({
      stats: blend.stats,
      lines: blend.lines,
      directions: blend.directions,
      columns: strip,
      centres,
      nights: dayNights(spot.lat, spot.lon, new Date(axis[0]), new Date(axis[axis.length - 1])),
      units,
      height: layout.at.blend.h,
      width: g.total,
    });
  }, [layout.at.blend, spot, axis, blend, strip, centres, units, g.total]);

  /* ---- the scrub ---- */
  const [scrub] = useState(() => createScrubStore(selected));
  const listRef = useRef<FlatList<StripDay>>(null);
  const scrollX = useSharedValue(0);
  const userDriven = useSharedValue(false);
  const lastIndex = useSharedValue(-1);
  const committed = useRef({ at: 0, column: -1 });
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The snaps the strip was last placed on: new ones (a new width, a new run) place it again. */
  const placed = useRef<readonly number[] | null>(null);

  const commit = useCallback(
    (column: number) => {
      if (trailing.current) clearTimeout(trailing.current);
      trailing.current = null;
      const target = strip[column];
      if (!target) return;
      committed.current = { at: Date.now(), column };
      selectTime(target.validTime);
    },
    [strip, selectTime],
  );
  const onScrubHour = useCallback(
    (column: number) => {
      tick();
      scrub.set(column);
      const at = Date.now();
      if (commitDue(at, committed.current.at)) commit(column);
      else {
        if (trailing.current) clearTimeout(trailing.current);
        trailing.current = setTimeout(() => commit(scrub.get()), COMMIT_MS);
      }
    },
    [scrub, commit],
  );
  // No update banner mid-gesture: updates wait while the finger is on the
  // hours and the strip is still coasting (features/updates/hold.ts).
  const hold = useRef<{ release: () => void; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const releaseHold = useCallback(() => {
    if (!hold.current) return;
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.release();
    hold.current = null;
  }, []);
  const onScrubStart = useCallback(() => {
    if (hold.current?.timer) clearTimeout(hold.current.timer);
    if (hold.current) hold.current.timer = null;
    else hold.current = { release: holdUpdates(), timer: null };
  }, []);
  /** The finger is off: let go once the coast has ended, or soon if there is none. */
  const onDragEnd = useCallback(() => {
    if (!hold.current) return;
    if (hold.current.timer) clearTimeout(hold.current.timer);
    hold.current.timer = setTimeout(releaseHold, 1200);
  }, [releaseHold]);
  const onSettle = useCallback(() => {
    commit(scrub.get());
    releaseHold();
  }, [scrub, commit, releaseHold]);
  useEffect(
    () => () => {
      if (trailing.current) clearTimeout(trailing.current);
      releaseHold();
    },
    [releaseHold],
  );

  const onScroll = useAnimatedScrollHandler(
    {
      onBeginDrag: () => {
        userDriven.set(true);
        scheduleOnRN(onScrubStart);
      },
      onEndDrag: () => {
        scheduleOnRN(onDragEnd);
      },
      onScroll: (event) => {
        const x = event.contentOffset.x;
        scrollX.set(x);
        if (!userDriven.get()) return;
        const column = nearestCentre(centres, trackTimeAt(params, x));
        if (column !== lastIndex.get()) {
          lastIndex.set(column);
          scheduleOnRN(onScrubHour, column);
        }
      },
      onMomentumEnd: () => {
        if (userDriven.get()) scheduleOnRN(onSettle);
      },
    },
    [centres, params, onScrubHour, onSettle, onScrubStart, onDragEnd],
  );

  /** Bring a column under the cursor, by the time rather than the finger. */
  const scrollToColumn = useCallback(
    (column: number, animated: boolean) => {
      userDriven.set(false);
      lastIndex.set(column);
      listRef.current?.scrollToOffset({ offset: snaps[column] ?? 0, animated: animated && !reducedMotion });
    },
    [snaps, reducedMotion, userDriven, lastIndex],
  );

  // The time moved from elsewhere (the chart, a new run, the hour turning):
  // the strip follows it. A commit of the strip's own is already there. The
  // first placing, and any after the strip's shape changes, is without motion.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    scrub.set(selected);
    if (!snaps.length || !contentReady) return;
    const fresh = placed.current !== snaps;
    if (!fresh && committed.current.column === selected) return;
    scrollToColumn(selected, !fresh);
    placed.current = snaps;
  }, [selected, snaps, contentReady, scrub, scrollToColumn]);
  const onContentSizeChange = useCallback((width: number) => {
    if (width > 0) setContentReady(true);
  }, []);

  const choose = useCallback(
    (column: number) => {
      tick();
      scrub.set(column);
      scrollToColumn(column, true);
      commit(column);
    },
    [scrub, scrollToColumn, commit],
  );

  // Where the model the stars come from changes: the pen marks it on the strip.
  const changes = useMemo(() => dockHandovers(hours, strip), [hours, strip]);

  /* ---- why these stars ---- */
  const [tip, setTip] = useState<number | null>(null);
  const band = useMemo(() => bandKnots(forecast.rider), [forecast.rider]);
  const explanation = useMemo<HourExplanation | null>(() => {
    const hour = tip === null ? null : hours?.[tip];
    const column = tip === null ? null : strip[tip];
    if (!hour || !column) return null;
    return {
      when: `${dayShort(column.time)} · ${clock(column.time)}`,
      rating: hour.rating,
      daylight: hour.daylight,
      windKn: hour.windKn,
      gustKn: hour.gustKn,
      from: hour.from,
      units,
      riderText: riderWords(forecast.rider),
      sweet: { low: band.sweetLow, high: band.sweetHigh },
      facingKnown: (spot?.facing ?? null) !== null,
      model: hour.model,
      spotOwn: !!hour.model && hour.model === spotOverride(forecast.rider.starsFrom, spot?.id),
    };
  }, [tip, hours, strip, units, forecast.rider, band, spot?.facing, spot?.id]);
  const onStars = useCallback((column: number) => {
    tick();
    setTip(column);
  }, []);

  /* ---- the list ---- */
  const renderDay = useCallback(
    ({ item, index }: ListRenderItemInfo<StripDay>) => (
      <DockDay
        day={item}
        strip={strip}
        g={g}
        hours={hours}
        daylight={daylight}
        layout={layout}
        units={units}
        facing={spot?.facing ?? null}
        spot={!!spot}
        nowHour={nowHour}
        tide={tides?.[index] ?? null}
        tideNote={tideNote}
        more={cells}
        blend={drawing}
        blendNote={view === "blend" ? (blend.lines.length ? null : "Reading the models…") : null}
        scale={scale}
        onHour={choose}
        onStars={onStars}
        handovers={changes}
      />
    ),
    [strip, g, hours, daylight, layout, units, spot, nowHour, tides, tideNote, cells, drawing, view, blend.lines.length, scale, choose, onStars, changes],
  );
  const getItemLayout = useCallback(
    (_: ArrayLike<StripDay> | null | undefined, index: number) => ({
      length: dayLayout[index]?.length ?? 0,
      offset: dayLayout[index]?.offset ?? 0,
      index,
    }),
    [dayLayout],
  );
  const onStripLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setStripWidth(width);
  }, []);

  /* ---- the sheet ---- */
  const sheet = useBottomSheetInternal(true);
  const Scroll = sheet ? BottomSheetScrollView : ScrollView;
  const isStarred = !!spot && starred.includes(spot.id);
  const column = strip[selected];
  const reach = open && onShowOnChart && beyondMapModel(column) ? modelEntry(column!.model) : null;

  if (!strip.length)
    return (
      <View style={styles.root}>
        {resolved ? (
          <View style={styles.state} accessibilityRole="alert">
            <T variant="lead">The forecast could not be read just now</T>
            <T variant="body" color="muted">
              Check the connection; the chart will try again on its own.
            </T>
            <Button label="Try again" kind="pill" size="sm" onPress={wantModels} />
          </View>
        ) : (
          <View style={styles.state} accessibilityLabel="Reading the forecast" accessibilityState={{ busy: true }}>
            <View style={[styles.bone, { width: "45%" }]} />
            <View style={[styles.bone, { width: "100%", height: space["3xl"] }]} />
            <View style={[styles.bone, { width: "100%", height: space["3xl"] }]} />
          </View>
        )}
      </View>
    );

  return (
    <View style={styles.root}>
      <Scroll
        scrollEnabled={open}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- the head ---- */}
        <View style={styles.head}>
          {spot ? (
            <StarToggle on={isStarred} name={spot.name} onToggle={() => favourites.toggle(spot.id)} />
          ) : null}
          <T
            variant="lead"
            numberOfLines={1}
            style={[styles.name, !spot && styles.nameAlone]}
            accessibilityRole="header"
          >
            {spot ? spot.name : "All of Ireland"}
          </T>
          {spot ? <CustomStarsChip /> : null}
          {spot ? <SpotStarsChip spotId={spot.id} /> : null}
          {spot && open ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={more ? "Hide waves, sky and sea" : "Show waves, sky and sea"}
              accessibilityState={{ expanded: more }}
              onPress={() => {
                tick();
                setMore(!more);
              }}
              style={({ pressed }) => [styles.chev, pressed && styles.pressed]}
            >
              <Chevron up={!more} />
            </Pressable>
          ) : null}
        </View>

        <Readout store={scrub} spot={!!spot} hours={hours} strip={strip} units={units} onStep={choose} />

        {open && spot ? (
          <View style={styles.actions}>
            <Segmented<DockView>
              value={view}
              accessibilityLabel="Show the hours as"
              segments={[
                { value: "table", label: "Table" },
                { value: "blend", label: "Blend", accessibilityLabel: "Blend chart of the models" },
              ]}
              onChange={(next) => update((p) => ({ ...p, view: prefsView(next) }))}
            />
            <Button
              kind="primary"
              size="sm"
              label="Spot page"
              accessibilityHint={`Opens ${spot.name}'s week, day by day`}
              onPress={() => onOpenSpotPage(spot.id)}
            />
          </View>
        ) : null}

        {reach ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show ${reach.name} on the chart: the map's own model does not reach this hour`}
            onPress={() => {
              tick();
              onShowOnChart?.();
            }}
            style={({ pressed }) => [styles.reach, pressed && styles.pressedRow]}
          >
            <T variant="label" caps>
              Show {reach.name} on the chart
            </T>
          </Pressable>
        ) : null}

        {/* ---- the strip ---- */}
        <View style={[styles.grid, { height: layout.height }]}>
          <RowLabels layout={layout} width={label} units={unitLabel(units)} drawing={drawing} />
          <View style={styles.strip} onLayout={onStripLayout}>
            <Animated.FlatList
              ref={listRef}
              data={days as StripDay[]}
              horizontal
              keyExtractor={(d: StripDay) => d.date}
              renderItem={renderDay}
              getItemLayout={getItemLayout}
              onScroll={onScroll}
              onContentSizeChange={onContentSizeChange}
              scrollEventThrottle={16}
              snapToOffsets={snaps}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={5}
              removeClippedSubviews
              accessibilityLabel="The fortnight hour by hour: scroll sideways to move through time"
              style={{ height: layout.height }}
            />
          </View>
          <CursorMark
            store={scrub}
            scrollX={scrollX}
            params={params}
            left={label}
            layout={layout}
            strip={strip}
            curve={tide.tide?.curve ?? null}
          />
        </View>

        {open && spot ? <Rule style={styles.footRule} /> : null}
      </Scroll>
      <RatingTip explanation={explanation} onClose={() => setTip(null)} onHow={() => router.push("/stars" as never)} />
    </View>
  );
}

/** The hour under the cursor, in figures, and the time as a screen reader's slider. */
const Readout = memo(function Readout({
  store,
  spot,
  hours,
  strip,
  units,
  onStep,
}: {
  store: ScrubStore;
  spot: boolean;
  hours: readonly import("../../../../src/ratings").PlaceHour[] | null;
  strip: ReturnType<typeof useForecast>["strip"];
  units: import("../../../../force5/src/units").Units;
  onStep: (column: number) => void;
}) {
  const column = useScrub(store);
  const at = strip[column];
  const hour = hours?.[column] ?? null;
  if (!at) return null;
  const reading = hourReading(at, spot ? hour : undefined, units).replace(spot ? "" : ", not read yet", "");
  return (
    <View
      style={styles.readout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Forecast time"
      accessibilityValue={{ text: reading }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const next = column + (event.nativeEvent.actionName === "increment" ? 1 : -1);
        if (next >= 0 && next < strip.length) onStep(next);
      }}
    >
      <T variant="label" caps color="muted">
        {dayShort(at.time)} {clock(at.time)}
      </T>
      {spot ? (
        hours ? (
          <>
            {hour?.rating ? (
              <Stars stars={hour.rating.stars} potential={hour.rating.potential} size={12} best />
            ) : (
              <T variant="caption" color="muted">
                {hour && !hour.daylight ? "dark" : "–"}
              </T>
            )}
            <T variant="figureSm" tabular>
              {windFigures(hour, units)}
            </T>
            {hour?.rating && hour.model ? (
              <T variant="caption" color="muted" numberOfLines={1} style={styles.readoutModel}>
                {modelName(hour.model)}
              </T>
            ) : null}
          </>
        ) : (
          <View style={[styles.bone, { width: space["4xl"] * 2 }]} />
        )
      ) : null}
    </View>
  );
});

/** The cursor: the pen's line, the hour inked at its head, the tide's dot. */
const CursorMark = memo(function CursorMark({
  store,
  scrollX,
  params,
  left,
  layout,
  strip,
  curve,
}: {
  store: ScrubStore;
  scrollX: SharedValue<number>;
  params: TrackParams;
  left: number;
  layout: RowLayout;
  strip: ReturnType<typeof useForecast>["strip"];
  curve: import("../../../../force5/src/tides").TideCurve | null;
}) {
  const column = useScrub(store);
  const style = useAnimatedStyle(
    () => ({ transform: [{ translateX: left + trackCursorAt(params, scrollX.get()) }] }),
    [params, left],
  );
  const hourSlot = layout.at.hour;
  const tideSlot = layout.at.tide;
  const at = strip[column];
  const top = hourSlot?.y ?? 0;
  let dot: number | null = null;
  if (curve && tideSlot && at) {
    const h = tideAt(curve, at.time);
    if (h !== null) dot = tideSlot.y + tideScale(curve, tideSlot.h)(h);
  }
  return (
    <Animated.View pointerEvents="none" style={[styles.cursor, { top, height: layout.height - top }, style]}>
      <View style={styles.cursorLine} />
      {hourSlot && at ? (
        <View style={[styles.cursorHour, { height: hourSlot.h }]}>
          <T allowFontScaling={false} variant="label" color="inkInverse">
            {String(at.hour).padStart(2, "0")}
          </T>
        </View>
      ) : null}
      {dot !== null ? <View style={[styles.tideDot, { top: dot - top - 3.5 }]} /> : null}
    </Animated.View>
  );
});

/** Each row's name as a glyph, in a column that stays while the hours scroll. */
const RowLabels = memo(function RowLabels({
  layout,
  width,
  units,
  drawing,
}: {
  layout: RowLayout;
  width: number;
  units: string;
  drawing: ReturnType<typeof blendDrawing>;
}) {
  const glyph = (row: string) => {
    switch (row) {
      case "wind":
        return (
          <>
            <WindGlyph size={13} />
            <T allowFontScaling={false} variant="eyebrow" color="muted">
              {units}
            </T>
          </>
        );
      case "from":
        return <DirectionGlyph size={12} />;
      case "wing":
        return <WingGlyph size={13} />;
      case "waves":
        return <WavesGlyph size={13} />;
      case "sky":
        return <SkyGlyph icon="partly" size={13} />;
      case "air":
        return <ThermometerGlyph size={13} />;
      case "rain":
        return <SkyGlyph icon="rain" size={13} />;
      case "sea":
        return <SeaTempGlyph size={13} />;
      case "stars":
        return (
          <Svg width={12} height={12}>
            <StarsMark stars={1} potential={1} cx={6} cy={6} size={10} ink={colors.muted} />
          </Svg>
        );
      default:
        return null;
    }
  };
  return (
    <View style={[styles.labels, { width }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {layout.slots.map((slot) =>
        slot.row === "blend" ? (
          <View key={slot.row} style={[styles.label, { top: slot.y, height: slot.h }]}>
            <T allowFontScaling={false} variant="eyebrow" color="muted" style={styles.blendUnit}>
              {units}
            </T>
            {drawing?.ticks.slice(1).map((t) => (
              <T
                key={t.value}
                allowFontScaling={false}
                variant="eyebrow"
                color="muted"
                style={[styles.tick, { top: t.y - 6 }]}
              >
                {t.value}
              </T>
            ))}
          </View>
        ) : (
          <View key={slot.row} style={[styles.label, styles.labelCentre, { top: slot.y, height: slot.h }]}>
            {glyph(slot.row)}
          </View>
        ),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space.xl },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: space.xs,
    paddingRight: space.md,
    minHeight: hitTarget,
  },
  name: { flex: 1, fontFamily: fonts.displayBold },
  // No star beside it: in line with the sheet's own margin (space.lg).
  nameAlone: { paddingLeft: space.md },
  chev: { minWidth: hitTarget, minHeight: hitTarget, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.55 },
  pressedRow: { backgroundColor: colors.sunken },
  readoutModel: { flexShrink: 1 },
  readout: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: space["3xl"],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    gap: space.sm,
  },
  reach: {
    alignSelf: "flex-start",
    marginHorizontal: space.md,
    marginBottom: space.xs,
    paddingHorizontal: space.md,
    minHeight: hitTarget,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.pill,
  },
  grid: {
    flexDirection: "row",
    borderTopWidth: 3,
    borderTopColor: colors.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  strip: { flex: 1 },
  labels: { position: "relative", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line },
  label: { position: "absolute", left: 0, right: 0, paddingHorizontal: space["2xs"] },
  labelCentre: { alignItems: "center", justifyContent: "center" },
  blendUnit: { position: "absolute", left: space["2xs"], top: 0 },
  tick: { position: "absolute", right: space.xs },
  cursor: { position: "absolute", left: 0, width: 0, alignItems: "center" },
  cursorLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: withAlpha(colors.pen, 0.85),
  },
  cursorHour: {
    position: "absolute",
    top: 0,
    width: space["3xl"],
    left: -space.lg,
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  tideDot: {
    position: "absolute",
    left: -3.5,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.magenta,
  },
  footRule: { marginTop: space.md },
  state: { padding: space.lg, gap: space.md },
  bone: { height: space.md, backgroundColor: colors.sunken, borderRadius: radius.control },
});
