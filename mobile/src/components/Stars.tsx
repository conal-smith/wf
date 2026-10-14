import { memo } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme/tokens";

/** The site's star, solid and faded (design-system/glyphs/star-*.svg), on its 12 box. */
const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

interface Props {
  /** Solid stars, 0–5: what the hour is. */
  stars: number;
  /** Faded stars beyond them: what it could be if the models agreed (HourRating.potential). */
  potential?: number;
  size?: number;
  /** Five stars are chart magenta, the best of something. */
  best?: boolean;
}

/** Five places: a solid star, a faded one, or the dot of none (ui/StarGlyphs.tsx). */
export const Stars = memo(function Stars({ stars, potential = stars, size = 14, best }: Props) {
  const ink = best && stars >= 5 ? colors.magenta : colors.ink;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${stars} star${stars === 1 ? "" : "s"}${potential > stars ? `, up to ${potential}` : ""}`}
      style={{ flexDirection: "row" }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Svg key={i} width={size} height={size} viewBox="-6 -6 12 12">
          {i < stars ? (
            <Path d={STAR} transform="translate(0 0.4)" fill={ink} />
          ) : i < potential ? (
            <Path
              d={STAR}
              transform="translate(0 0.4)"
              fill="none"
              stroke={colors.ink}
              strokeWidth={0.95}
              strokeLinejoin="round"
              opacity={0.5}
            />
          ) : (
            <Circle r={0.84} fill={colors.ink} opacity={0.25} />
          )}
        </Svg>
      ))}
    </View>
  );
});
