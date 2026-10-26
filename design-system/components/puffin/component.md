# Puffin

The Almanac's own bird (`ui/Puffin.tsx`, `puffinStyles`), standing on his
rock at the foot of the pen's note. He signs the house's word; he does not
talk.

## Anatomy

- Root: `.wf-puffin` — an inline SVG, viewBox `0 0 120 130`, `size` px tall
  and `size × 120 / 130` wide, `overflow: visible`.
- Rock: `.wf-puffin__rock` in `sem.color.land`, ruled in ink, with a few
  `.wf-puffin__ink-line` strokes.
- Figure: `.wf-puffin__figure` — the bird without his rock, turning about the
  foot of its own box.
- Inks: `.wf-puffin__ink` (`sem.color.ink`), `__ink-line` (ink strokes),
  `__paper` (`sem.color.ground`, ruled in ink: the face and breast),
  `__paper-line` (paper strokes: the bill's grooves, the hatch's lines),
  `__pen` (`sem.color.pen`: the bill and feet), `__buoy` (`sem.color.buoy`: the
  bill's base).
- Hatch: the wing is filled by a pattern of paper lines at 38°; the pattern's
  line takes `__paper-line`, the wing's own edge `__hatched`. Each SVG needs a
  pattern id of its own.

## Variants

- Size: 57 (the default), 44 (the site menu), 32, 96.
- `--bob` — he shifts his weight now and then (`sem.animate.bob`, a 6s cycle).
- Decorative (the default) or titled.

## States

- Bobbing, or held still for a reader who asks for less motion.

## Usage

- One puffin on a view at most, as a picture. No words are signed by or
  credited to "the Almanac"; the copy beside him is plain English
  (docs/BRAND.md, rule 7).
- On the proposed night chart his paper and ink trade places with the page's.

## Accessibility

- Decorative: `aria-hidden="true"`, `focusable="false"`.
- Where he stands for something, `role="img"` with an `aria-label` ("The
  Almanac").
- The bob stops under `prefers-reduced-motion: reduce`.
