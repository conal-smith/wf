# Wordmark

The nameplate (`ui/Wordmark.tsx`, `wordmarkStyles`): "wingfoil" heavy and set
tight in Fraunces at its display cut, then ".ie" in the light italic and the
chart's magenta. Words, not a picture, so it is read as the name it is.

## Anatomy

- Container: `.wf-wordmark` — an inline-block in `sem.font.family.display`,
  `sem.font.weight.extrabold` (800, the wordmark's alone), line height 1,
  tracked `sem.font.tracking.headline`, never wrapping, in `sem.color.ink`.
  Fraunces is held at its largest optical size (`"opsz" 144`, the theme's
  `optical-display`) whatever size it is drawn at.
- Domain: `.wf-wordmark__domain` — ".ie" in `sem.font.weight.normal` italic,
  untracked, in `sem.color.chart-magenta`.

## Variants

- `--sm` — `sem.font.size.lead` (19): a masthead on a phone, the map's top bar.
- `--md` — `sem.font.size.title` (30), the default: a masthead with the room.
- `--lg` — `sem.font.size.headline` (44): the menu's head, an about page.

## States

- None of its own. It is not pressable; the link round it carries the focus
  ring (see Masthead).

## Usage

- One a view. It is the magenta's one standing use besides the focus ring and
  the best of something; do not set anything else this heavy.
- Write it as text with the domain in its own span, exactly
  `wingfoil<span class="wf-wordmark__domain">.ie</span>`; never an image.
- In a masthead it carries `.wf-masthead__mark`, which steps it to lead under
  720px.

## Accessibility

- Read as the words "wingfoil.ie". A link round it names where it goes, for
  example `aria-label="wingfoil.ie Market, home"`.
- Magenta on paper is 5.7:1; the ink is 14.6:1.
