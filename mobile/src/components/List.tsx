/**
 * A grouped list the broadsheet way: sections under a heavy ink rule with a
 * mono label, rows divided by hairlines rather than set on cards, a figure or
 * a word set right, and a chevron where a row goes somewhere. Every row is 44
 * points at least and says what it does to a screen reader.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { colors, fonts, hitTarget, space } from "../theme/tokens";
import { tick } from "./haptics";
import { T } from "./Text";

/** A tab's own head: the tabs have no navigation bar, so the title is the page's. */
export function ScreenTitle({ title, kicker, children }: { title: string; kicker?: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.title, { paddingTop: insets.top + space.md }]}>
      {kicker ? (
        <T variant="eyebrow" caps color="muted">
          {kicker}
        </T>
      ) : null}
      <T variant="title" accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {title}
      </T>
      {children}
      <View style={styles.double} />
    </View>
  );
}

export function ListSection({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <T variant="eyebrow" caps color="muted" accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </T>
      ) : null}
      <View style={styles.rows}>{children}</View>
      {footer ? (
        <T variant="caption" color="muted" style={styles.footer}>
          {footer}
        </T>
      ) : null}
    </View>
  );
}

export function Disclosure({ external }: { external?: boolean }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" accessible={false}>
      <Path
        d={external ? "M4 2h6v6M10 2 3 9" : "M4 2l4 4-4 4"}
        fill="none"
        stroke={colors.muted}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ListRow({
  label,
  detail,
  value,
  onPress,
  external,
  hint,
  icon,
  accessibilityLabel,
}: {
  label: string;
  /** A line of small print under the label. */
  detail?: string;
  /** Set right: a figure, or the current choice. */
  value?: string;
  onPress?: () => void;
  /** It leaves the app: a browser, the share sheet. */
  external?: boolean;
  hint?: string;
  icon?: ReactNode;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.text}>
        <T variant="prose">{label}</T>
        {detail ? (
          <T variant="caption" color="muted">
            {detail}
          </T>
        ) : null}
      </View>
      {value ? (
        <T variant="figureSm" color="ink2" tabular style={styles.value} numberOfLines={1}>
          {value}
        </T>
      ) : null}
      {onPress ? <Disclosure external={external} /> : null}
    </>
  );
  if (!onPress)
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? [label, value, detail].filter(Boolean).join(", ")}>
        {body}
      </View>
    );
  return (
    <Pressable
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={accessibilityLabel ?? [label, value].filter(Boolean).join(", ")}
      accessibilityHint={hint ?? detail}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

export function ListSwitch({
  label,
  detail,
  value,
  onChange,
  disabled,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.text}>
        <T variant="prose">{label}</T>
        {detail ? (
          <T variant="caption" color="muted">
            {detail}
          </T>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(on) => {
          tick();
          onChange(on);
        }}
        trackColor={{ true: colors.ink, false: colors.sunken }}
        thumbColor={colors.paper}
        ios_backgroundColor={colors.sunken}
        accessibilityLabel={label}
        accessibilityHint={detail}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space["2xs"], backgroundColor: colors.paper },
  double: {
    marginTop: space.sm,
    height: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.ink,
  },
  section: { marginTop: space.xl },
  sectionTitle: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  rows: { borderTopWidth: 2, borderTopColor: colors.ink, marginHorizontal: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm, fontFamily: fonts.bodyItalic },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: hitTarget + space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  disabled: { opacity: 0.5 },
  icon: { width: space["2xl"], alignItems: "center" },
  text: { flex: 1, gap: space["2xs"] },
  value: { maxWidth: "50%" },
});
