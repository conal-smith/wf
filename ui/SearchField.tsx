import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { NO_RING, RING_WITHIN, tv, type VariantProps } from "./tv";

export const searchFieldStyles = tv({
  slots: {
    // A rule to write on, as the chart's "Find a spot...": no box, an ink
    // line under the words, and the words in the body face's italic.
    base: [
      "flex min-w-0 items-center gap-2 border-0 border-b border-ink bg-transparent px-0.5",
      "font-body text-ink-muted transition-colors duration-fast hover:border-chart-magenta",
      "aria-busy:cursor-progress",
      // A tap target is never shorter than touch, whatever size was asked for.
      "pointer-coarse:min-h-touch",
      RING_WITHIN,
    ],
    input: [
      "w-full min-w-0 flex-1 self-stretch appearance-none border-0 bg-transparent p-0",
      "font-body text-prose font-normal text-ink",
      "placeholder:text-ink-muted placeholder:italic placeholder:opacity-100",
      "pointer-coarse:text-input",
      NO_RING,
    ],
  },
  variants: {
    size: {
      md: { base: "h-control-md" },
      lg: { base: "h-control-lg" },
      // The search a page is built around rather than a control in a bar:
      // taller than any other control, on a heavier rule, in the lead size.
      hero: {
        base: "h-13.5 gap-3 border-b-2 pr-1",
        input: "text-lead font-normal pointer-coarse:text-lead",
      },
    },
    // A capsule ruled all round in ink rather than a rule under the words:
    // a search inside a box, where a lone rule would read as a divider.
    shape: {
      rule: {},
      pill: {
        base: "rounded-pill border border-ink px-3.5 hover:border-chart-magenta",
      },
    },
  },
  defaultVariants: { size: "lg", shape: "rule" },
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
  shape,
  busy = false,
  className,
  children,
  ...props
}: SearchFieldProps) {
  const styles = searchFieldStyles({ size, shape });
  return (
    <div className={styles.base({ className })} aria-busy={busy}>
      <Search size={ICON[size]} aria-hidden="true" />
      <input {...props} type="search" className={styles.input()} />
      {children}
    </div>
  );
}
