# Tag

A word on a thing that cannot be pressed (`ui/Tag.tsx`, `tagStyles`): a
condition, a status, a category. Offshore, Unsure, now, coming. A choice the
rider can press is a [Chip](../chip/component.md).

## Anatomy

- Tag: `.wf-tag`, a `<span>` 22px tall, `sem.space.x2` across, round-ended.
- Words: Inter at `sem.font.size.label` (12px), `sem.font.weight.medium`, in
  sentence case. An optional small icon before them.

## Variants

- **Neutral** (`.wf-tag`, the default): `sem.color.ink-2` on
  `sem.color.well` (the card's second grey on a soft card).
- **Off** (`--off`): `sem.color.pen-ink` on `sem.color.warn-ground`. Offshore,
  a warning, something wrong.
- **Ok** (`--ok`): `sem.color.ok` on `sem.color.well`. Good to go.
- **Glass** (`--glass`): `sem.color.glass` with `sem.blur.glass`, over a
  photograph; solid for a reader who has turned transparency down.

## States

- None. A tag does not hover, focus or press.

## Usage

- One or two words. Sentence case, never capitals, never tracked.
- Beside a name or a figure, never as a heading or an eyebrow over one.
- Do not make a tag look pressable, and do not put a link in one.
- A tag is not a notice: a weather warning is a
  [Notice](../notice/component.md) or, where it replaces the stars, a notice
  mark.

## Accessibility

- Plain text in a `<span>`; it is read with what it sits beside. Give it words
  that make sense out of context ("Offshore wind", not just a colour).
- Off is said in words as well as red.
- Contrast: neutral 10.4:1 (light) and 10.8:1 (dark); off 4.8:1 and 6.1:1;
  ok 5.5:1 and 7.9:1.
