import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";
import { tv, type VariantProps } from "./tv";

export const noticeStyles = tv({
  slots: {
    // Set off as the broadsheet sets off a note: a heavy rule down its edge.
    base: "flex items-start gap-3 border-l-3 px-4 py-3 font-body text-prose",
    icon: "mt-0.5 shrink-0",
    body: "min-w-0",
  },
  variants: {
    kind: {
      info: { base: "border-ink bg-sunken text-ink-2" },
      // Warm, an icon of its own and an interrupting role: three tellings.
      warn: { base: "border-warn bg-warn-ground text-warn" },
    },
  },
  defaultVariants: { kind: "info" },
});

export type NoticeProps = VariantProps<typeof noticeStyles> & {
  className?: string;
  children: ReactNode;
};

/** Something the reader should know, said in place. A warning interrupts. */
export function Notice({ kind = "info", className, children }: NoticeProps) {
  const styles = noticeStyles({ kind });
  const Icon = kind === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={styles.base({ className })}
      role={kind === "warn" ? "alert" : "status"}
    >
      <Icon className={styles.icon()} size={16} aria-hidden="true" />
      <div className={styles.body()}>{children}</div>
    </div>
  );
}
