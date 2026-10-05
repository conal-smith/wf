import type { AnchorHTMLAttributes, Ref } from "react";
import { RING, tv, type VariantProps } from "./tv";

export const linkStyles = tv({
  base: [
    "rounded-control text-quiet transition-colors duration-fast not-disabled:hover:text-chart-magenta",
    RING,
  ],
  variants: {
    // In running text a link is underlined: ink alone does not say "link".
    // In a list of nothing but links, a footer or a menu, it can go plain.
    plain: {
      false:
        "underline decoration-1 underline-offset-3 decoration-line-strong not-disabled:hover:decoration-current",
      true: "no-underline",
    },
  },
  defaultVariants: { plain: false },
});

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  VariantProps<typeof linkStyles> & {
    href: string;
    ref?: Ref<HTMLAnchorElement>;
  };

/**
 * A link in text. A plain <a href>: a section's router takes it over with its
 * own `onClick`, and it still opens in a new tab when asked to.
 */
export function Link({ plain, className, ...props }: LinkProps) {
  return <a {...props} className={linkStyles({ plain, className })} />;
}
