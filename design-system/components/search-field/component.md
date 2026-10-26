# Search field

A rule to write on, as the chart's "Find a spot…" (`ui/SearchField.tsx`,
`searchFieldStyles`): no box, an ink line under the words, the placeholder in
the body face's italic, the magnifier ahead of it.

## Anatomy

- Field: `.wf-search-field` on the wrapper that carries `aria-busy` — a
  flex row, `sem.space.x2` between its parts, `sem.space.x0-5` either side,
  no border but a `sem.rule.hairline` of `sem.color.ink` underneath, no
  fill, `sem.color.ink-muted` (which the magnifier takes).
- Magnifier: `.wf-search-field__icon` — lucide Search, 16 (`sem.space.x4`),
  stroke 2, `currentColor`, `aria-hidden`.
- Input: `.wf-search-field__input` on an `<input type="search">` — bare, no
  platform appearance, Newsreader at `sem.font.size.prose`, normal weight,
  `sem.color.ink`; the placeholder italic in `sem.color.ink-muted`.
- Optional trailing part: whatever follows the input inside the field, such
  as a way to clear it (a quiet icon Button).

## Variants

- **lg** (the default) — `sem.size.control.lg` (46) tall: the chart's head.
- **md** (`--md`) — `sem.size.control.md` (40): a search in a bar.
- **hero** (`--hero`) — the search a page is built around: `sem.space.step`
  × 13.5 (54) tall, taller than any other control, on a `sem.rule.heavy`
  line, `sem.space.x3` between its parts, `sem.space.x1` clear on the right,
  a 20 (`sem.space.x5`) magnifier, and the words at `sem.font.size.lead` in
  normal weight on every pointer.
- **Pill** (`--pill`, `shape="pill"`) — a capsule (`sem.radius.pill`) ruled
  all round in a `sem.rule.hairline` of `sem.color.ink`, `sem.space.step` ×
  3.5 either side, for a search inside a box,
  where a lone rule under the words would read as a divider. Combines with
  the sizes; the hover takes the whole border to `sem.color.chart-magenta`.

## States

- Hover: the line goes to `sem.color.chart-magenta` (`.is-hover` in the
  demo).
- Focus: the one ring round the whole field when its input holds the focus
  (`:focus-within`, `.is-focus` in the demo): `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear. The input draws none.
- Busy (`aria-busy="true"` on the field): results are on their way; the
  cursor says progress.
- Coarse pointer: the field is at least `sem.size.touch` tall, and the words
  step to `sem.font.size.input` (16), except hero, which stays at lead.

## Usage

- The chart's head: the menu, the wordmark, then "Find a spot…" on its rule.
- A placeholder says what is found ("Find a spot…", "Search listings"), with
  the ellipsis; there is no visible label.
- One hero on a page, and only on a page built around its search.
- Not a form field: a field in a form is a Text input in a Field.

## Accessibility

- A search has no visible label, so it must carry an `aria-label`; the
  product's types refuse one without it.
- `type="search"` gives the platform's search keyboard and its Escape to
  clear.
- `aria-busy` on the field tells assistive technology results are loading.
- The rule is `ink`, 14.6:1; the placeholder `ink-muted`, 5.8:1 on paper.
