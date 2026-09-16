# Spot marker

What a location looks like on the map. The kind of place decides the shape, so the
map is readable before any colour is understood: riding spots are round and carry
a wind number, operators are squared, areas are dashed.

## Anatomy

- A near-solid ground (`--sem-color-surface-raised` over white) with a hairline,
  so it holds up over both a bright sea and a dark basemap.
- `--sem-effect-shadow-marker`, which lifts it off the tiles.
- For a riding spot, the wind reading in tabular figures.

## Variants

- `.f5-spot-marker` - a riding spot. Round, shows knots.
- `.f5-spot-marker--operator` - a school or hire centre. Squared at
  `--sem-radius-control`.
- `.f5-spot-marker--club` - a club. Round, no reading.
- `.f5-spot-marker--area` - a region rather than a point. Dashed border.

## States

- `.f5-spot-marker` - at rest.
- `.f5-spot-marker:hover` - lifts to `--sem-effect-shadow-surface`.
- `.f5-spot-marker[data-active="true"]` - selected: inverts onto
  `--sem-color-surface-inverse` and gains a white halo so it separates from
  whatever is under it.
- `.f5-spot-marker:focus-visible` - the ring.

## Usage

Do let shape carry the kind. Colour is the wind reading's job, and the two must
not compete.
Do keep the reading to whole knots; the marker is a glance, not a table.
Do not put a marker on a surface. Markers belong on the map.

## Accessibility

Kind is encoded as shape and announced in the accessible name, never by colour
alone. Markers are real buttons: focusable, ring-bearing, and activated by Enter
or Space, so the map is navigable without a pointer. The active halo is a white
ring rather than a hue change, so selection reads at any basemap brightness and
for a colour-blind user. The 30px marker is below the 44px target, so the map
layer pads each marker's hit area out to 44px rather than growing the paint.
