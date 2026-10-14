/**
 * The editor's few controls, in the app's manner: capsules for what is
 * pressed, rules between things, figures in mono. Each is 44 points to touch
 * and says what it is to a screen reader.
 */
import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { colors, hitTarget, radius, space } from "../../theme/tokens";

/** − value + : one number, a step at a time. */
export const Stepper = memo(function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format = String,
  children,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  children?: ReactNode;
}) {
  const set = (next: number) => {
    if (next < min || next > max || next === value) return;
    tick();
    onChange(next);
  };
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: less`}
        accessibilityState={{ disabled: value <= min }}
        disabled={value <= min}
        onPress={() => set(value - 1)}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, value <= min && styles.off]}
      >
        <T variant="figure">−</T>
      </Pressable>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: format(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => set(e.nativeEvent.actionName === "increment" ? value + 1 : value - 1)}
        style={styles.value}
      >
        {children ?? (
          <T variant="figure" tabular align="center">
            {format(value)}
          </T>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: more`}
        accessibilityState={{ disabled: value >= max }}
        disabled={value >= max}
        onPress={() => set(value + 1)}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, value >= max && styles.off]}
      >
        <T variant="figure">+</T>
      </Pressable>
    </View>
  );
});

/** A capsule that is on or off: a weekday, a spot, a preset. */
export const Chip = memo(function Chip({
  label,
  on,
  onPress,
  accessibilityLabel,
  trailing,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  trailing?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={space.xs}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && styles.pressed]}
    >
      <T variant="label" caps color={on ? "inkInverse" : "ink2"}>
        {label}
        {trailing ? ` ${trailing}` : ""}
      </T>
    </Pressable>
  );
});

/** A line of words and a switch. */
export const SwitchRow = memo(function SwitchRow({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.grow}>
        <T variant="body">{label}</T>
        {note ? (
          <T variant="caption" color="muted">
            {note}
          </T>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={(next) => {
          tick();
          onChange(next);
        }}
        trackColor={{ false: colors.line, true: colors.ink }}
        thumbColor={colors.paper}
        ios_backgroundColor={colors.line}
      />
    </View>
  );
});

/** An eyebrow over a part of a form. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T variant="eyebrow" caps color="muted" accessibilityRole="header">
          {title}
        </T>
        {aside}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  step: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { minWidth: hitTarget * 2, minHeight: hitTarget, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: colors.sunken },
  off: { opacity: 0.35 },
  chip: {
    minHeight: hitTarget - 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: hitTarget },
  grow: { flex: 1 },
  section: { gap: space.sm, paddingVertical: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
