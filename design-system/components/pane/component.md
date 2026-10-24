# Pane

The box content sits in on a page that is read (`ui/Pane.tsx`, `paneStyles`).
Told apart from its siblings by its rules, never its fill. Over the map the box
is a Surface.

## Anatomy

- Container: `.wf-pane` — `sem.space.x5` inset, a box's corner
  (`sem.radius.surface`, 14px; square for a ruled section), `sem.color.ink`
  words.
- Rule: per kind (below): a hairline round it, none, or a heavy rule above.
- Paper: `sem.color.card` with `sem.texture.grain` for a card; the second
  sheet (`sem.color.sunken`) for a well; nothing for a ruled section.
- Content is free: the Pane sets no face or size of its own.

## Variants

- **Card** (`.wf-pane`, `kind="card"`, the default) — a card: a
  `sem.rule.hairline` ink border with `sem.shadow.frame` inside it, paper with
  its grain, and `sem.shadow.card`, a contact shadow only.
- **Sunken** (`--sunken`) — `sem.color.sunken`, no rule: a well, an aside, a
  breakdown of figures.
- **Ruled** (`--ruled`) — a `sem.rule.heavy` ink rule above, nothing at the
  sides, no fill; inset `sem.space.x3` above and none at the sides or foot, so
  it lines up with its column. Most of a page is this.
- **Double** (`--double`) — `sem.shadow.frame`. A card has it already; this
  is for a sunken pane that is to read as a box.
- **Standing** (`--standing`) — a pane on its own rather than in a column: a
  `sem.space.x6` inset from `sem.breakpoint.wide` (720px) up, `sem.space.x5`
  under it. Still a card: the contact shadow, no more.

## States

- None of its own. A pane is not pressed; a pane loading carries `aria-busy`
  and holds Skeletons.

## Usage

- Reach for `--ruled` (or a section heading) first; boxes are for what stands
  alone.
- One `--double` on a view at most; it is the chart's box, not decoration.
- A page that is read stands on `ground`, its boxes on `card`: one paper, so
  the rule sets the box apart, never a lighter fill.
- Do not round it, and add no shadow beyond `--standing`'s.

## Accessibility

- A plain `div`; the heading inside it names it. Use `section` with a heading
  when it is a section of the page.
- The rule is decoration and carries no meaning; a sunken pane's words stay at
  `sem.color.ink-muted` or darker (5.4:1 on sunken).
