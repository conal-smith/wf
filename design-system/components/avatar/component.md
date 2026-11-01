# Avatar

A face for a name (`ui/Avatar.tsx`, `avatarStyles`): the member's photo, or a
monogram in Inter on the soft grey. Decoration: the name is always written
beside it.

## Anatomy

- Circle: `.wf-avatar`, `sem.radius.full`, on `sem.color.well`, no ring.
- Monogram: up to two letters, Inter semibold in `sem.color.ink-2`.
- Photo (optional): `.wf-avatar__image`, an `<img alt="">` that fills the
  circle, cropped to it.

## Variants

- **sm** (`--sm`): `sem.size.control.sm`, the monogram at
  `sem.font.size.caption`. A row in a list, a notification.
- **md** (the default): `sem.size.control.md`, at `sem.font.size.body`.
- **lg** (`--lg`): 72px, at `sem.font.size.title`. A profile's head.

## States

- None.

## Usage

- Always with the name written beside it, in Inter; the avatar never stands in
  for the name.
- Monograms over stock pictures: the community draws monograms unless a member
  has given a photo.
- Do not colour the circle to tell members apart.

## Accessibility

- `aria-hidden="true"` on the circle and `alt=""` on the photo: the name beside
  it is what is read, once.
- Contrast: the monogram 10.4:1 (light) and 10.8:1 (dark) on the grey.
