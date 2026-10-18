/**
 * The ways into "Your star rating" (YourStarsScreen.tsx), as the pattern draws
 * them (design-system/patterns/your-stars.html): the rider settings' Star
 * rating row, "Standard for Riding" with Customise, or "Custom" with Edit and
 * Reset; and the chip a rider's own stars put in the forecast's head.
 */
import { router } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, controlHeight, hitTarget, radius, space } from "../../theme/tokens";
import { starRatingText } from "../settings/settingsLogic";

export const openYourStars = () => router.push("/your-stars" as never);

function Act({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [styles.act, pressed && styles.pressed]}
    >
      <T variant="prose" style={styles.link}>
        {label}
      </T>
    </Pressable>
  );
}

/** "Standard for Riding · Customise", or "Custom · Edit · Reset". */
export function StarRatingRow() {
  const { prefs, setCustomStars } = usePrefs();
  const custom = !!prefs.rider.custom;
  return (
    <View style={styles.row}>
      <T variant="prose" style={styles.value}>
        {starRatingText(prefs.rider)}
      </T>
      {custom ? (
        <>
          <Act label="Edit" a11y="Edit your star rating" onPress={openYourStars} />
          <Act label="Reset" a11y="Reset to the standard star rating" onPress={() => setCustomStars(null)} />
        </>
      ) : (
        <Act label="Customise" a11y="Customise your star rating" onPress={openYourStars} />
      )}
    </View>
  );
}

const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/** "★ Custom stars": said once, where the stars are read, and the way to change them. Only for a rider who has them. */
export const CustomStarsChip = memo(function CustomStarsChip() {
  const { prefs } = usePrefs();
  if (!prefs.rider.custom) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Custom star rating: edit"
      hitSlop={(hitTarget - controlHeight.sm) / 2}
      onPress={() => {
        tick();
        openYourStars();
      }}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
    >
      <Svg width={10} height={10} viewBox="-5 -5 10 10" accessible={false}>
        <Path d={STAR} fill={colors.ink} />
      </Svg>
      <T variant="label" caps>
        Custom stars
      </T>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.md,
    minHeight: hitTarget + space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  value: { flex: 1 },
  act: { minHeight: hitTarget, minWidth: hitTarget, justifyContent: "center", alignItems: "center" },
  pressed: { opacity: 0.55 },
  link: { textDecorationLine: "underline", textDecorationColor: colors.lineStrong },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    height: controlHeight.sm,
    paddingHorizontal: space.sm + space["2xs"],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
    alignSelf: "center",
  },
  chipPressed: { backgroundColor: colors.sunken, borderColor: colors.magenta },
});
