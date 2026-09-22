import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { DISABLED, HOVER, RING, tv, type VariantProps } from "./tv";

export const buttonStyles = tv({
  base: [
    "inline-flex shrink-0 items-center justify-center gap-1 border-0 bg-transparent",
    "font-sans text-label text-quiet no-underline whitespace-nowrap",
    "cursor-pointer touch-manipulation transition-colors duration-fast",
    // A tap target is never shorter than touch, whatever size was asked for.
    "pointer-coarse:min-h-touch",
    RING,
    DISABLED,
  ],
  variants: {
    variant: {
      quiet: ["rounded-control", HOVER],
      // The one filled control. A view has one of these, or none.
      primary:
        "rounded-full bg-accent text-accent-ink not-disabled:hover:bg-accent-hover disabled:bg-sunken",
      pill: [
        "rounded-full border border-line bg-card shadow-control",
        "disabled:bg-transparent disabled:shadow-none",
        HOVER,
      ],
      /*
       * The pill's twin for a control that stands on glass, or on the moving
       * map: a card fill would be an opaque patch there, and sunken grey a
       * darker one. The raised white and the glass's own white hairline, no
       * shadow of its own (the glass it stands on has one), and a whiter
       * white under the pointer. The site menu's trigger is the one reader.
       */
      raised: [
        "rounded-full border border-card/70 bg-card/40",
        "not-disabled:hover:bg-card/55 disabled:bg-transparent",
      ],
      // A hover names its own background even where it wants none: the site's
      // reset lays 25% white behind `button:enabled:hover`, and a variant that
      // stays quiet about it is the one place that white gets through.
      link: "font-normal underline underline-offset-4 decoration-line-strong not-disabled:hover:bg-transparent not-disabled:hover:text-ink not-disabled:hover:decoration-current",
      // The destructive answer in a ConfirmDialog, and nowhere else: warm
      // means degraded, and what it confirms cannot be taken back. It lifts
      // under the pointer and keeps its fill, rather than being washed out.
      danger:
        "rounded-full bg-warn text-ink-inverse not-disabled:hover:bg-warn not-disabled:hover:shadow-marker disabled:bg-sunken",
    },
    size: {
      sm: "h-control-sm px-2",
      md: "h-control-md px-3",
      lg: "h-control-lg px-5 text-prose font-semibold",
    },
    icon: { true: "rounded-full p-0 pointer-coarse:min-w-touch" },
    pressed: {
      // Raised and filled as well as recoloured, and heavier: never colour alone.
      true: "border-transparent bg-inverse font-bold text-ink-inverse shadow-control not-disabled:hover:bg-inverse disabled:bg-sunken",
      /*
       * A toggle that renames itself when it goes on — Save becomes Saved, the
       * heart beside it filled in — has already said so twice, in the word and
       * in the mark. It keeps its quiet box, so that being on does not put a
       * second filled control on a view that already has the one it is allowed.
       */
      worded: "",
    },
  },
  compoundVariants: [
    { icon: true, size: "sm", class: "w-control-sm" },
    { icon: true, size: "md", class: "w-control-md" },
    { icon: true, size: "lg", class: "w-control-lg" },
    /*
     * A link in running text: no box of its own, whatever size was asked for.
     * A thumb still gets a touch-tall target: on a coarse pointer an invisible
     * band the height of touch is laid across the words, centred on them, so
     * the target grows and nothing around it moves.
     */
    {
      variant: "link",
      class: [
        "relative h-auto rounded-control p-0 pointer-coarse:min-h-0",
        "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:top-1/2",
        "pointer-coarse:before:h-touch pointer-coarse:before:-translate-y-1/2",
      ],
    },
  ],
  defaultVariants: { variant: "quiet", size: "md" },
});

type ButtonVariants = VariantProps<typeof buttonStyles>;

interface Shared {
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  /**
   * A toggle that is on. `"worded"` for one whose own label and icon say so,
   * which keeps its quiet box. Omit it on a button that is not a toggle.
   */
  pressed?: boolean | "worded";
  children?: ReactNode;
}

/**
 * An icon says nothing to a screen reader, so a button that is only an icon
 * cannot be written without a name: `icon` makes `aria-label` required.
 */
type Labelled =
  | { icon: true; "aria-label": string }
  | { icon?: false; "aria-label"?: string };

type Omitted = "aria-label" | "aria-pressed" | "children";

type AsButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, Omitted> & {
  href?: undefined;
  ref?: Ref<HTMLButtonElement>;
};

/** With an `href` it is a link that looks like a button, and is announced as a link. */
type AsLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, Omitted> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
};

export type ButtonProps = Shared & Labelled & (AsButton | AsLink);

export function Button(props: ButtonProps) {
  const { variant, size, icon, pressed, className, ...rest } = props;
  const classes = buttonStyles({ variant, size, icon, pressed, className });
  // A link cannot be pressed; the one that is on is the current one.
  if (rest.href !== undefined)
    return (
      <a
        aria-current={pressed ? "true" : undefined}
        {...rest}
        className={classes}
      />
    );
  return (
    <button
      type="button"
      {...rest}
      className={classes}
      aria-pressed={pressed === undefined ? undefined : pressed !== false}
    />
  );
}
