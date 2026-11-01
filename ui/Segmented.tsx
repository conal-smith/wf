import type { ReactNode } from "react";
import { DISABLED, RING, tv, type VariantProps } from "./tv";

/*
 * One of a few short options, all in view (five at most): a grey well, the
 * chosen one lifted out of it. Model names keep their own spelling (HARMONIE,
 * ICON-EU): they are names, not labels set in capitals.
 */
export const segmentedStyles = tv({
  slots: {
    base: [
      "inline-flex max-w-full shrink-0 overflow-x-auto rounded-full bg-sunken p-0.75 scrollbar-none",
    ],
    item: [
      "inline-flex h-7.5 flex-auto items-center justify-center gap-1.5 rounded-full border-0 bg-transparent px-3",
      "font-body text-body font-medium whitespace-nowrap text-ink-2",
      "cursor-pointer touch-manipulation transition-colors duration-fast",
      "not-disabled:hover:text-ink",
      // The chosen one: lifted onto the ground in white, a lighter grey in
      // dark, and in the ink colour: not by colour alone.
      "aria-pressed:bg-ground aria-pressed:text-ink aria-pressed:shadow-control dark:aria-pressed:bg-ink/12 dark:aria-pressed:shadow-none",
      RING,
      DISABLED,
    ],
  },
  variants: {
    size: {
      sm: { item: "h-6.5 px-2.5 text-label" },
      md: {},
      // A question with a few answers, across the width it is given.
      lg: { item: "h-9.5 px-4 text-prose" },
    },
    // Across the whole width it is given, each option an equal share.
    full: {
      true: { base: "flex w-full", item: "flex-1 basis-0" },
    },
  },
  defaultVariants: { size: "md" },
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type SegmentedProps<T extends string> = VariantProps<
  typeof segmentedStyles
> & {
  /** What is being chosen, for a screen reader. */
  "aria-label": string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** One of a few, all in view: a row of toggles of which exactly one is on. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size,
  full,
  className,
  "aria-label": label,
}: SegmentedProps<T>) {
  const styles = segmentedStyles({ size, full });
  return (
    <div role="group" aria-label={label} className={styles.base({ className })}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.item()}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
