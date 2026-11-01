import type { ReactNode } from "react";
import { tv, type VariantProps } from "./tv";

/*
 * Headings, in Inter and sentence case, kept apart from what follows by
 * space and never by a rule. Three steps: a page's (40px, 32 on a phone,
 * with a lead line under it), a section's (20px, with a link or a count on
 * the right) and a card's (15px). Fraunces is the wordmark's and a spot's
 * name's, and no heading's.
 *
 *   <Heading level="page" lead="We rate every daylight hour…">How the stars work</Heading>
 *   <Heading level="section" aside={<Link href="/">All spots</Link>}>The week</Heading>
 */
export const headingStyles = tv({
  slots: {
    // The heading's line, then the lead under it. The lead is its own row,
    // not a wrapped item of the line: a short title would otherwise take the
    // lead up beside it, a lead held to a measure fitting in what is left.
    base: "grid min-w-0 gap-y-1",
    line: "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1",
    title: "m-0 min-w-0 font-body text-balance text-ink",
    aside: "flex shrink-0 items-center gap-2 font-body text-body font-medium text-ink-muted",
    lead: "m-0 font-body text-prose leading-normal text-pretty text-ink-2",
  },
  variants: {
    level: {
      page: {
        base: "gap-y-2",
        line: "items-end",
        title: "text-big max-wide:text-big-sm",
        lead: "max-w-form",
      },
      section: { title: "text-lead tracking-tight" },
      card: { title: "text-prose leading-tight font-semibold" },
    },
  },
  defaultVariants: { level: "section" },
});

const TAG = { page: "h1", section: "h2", card: "h3" } as const;

export type HeadingProps = VariantProps<typeof headingStyles> & {
  /** The heading's level in the page's outline, where it is not the step's own. */
  as?: "h1" | "h2" | "h3" | "h4";
  id?: string;
  /** Set right on the heading's line: a link, a count, an action. */
  aside?: ReactNode;
  /** The line under a page's heading. */
  lead?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Heading({
  level = "section",
  as,
  id,
  aside,
  lead,
  className,
  children,
}: HeadingProps) {
  const styles = headingStyles({ level });
  const Tag = as ?? TAG[level];
  return (
    <div className={styles.base({ className })}>
      <div className={styles.line()}>
        <Tag className={styles.title()} id={id}>
          {children}
        </Tag>
        {aside && <div className={styles.aside()}>{aside}</div>}
      </div>
      {lead && <p className={styles.lead()}>{lead}</p>}
    </div>
  );
}
