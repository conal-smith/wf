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
    base: "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1",
    title: "m-0 min-w-0 font-body text-balance text-ink",
    aside: "flex shrink-0 items-center gap-2 font-body text-body font-medium text-ink-muted",
    lead: "m-0 basis-full font-body text-prose leading-normal text-pretty text-ink-2",
  },
  variants: {
    level: {
      page: {
        base: "items-end gap-y-2",
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
      <Tag className={styles.title()} id={id}>
        {children}
      </Tag>
      {aside && <div className={styles.aside()}>{aside}</div>}
      {lead && <p className={styles.lead()}>{lead}</p>}
    </div>
  );
}
