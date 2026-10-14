import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, hitTarget, radius, space } from "../theme/tokens";
import { tick } from "./haptics";
import { T } from "./Text";

export interface Segment<V extends string> {
  value: V;
  label: string;
  accessibilityLabel?: string;
}

interface Props<V extends string> {
  value: V;
  segments: readonly Segment<V>[];
  onChange: (value: V) => void;
  accessibilityLabel: string;
}

/** A row of choices, one pressed: the pressed one is the ink capsule. */
function SegmentedInner<V extends string>({ value, segments, onChange, accessibilityLabel }: Props<V>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.row}>
      {segments.map((s) => {
        const on = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={s.accessibilityLabel ?? s.label}
            onPress={() => {
              if (on) return;
              tick();
              onChange(s.value);
            }}
            style={[styles.segment, on && styles.on]}
          >
            <T variant="label" caps color={on ? "inkInverse" : "ink2"}>
              {s.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export const Segmented = memo(SegmentedInner) as typeof SegmentedInner;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.pill,
    padding: space["2xs"],
    alignSelf: "flex-start",
  },
  segment: {
    minHeight: hitTarget - 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  on: { backgroundColor: colors.ink },
});
