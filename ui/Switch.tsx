import type { ButtonHTMLAttributes, Ref } from "react";
import { RING, tv } from "./tv";

/*
 * On or off, taking effect at once: a flat track that fills with the ink
 * colour when on, the thumb sliding across. No gradient, no frame.
 */
export const switchStyles = tv({
  slots: {
    base: [
      "relative inline-block h-6.5 w-11 shrink-0 cursor-pointer rounded-full border-0 bg-line-strong p-0",
      "transition-colors duration-fast motion-reduce:transition-none",
      "aria-checked:bg-inverse disabled:cursor-default disabled:opacity-40",
      // A thumb's reach on a touch screen: an invisible band to touch height.
      "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-2.25",
      RING,
    ],
    thumb: [
      "pointer-events-none absolute top-0.75 left-0.75 size-5 rounded-full bg-ground shadow-control",
      "transition-transform duration-fast motion-reduce:transition-none",
      "group-aria-checked/switch:translate-x-4.5",
    ],
  },
});

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "role" | "aria-checked" | "onChange" | "children"
> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A switch on its own has no words: name it, or point at its label. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function Switch({
  checked,
  onChange,
  className,
  ...props
}: SwitchProps) {
  const styles = switchStyles();
  return (
    <button
      type="button"
      {...props}
      role="switch"
      aria-checked={checked}
      className={styles.base({ className: ["group/switch", className] })}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb()} aria-hidden="true" />
    </button>
  );
}
