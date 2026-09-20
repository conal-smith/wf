import { ChevronDown } from "lucide-react";
import type { Ref, SelectHTMLAttributes } from "react";
import { controlStyles } from "./control";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** A filter that is narrowing the results, as opposed to sitting at "any". */
  active?: boolean;
  ref?: Ref<HTMLSelectElement>;
};

/** A native select: the platform's own picker, in the kit's box. */
export function Select({ active, className, ...props }: SelectProps) {
  const styles = controlStyles({ kind: "select", active });
  return (
    <div className={styles.box({ className })}>
      <select {...props} className={styles.input()} />
      <ChevronDown
        className={styles.adornment()}
        size={16}
        aria-hidden="true"
      />
    </div>
  );
}
