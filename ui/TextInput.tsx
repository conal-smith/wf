import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { controlStyles } from "./control";

export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "prefix"
> & {
  /** Shown inside the box ahead of the text: a currency sign, a unit. */
  prefix?: ReactNode;
  /** A filter that is narrowing the results. */
  active?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function TextInput({
  prefix,
  active,
  className,
  ...props
}: TextInputProps) {
  const styles = controlStyles({ active });
  return (
    <div className={styles.box({ className })}>
      {prefix && <span className={styles.adornment()}>{prefix}</span>}
      <input {...props} className={styles.input()} />
    </div>
  );
}
