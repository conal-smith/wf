import { NO_RING, tv } from "./tv";

/**
 * The box a text field, a text area and a select share, and the bare element
 * inside it. The box is what is drawn: it takes the border, the hover and the
 * ring, so a prefix or a chevron sits inside the same outline as the text.
 */
export const controlStyles = tv({
  slots: {
    // A filled field: the soft card's grey, no rule round it, the ink edge
    // and a soft ring of the accent when it holds the focus.
    box: [
      "flex min-h-11 min-w-0 items-center gap-2.5 rounded-control border border-transparent bg-sunken px-3.5",
      "font-body text-ink transition-colors duration-fast",
      "focus-within:border-ink focus-within:ring-3 focus-within:ring-focus/20",
      // Wrong is said by the Field's message as well as by the warm ground.
      "group-data-invalid/field:border-warn group-data-invalid/field:bg-warn-ground",
      "has-aria-invalid:border-warn has-aria-invalid:bg-warn-ground",
      "has-disabled:text-ink-disabled has-disabled:opacity-60",
    ],
    input: [
      "w-full min-w-0 flex-1 self-stretch border-0 bg-transparent p-0",
      "font-body text-prose font-normal text-inherit",
      "placeholder:text-ink-muted placeholder:opacity-100 disabled:cursor-default",
      // A focused field under 16px makes a phone zoom the page, so on a touch
      // device a field takes the input step, which is 16.
      "pointer-coarse:text-input",
      NO_RING,
    ],
    // A unit or a currency sign, or the select's chevron.
    adornment: "shrink-0 font-body text-body text-ink-muted",
  },
  variants: {
    // A filter that is narrowing the results, as opposed to sitting at "any":
    // an ink edge, so it is not said by colour alone.
    active: {
      true: { box: "border-ink" },
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
