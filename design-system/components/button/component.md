# Button

The kit's one pressable control (`ui/Button.tsx`, `buttonStyles`). Mono
capitals in every variant; the shape says what it is.

## Anatomy

- Container: `.wf-button` — `sem.size.control.md` tall, `sem.space.x4` across,
  a hairline border (transparent unless the variant rules it), a capsule.
- Label: IBM Plex Mono at `sem.font.size.label`, `sem.font.weight.label`,
  tracked `sem.font.tracking.label`, uppercase.
- Optional icon: `.wf-button__icon`, 16px, `currentColor`, stroke 1.5 beside the
  mono label (lucide's default 2 reads heavy against the thin rules).

## Variants

- **Quiet** (`.wf-button`, the default) — no fill; `sem.color.sunken` under the
  pointer. Everything that is not the one action.
- **Primary** (`--primary`) — the ink pill: `sem.color.accent.primary` fill,
  `sem.color.accent.ink` label, `sem.color.accent.hover` (magenta) under the
  pointer. One per view, or none.
- **Pill** (`--pill`) — a capsule ruled in ink on paper; inverse under the
  pointer. Sign in, Previous / Next, Cancel.
- **Raised** (`--raised`) — the chart's instrument: a raised paper button
  ruled in ink (the site menu), lit from above (`sem.gradient.raised`) with
  `sem.shadow.raised`; `sem.radius.control` with words in it, a circle with an
  icon (the round menu button). Ink with its sheen under the pointer.
- **Link** (`--link`) — the label face underlined in ink, "← Chart"; magenta
  under the pointer. No box.
- **Danger** (`--danger`) — the warm pill, for the destructive answer in a
  confirm dialog and nowhere else. Lifts (`sem.shadow.marker`) under the
  pointer.
- **Sizes** `--sm` (30), md (40), `--lg` (46, semibold).
- **Icon** (`--icon`) — width equals height; a circle, raised included.
- **Pressed** (`aria-pressed="true"`) — filled in inverse with the ink's sheen
  (`sem.gradient.ink`), semibold and with `sem.shadow.control`: never colour
  alone. The primary pill carries the same sheen and lip. A lit button (primary,
  raised, pressed) nudges down a pixel while it is pressed. `--worded` keeps its quiet box for a
  toggle whose words say it is on (Save → Saved).

## States

- Hover: per variant above (`.is-hover` holds it in the demo).
- Focus: `:focus-visible` draws the one ring — `sem.ring.width` of
  `sem.color.focus`, `sem.ring.offset` clear (`.is-focus` in the demo).
- Disabled: `sem.color.ink-disabled` words, default cursor, no fade; filled
  variants go to `sem.color.sunken` on a `sem.color.line` ring.
- Coarse pointer: never shorter than `sem.size.touch`; a link grows an invisible
  touch-tall band instead.

## Usage

- One `--primary` per view. If a view seems to need two, the hierarchy is wrong.
- Name the action in a word or two: "Spot page →", "Sell", "Sign in".
- `--danger` only inside a confirm dialog, after Cancel in the document.
- With an `href` the product renders an `<a>` with the same classes, announced
  as a link; a link cannot be pressed, the current one carries
  `aria-current="true"` and draws as pressed.

## Accessibility

- A real `<button type="button">`, or `<a href>` for navigation.
- An icon-only button must carry `aria-label`; the product's types refuse one
  without it.
- Toggles expose `aria-pressed`; the pressed look adds weight and fill, so it
  survives greyscale.
- Label contrast: paper on ink 14.6:1, paper on the magenta hover 5.7:1, paper
  on warn 5.7:1.
