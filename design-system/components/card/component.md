# Card

The box content sits in (`ui/Card.tsx`, `cardStyles`): on a page, a soft card
a shade off the ground; over the map, a box that floats. It replaces every
framed or ruled panel the site used to draw.

## Anatomy

- Card: `.wf-card`, `sem.color.sunken` with a box's corner
  (`sem.radius.surface`), `sem.space.x5` inside (`sem.space.x4` on a phone).
  No border and no shadow.
- Usual contents (optional): `.wf-card__label`, a small grey label in
  sentence case (`sem.font.size.body`, `sem.color.ink-muted`); `.wf-card__big`,
  one big figure, semibold and tracked tight, with its unit `__unit` in
  `sem.color.ink-2`; `.wf-card__line`, one short line in `sem.color.ink-2`.
- Grid (optional): `.wf-card-grid`, cards side by side with `sem.space.x3`
  between them (`sem.grid.cards`).

## Variants

- **Soft** (`.wf-card`, the default): on a page.
- **Float** (`--float`): over the map, a popover, the dock: `sem.color.ground`
  with `sem.shadow.float`; in dark a faint `sem.color.line` edge as well,
  because a shadow barely shows on a dark chart.
- **Pad none** (`--pad-none`): no padding, for a card whose content runs to
  its edge (a picture, a list of [Rows](../rows/component.md)).

## States

- None of its own. A card that is a link or a button takes a hover of
  `sem.color.line` and the one focus ring, as a row does.

## Usage

- Structure a page by space and soft cards, not by rules. Cards sit apart
  with `sem.space.x3` to `sem.space.x4` between them; sections with more.
- Hairlines (`sem.color.line`) only inside a card: between rows, above a
  dialog's actions. Never a rule round a card, never a heavy or double rule.
- One big figure and one short line a card. If a card needs a heading, use
  [Heading](../heading/component.md) at the card step.
- Do not nest a soft card in a soft card; inside a card, group by space.
- A soft card carries `on-card` (`.wf-on-card` here, the product's `on-card`
  utility): inside it `sem.color.well`, the fill every control takes, becomes
  `sem.color.raised`, the second grey, so a soft button, a segmented control,
  a chip, a tag or a filled field still shows on the card. Give anything else
  drawn on the card's grey the same class.

## Accessibility

- A card is a plain `<div>` (or `<section>` with a heading); it adds no role.
- A card that is a link wraps its content in one `<a>`, named by the card's
  title, so a screen reader hears it once.
- The soft grey is decoration: what the card says is in its words, at 17.3:1
  (light) and 16.0:1 (dark).
