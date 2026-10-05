import type { ElementType, HTMLAttributes } from "react";
import { MONO_LABEL, tv, type VariantProps } from "./tv";

/*
 * The mono label: tracked capitals in IBM Plex Mono, as a chart names its
 * parts and a broadsheet heads its columns. STARS · WIND KN · BEST MON. It
 * names a thing in a word or two; it never says a sentence.
 */
export const kickerStyles = tv({
  base: ["m-0", MONO_LABEL],
  variants: {
    tone: {
      muted: "text-ink-muted",
      ink: "text-ink",
      // The pen's colour, for the label of the one thing that matters.
      pen: "text-pen-ink",
    },
  },
  defaultVariants: { tone: "muted" },
});

export type KickerProps = HTMLAttributes<HTMLElement> &
  VariantProps<typeof kickerStyles> & {
    /** A paragraph by default; a span in a row, a heading where it is one. */
    as?: ElementType;
  };

export function Kicker({
  as: Tag = "p",
  tone,
  className,
  ...props
}: KickerProps) {
  return <Tag {...props} className={kickerStyles({ tone, className })} />;
}
