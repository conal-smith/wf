# Search field

A field that searches (`ui/SearchField.tsx`, `searchFieldStyles`): a soft grey
pill with the magnifier in it. No underline, no frame.

## Anatomy

- Pill: `.wf-search-field`, 40px tall (`sem.size.control.md`), 14px in from
  each end, round-ended, on `sem.color.well`, a transparent hairline edge.
- Icon: `.wf-search-field__icon`, a 16px magnifier in `sem.color.ink-muted`,
  stroke 1.75, `aria-hidden`.
- Input: `.wf-search-field__input`, a bare `<input type="search">`, Inter at
  `sem.font.size.prose` (`sem.font.size.input` on a touch screen),
  placeholder in `sem.color.ink-muted`. The browser's own clear button is
  taken off.
- After the input (optional): a way to clear it, a quiet small icon
  [Button](../button/component.md), inside the same pill.

## Variants

- **md** (the default), 40px; **lg** (`--lg`), 44px, for a search that is a
  page's main control.

## States

- Focus: the ink edge, the pill onto `sem.color.ground`, and a soft ring of
  the accent (the focus colour at 20%) (`.is-focus` in the demo).
- Busy (`aria-busy="true"`): results on their way; a progress cursor.
- Coarse pointer: never shorter than `sem.size.touch`.

## Usage

- For filtering a list in place (a spot index, a marketplace). The top bar's
  search for a spot by name is the [Spot search](../spot-search/component.md),
  which adds a list of results.
- The placeholder says what can be searched: "Search spots", "Search
  listings".

## Accessibility

- A search has no visible label, so it must carry an `aria-label`; the
  product's types refuse one without it.
- A results count is announced in a polite live region near the field, not in
  the field.
- Contrast: typed words 17.3:1 (light) and 16.0:1 (dark) on the pill;
  placeholder 4.8:1 and 5.6:1.
