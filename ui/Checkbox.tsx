import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { DISABLED, RING, tv } from "./tv";

export const checkboxStyles = tv({
  slots: {
    // The words are part of the target, and the row is never shorter than a
    // thumb: a box on its own is 20px, which no rule here would allow.
    base: [
      "inline-flex min-h-touch cursor-pointer items-center gap-2",
      "font-sans text-prose text-ink",
      "has-disabled:cursor-default has-disabled:text-ink-disabled",
    ],
    /*
     * The platform's own box and tick. The tick is what says checked — a mark
     * that is either there or not — so the fill under it is the kit's ink and
     * not the accent: the accent is the one filled action on a view, and a
     * checkbox is never that. `m-0` takes off the margin a browser gives it.
     */
    input: ["size-5 shrink-0 accent-inverse m-0", RING, DISABLED],
    label: "min-w-0",
  },
});

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children"
> & {
  /** The words beside the box, which are part of what turns it on. */
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/** One thing that is either so or not, with the words that say which. */
export function Checkbox({ children, className, ...props }: CheckboxProps) {
  const styles = checkboxStyles();
  return (
    <label className={styles.base({ className })}>
      <input {...props} type="checkbox" className={styles.input()} />
      <span className={styles.label()}>{children}</span>
    </label>
  );
}
