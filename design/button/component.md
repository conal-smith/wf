# Button

Everything the user can press. Force5 has one filled action per view; everything
else is quiet until it is touched.

## Anatomy

- A box at one of the three control heights, centred content, gap
  `--sem-space-gap-tight` between an icon and its label.
- A label in `--sem-text-label-*`.
- A radius: `--sem-radius-control` for a rectangle, `--sem-radius-round` for a
  capsule or a circle.

## Variants

- `.f5-button` - quiet. The default, and the right answer nearly always.
- `.f5-button--primary` - filled with `--sem-color-action-bg`. One per view.
- `.f5-button--pill` - quiet, capsule, bordered. Floating chrome that must read
  as pressable against a moving map.
- `.f5-button--icon` - a circle, no label, `aria-label` required.
- `.f5-button--link` - underlined text, for a recovery action inside a sentence.
- Sizes: `.f5-button--sm` (30px), default (40px), `.f5-button--lg` (46px).

## States

- `.f5-button:hover` - picks up `--sem-color-action-quiet-hover`; filled variants
  darken to `--sem-color-action-bg-hover`.
- `.f5-button:focus-visible` - the ring. Never removed, never restyled.
- `.f5-button:disabled` - label drops to `--sem-color-text-disabled`, the
  filled variant loses its fill to `--sem-color-surface-sunken`, default cursor,
  no hover. Opacity is not used: fading a control fades its label too.
- `.f5-button[aria-pressed="true"]` - a toggle that is on.

## Usage

Do give every icon-only button an `aria-label`.
Do use `aria-pressed` for a toggle, not a class, so the state is in the
accessibility tree rather than only in the paint.
Do not put two `--primary` buttons on one view. If two things look equally
important, neither is primary.
Do not shrink below `--sem-control-height-sm`, and only use that size where the
parent pads the tap target out to 44px.

## Accessibility

The focus ring is `--sem-stroke-focus-width` of `--sem-color-action-focus` at
`--sem-stroke-focus-offset`, identical on every variant, and it survives on the
filled variant because the ring sits outside the fill. Disabled buttons keep
their text at `--sem-color-text-disabled` rather than fading the colour itself,
so the label stays legible while the control reads as unavailable. All hover
affordances are also reachable by keyboard; none of the states are hover-only.
