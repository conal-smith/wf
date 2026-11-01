import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { DISABLED, RING, tv } from "./tv";

/*
 * A number moved in steps: minus, the value with its unit, plus, in a filled
 * capsule. The value is a spin button, so the arrow keys step it too and a
 * screen reader hears it as a number in a range.
 */
export const numberFieldStyles = tv({
  slots: {
    base: "inline-flex h-11 items-center gap-1 rounded-full bg-well px-1",
    step: [
      "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink",
      "not-disabled:hover:bg-line pointer-coarse:size-11",
      RING,
      DISABLED,
    ],
    value: [
      "min-w-17.5 rounded-control text-center font-body text-lead font-semibold tracking-tight text-ink tabular-nums",
      RING,
    ],
    unit: "ml-0.5 text-body font-medium text-ink-muted",
  },
});

export interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** What the number is, for a screen reader: "Weight". */
  "aria-label": string;
  unit?: ReactNode;
  /** The value in words where the number alone is not it ("75 kilograms"). */
  valueText?: string;
  /** The steps' names: "Lighter", "Heavier". */
  less?: string;
  more?: string;
  className?: string;
}

export function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  valueText,
  less = "Less",
  more = "More",
  className,
  "aria-label": label,
}: NumberFieldProps) {
  const styles = numberFieldStyles();
  const set = (next: number) =>
    onChange(Math.min(max, Math.max(min, Math.round(next / step) * step)));
  return (
    <span className={styles.base({ className })}>
      <button
        type="button"
        className={styles.step()}
        aria-label={less}
        disabled={value <= min}
        onClick={() => set(value - step)}
      >
        <Minus size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText}
        className={styles.value()}
        onKeyDown={(event) => {
          const by =
            event.key === "ArrowUp" || event.key === "ArrowRight"
              ? step
              : event.key === "ArrowDown" || event.key === "ArrowLeft"
                ? -step
                : 0;
          if (event.key === "Home") set(min);
          else if (event.key === "End") set(max);
          else if (by) set(value + by);
          else return;
          event.preventDefault();
        }}
      >
        {value}
        {unit && <small className={styles.unit()}>{unit}</small>}
      </span>
      <button
        type="button"
        className={styles.step()}
        aria-label={more}
        disabled={value >= max}
        onClick={() => set(value + step)}
      >
        <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  );
}
