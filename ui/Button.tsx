import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { DISABLED, RING, tv, type VariantProps } from "./tv";

/*
 * Four flat buttons, round-ended, in Inter and sentence case: filled (the one
 * thing to do next, at most one a view), outlined (the default), soft (a grey
 * fill, for a second action inside a card) and quiet (no edge: Reset, Clear,
 * Skip). No gradient, no raised shadow, no nudge. An icon button is a circle.
 * A link in running text is `link`; the one destructive answer is `danger`.
 */
export const buttonStyles = tv({
  base: [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-transparent",
    "font-body text-body font-medium text-ink no-underline whitespace-nowrap",
    "cursor-pointer touch-manipulation transition-colors duration-fast",
    // A tap target is never shorter than touch, whatever size was asked for.
    "pointer-coarse:min-h-touch",
    RING,
    DISABLED,
    "disabled:opacity-40 disabled:text-ink",
  ],
  variants: {
    variant: {
      // The default: a hairline round the words, the ground inside.
      outline: "border-line bg-ground not-disabled:hover:bg-well",
      // The one filled control: ink on the ground, a view has one or none.
      primary:
        "bg-accent text-accent-ink not-disabled:hover:bg-accent not-disabled:hover:opacity-90 disabled:text-accent-ink",
      // A grey fill, for a second action inside a card or a list.
      soft: "bg-well not-disabled:hover:bg-line",
      // No edge, for the small actions: Reset, Clear, Skip, Close.
      quiet: "not-disabled:hover:bg-well",
      // A way back or on in running text, underlined.
      link: [
        "underline decoration-1 underline-offset-3 decoration-line-strong",
        "not-disabled:hover:bg-transparent not-disabled:hover:decoration-current",
      ],
      // The destructive answer in a ConfirmDialog, and nowhere else.
      danger:
        "border-line bg-ground text-pen-ink not-disabled:hover:bg-warn-ground disabled:text-pen-ink",
    },
    size: {
      sm: "h-control-sm gap-1.5 px-3",
      md: "h-control-md px-4",
      lg: "h-control-lg px-5.5 text-prose",
    },
    icon: { true: "p-0 pointer-coarse:min-w-touch" },
    pressed: {
      // On: filled in ink, the way a chip is, and so not by colour alone.
      true: "border-transparent bg-inverse text-ink-inverse not-disabled:hover:bg-inverse not-disabled:hover:opacity-90",
      /*
       * A toggle that renames itself when it goes on (Save becomes Saved, the
       * star beside it filled) has already said so twice, in the word and the
       * mark, and keeps its own box: being on does not put a second filled
       * control on a view.
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
     * A thumb still gets a touch-tall target: an invisible band the height of
     * touch is laid across the words, so the target grows and nothing moves.
     */
    {
      variant: "link",
      class: [
        "relative h-auto rounded-control border-0 p-0 pointer-coarse:min-h-0",
        "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:top-1/2",
        "pointer-coarse:before:h-touch pointer-coarse:before:-translate-y-1/2",
      ],
    },
  ],
  defaultVariants: { variant: "outline", size: "md" },
});

type ButtonVariants = VariantProps<typeof buttonStyles>;

interface Shared {
  variant?: ButtonVariants["variant"];
  size?: ButtonVariants["size"];
  /**
   * A toggle that is on. `"worded"` for one whose own label and icon say so,
   * which keeps its box. Omit it on a button that is not a toggle.
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
