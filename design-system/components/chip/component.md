# Chip

A label on a thing: a category, a condition, a status (`ui/Chip.tsx`,
`chipStyles`). A tag in the figures' face, in a capsule ruled with a hairline.
It labels; it is never pressed.

## Anatomy

- Capsule: `.wf-chip` — an inline row, `sem.space.x1` gap, `sem.space.x0-5` by
  `sem.space.x2-5` inset, a `sem.rule.hairline` border, `sem.radius.full`,
  never wrapping.
- Words: `sem.font.family.mono` at `sem.font.size.caption`.
- Icon: `.wf-chip__icon` — optional, a 10px lucide icon in `currentColor`
  (the heart of Saved, the camera of a photo count).

## Variants

- **Neutral** (`.wf-chip`, the default) — `sem.color.sunken` with a
  `sem.color.line` hairline, `sem.color.ink-2` words. A category, a figure.
- **Warn** (`--warn`) — `sem.color.warn-ground`, a `sem.color.warn` hairline and
  words: now, or degraded (Sold on a listing page, a photo that failed).
- **Glass** (`--glass`) — paper over a photograph: an ink hairline,
  `sem.color.glass` (paper that lets a little through) with a `sem.blur.glass`
  blur behind, ink words. Goes solid (`sem.color.solid`, no blur) for a reader
  who has asked for less transparency.
- **Eyebrow** (`--eyebrow`) — the mono label's step: `sem.font.size.eyebrow`,
  its weight and tracking, capitals. With any tone.

## States

- None. A chip is not pressed, hovered or focused; something that is pressed is
  a Button.

## Usage

- Glass only over a photograph (a listing's badges: Saved, Sold, the photo
  count, Cover). Never over the map: over the map, paper is opaque.
- Warm means now or degraded. A chip that is only a category is neutral; do not
  use warm to make a tag stand out.
- A word or a figure, never a sentence.

## Accessibility

- A plain `span`. A status that appears after an action (a failed upload)
  carries `role="alert"`.
- An icon is `aria-hidden`; give an icon-led figure a visually hidden word
  ("Photos: 4").
- Ink-2 on sunken 8.9:1; warn on warn-ground 4.8:1; ink on glass reads on any
  picture because the paper is near solid.
