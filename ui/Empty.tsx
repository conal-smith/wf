import { Image as ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import { paneStyles } from "./Pane";
import { tv, type VariantProps } from "./tv";

export const emptyStyles = tv({
  slots: {
    base: "grid justify-items-center gap-3 px-6 py-14 text-center font-body text-prose text-ink-muted",
    // A large control and a gap across, ruled in ink like a chart's light.
    icon: "grid size-14.5 place-items-center rounded-full border",
    // The display face's italic: a line, not a heading.
    title: "m-0 font-display text-lead text-balance text-ink italic",
    body: "grid max-w-reading justify-items-center gap-3 text-pretty",
  },
  variants: {
    kind: {
      info: { icon: "border-ink bg-card text-ink" },
      warn: { icon: "border-warn bg-warn-ground text-warn" },
    },
  },
  defaultVariants: { kind: "info" },
});

export type EmptyProps = VariantProps<typeof emptyStyles> & {
  title: string;
  icon?: ReactNode;
  className?: string;
  /** What to do about it: a sentence, and the action that mends it. */
  children?: ReactNode;
};

/** Where a list would be, when there is nothing to list. */
export function Empty({ title, icon, kind, className, children }: EmptyProps) {
  const styles = emptyStyles({ kind });
  return (
    <div className={paneStyles({ className: styles.base({ className }) })}>
      <span className={styles.icon()} aria-hidden="true">
        {icon ?? <ImageIcon size={24} />}
      </span>
      <p className={styles.title()}>{title}</p>
      {children && <div className={styles.body()}>{children}</div>}
    </div>
  );
}
