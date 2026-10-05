import { tv, type VariantProps } from "./tv";

/*
 * The nameplate: "wingfoil" in Fraunces at its display cut, heavy and set
 * tight, then ".ie" in the light italic and the chart's magenta. It is the
 * only thing in the site set this heavy.
 */
export const wordmarkStyles = tv({
  slots: {
    base: "inline-block font-display leading-none font-extrabold tracking-tight whitespace-nowrap text-ink optical-display",
    domain: "font-normal tracking-normal text-chart-magenta italic",
  },
  variants: {
    size: {
      // A masthead on a phone, and the map's top bar.
      sm: { base: "text-lead" },
      // A masthead with the room.
      md: { base: "text-title" },
      // The menu's head, an about page.
      lg: { base: "text-headline" },
    },
  },
  defaultVariants: { size: "md" },
});

export type WordmarkProps = VariantProps<typeof wordmarkStyles> & {
  className?: string;
};

/**
 * wingfoil.ie. Words, not a picture, so it is read as the name it is; a link
 * round it names where it goes (`aria-label="wingfoil.ie Market, home"`).
 */
export function Wordmark({ size, className }: WordmarkProps) {
  const styles = wordmarkStyles({ size });
  return (
    <span className={styles.base({ className })}>
      wingfoil<span className={styles.domain()}>.ie</span>
    </span>
  );
}
