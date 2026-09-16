# Segmented control

A small set of mutually exclusive choices, all visible at once: knots or metres
per second, which forecast model. Use it up to four options; past that it is a
list, not a segmented control.

## Anatomy

- A trough (`.f5-segmented`) in `--sem-color-surface-sunken`, padded by
  `--sem-space-gap-tight` so the selected segment floats inside it.
- Segments (`.f5-segmented__item`), each a real `<button>` carrying `aria-pressed`.

## Variants

- `.f5-segmented` - horizontal, the default.
- `.f5-segmented--stack` - vertical, for a model list inside a popover.

## States

- `.f5-segmented__item[aria-pressed="true"]` - selected: raised onto
  `--sem-color-surface-raised` with `--sem-effect-shadow-control`.
- `.f5-segmented__item:hover` - unselected segments only.
- `.f5-segmented__item:focus-visible` - the ring, inset so it is not clipped by
  the trough.
- `.f5-segmented__item:disabled` - an option that is not currently loadable.

## Usage

Do use `aria-pressed` on each button, and keep exactly one true.
Do keep the labels the same length where you can; segments that resize as the
selection moves are hard to hit.
Do not use a segmented control for an on/off. That is a switch or a checkbox.
Do not exceed four segments.

## Accessibility

Each segment is a real `<button>` with `aria-pressed`, so the selection is in the
accessibility tree rather than only in the fill, and the whole group is reachable
by tab with each segment individually focusable. The focus ring is drawn inset
(`outline-offset` negative) because an offset ring would be clipped by the
trough's overflow; it is the same width and colour as everywhere else. Selection
is carried by elevation and weight as well as fill, so it survives without colour.
