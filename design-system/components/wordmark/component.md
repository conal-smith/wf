# Wordmark

The site's name, wingfoil.ie (`ui/Wordmark.tsx`, `wordmarkStyles`): words, not
a picture.

## Anatomy

- Mark: `.wf-wordmark`, "wingfoil" in Fraunces (`sem.font.family.display`) at
  `sem.font.size.wordmark` (23px; `sem.font.size.wordmark-sm`, 21px, on a
  phone), semibold, tracked a little tight (`sem.font.tracking.title`), at the
  face's 72pt optical size, in `sem.color.ink`.
- Domain: `.wf-wordmark__domain`, ".ie" in Fraunces italic, medium, in the
  accent (`sem.color.chart-magenta`).

## Variants

- **md** (`.wf-wordmark`, the default): the top bar and the site menu's head.
- **lg** (`--lg`): `sem.font.size.title` (30px), where a page is about the
  site itself.

## States

- None of its own. In the top bar it sits in a link home, which takes the one
  focus ring.

## Usage

- Fraunces belongs to the wordmark and to a spot's name as the title of its
  own page, and to nothing else: no heading, no name in a list, no figure.
- Always lower case, always with ".ie", never restyled, recoloured or set in
  capitals.
- One wordmark a view, at the left of the [Top bar](../top-bar/component.md).

## Accessibility

- Real text, so it reads as the name it is and scales with the reader's
  settings.
- The link round it names where it goes ("wingfoil.ie, the Spot finder").
- Contrast: the name 18.8:1 (light) and 17.5:1 (dark); ".ie" 6.6:1 and 6.8:1.
