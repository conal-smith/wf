import { Search } from "lucide-react";
import type { InputHTMLAttributes, Ref } from "react";
import { NO_RING, RING_WITHIN, tv, type VariantProps } from "./tv";

export const searchFieldStyles = tv({
  slots: {
    base: [
      "flex min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 shadow-control",
      "font-sans text-ink-muted transition-colors duration-fast hover:border-line-strong",
      "aria-busy:cursor-progress",
      RING_WITHIN,
    ],
    input: [
      "w-full min-w-0 flex-1 self-stretch appearance-none border-0 bg-transparent p-0",
      "font-sans text-prose font-normal text-ink",
      "placeholder:text-ink-muted placeholder:opacity-100",
      "pointer-coarse:text-lead",
      NO_RING,
    ],
  },
  variants: {
    size: {
      md: { base: "h-control-md" },
      lg: { base: "h-control-lg" },
    },
  },
  defaultVariants: { size: "lg" },
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
    ref?: Ref<HTMLInputElement>;
  };

export function SearchField({
  size,
  busy = false,
  className,
  ...props
}: SearchFieldProps) {
  const styles = searchFieldStyles({ size });
  return (
    <div className={styles.base({ className })} aria-busy={busy}>
      <Search size={16} aria-hidden="true" />
      <input {...props} type="search" className={styles.input()} />
    </div>
  );
}
