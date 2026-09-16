# Search field

The one text input in Force5: find a spot by name. It is a glass capsule so it
reads as chrome floating over the map rather than a form.

## Anatomy

- A capsule at `--sem-control-height-lg`, radius `--sem-radius-round`.
- A leading search icon in `--sem-color-text-muted`.
- The `<input>` itself: transparent, borderless, inheriting the field's colour.
- An optional trailing clear button (`.f5-button--icon.f5-button--sm`).

## Variants

- `.f5-search` - the default, 46px.
- `.f5-search--sm` - 40px, for compact layouts where the map is the priority.

## States

- `.f5-search:focus-within` - the whole capsule takes the ring, not the bare input.
- `.f5-search input::placeholder` - `--sem-color-text-muted`.
- `.f5-search[data-busy="true"]` - a query is resolving.

## Usage

Do let the capsule own the focus ring. Ringing the inner input inside a rounded
capsule draws a rectangle inside a pill, which looks broken.
Do keep the placeholder a hint, never the only label; pair it with a visually
hidden `<label>` or an `aria-label`.
Do not put two actions in the trailing slot.

## Accessibility

Focus is taken by `:focus-within` on the capsule so the ring traces the control's
real shape, and the ring is the same token as every other control's. The input
keeps a real accessible name via a `<label>`; the placeholder disappears on type
and so can never be the name. The trailing clear button is a real button with an
`aria-label`, reachable in tab order after the input.
