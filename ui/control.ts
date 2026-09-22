import { NO_RING, RING_WITHIN, tv } from "./tv";

/**
 * The box a text field, a text area and a select share, and the bare element
 * inside it. The box is what is drawn: it takes the border, the hover and the
 * ring, so a prefix or a chevron sits inside the same outline as the text.
 */
export const controlStyles = tv({
  slots: {
    box: [
      "flex min-h-touch min-w-0 items-center gap-2 rounded-control border border-line-strong bg-card px-3",
      "font-sans text-ink transition-colors duration-fast hover:border-ink-muted",
      RING_WITHIN,
      // Wrong is said by the Field's message as well as by the warm ground.
      "group-data-invalid/field:border-warn group-data-invalid/field:bg-warn-ground group-data-invalid/field:hover:border-warn",
      "has-aria-invalid:border-warn has-aria-invalid:bg-warn-ground has-aria-invalid:hover:border-warn",
      "has-disabled:border-line has-disabled:bg-sunken has-disabled:text-ink-disabled has-disabled:hover:border-line",
    ],
    input: [
      "w-full min-w-0 flex-1 self-stretch border-0 bg-transparent p-0",
      "font-sans text-prose font-normal text-inherit",
      "placeholder:text-ink-muted placeholder:opacity-100 disabled:cursor-default",
      // A focused field under 16px makes a phone zoom the page. The scale has
      // no 16, so on a touch device a field takes the next step up.
      "pointer-coarse:text-lead",
      NO_RING,
    ],
    adornment: "shrink-0 font-semibold text-ink-muted",
  },
  variants: {
    // A filter that is narrowing the results, as opposed to sitting at "any":
    // a second line inside the border, so it is not said by colour alone.
    active: {
      true: {
        box: "border-accent inset-ring inset-ring-accent hover:border-accent",
      },
    },
    kind: {
      text: {},
      area: {
        box: "items-start",
        // Three large controls tall before anything is written, as the design
        // bundle always drew a text area.
        input: "min-h-34.5 resize-y py-3 leading-normal",
      },
      select: {
        box: "relative",
        input: "cursor-pointer appearance-none pr-6 text-ellipsis",
        adornment: "pointer-events-none absolute right-3 font-normal",
      },
    },
  },
  defaultVariants: { kind: "text" },
});
