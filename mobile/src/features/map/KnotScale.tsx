/**
 * The wind scale the coloured wind is drawn on (src/KnotScale.tsx): the same
 * for every rider, generated from PALETTE stop for stop, with its knots under
 * it.
 */
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { PALETTE, windColor } from "../../../../force5/src/weather";
import { T } from "../../components/Text";
import { space } from "../../theme/tokens";
import { hexOf } from "./windLogic";

/** The bar runs from calm to this, in knots: the storm stops past it are rare. */
const TOP = 60;
const TICKS = [10, 20, 30, 40, 50];
const STOPS = [...PALETTE.map(([kn]) => kn).filter((kn) => kn < TOP), TOP];

export const KnotScale = memo(function KnotScale({ faint = false }: { faint?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Wind scale: blue under 10 knots, green 10 to 20, yellow by 30, red by 40, purple from 50"
      style={styles.wrap}
    >
      <Svg width="100%" height={10}>
        <Defs>
          <LinearGradient id="wind" x1="0" y1="0" x2="1" y2="0">
            {STOPS.map((kn) => (
              <Stop key={kn} offset={kn / TOP} stopColor={hexOf(windColor(kn))} stopOpacity={faint ? 0.55 : 1} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height={10} fill="url(#wind)" />
      </Svg>
      <View style={styles.ticks}>
        {TICKS.map((kn) => (
          <T key={kn} variant="figureSm" tabular style={[styles.tick, { left: `${(kn / TOP) * 100}%` }]}>
            {kn}
          </T>
        ))}
        <T variant="label" color="muted" style={styles.unit}>
          kn
        </T>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { width: "100%", gap: space.xs },
  ticks: { height: 18 },
  tick: { position: "absolute", transform: [{ translateX: -8 }] },
  unit: { position: "absolute", right: 0 },
});
