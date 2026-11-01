import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { NO_RING, tv, type VariantProps } from "./tv";

export const searchFieldStyles = tv({
  slots: {
    // A soft grey pill with the magnifier in it, a step lighter when it holds
    // the focus. No edge, no ring, no underline, no frame.
    base: [
      "flex min-w-0 items-center gap-2 rounded-full border border-transparent bg-well px-3.5",
      "font-body text-ink-muted transition-colors duration-fast",
      "focus-within:bg-raised",
      "aria-busy:cursor-progress",
      // A tap target is never shorter than touch, whatever size was asked for.
      "pointer-coarse:min-h-touch",
    ],
    input: [
      "h-full w-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0",
      "font-body text-prose font-normal text-ink",
      "placeholder:text-ink-muted placeholder:opacity-100",
      "pointer-coarse:text-input",
      NO_RING,
    ],
  },
  variants: {
    size: {
      md: { base: "h-control-md" },
      lg: { base: "h-11" },
    },
  },
  defaultVariants: { size: "md" },
});

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "aria-label"
> &
  VariantProps<typeof searchFieldStyles> & {
    /** A search has no visible label, so it cannot be written without a name. */
    "aria-label": string;
    /** Results are on their way. */
    busy?: boolean;
    /** What goes after the field, inside the same box: a way to clear it. */
    children?: ReactNode;
    ref?: Ref<HTMLInputElement>;
  };

export function SearchField({
  size,
  busy = false,
  className,
  children,
  ...props
}: SearchFieldProps) {
  const styles = searchFieldStyles({ size });
  return (
    <div className={styles.base({ className })} aria-busy={busy}>
      <Search size={16} strokeWidth={1.75} aria-hidden="true" />
      <input {...props} type="search" className={styles.input()} />
      {children}
    </div>
  );
}
