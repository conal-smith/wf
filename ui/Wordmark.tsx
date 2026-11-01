import { tv, type VariantProps } from "./tv";

/*
 * The wordmark: "wingfoil" in Fraunces, semibold and set a little tight, then
 * ".ie" in the accent and Fraunces' italic. With a spot's name on its own
 * page, the only Fraunces on the site.
 */
export const wordmarkStyles = tv({
  slots: {
    base: "inline-block font-display leading-none font-semibold tracking-tight whitespace-nowrap text-ink optical-wordmark",
    domain: "font-medium text-chart-magenta italic",
  },
  variants: {
    size: {
      // The top bar and the menu's head: 23px, 21 on a phone.
      md: { base: "text-wordmark max-wide:text-wordmark-sm" },
      // A larger mark, where a page is about the site itself.
      lg: { base: "text-title" },
    },
  },
  defaultVariants: { size: "md" },
});

export type WordmarkProps = VariantProps<typeof wordmarkStyles> & {
  className?: string;
};

/**
 * wingfoil.ie. Words, not a picture, so it is read as the name it is; a link
 * round it names where it goes.
 */
export function Wordmark({ size, className }: WordmarkProps) {
  const styles = wordmarkStyles({ size });
  return (
    <span className={styles.base({ className })}>
      wingfoil<span className={styles.domain()}>.ie</span>
    </span>
  );
}
