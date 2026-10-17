/**
 * The chart's head, top left (src/MapHead.tsx): "Find a spot…", whose list
 * opens under it as the rider types; with nothing typed it offers the
 * rider's starred spots and, once the phone has said where it is, the
 * nearest ones. Each place carries its stars and wind at the hour the
 * chart's lights show, never a day's best. A box of paper in an ink rule,
 * never glass over the map.
 */
import { memo, useMemo, useState, type RefObject } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { Units } from "../../../../force5/src/units";
import type { Spot } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { tick } from "../../components/haptics";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { distanceKm, searchSpots, spotById } from "../../data/spots";
import { colors, fonts, hitTarget, radius, shadow, space } from "../../theme/tokens";
import { windFigures } from "../dock/dockLogic";
import { CloseGlyph, SearchGlyph } from "./ChartControls";

interface Props {
  inputRef: RefObject<TextInput | null>;
  spots: readonly Spot[];
  starred: readonly string[];
  /** A place's rated hour at the time the lights show, where there is one. */
  hourAt: (id: string) => PlaceHour | null;
  units: Units;
  me: { lat: number; lon: number } | null;
  /** Open the list (after locating, to show the nearest). */
  open: boolean;
  onOpen: (open: boolean) => void;
  onPick: (spot: Spot) => void;
}

interface Row {
  spot: Spot;
  note?: string;
}

export const ChartHeader = memo(function ChartHeader({
  inputRef,
  spots,
  starred,
  hourAt,
  units,
  me,
  open,
  onOpen,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");
  const hits = useMemo<Row[]>(() => {
    const q = query.trim();
    if (!q) return [];
    // The best match first: a name's start, then within it, then a county's (data/spots.ts).
    return searchSpots(q, 9).map((spot) => ({ spot }));
  }, [query]);
  const own = useMemo<Row[]>(
    () => starred.flatMap((id) => (spotById(id) ? [{ spot: spotById(id)! }] : [])),
    [starred],
  );
  const nearest = useMemo<Row[]>(() => {
    if (!me) return [];
    return spots
      .map((spot) => ({ spot, km: distanceKm(me, spot) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5)
      .map(({ spot, km }) => ({ spot, note: km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km` }));
  }, [me, spots]);

  const pick = (spot: Spot) => {
    tick();
    setQuery("");
    onOpen(false);
    Keyboard.dismiss();
    inputRef.current?.blur();
    onPick(spot);
  };

  const typed = query.trim().length > 0;
  const sections: { title: string; rows: Row[] }[] = typed
    ? [{ title: "", rows: hits }]
    : [
        ...(nearest.length ? [{ title: "Nearest you", rows: nearest }] : []),
        ...(own.length ? [{ title: "Your spots", rows: own }] : []),
      ];
  const showing = open && (typed || sections.length > 0);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.box}>
        <View style={styles.glyph} accessible={false}>
          <SearchGlyph />
        </View>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            onOpen(true);
          }}
          onFocus={() => onOpen(true)}
          onBlur={() => {
            // A tap on the list lands before it closes (keyboardShouldPersistTaps).
            if (!query) setTimeout(() => onOpen(false), 150);
          }}
          placeholder="Find a spot…"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Find a spot"
          accessibilityHint="Type a spot's name, a county or another name for it"
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          onSubmitEditing={() => hits[0] && pick(hits[0].spot)}
          style={[styles.input, { fontFamily: query ? fonts.body : fonts.bodyItalic }]}
          maxFontSizeMultiplier={1.4}
        />
        {(query.length > 0 || open) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={query ? "Clear the search" : "Close the list"}
            hitSlop={4}
            onPress={() => {
              if (query) setQuery("");
              else {
                onOpen(false);
                inputRef.current?.blur();
                Keyboard.dismiss();
              }
            }}
            style={styles.clear}
          >
            <CloseGlyph />
          </Pressable>
        )}
      </View>
      {showing && (
        <View style={styles.results}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} accessibilityRole="list">
            {typed && !hits.length && (
              <T variant="body" color="muted" style={styles.none}>
                No spot by that name.
              </T>
            )}
            {sections.map((section) => (
              <View key={section.title || "hits"}>
                {section.title ? (
                  <T variant="eyebrow" caps color="muted" style={styles.heading} accessibilityRole="header">
                    {section.title}
                  </T>
                ) : null}
                {section.rows.map(({ spot, note }) => {
                  const hour = hourAt(spot.id);
                  const rating = hour?.rating ?? null;
                  const wind = hour ? windFigures(hour, units) : "";
                  return (
                    <Pressable
                      key={spot.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${spot.name}${spot.county ? `, ${spot.county}` : ""}${note ? `, ${note} away` : ""}${rating ? `, ${rating.stars} star${rating.stars === 1 ? "" : "s"} at this hour, wind ${wind}` : ""}`}
                      onPress={() => pick(spot)}
                      style={({ pressed }) => [styles.row, pressed && styles.rowDown]}
                    >
                      <View style={styles.rowText}>
                        <T variant="spot" numberOfLines={1}>
                          {spot.name}
                        </T>
                        <T variant="caption" color="muted" numberOfLines={1}>
                          {[spot.county, note].filter(Boolean).join(" · ")}
                        </T>
                      </View>
                      {rating ? (
                        <View style={styles.hour}>
                          <Stars stars={rating.stars} potential={rating.potential} size={10} best />
                          <T variant="caption" tabular color="muted" numberOfLines={1}>
                            {wind}
                          </T>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: hitTarget,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.box,
    boxShadow: shadow.surface,
  },
  glyph: { paddingLeft: space.md, paddingRight: space.xs },
  input: {
    flex: 1,
    minHeight: hitTarget,
    fontSize: 16,
    color: colors.ink,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
  },
  clear: { width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" },
  results: {
    marginTop: space.xs,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.box,
    boxShadow: shadow.surface,
    maxHeight: 340,
  },
  scroll: { flexGrow: 0 },
  heading: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.xs },
  none: { padding: space.md },
  row: {
    minHeight: hitTarget + space.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowDown: { backgroundColor: colors.sunken },
  rowText: { flex: 1, paddingVertical: space.xs },
  hour: { alignItems: "flex-end", gap: space["2xs"] },
});
