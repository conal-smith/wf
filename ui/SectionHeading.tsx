import type { ReactNode } from "react";
import { MONO_LABEL, tv, type VariantProps } from "./tv";

/*
 * The broadsheet's section head: the name in the display face, a rule under
 * it, and on the same line, set right, the figures that sum the section up
 * (a day's stars and best window, a count, a price). The rule is what divides
 * the page; the section needs no box.
 */
export const sectionHeadingStyles = tv({
  slots: {
    // `border-0` first: with no reset, a border style set on all four sides
    // (as `border-double` does) would draw them all at the browser's medium.
    base: "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-0 border-ink pb-1",
    title: "m-0 font-display text-ink",
    aside:
      "flex items-center gap-2 font-mono text-caption text-ink-muted tabular-nums",
  },
  variants: {
    size: {
      // A day, a section of a page.
      lead: { title: "text-lead" },
      // A page's own head, where there is no headline.
      title: { title: "text-title" },
      // A group in a list or a menu: the mono label on a thin rule.
      kicker: { title: ["text-ink-muted", MONO_LABEL] },
    },
    rule: {
      thin: { base: "border-b" },
      thick: { base: "border-b-2" },
      // The heaviest: a page's foot, or the head of what follows a masthead.
      double: { base: "border-b-3 border-double" },
    },
  },
  defaultVariants: { size: "lead", rule: "thick" },
});

export type SectionHeadingProps = VariantProps<typeof sectionHeadingStyles> & {
  /** The heading's level in the page's outline. */
  as?: "h1" | "h2" | "h3" | "h4";
  id?: string;
  /** Set right on the heading's line: figures, not a sentence. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SectionHeading({
  as: Tag = "h2",
  id,
  size,
  rule,
  aside,
  className,
  children,
}: SectionHeadingProps) {
  const styles = sectionHeadingStyles({ size, rule });
  return (
    <div className={styles.base({ className })}>
      <Tag className={styles.title()} id={id}>
        {children}
      </Tag>
      {aside && <div className={styles.aside()}>{aside}</div>}
    </div>
  );
}
