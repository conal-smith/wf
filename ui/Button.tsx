import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { DISABLED, HOVER, RING, tv, type VariantProps } from "./tv";

/*
 * Every button speaks in the mono label: tracked capitals in IBM Plex Mono,
 * as the chart's own controls do. The shapes are the chart's too: a capsule
 * ruled in ink, filled in ink when it is the one action, and a square box for
 * an instrument laid over the map.
 */
export const buttonStyles = tv({
  base: [
    "inline-flex shrink-0 items-center justify-center gap-1.5 border border-transparent bg-transparent",
    "font-mono text-label text-quiet uppercase no-underline whitespace-nowrap",
    "cursor-pointer touch-manipulation transition-colors duration-fast",
    // A tap target is never shorter than touch, whatever size was asked for.
    "pointer-coarse:min-h-touch",
    RING,
    DISABLED,
  ],
  variants: {
    variant: {
      quiet: ["rounded-pill", HOVER],
      // The one filled control: an ink pill, magenta under the pointer. A
      // view has one of these, or none.
      primary: [
        "rounded-full border-accent bg-accent text-accent-ink",
        "not-disabled:hover:border-accent-hover not-disabled:hover:bg-accent-hover",
        "disabled:border-line disabled:bg-sunken",
      ],
      // A capsule ruled in ink, which turns to ink under the pointer.
      pill: [
        "rounded-full border-ink bg-card",
        "not-disabled:hover:bg-inverse not-disabled:hover:text-ink-inverse",
        "disabled:border-line disabled:bg-transparent",
      ],
      /*
       * The chart's instrument: a square box ruled in ink, for a control laid
       * over the moving map (the site menu, zoom, layers), where a capsule
       * among the coastlines would read as one more shape on the chart. It
       * casts no shadow of its own; the frame it stands in has one.
       */
      raised: [
        "rounded-none border-ink bg-card",
        "not-disabled:hover:bg-inverse not-disabled:hover:text-ink-inverse disabled:bg-transparent",
      ],
      // A way back or on, in the label face, underlined in ink: "<- Chart".
      // A hover names its own background even where it wants none: the
      // site's reset lays a wash behind `button:enabled:hover`, and a variant
      // that stays quiet about it is the one place that wash gets through.
      link: [
        "underline decoration-1 underline-offset-4 decoration-ink",
        "not-disabled:hover:bg-transparent not-disabled:hover:text-chart-magenta not-disabled:hover:decoration-current",
      ],
      // The destructive answer in a ConfirmDialog, and nowhere else: warm
      // means degraded, and what it confirms cannot be taken back. It lifts
      // under the pointer and keeps its fill, rather than being washed out.
      danger:
        "rounded-full border-warn bg-warn text-ink-inverse not-disabled:hover:bg-warn not-disabled:hover:shadow-marker disabled:border-line disabled:bg-sunken",
    },
    size: {
      sm: "h-control-sm px-3",
      md: "h-control-md px-4",
      lg: "h-control-lg px-5 font-semibold",
    },
    icon: { true: "rounded-full p-0 pointer-coarse:min-w-touch" },
    pressed: {
      // Filled in ink as well as recoloured, and heavier: never colour alone.
      true: "border-ink bg-inverse font-semibold text-ink-inverse shadow-control not-disabled:hover:bg-inverse disabled:bg-sunken",
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
    // The instrument stays square with an icon in it.
    { icon: true, variant: "raised", class: "rounded-none" },
    /*
     * A link in running text: no box of its own, whatever size was asked for.
     * A thumb still gets a touch-tall target: on a coarse pointer an invisible
     * band the height of touch is laid across the words, centred on them, so
     * the target grows and nothing around it moves.
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
