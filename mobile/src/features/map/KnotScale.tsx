/**
 * The wind scale the wash and the arrows are drawn on, for this rider
 * (src/KnotScale.tsx): a bar with the knots where it turns green, where the
 * sweet spot starts and ends, and where it becomes too much.
 */
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { RideStop } from "../../../../force5/src/chartStyle";
import { windBand, type Rider } from "../../../../force5/src/stars";
import { T } from "../../components/Text";
import { space } from "../../theme/tokens";
import { hexOf } from "./windLogic";

const TOP = 40;

export const KnotScale = memo(function KnotScale({
  stops,
  rider,
  faint = false,
}: {
  stops: readonly RideStop[];
  rider: Rider;
  faint?: boolean;
}) {
  if (!stops.length) return null;
  const b = windBand(rider);
  const ticks = [b.min, b.sweetLow, b.sweetHigh, b.max].map(Math.round);
  const shown = stops.filter((s) => s.kn <= TOP);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Wind scale: green from ${ticks[0]} knots, best ${ticks[1]} to ${ticks[2]} knots, too much from ${ticks[3]} knots`}
      style={styles.wrap}
    >
      <Svg width="100%" height={10}>
        <Defs>
          <LinearGradient id="ride" x1="0" y1="0" x2="1" y2="0">
            {[
              ...shown.map((s, i) => (
                <Stop key={i} offset={s.kn / TOP} stopColor={hexOf(s.rgb)} stopOpacity={faint ? 0.55 : 1} />
              )),
              <Stop key="end" offset={1} stopColor={hexOf(stops[stops.length - 1].rgb)} stopOpacity={faint ? 0.55 : 1} />,
            ]}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height={10} fill="url(#ride)" />
      </Svg>
      <View style={styles.ticks}>
        {ticks.map((kn, i) => (
          <T
            key={i}
            variant="figureSm"
            tabular
            style={[styles.tick, { left: `${(kn / TOP) * 100}%` }]}
          >
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
