# Surface

Every floating thing in Force5 is a surface: a pane of tinted glass, blurred over
the map, edged with a lit stroke so it reads as an object and not a stain. The map
is the only thing in the product that is not on a surface.

## Anatomy

- A ground (`--sem-color-surface-glass`) plus a backdrop blur.
- A one-stroke border in `--sem-color-border-glass`, which is the lit edge.
- An elevation from `--sem-effect-shadow-*`, which says how far it floats.
- A radius from `--sem-radius-*`, which says what kind of surface it is.

## Variants

- `.f5-surface` - the default pane. Panels, popovers, the layers panel.
- `.f5-surface--pill` - the same glass at pill radius, for floating chrome.
- `.f5-surface--dock` - edge to edge along the bottom, square, casting upward.
- `.f5-surface--dialog` - modal radius, dialog padding, above the scrim.
- `.f5-surface--sunken` - a recess *inside* a surface. No blur, no shadow.

## States

- `.f5-surface` - at rest.
- `.f5-surface[data-elevated="false"]` - flush: no shadow, for a surface that
  sits directly on another rather than over the map.

## Usage

Do use a surface for anything that floats over the map.
Do keep one elevation per layer: two surfaces at the same z must cast the same shadow.
Do not nest glass inside glass - the blurs compound into mud. Put
`--sem-color-surface-raised` or `.f5-surface--sunken` inside a surface instead.
Do not invent a radius. If none of the four fits, the surface is the wrong component.

## Accessibility

The blur is decorative and never carries meaning. Under
`prefers-reduced-transparency: reduce`, and where `backdrop-filter` is
unsupported, the ground falls back to the opaque `--sem-color-surface-solid`;
every text token is contrast-tested against that solid ground, not against the
glass, so the fallback is the accessible case rather than a degradation.
