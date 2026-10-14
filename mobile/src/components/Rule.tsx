import { StyleSheet, View, type ViewStyle } from "react-native";
import { colors } from "../theme/tokens";

/** Things are set apart by rules, not cards (docs/BRAND.md). */
export function Rule({ strong, inset = 0, style }: { strong?: boolean; inset?: number; style?: ViewStyle }) {
  return (
    <View
      accessible={false}
      style={[
        {
          height: strong ? 1 : StyleSheet.hairlineWidth,
          backgroundColor: strong ? colors.ink : colors.line,
          marginHorizontal: inset,
        },
        style,
      ]}
    />
  );
}
