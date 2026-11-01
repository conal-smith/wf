/**
 * The head of a community page: the kit's page heading (ui/Heading), with a
 * grey line over it that says where the page is (the community, a channel's
 * category, a member), and on the heading's line, set right, what the page
 * comes to in figures, or the one or two things a reader does to it. Space
 * keeps it apart from the page under it, never a rule.
 *
 *   Community
 *   Latest                                           6 threads · 2 new
 */
import type { ReactNode } from "react";
import { Heading } from "../../../ui";
import { tv } from "../../../ui/tv";

export const pageHeadStyles = tv({
  slots: {
    base: "grid min-w-0 gap-1.5",
    // Where the page is, in a plain grey line.
    dateline: "m-0 min-w-0 font-body text-body text-ink-muted",
    // What the page comes to, beside whatever is done to it.
    figures: "font-body text-body text-ink-muted tabular-nums",
    actions: "flex shrink-0 flex-wrap items-center gap-2",
  },
});

export interface PageHeadProps {
  /** The page's name: the one h1 it has. */
  title: ReactNode;
  /** Over the title: the community, a channel's category, a handle. */
  dateline?: ReactNode;
  /** Set right on the title's line: what the page comes to, in figures. */
  figures?: ReactNode;
  /** Set right on the title's line: a follow, a mark-all-read. */
  actions?: ReactNode;
  /** Under the title: a line of the page's own, never the site's. */
  lede?: ReactNode;
  className?: string;
}

export function PageHead({
  title,
  dateline,
  figures,
  actions,
  lede,
  className,
}: PageHeadProps) {
  const styles = pageHeadStyles();
  return (
    <div className={styles.base({ className })}>
      {dateline && <p className={styles.dateline()}>{dateline}</p>}
      <Heading
        level="page"
        lead={lede}
        aside={
          (figures || actions) && (
            <span className={styles.actions()}>
              {figures && <span className={styles.figures()}>{figures}</span>}
              {actions}
            </span>
          )
        }
      >
        {title}
      </Heading>
    </div>
  );
}

/** Over the title of a page that is the community's own, not a channel's. */
export const COMMUNITY = "Community";
