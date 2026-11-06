import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { RING, tv } from "./tv";

/*
 * What a page keeps for whoever asks: a heading that opens what is under it,
 * with a chevron at its end. No frame and no rule: a section like any other,
 * until it is opened. What it holds is not drawn, or fetched, until then.
 */
export const disclosureStyles = tv({
  slots: {
    base: "group/disclosure min-w-0 font-body",
    summary: [
      "flex min-h-control-md cursor-pointer no-marker items-center gap-2 rounded-control text-ink pointer-coarse:min-h-touch",
      RING,
    ],
    title: "m-0 min-w-0 flex-1 font-body text-lead font-semibold text-ink",
    small: "m-0 min-w-0 flex-1 font-body text-body font-medium text-ink-muted",
    chevron:
      "shrink-0 text-ink-muted transition-transform duration-fast group-open/disclosure:rotate-180 motion-reduce:transition-none",
  },
});

export interface DisclosureProps {
  title: ReactNode;
  /** The heading's level in the page's outline. */
  as?: "h2" | "h3" | "span";
  /** A small grey name in place of a section's heading: a chart's key. */
  small?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
  /** A hook for the specs. */
  "data-disclosure"?: string;
}

/** A section a reader opens: its heading stays, what is under it waits. */
export function Disclosure({
  title,
  as: Tag = "h2",
  small = false,
  defaultOpen = false,
  className,
  children,
  "data-disclosure": name,
}: DisclosureProps) {
  const styles = disclosureStyles();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={styles.base({ className })}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-disclosure={name}
    >
      <summary className={styles.summary()}>
        <Tag className={small ? styles.small() : styles.title()}>{title}</Tag>
        <ChevronDown
          className={styles.chevron()}
          size={18}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </summary>
      {open && children}
    </details>
  );
}
