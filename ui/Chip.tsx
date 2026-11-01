import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { DISABLED, RING, tv } from "./tv";

/*
 * A choice you can press: a soft capsule, filled in ink when it is on. Never
 * in capitals. A word that only describes something is a Tag, not a Chip.
 */
export const chipStyles = tv({
  slots: {
    base: [
      "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-sunken px-3",
      "font-body text-body font-medium whitespace-nowrap text-ink",
      "touch-manipulation transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-line",
      "aria-pressed:bg-inverse aria-pressed:text-ink-inverse not-disabled:aria-pressed:hover:bg-inverse",
      RING,
      DISABLED,
    ],
    remove: "-mr-1 opacity-60",
  },
});

export type ChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "children"
> & {
  /** On, for a choice; omit it for a filter in use that a press takes away. */
  pressed?: boolean;
  /** A filter in use: the cross that says a press takes it away. */
  removable?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

/** A choice in a row of them, or a filter in use that a press clears. */
export function Chip({
  pressed,
  removable = false,
  className,
  children,
  ...props
}: ChipProps) {
  const styles = chipStyles();
  return (
    <button
      type="button"
      {...props}
      className={styles.base({ className })}
      aria-pressed={pressed}
    >
      {children}
      {removable && (
        <X className={styles.remove()} size={14} aria-hidden="true" />
      )}
    </button>
  );
}
