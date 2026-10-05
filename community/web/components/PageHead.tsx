/**
 * The head of a community page, set as a broadsheet sets the head of a page of
 * letters: a dateline in the mono label, the page's name in the display face
 * over a double rule, and on the name's line, set right, what the page is
 * about in figures, or the one or two things a reader does to it.
 *
 *   MON 5 OCT 2026                                   6 THREADS · 2 NEW
 *   Latest
 *   ══════════════════════════════════════════════════════════════════
 */
import type { ReactNode } from "react";
import { MONO_LABEL, tv } from "../../../ui/tv";

export const pageHeadStyles = tv({
  slots: {
    base: "grid min-w-0 gap-1",
    // The dateline: what the page is, where and when, in tracked capitals.
    dateline: [
      "m-0 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-ink-muted tabular-nums",
      MONO_LABEL,
    ],
    datelineEnd: "ml-auto",
    // `border-0` first: `border-double` would otherwise draw all four sides.
    bar: "flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2 border-0 border-b-3 border-double border-ink pb-2",
    title: "m-0 min-w-0 font-display text-title text-balance text-ink",
    actions: "flex shrink-0 items-center gap-2",
    // A line under the rule, where a page has one: a channel's own words.
    lede: "m-0 max-w-measure pt-1 font-body text-body text-ink-2 italic",
  },
});

export interface PageHeadProps {
  /** The page's name: the one h1 it has. */
  title: ReactNode;
  /** Left of the dateline: a date, a channel, a handle. */
  dateline?: ReactNode;
  /** Right of the dateline: what the page comes to, in figures. */
  figures?: ReactNode;
  /** Set right on the title's line: a follow, a mark-all-read. */
  actions?: ReactNode;
  /** Under the rule: a line of the page's own, never the site's. */
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
      {(dateline || figures) && (
        <p className={styles.dateline()}>
          {dateline && <span>{dateline}</span>}
          {figures && <span className={styles.datelineEnd()}>{figures}</span>}
        </p>
      )}
      <div className={styles.bar()}>
        <h1 className={styles.title()}>{title}</h1>
        {actions && <div className={styles.actions()}>{actions}</div>}
      </div>
      {lede && <p className={styles.lede()}>{lede}</p>}
    </div>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-IE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "Mon 5 Oct 2026": the dateline's date, in the reader's own time. */
export const dateline = (now: Date) => dayFormat.format(now).replace(/,/g, "");
