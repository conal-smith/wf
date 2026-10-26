/**
 * Who the stars are rated for: ours, or the rider's own once they have made
 * them their own in "Your stars" (stars/YourStarsScreen.tsx), the weight and
 * the wings in the bag. The same rider as the site's (force5.prefs.v1, read
 * and written through `parseRider`), so a change here is the rider the chart,
 * the dock and the spot page rate for at once. The weight and the wings pick
 * the wing size beside the stars; they never move a star.
 *
 * `compact` is the spot page's line (spot/web/RiderSwitch.tsx): whose stars,
 * the way into "Your stars", and the weight and wings behind a fold that
 * opens in place.
 */
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ESTIMATE_WEIGHT_KG, type Rider } from "../../../../force5/src/stars";
import { Chevron } from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { openYourStars } from "../stars/StarRating";
import { colors, fonts, hitTarget, radius, space, type as scale } from "../../theme/tokens";
import {
  WEIGHT_RANGE,
  WING_SIZES,
  changeRider,
  customiseText,
  parseWeight,
  starsName,
  toggleWing,
  weightText,
} from "./settingsLogic";

/** The rider, and a change of weight or wings (`saveRider`: the star rating stays). */
export function useRider(): [Rider, (change: Partial<Rider>) => void] {
  const { prefs, changeRider: save } = usePrefs();
  return [prefs.rider, (change) => save((rider) => changeRider(rider, change))];
}

/** The way into "Your stars": "Customise" from ours, or "Edit your stars". */
export function CustomiseLink() {
  const { prefs } = usePrefs();
  const label = customiseText(prefs.rider);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tick();
        openYourStars();
      }}
      style={({ pressed }) => [styles.link, pressed && styles.linkDown]}
    >
      <T variant="prose" style={styles.underline}>
        {label}
      </T>
    </Pressable>
  );
}

export function WeightField({ rider, onChange }: { rider: Rider; onChange: (change: Partial<Rider>) => void }) {
  const [text, setText] = useState(rider.weightKg === null ? "" : String(rider.weightKg));
  const current = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  const step = (by: number) => {
    const next = Math.max(WEIGHT_RANGE.min, Math.min(WEIGHT_RANGE.max, current + by));
    tick();
    setText(String(next));
    onChange({ weightKg: next });
  };
  return (
    <View style={styles.weight}>
      <StepButton label="−" a11y="One kilogram less" onPress={() => step(-1)} />
      <TextInput
        value={text}
        onChangeText={(value) => {
          setText(value);
          onChange({ weightKg: parseWeight(value) });
        }}
        placeholder={`~${ESTIMATE_WEIGHT_KG}`}
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={3}
        accessibilityLabel={`Weight in kilograms${rider.weightKg === null ? `, not set: the wing sizes assume ${ESTIMATE_WEIGHT_KG}` : ""}`}
        style={styles.input}
        maxFontSizeMultiplier={1.6}
      />
      <T variant="label" caps color="muted">
        kg
      </T>
      <StepButton label="+" a11y="One kilogram more" onPress={() => step(1)} />
      {rider.weightKg !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear the weight: size the wings for the estimate, ${ESTIMATE_WEIGHT_KG} kilograms`}
          onPress={() => {
            tick();
            setText("");
            onChange({ weightKg: null });
          }}
          style={styles.clear}
        >
          <T variant="label" caps color="ink2">
            Clear
          </T>
        </Pressable>
      )}
    </View>
  );
}

/** A round − or +, a step at a time. */
export function StepButton({
  label,
  a11y,
  onPress,
  disabled,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && styles.stepOn, disabled && styles.stepOff]}
    >
      <T variant="figure">{label}</T>
    </Pressable>
  );
}

export function WingChips({ rider, onChange }: { rider: Rider; onChange: (change: Partial<Rider>) => void }) {
  const extra = rider.wings.filter((w) => !WING_SIZES.includes(w));
  return (
    <View style={styles.chips} accessibilityLabel="Your wings, square metres">
      {[...WING_SIZES, ...extra].map((size) => {
        const on = rider.wings.includes(size);
        return (
          <Pressable
            key={size}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${size} square metre wing`}
            onPress={() => {
              tick();
              onChange({ wings: toggleWing(rider.wings, size) });
            }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <T variant="figureSm" tabular color={on ? "inkInverse" : "ink"}>
              {size}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The spot page's line: whose stars, the way to make them your own, and the weight and wings behind a fold. */
export function RiderLine() {
  const [rider, change] = useRider();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.line}>
      <View style={styles.lineRow}>
        <T variant="eyebrow" caps color="muted">
          Rated on
        </T>
        <T variant="label" caps>
          {starsName(rider)}
        </T>
        <CustomiseLink />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${weightText(rider)}${rider.wings.length ? `, wings ${rider.wings.join(", ")} square metres` : ""}`}
        accessibilityHint={open ? "Closes the weight and wings" : "Opens the weight and wings"}
        onPress={() => {
          tick();
          setOpen(!open);
        }}
        style={styles.fold}
      >
        <T variant="label" caps style={styles.underline}>
          {weightText(rider)}
          {rider.wings.length ? ` · ${rider.wings.join(", ")} m²` : ""}
        </T>
        <Chevron up={open} size={11} />
      </Pressable>
      {open && (
        <View style={styles.panel}>
          <T variant="eyebrow" caps color="muted">
            Weight
          </T>
          <WeightField rider={rider} onChange={change} />
          <T variant="eyebrow" caps color="muted">
            Your wings m²
          </T>
          <WingChips rider={rider} onChange={change} />
          <T variant="caption" color="muted" style={styles.note}>
            Kept on this phone. Your weight and wings pick the wing size; they never change the stars.
          </T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  weight: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  input: {
    ...scale.figure,
    color: colors.ink,
    minWidth: space["4xl"] + space.lg,
    height: hitTarget,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.control,
    textAlign: "center",
  },
  step: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  stepOn: { backgroundColor: colors.sunken, borderColor: colors.magenta },
  stepOff: { opacity: 0.35 },
  clear: { minHeight: hitTarget, justifyContent: "center", paddingHorizontal: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minWidth: hitTarget,
    height: hitTarget,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink },
  line: { gap: space.xs },
  lineRow: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minHeight: hitTarget,
    alignSelf: "flex-start",
  },
  underline: { textDecorationLine: "underline", textDecorationColor: colors.lineStrong },
  link: { minHeight: hitTarget, justifyContent: "center", alignSelf: "flex-start" },
  linkDown: { opacity: 0.55 },
  panel: { gap: space.sm, paddingBottom: space.sm },
  note: { fontFamily: fonts.bodyItalic },
});
