/**
 * Who the stars are rated for: the level as three choices, the weight, and
 * the wings in the bag. The same rider as the site's (force5.prefs.v1, read
 * and written through `parseRider`), so a change here is the rider the chart,
 * the dock and the spot page rate for at once.
 *
 * `compact` is the spot page's line (spot/web/RiderSwitch.tsx): the level,
 * and the weight and wings behind a fold that opens in place.
 */
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ESTIMATE_WEIGHT_KG, SKILLS, type Rider, type Skill } from "../../../../force5/src/stars";
import { Chevron } from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { Segmented } from "../../components/Segmented";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, hitTarget, radius, space, type as scale } from "../../theme/tokens";
import {
  SKILL_LABEL,
  WEIGHT_RANGE,
  WING_SIZES,
  changeRider,
  parseWeight,
  toggleWing,
  weightText,
} from "./settingsLogic";

export function useRider(): [Rider, (change: Partial<Rider>) => void] {
  const { prefs, update } = usePrefs();
  return [
    prefs.rider,
    (change) => update((p) => ({ ...p, rider: changeRider(p.rider, change) })),
  ];
}

export function LevelSwitch({ rider, onChange }: { rider: Rider; onChange: (change: Partial<Rider>) => void }) {
  return (
    <Segmented<Skill>
      value={rider.skill}
      accessibilityLabel="Riding level"
      segments={SKILLS.map((skill) => ({ value: skill, label: SKILL_LABEL[skill] }))}
      onChange={(skill) => onChange({ skill })}
    />
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
        accessibilityLabel={`Weight in kilograms${rider.weightKg === null ? `, not set: the stars assume ${ESTIMATE_WEIGHT_KG}` : ""}`}
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
          accessibilityLabel={`Clear the weight: rate for the estimate, ${ESTIMATE_WEIGHT_KG} kilograms`}
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

function StepButton({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && styles.stepOn]}
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

/** The spot page's line: the level, and the weight and wings behind a fold. */
export function RiderLine() {
  const [rider, change] = useRider();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.line}>
      <View style={styles.lineRow}>
        <T variant="eyebrow" caps color="muted">
          Rated for
        </T>
        <LevelSwitch rider={rider} onChange={change} />
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
            Kept on this phone; the chart and every spot rate for it.
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
  panel: { gap: space.sm, paddingBottom: space.sm },
  note: { fontFamily: fonts.bodyItalic },
});
