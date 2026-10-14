/**
 * The rider's places: every one of the 148 to search, the ones they star and
 * the ones they keep opening, each with every day's best stars, and the
 * nearest to them when they ask. A swipe or a long press stars or unstars a
 * place; a tap opens its page.
 */
import * as Location from "expo-location";
import { router } from "expo-router";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, SectionList, StyleSheet, TextInput, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Svg, { Circle, Path } from "react-native-svg";
import type { Spot } from "../../../../force5/src/weather";
import { Button } from "../../components/Button";
import { KeepStarGlyph } from "../../components/Glyphs";
import { done, tick } from "../../components/haptics";
import { ScreenTitle } from "../../components/List";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast } from "../../data/forecast";
import { allSpots, searchSpots, spotById } from "../../data/spots";
import { colors, fonts, hitTarget, radius, space, type as scale } from "../../theme/tokens";
import { kmText, nearest, placesFor, weekStars, weekWords, type DayStars } from "./spotsLogic";

type Row = { spot: Spot; km?: number };
type Section = { key: string; title: string; data: Row[]; note?: string };

type Here =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "refused" }
  | { kind: "failed" }
  | { kind: "found"; lat: number; lon: number };

export function SpotsScreen() {
  const { store, starred, frequent } = useFavourites();
  const [query, setQuery] = useState("");
  const [here, setHere] = useState<Here>({ kind: "idle" });

  const findMe = useCallback(async () => {
    tick();
    setHere({ kind: "asking" });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return setHere({ kind: "refused" });
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60000 });
      const fix = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      done();
      setHere({ kind: "found", lat: fix.coords.latitude, lon: fix.coords.longitude });
    } catch {
      setHere({ kind: "failed" });
    }
  }, []);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (q) {
      const found = searchSpots(q, 60);
      return [
        {
          key: "found",
          title: found.length ? `${found.length} place${found.length === 1 ? "" : "s"}` : "No place by that name",
          data: found.map((spot) => ({ spot })),
        },
      ];
    }
    const out: Section[] = [];
    const kept = placesFor(starred, spotById);
    out.push({
      key: "starred",
      title: "Starred",
      data: kept.map((spot) => ({ spot })),
      note: kept.length ? undefined : "Star a place, here or on the chart, and its week is kept here.",
    });
    const opened = placesFor(
      frequent.map((v) => v.id).filter((id) => !starred.includes(id)),
      spotById,
    );
    if (opened.length) out.push({ key: "frequent", title: "You look at", data: opened.map((spot) => ({ spot })) });
    out.push({
      key: "near",
      title: "Near you",
      data: here.kind === "found" ? nearest(allSpots(), here).map(({ spot, km }) => ({ spot, km })) : [],
    });
    return out;
  }, [query, starred, frequent, here]);

  const toggle = useCallback(
    (spot: Spot) => {
      const on = store.toggle(spot.id);
      done();
      return on;
    },
    [store],
  );

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(row, index) => `${row.spot.id}-${index}`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <ScreenTitle title="Spots" kicker={`${allSpots().length} riding places`}>
            <SearchField value={query} onChange={setQuery} />
          </ScreenTitle>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <T variant="eyebrow" caps color="muted" accessibilityRole="header">
              {section.title}
            </T>
            {section.key === "near" ? (
              <Button
                kind="pill"
                size="sm"
                label={here.kind === "found" ? "Again" : "Near me"}
                busy={here.kind === "asking"}
                accessibilityHint="Uses your location once, to list the nearest places"
                onPress={findMe}
              />
            ) : null}
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.note ? (
            <T variant="body" color="muted" style={styles.note}>
              {section.note}
            </T>
          ) : section.key === "near" && here.kind !== "found" ? (
            <T variant="body" color="muted" style={styles.note}>
              {here.kind === "refused"
                ? "Location is off for wingfoil.ie. Turn it on in Settings to list the places nearest you."
                : here.kind === "failed"
                  ? "Your location could not be found just now."
                  : "Your location is only read when you ask, and never leaves the phone."}
            </T>
          ) : null
        }
        renderItem={({ item }) => (
          <SpotRow spot={item.spot} km={item.km} starred={starred.includes(item.spot.id)} onToggle={toggle} />
        )}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="never"
      />
    </View>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <View style={styles.search}>
      <Svg width={16} height={16} viewBox="0 0 16 16" accessible={false}>
        <Circle cx={7} cy={7} r={5} fill="none" stroke={colors.ink} strokeWidth={1.5} />
        <Path d="M11 11l3.5 3.5" stroke={colors.ink} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Find a spot…"
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Find a spot by name or county"
        style={styles.input}
        maxFontSizeMultiplier={1.6}
      />
    </View>
  );
}

/** One place: its name, its county or distance, and its week of best stars. */
const SpotRow = memo(function SpotRow({
  spot,
  km,
  starred,
  onToggle,
}: {
  spot: Spot;
  km?: number;
  starred: boolean;
  onToggle: (spot: Spot) => boolean;
}) {
  const { hours, version, days, strip, now } = useForecast();
  const place = hours.get(spot.id) ?? null;
  const week = useMemo(
    () => weekStars(place, days, strip, now),
    // `hours` is one Map filled in place; `version` says when it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [place, days, strip, now, version],
  );
  const swipe = useRef<SwipeableMethods>(null);
  const open = () => router.push({ pathname: "/spot/[id]", params: { id: spot.id } });
  const flip = () => {
    onToggle(spot);
    swipe.current?.close();
  };
  const where = km !== undefined ? kmText(km) : spot.county;
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.6}
      rightThreshold={hitTarget}
      overshootRight={false}
      onSwipeableOpen={flip}
      renderRightActions={() => (
        <View style={[styles.action, starred ? styles.actionOff : styles.actionOn]}>
          <KeepStarGlyph on={!starred} size={20} />
          <T variant="label" caps color={starred ? "ink" : "inkInverse"}>
            {starred ? "Unstar" : "Star"}
          </T>
        </View>
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${spot.name}, ${where}${starred ? ", starred" : ""}. ${weekWords(week)}`}
        accessibilityHint="Opens its week, day by day"
        accessibilityActions={[{ name: "activate" }, { name: "star", label: starred ? "Unstar" : "Star" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "star") onToggle(spot);
          else open();
        }}
        onPress={open}
        onLongPress={() => onToggle(spot)}
        delayLongPress={350}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.rowHead}>
          {starred ? <KeepStarGlyph on size={13} /> : null}
          <T variant="spot" numberOfLines={1} style={styles.name}>
            {spot.name}
          </T>
          <T variant="caption" color="muted" numberOfLines={1}>
            {where}
          </T>
        </View>
        <Week week={week} />
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const Week = memo(function Week({ week }: { week: readonly DayStars[] }) {
  return (
    <View style={styles.week}>
      {week.map((day) => (
        <View key={day.date} style={styles.day}>
          <T variant="eyebrow" caps color="muted" maxFontSizeMultiplier={1.2}>
            {day.label}
          </T>
          {day.kind === "rated" ? (
            day.potential > 0 ? (
              <Stars stars={day.stars} potential={day.potential} size={6.5} best />
            ) : (
              <T variant="eyebrow" color="muted">
                –
              </T>
            )
          ) : day.kind === "dark" ? (
            <T variant="eyebrow" color="muted">
              ·
            </T>
          ) : (
            <View style={styles.bone} />
          )}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  list: { paddingBottom: space["4xl"] * 2 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    minHeight: hitTarget,
  },
  input: {
    ...scale.prose,
    flex: 1,
    fontFamily: fonts.bodyItalic,
    color: colors.ink,
    minHeight: hitTarget,
    paddingVertical: space.sm,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.xl,
    marginHorizontal: space.lg,
    paddingBottom: space.xs,
    minHeight: hitTarget,
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
  },
  note: { paddingHorizontal: space.lg, paddingTop: space.sm, fontFamily: fonts.bodyItalic },
  row: {
    backgroundColor: colors.paper,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.xs,
    minHeight: hitTarget + space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  rowHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  name: { flexShrink: 1 },
  week: { flexDirection: "row", justifyContent: "space-between" },
  day: { alignItems: "center", gap: space["2xs"], minWidth: space["3xl"] },
  bone: { width: space["3xl"], height: space.sm, backgroundColor: colors.sunken, borderRadius: radius.control },
  action: {
    width: 104,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
  actionOn: { backgroundColor: colors.ink },
  actionOff: { backgroundColor: colors.sunken },
});
