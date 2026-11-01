import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { tv } from "./tv";

/*
 * Nothing found, not found, could not load: centred where the list would be,
 * with no frame round it. A round grey icon, an Inter title, a line or two,
 * and at most two buttons.
 */
export const emptyStyles = tv({
  slots: {
    base: "grid justify-items-center gap-2.5 px-5 py-14 text-center font-body",
    icon: "mb-1.5 grid size-14 place-items-center rounded-full bg-well text-ink-2",
    title: "m-0 font-body text-lead tracking-tight text-balance text-ink",
    body: "grid max-w-reading justify-items-center gap-2 text-prose leading-normal text-pretty text-ink-2",
    actions: "mt-2 flex flex-wrap justify-center gap-2",
  },
});

export interface EmptyProps {
  title: string;
  icon?: ReactNode;
  /** The title's level in the page's outline: a heading where it is the page's. */
  as?: "h1" | "h2" | "p";
  className?: string;
  /** What to do about it, in a sentence. */
  children?: ReactNode;
  /** At most two buttons: the way on. */
  actions?: ReactNode;
}

/** Where a list would be, when there is nothing to list. */
export function Empty({
  title,
  icon,
  as: Tag = "h2",
  className,
  children,
  actions,
}: EmptyProps) {
  const styles = emptyStyles();
  return (
    <div className={styles.base({ className })}>
      <span className={styles.icon()} aria-hidden="true">
        {icon ?? <Search size={24} strokeWidth={1.75} />}
      </span>
      <Tag className={styles.title()}>{title}</Tag>
      {children && <div className={styles.body()}>{children}</div>}
      {actions && <div className={styles.actions()}>{actions}</div>}
    </div>
  );
}
