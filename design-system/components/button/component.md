# Button

The kit's one pressable control (`ui/Button.tsx`, `buttonStyles`): flat,
round-ended, in Inter and sentence case. The style says how much the action
matters; no button has a gradient, a raised shadow or a nudge when pressed.

## Anatomy

- Container: `.wf-button`, `sem.size.control.md` (40px) tall,
  `sem.space.x4` across, round-ended (`sem.radius.full`), a
  `sem.rule.hairline` edge in `sem.color.line` on `sem.color.ground`.
- Label: Inter at `sem.font.size.body`, `sem.font.weight.medium`, in
  sentence case. Never capitals, never tracked.
- Optional icon: `.wf-button__icon`, 18px, `currentColor`, stroke 1.75, before
  the words (or alone, in an icon button).

## Variants

- **Outline** (`.wf-button`, the default): a hairline round the words, the
  ground inside, `sem.color.well` under the pointer. Most buttons.
- **Primary** (`--primary`): the one filled control,
  `sem.color.accent.primary` (ink in light, near-white in dark) with
  `sem.color.accent.ink` words; a touch lighter under the pointer. At most one
  a view: the next thing to do ("Show 12 spots", "Get started").
- **Soft** (`--soft`): a grey fill, `sem.color.well` (the soft grey on the
  ground; the card's second grey, `sem.color.raised`, on a soft card), no
  edge; `sem.color.line` under the pointer. A second action, on the page or
  inside a card or a list.
- **Quiet** (`--quiet`): no edge and no fill until the pointer is over it
  (`sem.color.well`).
  The small actions: Reset, Clear, Skip, Close.
- **Link** (`--link`): words underlined in `sem.color.line-strong`, the
  underline in the words' colour under the pointer. No box. A way back or on
  in running text.
- **Danger** (`--danger`): the outline with its words in `sem.color.pen-ink`,
  `sem.color.warn-ground` under the pointer. The destructive answer in a
  confirm dialog, and nowhere else.
- **Sizes**: `--sm` 32px (`sem.size.control.sm`), md 40px
  (`sem.size.control.md`), `--lg` 48px (`sem.size.control.lg`) at
  `sem.font.size.prose`.
- **Icon** (`--icon`): width equals height, so a circle, in any style.
- **Pressed** (`aria-pressed="true"`, or `aria-current="true"` on a link):
  filled in `sem.color.inverse` with `sem.color.ink-inverse` words, the way a
  chosen chip is. `--worded` keeps its own box, for a toggle whose words and
  mark already say it is on (Save becomes Saved, the star filled): being on
  does not put a second filled control on a view.

## States

- Hover: per style above (`.is-hover` holds it in the demo).
- Focus: `:focus-visible` draws the one ring, `sem.ring.width` of
  `sem.color.focus` with `sem.ring.offset` clear (`.is-focus` in the demo).
- Disabled: the whole button at 40% and the default cursor.
- Coarse pointer: never shorter than `sem.size.touch`; a link grows an invisible
  touch-tall band instead, so nothing moves.

## Usage

- One `--primary` a view, or none. If a view seems to need two, the hierarchy
  is wrong: make the second outlined or soft.
- Name the action in a word or two, in sentence case: "Show 12 spots", "Try
  again", "Sign in".
- Inside a soft card, the second action is `--soft` or `--quiet`: the card
  carries `on-card`, so the soft fill is its second grey and shows. Never two
  filled buttons.
- `--danger` only inside a confirm dialog, after Cancel in the document.
- With an `href` the product renders an `<a>` with the same classes, announced
  as a link; a link cannot be pressed, the current one carries
  `aria-current="true"` and draws as pressed.

## Accessibility

- A real `<button type="button">`, or `<a href>` for navigation.
- An icon-only button must carry `aria-label`; the product's types refuse one
  without it.
- Toggles expose `aria-pressed`; on is said by the fill, not by colour alone.
- Contrast: the filled button's words 18.8:1 in light and 17.5:1 in dark; the
  danger words 5.7:1 on the light ground and 7.8:1 on the dark.
