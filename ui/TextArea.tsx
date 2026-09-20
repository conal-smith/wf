import type { Ref, TextareaHTMLAttributes } from "react";
import { controlStyles } from "./control";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
};

export function TextArea({ className, ...props }: TextAreaProps) {
  const styles = controlStyles({ kind: "area" });
  return (
    <div className={styles.box({ className })}>
      <textarea {...props} className={styles.input()} />
    </div>
  );
}
