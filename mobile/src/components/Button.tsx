import { memo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, controlHeight, hitTarget, radius, space } from "../theme/tokens";
import { tick } from "./haptics";
import { T } from "./Text";

export type ButtonKind = "primary" | "pill" | "quiet" | "danger";

interface Props {
  label: string;
  onPress: () => void;
  /** One filled action a view (docs/BRAND.md): an ink pill, magenta while pressed. */
  kind?: ButtonKind;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export const Button = memo(function Button({
  label,
  onPress,
  kind = "pill",
  size = "md",
  icon,
  disabled,
  busy,
  accessibilityHint,
  style,
}: Props) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      hitSlop={Math.max(0, (hitTarget - controlHeight[size]) / 2)}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        { height: controlHeight[size], paddingHorizontal: size === "sm" ? space.md : space.lg },
        kind === "primary" && { backgroundColor: pressed ? colors.magenta : colors.ink },
        kind === "pill" && {
          borderWidth: 1,
          borderColor: pressed ? colors.magenta : colors.ink,
          backgroundColor: pressed ? colors.sunken : "transparent",
        },
        kind === "danger" && { borderWidth: 1, borderColor: colors.warn },
        kind === "quiet" && pressed && { backgroundColor: colors.sunken },
        off && { opacity: 0.45 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={kind === "primary" ? colors.inkInverse : colors.ink} />
      ) : (
        <View style={styles.row}>
          {icon}
          <T
            variant="label"
            caps
            color={kind === "primary" ? "inkInverse" : kind === "danger" ? "warn" : "ink"}
          >
            {label}
          </T>
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
