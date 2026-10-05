import type { ReactNode } from "react";
import { DISABLED, RING, tv, type VariantProps } from "./tv";

/*
 * The chart's switch, as the dock's TABLE | RIBBON: one capsule ruled in ink,
 * the words in mono capitals, and the one that is on filled in ink.
 */
export const segmentedStyles = tv({
  slots: {
    base: "inline-flex rounded-full border border-ink bg-card",
    item: [
      "inline-flex h-control-sm items-center justify-center gap-1 rounded-full border-0 bg-transparent px-3",
      "font-mono text-label whitespace-nowrap text-ink uppercase",
      "cursor-pointer touch-manipulation transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-sunken",
      // The chosen one is filled in ink and set heavier: not colour alone.
      "aria-pressed:bg-inverse aria-pressed:font-semibold aria-pressed:text-ink-inverse not-disabled:aria-pressed:hover:bg-inverse",
      RING,
      DISABLED,
    ],
  },
  variants: {
    // A column of choices: a ruled list, one row filled.
    stack: {
      true: {
        base: "flex flex-col items-stretch rounded-surface",
        item: "h-control-md justify-start rounded-none border-b border-line px-4 last:border-b-0",
      },
    },
  },
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
  stack,
  className,
  "aria-label": label,
}: SegmentedProps<T>) {
  const styles = segmentedStyles({ stack });
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
