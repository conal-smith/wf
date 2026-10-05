# Skeleton

The shape of what is loading, so the page does not jump when it lands
(`ui/Skeleton.tsx`, `skeletonStyles`). It says nothing itself.

## Anatomy

- Shape: `.wf-skeleton` — a block-level `span` filled with `sem.color.line`
  (the hairline's ink, which shows on grained paper where the second sheet does
  not), breathing with `sem.animate.pulse`. The caller sets its width.

## Variants

- **Line** (`.wf-skeleton`, the default) — `sem.space.x3` tall, the field's
  `sem.radius.control`: square, as a line of type is.
- **Block** (`--block`) — at least 128px (32 steps) tall, square
  (`sem.radius.surface`): a photo, a chart, a pane's worth.
- **Circle** (`--circle`) — `sem.size.control.md` across, a full circle: an
  avatar, a light.

## States

- Loading: pulses from 0.45 opacity to whole and back, a second each way.
- Reduced motion: still (`prefers-reduced-motion: reduce`); the shape alone
  says something is coming.

## Usage

- Draw the shape of what will land: as many lines as the row has, at roughly
  their widths, inside the same box.
- Swap the whole holder at once when the data lands; do not mix skeletons and
  real rows.
- Never as decoration, and never coloured: it is the hairline's ink only.

## Accessibility

- Each shape is `aria-hidden`. The element that holds them carries
  `aria-busy="true"` (and a label where it has none), and drops it when the
  content lands.
- Motion is held for a reader who asks for less.
