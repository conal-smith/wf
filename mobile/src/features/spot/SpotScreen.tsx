/**
 * A riding place's own page (spot/web/SpotApp.tsx), set as the chart's
 * broadsheet: the place's shore and sea in one line, who the stars are rated
 * for, the week in one strip, then day after day down the page under sticky
 * heads, every daylight hour a row of figures, the night folded either side,
 * and the tide and the light under each day. No day is rated: the hours are.
 *
 * It reads the app's one forecast (`useSpotHours`), so its stars are the
 * dock's and the chart's light's. `?t=<iso>` opens it on that hour.
 */
import { Stack, router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
  type SectionListData,
  type ViewToken,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { SHORE_LABEL } from "../../../../force5/src/stars";
import { compass } from "../../../../force5/src/weather";
import {
  HOUR,
  bandKnots,
  clock,
  dayNames,
  dublinDate,
  foldText,
  goodWindArcs,
  gustJumps,
  windIn,
} from "../../../../spot/web/spot";
import { Button } from "../../components/Button";
import { SkyGlyph, StarToggle, WindArrow } from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { RatingTip, type HourExplanation } from "../../components/RatingTip";
import { Rule } from "../../components/Rule";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast, useSpotHours } from "../../data/forecast";
import { usePrefs } from "../../data/prefs";
import { searchSpots, spotById } from "../../data/spots";
import { colors, fonts, hitTarget, radius, space } from "../../theme/tokens";
import { hourReading, moreCells, wingFor } from "../dock/dockLogic";
import { useMarine, useSpotTide } from "../dock/useDockData";
import { tideCredit } from "../../../../force5/src/tides";
import { RiderLine } from "../settings/RiderFields";
import { riderWords } from "../settings/settingsLogic";
import { DayTide } from "./DayTide";
import {
  dayItems,
  pageDays,
  pageRows,
  parseTimeParam,
  rowAt,
  shareContent,
  tideCeiling,
  type DayItem,
  type PageDay,
  type PageRow,
} from "./spotLogic";
import { WeekStrip } from "./WeekStrip";

type Section = SectionListData<DayItem, { key: string; entry: PageDay }>;

export function SpotScreen({ id, t }: { id: string; t?: string | string[] }) {
  const spot = spotById(id);
  if (!spot) return <UnknownSpot id={id} />;
  return <SpotPage id={id} t={t} />;
}

function SpotPage({ id, t }: { id: string; t?: string | string[] }) {
  const spot = spotById(id)!;
  const forecast = useForecast();
  const { strip, axis, now, openSpot, resolved, wantModels, selectTime } =
    forecast;
  const { prefs } = usePrefs();
  const units = prefs.units;
  const { store: favourites, starred } = useFavourites();
  const hours = useSpotHours(id);
  const { width } = useWindowDimensions();
  const facing = spot.facing ?? null;

  // Opening the page opens the spot: its square is read, and it counts as a visit.
  useEffect(() => {
    openSpot(id);
  }, [id, openSpot]);

  const tide = useSpotTide(id);
  const marine = useMarine(spot, axis, true);
  const cells = useMemo(
    () => moreCells(strip, marine.waves, marine.weather, marine.sea),
    [strip, marine.waves, marine.weather, marine.sea],
  );
  const rows = useMemo(
    () => (hours ? pageRows(strip, hours, now, facing, cells) : []),
    [hours, strip, now, facing, cells],
  );
  const days = useMemo(
    () => pageDays(rows, spot.lat, spot.lon),
    [rows, spot.lat, spot.lon],
  );
  // `?t=` names an hour: its day's night is unfolded if it is dark, and its
  // detail opened. A tap flips either from there.
  const wanted = useMemo(() => parseTimeParam(t, now), [t, now]);
  const landing = useMemo(
    () => (wanted === null ? null : rowAt(days, wanted)),
    [wanted, days],
  );
  const [nightsFlipped, setNights] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openFlipped, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const nightShown = useCallback(
    (date: string) =>
      nightsFlipped.has(date) !== (!!landing?.dark && landing.date === date),
    [nightsFlipped, landing],
  );
  const rowOpen = (time: number) =>
    openFlipped.has(time) !== (landing?.row.time === time);
  const sections = useMemo<Section[]>(
    () =>
      days.map((entry) => ({
        key: entry.day.date,
        entry,
        data: dayItems(entry, nightShown(entry.day.date), (edge, run) =>
          foldText(edge, run, entry.sun, run.length < entry.day.rows.length),
        ),
      })),
    [days, nightShown],
  );
  const band = useMemo(() => bandKnots(forecast.rider), [forecast.rider]);
  const curve = tide.tide?.curve ?? null;
  const ceiling = useMemo(() => tideCeiling(curve), [curve]);
  const tideNote = tide.loading
    ? null
    : (tide.error ?? (tide.tide ? null : "No tide station near"));
  const isStarred = starred.includes(id);

  /* ---- the week strip follows the day at the top ---- */
  const [current, setCurrent] = useState<string | null>(null);
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const top = viewableItems.find((v) => v.section);
      const key = (top?.section as { key?: string } | undefined)?.key;
      if (key) setCurrent(key);
    },
    [],
  );
  const list =
    useRef<SectionList<DayItem, { key: string; entry: PageDay }>>(null);
  const goTo = useCallback(
    (date: string, item = 0) => {
      const sectionIndex = sections.findIndex((s) => s.key === date);
      if (sectionIndex < 0) return;
      setCurrent(date);
      list.current?.scrollToLocation({
        sectionIndex,
        itemIndex: item,
        viewOffset: 0,
        animated: true,
      });
    },
    [sections],
  );

  /* ---- ?t= opens on that hour ---- */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !landing) return;
    const section = sections.find((s) => s.key === landing.date);
    const index =
      section?.data.findIndex(
        (item) => item.kind === "row" && item.row === landing.row,
      ) ?? -1;
    if (index < 0) return;
    // The section's head is index 0 of its run in the list.
    const timer = setTimeout(() => {
      landed.current = true;
      goTo(landing.date, index + 1);
    }, 250);
    return () => clearTimeout(timer);
  }, [landing, sections, goTo]);

  /* ---- why these stars ---- */
  const [tip, setTip] = useState<PageRow | null>(null);
  const explanation = useMemo<HourExplanation | null>(
    () =>
      tip
        ? {
            when: `${dayNames(dublinDate(tip.time), now).short} · ${clock(tip.time)}`,
            rating: tip.rating,
            daylight: tip.hour.daylight,
            windKn: tip.place.windKn,
            gustKn: tip.place.gustKn,
            from: tip.place.from,
            units,
            riderText: riderWords(forecast.rider),
            sweet: { low: band.sweetLow, high: band.sweetHigh },
            facingKnown: facing !== null,
          }
        : null,
    [tip, now, units, forecast.rider, band, facing],
  );

  const share = useCallback(() => {
    tick();
    const content = shareContent(spot.name, id);
    void Share.share({
      title: content.title,
      message: content.message,
      url: content.url,
    }).catch(() => undefined);
  }, [spot.name, id]);

  const toggleRow = useCallback((time: number) => {
    tick();
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(time)) next.delete(time);
      else next.add(time);
      return next;
    });
  }, []);
  const showOnChart = useCallback(
    (row: PageRow) => {
      selectTime(strip[row.column].validTime);
      router.navigate("/");
    },
    [selectTime, strip],
  );

  const arcs = facing === null ? [] : goodWindArcs(facing);
  const sea = marine.sea.observed;
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const contentWidth = width - space.lg * 2;

  const header = (
    <View style={styles.top}>
      <View style={styles.meta}>
        <T variant="label" caps color="muted">
          {facing !== null
            ? `Faces ${compass(facing)} ${Math.round(facing)}°${
                arcs.length
                  ? ` · best ${arcs.map((a) => (a.from === a.to ? a.from : `${a.from}–${a.to}`)).join(", ")}`
                  : ""
              }`
            : "Facing unknown: rated on the wind alone"}
          {spot.county ? ` · ${spot.county}` : ""}
          {sea ? ` · Sea ${sea.latest.value.toFixed(1)}°` : ""}
        </T>
      </View>
      <RiderLine />
      {days.length ? (
        <WeekStrip
          days={days}
          current={current ?? days[0].day.date}
          now={now}
          onSelect={(date) => goTo(date)}
        />
      ) : null}
      <Button
        kind="primary"
        label="Set an alert for this spot"
        accessibilityHint="Tells you when the stars here reach what you ask for"
        onPress={() =>
          router.push({
            pathname: "/alert/[id]",
            params: { id: "new", spot: id },
          })
        }
      />
    </View>
  );

  const renderItem = ({
    item,
    section,
  }: {
    item: DayItem;
    section: Section;
  }) => {
    if (item.kind === "fold") {
      const shown = nightShown(section.key);
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: shown }}
          accessibilityLabel={`${item.text}, not rated. ${shown ? "Hide" : "Show"} the dark hours`}
          onPress={() => {
            tick();
            setNights((was) => {
              const next = new Set(was);
              if (next.has(section.key)) next.delete(section.key);
              else next.add(section.key);
              return next;
            });
          }}
          style={({ pressed }) => [styles.fold, pressed && styles.pressed]}
        >
          <T variant="caption" color="muted" style={styles.foldText}>
            {item.text} · not rated
          </T>
          <T variant="label" caps style={styles.foldAction}>
            {shown ? "Hide" : "Show"}
          </T>
        </Pressable>
      );
    }
    if (item.kind === "tide")
      return (
        <DayTide
          date={section.key}
          curve={curve}
          sun={section.entry.sun}
          now={now}
          width={contentWidth}
          ceiling={ceiling}
          note={tideNote}
        />
      );
    return (
      <HourRow
        item={item}
        units={units}
        facing={facing}
        nowHour={nowHour}
        open={rowOpen(item.row.time)}
        reading={hourReading(strip[item.row.column], item.row.place, units)}
        onToggle={toggleRow}
        onStars={setTip}
        onChart={showOnChart}
      />
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: spot.name,
          headerLargeTitleEnabled: true,
          headerRight: () => (
            <View style={styles.headerActions}>
              <StarToggle
                on={isStarred}
                name={spot.name}
                onToggle={() => favourites.toggle(id)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Share ${spot.name}'s forecast`}
                onPress={share}
                style={styles.headerButton}
              >
                <ShareGlyph />
              </Pressable>
            </View>
          ),
        }}
      />
      {!hours ? (
        <View style={styles.state}>
          {header}
          {resolved && !strip.length ? (
            <View style={styles.notice} accessibilityRole="alert">
              <T variant="prose">The forecast could not be read just now.</T>
              <Button kind="pill" label="Try again" onPress={wantModels} />
            </View>
          ) : (
            <View
              accessibilityLabel="Reading the forecast"
              accessibilityState={{ busy: true }}
              style={styles.skeleton}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <View
                  key={i}
                  style={[styles.bone, { width: `${92 - (i % 3) * 14}%` }]}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        <SectionList
          ref={list}
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <DayHeader
              entry={section.entry}
              now={now}
              unit={units}
            />
          )}
          stickySectionHeadersEnabled
          ListHeaderComponent={header}
          ListFooterComponent={<Sources tide={tide} sea={marine.sea} />}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.list}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
          initialNumToRender={20}
          windowSize={9}
          onScrollToIndexFailed={(info) => {
            list.current
              ?.getScrollResponder()
              ?.scrollTo({
                y: info.averageItemLength * info.index,
                animated: false,
              });
          }}
        />
      )}
      <RatingTip
        explanation={explanation}
        onClose={() => setTip(null)}
        onHow={() => router.push("/stars" as never)}
      />
    </View>
  );
}

/** A day's head, sticky while its hours scroll under it, with the columns' names. */
const DayHeader = memo(function DayHeader({
  entry,
  now,
  unit,
}: {
  entry: PageDay;
  now: number;
  unit: string;
}) {
  const names = dayNames(entry.day.date, now);
  return (
    <View style={styles.dayHead}>
      <View style={styles.dayLine}>
        <T variant="lead" accessibilityRole="header">
          {names.long} {names.date.split(" ")[0]}
        </T>
        {names.relative === "Today" || names.relative === "Tomorrow" ? (
          <T variant="eyebrow" caps color="muted">
            {names.relative}
          </T>
        ) : null}
      </View>
      {entry.day.rows.some((r) => r.hour.daylight) ? (
        <View
          style={styles.heads}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <T variant="eyebrow" caps color="muted" style={styles.cTime}>
            IST
          </T>
          <T variant="eyebrow" caps color="muted" style={styles.cStars}>
            Stars
          </T>
          <T variant="eyebrow" caps color="muted" style={styles.cWind}>
            Wind {unit}
          </T>
          <T variant="eyebrow" caps color="muted" style={styles.cFrom}>
            From
          </T>
          <T variant="eyebrow" caps color="muted" style={styles.cWing}>
            Wing
          </T>
          <T variant="eyebrow" caps color="muted" style={styles.cSky}>
            Sky
          </T>
        </View>
      ) : null}
    </View>
  );
});

/** One hour: figures, not words; a tap opens its second line. */
const HourRow = memo(function HourRow({
  item,
  units,
  facing,
  nowHour,
  open,
  reading,
  onToggle,
  onStars,
  onChart,
}: {
  item: Extract<DayItem, { kind: "row" }>;
  units: import("../../../../force5/src/units").Units;
  facing: number | null;
  nowHour: number;
  open: boolean;
  reading: string;
  onToggle: (time: number) => void;
  onStars: (row: PageRow) => void;
  onChart: (row: PageRow) => void;
}) {
  const { row } = item;
  const { place, rating } = row;
  const wing = wingFor(rating);
  const jump = place.windKn !== null && gustJumps(place.windKn, place.gustKn);
  const off = rating?.shore === "offshore" || rating?.shore === "cross-off";
  const isNow = row.time === nowHour;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${reading}${wing ? `, ${wing} square metre wing` : ""}${row.wave ? `, waves ${row.wave.words}` : ""}${
          row.air !== null ? `, air ${row.air} degrees` : ""
        }${row.sky ? `, ${row.sky.words}` : ""}`}
        accessibilityHint={
          open ? "Hides the hour's detail" : "Shows the hour's detail"
        }
        accessibilityActions={[
          { name: "activate" },
          ...(rating ? [{ name: "stars", label: "Why these stars" }] : []),
          { name: "chart", label: "Show on the chart" },
        ]}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName;
          if (name === "activate") onToggle(row.time);
          else if (name === "stars") onStars(row);
          else if (name === "chart") onChart(row);
        }}
        onPress={() => onToggle(row.time)}
        onLongPress={() => {
          tick();
          onChart(row);
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <T
          variant="figureSm"
          tabular
          style={[styles.cTime, styles.time, isNow && styles.now]}
        >
          {clock(row.time).slice(0, 2)}
        </T>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no"
          onPress={() => {
            if (!rating) return onToggle(row.time);
            tick();
            onStars(row);
          }}
          style={styles.cStars}
          hitSlop={{ top: 6, bottom: 6 }}
        >
          {rating ? (
            <Stars
              stars={rating.stars}
              potential={rating.potential}
              size={10}
              best
            />
          ) : (
            <T variant="caption" color="muted">
              {row.hour.daylight ? "–" : "dark"}
            </T>
          )}
        </Pressable>
        <View style={[styles.cWind, styles.wind]}>
          {place.windKn !== null ? (
            <>
              <T variant="figure" tabular style={styles.figure}>
                {windIn(place.windKn, units)}
              </T>
              {place.gustKn !== null ? (
                <T
                  variant="figureSm"
                  tabular
                  color={jump ? "penInk" : "muted"}
                  style={styles.gust}
                >
                  {windIn(place.gustKn, units)}
                </T>
              ) : null}
            </>
          ) : (
            <T variant="caption" color="muted">
              –
            </T>
          )}
        </View>
        <View style={[styles.cFrom, styles.from]}>
          {place.from !== null ? (
            <>
              <WindArrow
                from={place.from}
                size={15}
                color={off ? colors.pen : colors.ink}
              />
              <T variant="eyebrow" color={off ? "penInk" : "muted"}>
                {compass(place.from)}
              </T>
            </>
          ) : null}
        </View>
        <T variant="figureSm" tabular style={styles.cWing}>
          {wing !== null ? `${wing} m` : "–"}
        </T>
        <View style={[styles.cSky, styles.sky]}>
          {row.sky ? <SkyGlyph icon={row.sky.icon} size={16} /> : null}
          {row.air !== null ? (
            <T variant="figureSm" tabular>
              {row.air}°
            </T>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <View style={styles.more}>
          {rating ? (
            <T variant="figureSm">
              {rating.potential > 0
                ? `${rating.wing.own ?? rating.wing.recommended} m wing`
                : "No stars"}
            </T>
          ) : (
            <T variant="body" color="muted">
              {place.windKn === null ? "No wind reading." : "Dark: not rated."}
            </T>
          )}
          <View style={styles.moreFacts}>
            {place.from !== null ? (
              <T variant="caption" color="muted">
                {row.shore
                  ? SHORE_LABEL[row.shore]
                  : facing === null
                    ? "facing unknown"
                    : ""}
              </T>
            ) : null}
            <T variant="caption" color="muted">
              waves {row.wave ? row.wave.words : "–"}
            </T>
            {row.rain && row.rain.own && row.rain.text !== "0" ? (
              <T variant="caption" color="muted">
                rain {row.rain.text} mm
              </T>
            ) : null}
          </View>
          {rating?.reasons.map((reason) => (
            <T key={reason} variant="body" color="penInk" style={styles.reason}>
              − {reason}
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
});

function ShareGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1"
        fill="none"
        stroke={colors.ink}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Where this comes from (the site's SourcesFooter), and the one line of care. */
function Sources({
  tide,
  sea,
}: {
  tide: ReturnType<typeof useSpotTide>;
  sea: ReturnType<typeof useMarine>["sea"];
}) {
  const { published, models } = useForecast();
  const wind = published
    ? published.sources
        .map((s) => `${s.name} (${s.runTime.slice(11, 16)} UTC)`)
        .join(", ")
    : models
        .filter((m) => m.wind)
        .map((m) => `${m.entry.name} (${m.wind!.runTime.slice(11, 16)} UTC)`)
        .join(", ");
  return (
    <View style={styles.sources}>
      <Rule strong />
      <T variant="eyebrow" caps color="muted" accessibilityRole="header">
        Where this comes from
      </T>
      <T variant="body" color="ink2">
        Wind: {wind || "the models' blend"}.
      </T>
      {tide.tide ? (
        <T variant="body" color="ink2">
          Tides: {tide.tide.station.name}, {tide.tide.distanceKm.toFixed(0)} km
          away, above {tide.tide.curve.datum}
          {tide.manifest && tideCredit(tide.manifest, tide.tide.station)
            ? ` · ${tideCredit(tide.manifest, tide.tide.station)}`
            : ""}
          .
        </T>
      ) : null}
      {sea.observed ? (
        <T variant="body" color="ink2">
          Sea: {sea.observed.station.name}
          {sea.manifest?.attribution ? ` · ${sea.manifest.attribution}` : ""}.
        </T>
      ) : null}
      <T variant="body" color="ink2">
        Times are Irish.
      </T>
      <Button
        kind="quiet"
        size="sm"
        label="How the stars work"
        onPress={() => router.push("/stars" as never)}
      />
      <T variant="body" style={styles.safety}>
        Model forecasts only, not a safety statement. Look at the water, and
        never ride alone in offshore wind.
      </T>
    </View>
  );
}

function UnknownSpot({ id }: { id: string }) {
  const candidates = useMemo(() => {
    const words = id.replace(/[-_]+/g, " ");
    const found = searchSpots(words, 6);
    if (found.length) return found;
    const longest = words.split(" ").sort((a, b) => b.length - a.length)[0];
    return longest && longest.length >= 4 ? searchSpots(longest, 6) : [];
  }, [id]);
  return (
    <View style={[styles.root, styles.unknown]}>
      <Stack.Screen options={{ title: "Spot not found" }} />
      <T variant="title">No riding place at this address</T>
      <T variant="prose" color="ink2">
        Nothing is called “{id}”.{" "}
        {candidates.length
          ? "Did you mean one of these?"
          : "It may have been renamed."}
      </T>
      {candidates.map((spot) => (
        <Pressable
          key={spot.id}
          accessibilityRole="link"
          accessibilityLabel={`${spot.name}, ${spot.county}`}
          onPress={() =>
            router.replace({ pathname: "/spot/[id]", params: { id: spot.id } })
          }
          style={({ pressed }) => [styles.place, pressed && styles.pressed]}
        >
          <T variant="spot">{spot.name}</T>
          <T variant="caption" color="muted">
            {spot.county}
          </T>
        </Pressable>
      ))}
      <Button
        kind="pill"
        label="All places"
        onPress={() => router.navigate("/spots")}
      />
    </View>
  );
}

const C = { time: 32, stars: 64, wind: 62, from: 58, wing: 44 } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: space.lg, paddingBottom: space["4xl"] },
  top: { gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
  meta: { flexDirection: "row", flexWrap: "wrap" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerButton: {
    minWidth: hitTarget,
    minHeight: hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  state: { flex: 1, paddingHorizontal: space.lg },
  notice: { gap: space.md, paddingVertical: space.lg },
  skeleton: { gap: space.md, paddingTop: space.lg },
  bone: {
    height: space.xl,
    backgroundColor: colors.sunken,
    borderRadius: radius.control,
  },
  dayHead: {
    backgroundColor: colors.paper,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
    paddingTop: space.md,
  },
  dayLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.xs,
  },
  heads: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: hitTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  cTime: { width: C.time },
  cStars: { width: C.stars, minHeight: hitTarget, justifyContent: "center" },
  cWind: { width: C.wind },
  cFrom: { width: C.from },
  cWing: { width: C.wing },
  cSky: { flex: 1 },
  time: { fontFamily: fonts.monoBold },
  now: { color: colors.now },
  wind: { flexDirection: "row", alignItems: "flex-start" },
  figure: { fontSize: 17, lineHeight: 20 },
  gust: { fontSize: 11, lineHeight: 12 },
  from: { flexDirection: "row", alignItems: "center", gap: space.xs },
  sky: { flexDirection: "row", alignItems: "center", gap: space.xs },
  more: {
    paddingLeft: C.time,
    paddingBottom: space.md,
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  moreFacts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md },
  reason: { fontFamily: fonts.bodyItalic },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: hitTarget,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  foldText: { flex: 1, fontFamily: fonts.mono },
  foldAction: { textDecorationLine: "underline" },
  sources: { gap: space.sm, paddingTop: space["2xl"] },
  safety: { fontFamily: fonts.displayBold },
  unknown: { padding: space.lg, gap: space.md },
  place: {
    minHeight: hitTarget,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
