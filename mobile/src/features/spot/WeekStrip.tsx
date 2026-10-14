/**
 * The week across one ruled strip, a column a day (spot/web/WeekStrip.tsx):
 * its name, its best stars and the hours of its best window. The day being
 * read is on the second sheet with an ink rule under it; a tap takes the page
 * down to it.
 */
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { dayNames, windowHours } from "../../../../spot/web/spot";
import { tick } from "../../components/haptics";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { colors, fonts, hitTarget, space } from "../../theme/tokens";
import type { PageDay } from "./spotLogic";

export const WeekStrip = memo(function WeekStrip({
  days,
  current,
  now,
  onSelect,
}: {
  days: readonly PageDay[];
  current: string;
  now: number;
  onSelect: (date: string) => void;
}) {
  return (
    <View style={styles.base} accessibilityRole="tablist" accessibilityLabel="The week">
      {days.map(({ day, window }) => {
        const names = dayNames(day.date, now);
        const on = day.date === current;
        return (
          <Pressable
            key={day.date}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${names.full}: ${
              window ? `${window.stars} of 5 stars, ${windowHours(window)}` : "no stars"
            }`}
            onPress={() => {
              tick();
              onSelect(day.date);
            }}
            style={({ pressed }) => [styles.day, on && styles.on, pressed && styles.pressed]}
          >
            <T variant="body" style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {names.short}
            </T>
            <Stars
              stars={window ? window.stars : 0}
              potential={window ? window.potential : day.potential}
              size={7}
              best
            />
            <T variant="caption" tabular style={styles.hours} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {window ? windowHours(window) : "–"}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    borderTopWidth: 2,
    borderTopColor: colors.ink,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ink,
  },
  day: {
    flex: 1,
    minHeight: hitTarget + space.lg,
    paddingHorizontal: space["2xs"],
    paddingVertical: space.xs,
    alignItems: "center",
    gap: space["2xs"],
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.line,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  on: { backgroundColor: colors.sunken, borderBottomColor: colors.ink },
  pressed: { backgroundColor: colors.sunken },
  name: { fontFamily: fonts.displayBold },
  hours: { fontFamily: fonts.monoBold },
});
