/**
 * The ways into "Your stars" (YourStarsScreen.tsx): `openYourStars`, from
 * "Customise" in the rider's settings and on the spot page
 * (settings/RiderFields.tsx), and the chip a rider's own stars put in the
 * forecast's head.
 */
import { router } from "expo-router";
import { memo } from "react";
import { Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, controlHeight, hitTarget, radius, space } from "../../theme/tokens";

export const openYourStars = () => router.push("/your-stars" as never);

export const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/** "★ Your own stars": said once, where the stars are read, and the way to change them. Only once the rider has their own. */
export const CustomStarsChip = memo(function CustomStarsChip() {
  const { prefs } = usePrefs();
  if (!prefs.rider.custom) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your own stars: edit"
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
        Your own stars
      </T>
    </Pressable>
  );
});

const styles = StyleSheet.create({
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
