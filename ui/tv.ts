/**
 * The kit's one `tv()`, and the states every control shares.
 *
 * A recipe's classes are merged, so a later `rounded-full` replaces an earlier
 * `rounded-control` rather than leaving the stylesheet's order to decide. The
 * merge only knows the stock names, and ui/theme.css has replaced them: left
 * alone it reads `text-label` as a colour and drops it beside `text-ink`. So
 * the theme's names are listed here, family by family, and ui/tv.test.ts fails
 * when the theme gains a name this list does not hold.
 */
import { createTV } from "tailwind-variants";

export type { VariantProps } from "tailwind-variants";

export const THEME_NAMES = {
  text: [
    "eyebrow",
    "caption",
    "label",
    "body",
    "prose",
    "lead",
    "title",
    "reading",
    "display",
  ],
  radius: ["control", "surface", "pill", "dialog", "full"],
  shadow: ["control", "marker", "surface", "dock"],
  blur: ["glass", "scrim"],
  container: ["dialog", "dialog-wide", "reading", "measure", "page", "form"],
  spacing: ["control-sm", "control-md", "control-lg", "touch"],
  animate: ["pulse", "dialog-in", "menu-in"],
  "transition-duration": ["fast", "base", "slow"],
  "z-index": ["popover", "panel", "header", "dialog", "intro"],
} as const;

const {
  "transition-duration": duration,
  "z-index": layer,
  ...theme
} = THEME_NAMES;

export const tv = createTV({
  twMergeConfig: {
    extend: {
      theme,
      classGroups: { duration: [{ duration }], z: [{ z: layer }] },
    },
  },
});

/*
 * A hover below is written `not-disabled:…` for its weight as much as its
 * meaning. The site's reset (src/styles.css) styles `button:enabled:hover`, an
 * element and two pseudo-classes, which outranks a class and one.
 * `:not(:disabled)` adds the one step that wins, and unlike `:enabled` it also
 * matches a link. The reset's `button:focus-visible` and `button:disabled`
 * are an element and one pseudo-class, which a class and one already beats:
 * the ring carries `not-disabled:` only to be written as the hover is, and
 * `focus-visible:outline-hidden` is enough to take the map's ring off a field.
 */

/** The one focus ring: 3px of focus, 2px clear of the control. */
export const RING =
  "not-disabled:focus-visible:outline-3 not-disabled:focus-visible:outline-offset-2 not-disabled:focus-visible:outline-focus";

/** The same ring on a box whose field holds the focus, which then draws none. */
export const RING_WITHIN =
  "focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus";
export const NO_RING = "focus-visible:outline-hidden";

/** What a quiet control does under the pointer. */
export const HOVER = "not-disabled:hover:bg-sunken";

/** Disabled is said in ink and cursor; the reset's fade is taken back off. */
export const DISABLED =
  "disabled:cursor-default disabled:text-ink-disabled disabled:opacity-100";
