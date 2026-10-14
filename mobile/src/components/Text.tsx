import { memo } from "react";
import { Text as RNText, type TextProps } from "react-native";
import { colors, type ColorName, type TypeName, type as scale } from "../theme/tokens";

export interface TProps extends TextProps {
  /** The site's type scale (ui/theme.css --text-*). */
  variant?: TypeName;
  color?: ColorName;
  /** Mono labels and eyebrows are set in tracked capitals. */
  caps?: boolean;
  /** Figures line up in columns. */
  tabular?: boolean;
  align?: "left" | "center" | "right";
}

/**
 * Every piece of text in the app. Figures are mono and tabular, names are
 * Fraunces, the few sentences Newsreader: docs/BRAND.md, "Type".
 */
export const T = memo(function T({
  variant = "body",
  color = "ink",
  caps,
  tabular,
  align,
  style,
  ...rest
}: TProps) {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        scale[variant],
        { color: colors[color] },
        caps && { textTransform: "uppercase" },
        tabular && { fontVariant: ["tabular-nums"] },
        align && { textAlign: align },
        style,
      ]}
    />
  );
});
