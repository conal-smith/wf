# Avatar

A face for a name (`ui/Avatar.tsx`, `avatarStyles`): the member's photo, or a
monogram in the display face's italic, in an ink ring. Decoration: the name is
always written beside it.

## Anatomy

- Ring: `.wf-avatar` — a circle (`sem.radius.full`) with a
  `sem.rule.hairline` ink border, `sem.color.sunken` behind, clipping what is
  inside.
- Monogram: up to two letters, the first of the first word and of the last
  ("Aoife Ní Bhriain" is AN), in `sem.font.family.display` italic,
  `sem.font.weight.semibold`, line-height 1, in ink.
- Photo: `.wf-avatar__image` — an `img` with an empty `alt`, filling the ring
  and cropped to it (`object-fit: cover`).

## Variants

- **Sm** (`--sm`) — `sem.size.control.sm` (30px), the monogram at
  `sem.font.size.caption`.
- **Md** (the default) — `sem.size.control.md` (40px), at
  `sem.font.size.body`.
- **Lg** (`--lg`) — 72px (18 steps), at `sem.font.size.title` with its tracking;
  the weight stays semibold. A profile's head.

## States

- No photo, or a photo that fails to load: the monogram stands in.
- An empty name draws "?".

## Usage

- Always with the name written beside it, in the display face; the avatar never
  stands in for the name.
- Monograms over stock pictures: the community draws monograms unless a member
  has given a photo.
- Do not colour the ring or the sheet to tell members apart; the ring is ink.

## Accessibility

- `aria-hidden="true"` on the ring, and `alt=""` on the photo: the name beside
  it is what is read, once.
- Ink on sunken is 13.6:1.
