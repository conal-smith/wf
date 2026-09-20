import { Image as ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import { paneStyles } from "./Pane";
import { tv, type VariantProps } from "./tv";

export const emptyStyles = tv({
  slots: {
    base: "grid justify-items-center gap-3 px-6 py-16 text-center font-sans text-prose text-ink-muted",
    icon: "grid size-14 place-items-center rounded-full",
    title: "m-0 text-lead text-ink",
    body: "grid max-w-reading justify-items-center gap-3",
  },
  variants: {
    kind: {
      info: { icon: "bg-sunken text-ink-muted" },
      warn: { icon: "bg-warn-ground text-warn" },
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
