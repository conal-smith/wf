/**
 * The square instruments over the chart (docs/BRAND.md, `Button raised`):
 * opaque paper in an ink rule, never glass over the map, each 44 points with
 * its own glyph, role and label. The layers, the key, where am I, and all of
 * Ireland, down the right-hand edge.
 */
import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { tick } from "../../components/haptics";
import { colors, hitTarget, radius, shadow } from "../../theme/tokens";

interface InstrumentProps {
  label: string;
  hint?: string;
  onPress: () => void;
  children: ReactNode;
  pressed?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}

export const Instrument = memo(function Instrument({ label, hint, onPress, children, pressed, busy, style }: InstrumentProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: !!pressed, busy: !!busy }}
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed: down }) => [styles.instrument, (down || pressed) && styles.down, style]}
    >
      {children}
    </Pressable>
  );
});

/** A stack of instruments in one ruled box. */
export function InstrumentStack({ children }: { children: ReactNode }) {
  return <View style={styles.stack}>{children}</View>;
}

const G = { width: 20, height: 20, viewBox: "-10 -10 20 20" } as const;
const stroke = { stroke: colors.ink, strokeWidth: 1.3, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Two sheets one over the other (src/MapControls.tsx, the layers' button). */
export const LayersGlyph = () => (
  <Svg {...G}>
    <Path d="M0 -6.5L8 -2.5L0 1.5L-8 -2.5Z" {...stroke} />
    <Path d="M-8 2L0 6L8 2" {...stroke} />
  </Svg>
);

/** The chart's key: an "i" in a ring. */
export const KeyGlyph = () => (
  <Svg {...G}>
    <Circle r={7.5} {...stroke} />
    <Line x1={0} y1={-0.5} x2={0} y2={4.5} {...stroke} />
    <Circle cy={-3.6} r={0.9} fill={colors.ink} />
  </Svg>
);

/** Where am I: a compass ring with its four ticks. */
export const LocateGlyph = ({ active }: { active?: boolean }) => (
  <Svg {...G}>
    <Circle r={5.2} {...stroke} />
    <Circle r={1.8} fill={active ? colors.now : colors.ink} />
    <Path d="M0 -8.5V-5.6M0 5.6V8.5M-8.5 0H-5.6M5.6 0H8.5" {...stroke} />
  </Svg>
);

/** All of Ireland: four corners of a frame. */
export const FitGlyph = () => (
  <Svg {...G}>
    <Path d="M-7.5 -3.5V-7.5H-3.5M3.5 -7.5H7.5V-3.5M7.5 3.5V7.5H3.5M-3.5 7.5H-7.5V3.5" {...stroke} />
  </Svg>
);

export const CloseGlyph = ({ size = 16 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="-8 -8 16 16">
    <Path d="M-5 -5L5 5M5 -5L-5 5" {...stroke} />
  </Svg>
);

export const SearchGlyph = () => (
  <Svg width={18} height={18} viewBox="-9 -9 18 18">
    <Circle cx={-1.5} cy={-1.5} r={5} {...stroke} />
    <Path d="M2.2 2.2L7 7" {...stroke} />
  </Svg>
);

const styles = StyleSheet.create({
  instrument: {
    width: hitTarget,
    height: hitTarget,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  down: { backgroundColor: colors.sunken },
  stack: {
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.box,
    backgroundColor: colors.paper,
    boxShadow: shadow.control,
    overflow: "hidden",
  },
});
