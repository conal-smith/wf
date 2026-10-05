# Select

A native select in the kit's box (`ui/Select.tsx`,
`controlStyles({ kind: "select" })`): the platform's own picker, the
platform's arrow replaced by a chevron inside the same outline.

## Anatomy

- Box: `.wf-control.wf-control--select` — the shared field box (hairline in
  `sem.color.line-strong`, `sem.radius.control`, `sem.color.card`, at least
  `sem.size.touch` tall), positioned so the chevron can sit over it.
- Element: `.wf-control__input` on a `<select>` — no platform appearance,
  Newsreader at `sem.font.size.prose`, `sem.space.x6` clear on the right for
  the chevron, an ellipsis when the choice is long, a pointer cursor.
- Chevron: `.wf-control__adornment` on an inline SVG (lucide ChevronDown,
  16, stroke 2) in `currentColor`, which is the adornment's
  `sem.color.ink-muted`; laid `sem.space.x3` in from the right, the pointer
  passing through it. `aria-hidden`.
- Shared: the box, the element, the adornment and `--active` are the
  `.wf-control` classes owned by `components/text-input/component.css` (the
  product's `controlStyles` in `ui/control.ts`). This component links that
  file and adds only `.wf-control--select`.

## Variants

- **At "any"** — the default box.
- **Active** (`.wf-control--active`) — a filter narrowing the results: the
  border in `sem.color.accent.primary` and a second hairline inside it, a
  line and not a fill.

## States

- Hover: the border goes to `sem.color.ink` (`.is-hover` in the demo); an
  active box keeps its accent.
- Focus: the one ring round the box (`:focus-within`, `.is-focus` in the
  demo).
- Invalid: `sem.color.warn` border on `sem.color.warn-ground`, from
  `aria-invalid="true"` or a Field carrying `data-invalid`.
- Disabled: `sem.color.sunken`, a `sem.color.line` border,
  `sem.color.ink-disabled` words, default cursor; the chevron stays
  `ink-muted`.
- Coarse pointer: the words step to `sem.font.size.input` (16).

## Usage

- For one of many (a spot, a size) where a Segmented would not fit. Two to
  four short choices all in view are a Segmented instead.
- A filter's first option is "any" ("Any size"); choosing anything else sets
  `--active`.
- Inside a Field, or with an `aria-label` in a filter bar.

## Accessibility

- A real `<select>`: the platform's picker, keyboard and screen-reader
  behaviour are untouched.
- The chevron is decoration (`aria-hidden="true"`) and passes the pointer
  through.
- Active is said by a second line as well as the accent, so it survives
  greyscale.
