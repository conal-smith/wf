import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { NO_RING, RING_WITHIN, tv, type VariantProps } from "./tv";

export const searchFieldStyles = tv({
  slots: {
    base: [
      "flex min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 shadow-control",
      "font-sans text-ink-muted transition-colors duration-fast hover:border-line-strong",
      "aria-busy:cursor-progress",
      // A tap target is never shorter than touch, whatever size was asked for.
      "pointer-coarse:min-h-touch",
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
      // The search a page is built around rather than a control in a bar:
      // taller than any other control, lifted off the ground, and open enough
      // at the leading edge for the icon to stand clear of the words.
      hero: { base: "h-13.5 gap-3 pr-2 pl-5 shadow-marker" },
    },
  },
  defaultVariants: { size: "lg" },
});

/** The magnifier, which grows with the box. */
const ICON = { md: 16, lg: 16, hero: 20 } as const;

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
  size = "lg",
  busy = false,
  className,
  children,
  ...props
}: SearchFieldProps) {
  const styles = searchFieldStyles({ size });
  return (
    <div className={styles.base({ className })} aria-busy={busy}>
      <Search size={ICON[size]} aria-hidden="true" />
      <input {...props} type="search" className={styles.input()} />
      {children}
    </div>
  );
}
