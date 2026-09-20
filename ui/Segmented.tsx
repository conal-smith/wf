import type { ReactNode } from "react";
import { DISABLED, RING, tv, type VariantProps } from "./tv";

export const segmentedStyles = tv({
  slots: {
    base: "inline-flex gap-1 rounded-full bg-sunken p-1",
    item: [
      "inline-flex h-control-sm items-center justify-center gap-1 rounded-full border-0 bg-transparent px-3",
      "font-sans text-label whitespace-nowrap text-ink-muted",
      "cursor-pointer touch-manipulation transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-card/60 not-disabled:hover:text-ink",
      // The chosen one is lifted off the track: fill and shadow, not colour alone.
      "aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-control not-disabled:aria-pressed:hover:bg-card",
      RING,
      DISABLED,
    ],
  },
  variants: {
    stack: {
      true: {
        base: "flex flex-col items-stretch rounded-surface",
        item: "h-control-md justify-start",
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
