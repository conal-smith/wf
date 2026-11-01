import type { CSSProperties, InputHTMLAttributes, ReactNode, Ref } from "react";
import { tv } from "./tv";

/*
 * A value along a range: a thin track, filled in the ink colour up to a round
 * white thumb, and the value said beside it with its unit. A native range
 * input, so the keys, a screen reader and a thumb all work as the platform's.
 * The track and thumb are drawn by the theme's `range-kit` (ui/theme.css).
 */
export const sliderStyles = tv({
  slots: {
    base: "flex items-center gap-3.5",
    input: "range-kit min-w-0 flex-1",
    value:
      "min-w-13.5 text-right font-body text-prose font-semibold text-ink tabular-nums",
    unit: "ml-0.5 text-label font-medium text-ink-muted",
  },
});

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** The value as it is shown beside the track; the number itself if absent. */
  display?: ReactNode;
  unit?: ReactNode;
  "aria-label"?: string;
  ref?: Ref<HTMLInputElement>;
};

export function Slider({
  value,
  min,
  max,
  onChange,
  display,
  unit,
  className,
  ...props
}: SliderProps) {
  const styles = sliderStyles();
  const share = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={styles.base({ className })}>
      <input
        {...props}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={styles.input()}
        style={{ "--range-fill": `${share}%` } as CSSProperties}
      />
      <span className={styles.value()} aria-hidden="true">
        {display ?? value}
        {unit && <small className={styles.unit()}>{unit}</small>}
      </span>
    </div>
  );
}
