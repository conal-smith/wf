import type { ReactNode } from "react";
import { tv } from "./tv";

export const fieldStyles = tv({
  slots: {
    // `group/field` is what lets the control inside read `data-invalid`.
    base: "group/field grid min-w-0 content-start gap-2",
    // A label's leading, not a paragraph's: the body step at the design
    // system's label line height (1.3), which is what a field label has always
    // been drawn at. The hint sits on the same line and keeps it.
    // The mono label, as a chart's legend names a thing: TITLE, PRICE. The
    // hint beside it goes back to the body face's italic, in sentence case.
    label:
      "flex items-baseline justify-between gap-2 font-mono text-eyebrow leading-tight text-ink-muted uppercase",
    hint: "text-right font-body text-body leading-tight font-normal tracking-normal text-ink-muted normal-case italic",
    error: "font-body text-body text-warn italic",
  },
});

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** What is wrong, in words. The control inside turns warm with it. */
  error?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** A label, the control it names, and what is wrong with it if anything is. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps) {
  const styles = fieldStyles();
  return (
    <div
      className={styles.base({ className })}
      data-invalid={error ? "" : undefined}
    >
      <label className={styles.label()} htmlFor={htmlFor}>
        {label} {hint && <small className={styles.hint()}>{hint}</small>}
      </label>
      {children}
      {error && (
        <span className={styles.error()} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
