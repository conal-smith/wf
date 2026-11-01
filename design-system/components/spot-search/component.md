# Spot search

The top bar's search (`ui/SpotSearch.tsx`, `spotSearchStyles`): a field that
finds a riding place as the rider types, with a list of results under it. With
nothing typed it offers the rider's own spots and the ones they look at most.

## Anatomy

- Field: `.wf-spot-search__field`, a soft grey pill (`sem.color.sunken`), 40px
  tall and 320px wide; while in use it widens to 400px and comes onto
  `sem.color.ground` with an ink edge. Inside: the magnifier (`__icon`, 16px),
  the input (`__input`, Inter at `sem.font.size.body`, "Search spots"), and the
  "/" key (`__key`, a small hairline box) or, once something is typed, a quiet
  clear button.
- Results: `.wf-spot-search__panel`, a sheet under the field on
  `sem.color.ground` with `sem.shadow.sheet` and a faint `sem.color.line`
  edge, `sem.radius.surface`, at most 480px tall and scrolling.
- Group name: `.wf-spot-search__group-name`, a small grey label in sentence
  case: "Your spots", "You look at".
- Option: `.wf-spot-search__option`, a row with a box's corner: the spot's
  name (`__name`, Inter semibold at `sem.font.size.prose`, the typed letters
  `__mark` underlined in the accent) and its county under it (`__county`), and
  on the right, where it is cheap, today's wind and stars (`__detail`).
- None: `.wf-spot-search__none`, "Type a spot's name or its county." or what
  was not found.
- Foot: `.wf-spot-search__foot`, what Enter does and what the right of a result
  shows, in small grey words. Not on a phone.

## Variants

- **Computer**: the field in the [Top bar](../top-bar/component.md) beside the
  wordmark.
- **Phone**: the field folds into a round quiet icon button; pressed, it opens
  as a field the width of the screen over the bar (56px tall, a hairline
  under it, a Cancel button), with the results filling the screen under it.

## States

- Focus: the field widens and takes the ink edge (`.is-focus` in the demo).
- Active option: `aria-selected="true"`, on `sem.color.sunken`; the arrow keys
  and the pointer move it.
- Reduced motion: the field changes width without the animation.

## Usage

- One spot search a page, in the top bar. Filtering a list in place is a
  [Search field](../search-field/component.md).
- What a pick does is the page's: the finder and a spot's page go to the
  spot's page; the chart flies to the spot and opens it there.
- About 150 places, filtered at once as the rider types: no wait, no spinner.

## Accessibility

- An ARIA combobox: the input has `role="combobox"`, `aria-expanded`,
  `aria-controls` (the list box) and `aria-activedescendant` (the active
  option); the results are a `role="listbox"` of `role="option"`s in
  `role="group"`s named by their group name.
- The arrow keys move through the results, Enter picks, Escape clears and then
  closes, and "/" anywhere on the page that is not a field comes to it (not
  under an open dialog).
- How many were found is said in a polite status region.
- The phone's round button is named "Search spots" and carries
  `aria-expanded`.
- Contrast: names 18.8:1 (light) and 17.5:1 (dark); counties 5.2:1 and 6.1:1.
