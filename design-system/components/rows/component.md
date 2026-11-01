# Rows

A list of rows in one soft card, a hairline between them inside it
(`ui/Rows.tsx`, `Rows` and `Row`): the stars' key, the spot index, the models,
a setting with its value.

## Anatomy

- Card: `.wf-rows`, a `<ul>` (or a `<div>` for a plain group) on
  `sem.color.sunken` with `sem.radius.surface`, carrying `on-card` (a control
  inside, a switch's row or a tag, takes the card's second grey); a
  `sem.rule.hairline` of
  `sem.color.line` between rows and nowhere else.
- Row: `.wf-rows__row`, at least 56px tall, `sem.space.x4` in from the sides,
  14px between its parts:
  - lead (optional): `__lead`, an icon, a mark or a picture, in
    `sem.color.ink-2`;
  - main: `__main`, the title `__title` (Inter semibold at
    `sem.font.size.prose`) and an optional grey line `__detail`
    (`sem.font.size.body`, `sem.color.ink-2`);
  - end (optional): `__end`, the value or an action, at the right;
  - chevron (optional): `__chevron` at the end, in `sem.color.ink-muted`, for a
    row that opens a page.

## Variants

- **Plain row**: a `<div>`, for information (a key, a value).
- **Action** (`--action`): a row that is a link (`<a href>`) or a button,
  taking the whole row as its target.
- **Dim** (`--dim`): not available; the title and detail in
  `sem.color.ink-muted` ("No stars: offshore").

## States

- Hover (action): `sem.color.line` under the pointer (`.is-hover` in the
  demo).
- Focus (action): the one ring, drawn inside the row so the card's corner does
  not clip it (`.is-focus`).

## Usage

- One card holds the rows; the rows do not each get a card.
- The title says what the row is (a spot, a model, a setting), the detail a
  short fact about it (a county, a resolution). Sentence case.
- The end is for one value or one control: a [Switch](../switch/component.md),
  a figure, a [Tag](../tag/component.md), a small button.
- Lists longer than a screen want a heading per group
  ([Heading](../heading/component.md), section step) and a card per group.

## Accessibility

- A `<ul>` of rows, each in an `<li>`, so a screen reader hears how many.
- An action row is one link or one button; its name is its title and detail.
  A control in the end of a plain row is named by the row's title
  (`aria-labelledby`).
- The chevron is `aria-hidden`.
- Contrast: titles 17.3:1 (light) and 16.0:1 (dark); details 10.4:1 and
  10.8:1; dim words 4.8:1 and 5.6:1.
