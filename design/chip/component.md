# Chip

A small read-only pill that states a fact: which model is running, how many spots
matched, whether the pipeline is current. A chip is never pressable - if it can be
pressed it is a `.f5-button--pill`.

## Anatomy

- A capsule at `--sem-radius-round`, padded with `--sem-space-pad-control`.
- Optional leading dot (`.f5-chip__dot`) or icon.
- A label in `--sem-text-caption-*`, or `--sem-text-eyebrow-*` when tracked uppercase.

## Variants

- `.f5-chip` - the default, on `--sem-color-surface-raised`.
- `.f5-chip--glass` - free-floating over the map; carries its own glass and border.
- `.f5-chip--status` - leads with a dot; `data-status="ok|warn"` colours it.
- `.f5-chip--warn` - the whole chip in the warm family, for a degraded state.

## States

- `.f5-chip` - at rest. A chip has no interactive states by design.
- `.f5-chip--status[data-status="ok"]` - pipeline current.
- `.f5-chip--status[data-status="warn"]` - stale or failed.

## Usage

Do keep a chip to a handful of words; it is a label, not a sentence.
Do pair a status dot with words. The dot is redundant reinforcement, never the
only carrier of the state.
Do not attach a click handler. A chip that does something is a button.
Do not use `--warn` for emphasis. Warm means degraded, and nothing else.

## Accessibility

Colour never carries the status alone: `--status` chips always state the status in
text beside the dot, so the meaning survives for a colour-blind reader and in a
screenshot. The warm family is only ever paired with `--sem-color-status-warn-fg`
on `--sem-color-status-warn-bg`, which is contrast-tested as a pair.
