import type { ReactNode } from "react";
import { tv } from "./tv";

export const fieldStyles = tv({
  slots: {
    // `group/field` is what lets the control inside read `data-invalid`.
    base: "group/field grid min-w-0 content-start gap-2",
    label:
      "flex items-baseline justify-between gap-2 font-sans text-body font-semibold text-ink-2",
    hint: "text-right text-body font-normal text-ink-muted",
    error: "font-sans text-body text-warn",
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
