# Dialog

A modal (`ui/Dialog.tsx`, and `ui/ConfirmDialog.tsx` for a yes-or-no
question): no frame, an Inter title, the body, and a row of answers under a
hairline. On a computer a box in the middle of the screen; under 640px a
sheet up from the foot of it.

## Anatomy

- Box: `.wf-dialog`, a native `<dialog>` on `sem.color.ground`, a dialog's
  corner (`sem.radius.dialog`), `sem.shadow.sheet`, no border; in dark a faint
  `sem.color.line` edge as well. At most `sem.container.dialog` wide (`--wide`:
  `sem.container.dialog-wide`).
- Backdrop: the page behind blurred (`sem.blur.scrim`) under
  `sem.color.scrim`; solid (`sem.color.scrim-solid`) for a reader who has
  turned transparency down.
- Grabber: `.wf-dialog__grabber`, a 36 by 5px round bar in
  `sem.color.line-strong`, on the sheet only.
- Head: `.wf-dialog__head`, the title `__title` (Inter semibold at
  `sem.font.size.lead`, sentence case, no rule under it), an optional aside
  `__aside` (how far through a wizard: "2 / 6"), and the close button, a quiet
  icon [Button](../button/component.md).
- Body: `.wf-dialog__body`, sentences in `sem.color.ink-2`, controls in
  [Fields](../field/component.md); it scrolls if it is long.
- Actions: `.wf-dialog__actions`, a row of buttons at the right with a
  `sem.rule.hairline` of `sem.color.line` above it. The filled one, if any,
  comes last.

## Variants

- **md** (the default) and **wide** (`--wide`, for a form with a side list of
  [Tabs](../tabs/component.md)).
- **Sheet**: under 640px, by the width alone. The whole width, the corners at
  the top only, the grabber over the head, slides up (`sem.animate.sheet-in`),
  and the actions share the width equally at 48px tall within a thumb's reach.
  `.wf-dialog--sheet` draws it at any width for a static rendering.
- **Confirm**: a short question, no close button (its Cancel is the way out),
  the destructive answer as `--danger`.

## States

- Opening: fades and rises a little (`sem.animate.dialog-in`); the backdrop
  fades in. Without either for reduced motion.
- Busy: every way out (Escape, the backdrop, the close button) is held shut
  while work that closing would orphan is under way; the close button is
  disabled.

## Usage

- A dialog asks one thing or holds one short task: find a spot, confirm a
  delete, a step of a wizard. Anything longer is a page.
- At most one filled button, last in the row; Cancel is outlined or quiet.
- The hairline above the actions is the only rule in a dialog: none under the
  title, none round sections of the body (use space).
- Title in sentence case, as a question or a name: "Find a spot", "Delete this
  listing?".

## Accessibility

- A native `<dialog>` opened with `showModal()`: focus is trapped, Escape
  cancels and the page behind is inert.
- Labelled by its title (`aria-labelledby`), or by `aria-label` where the
  title changes under it, as a wizard's steps do.
- Focus goes back to what opened it on close.
- A click on the backdrop closes it only if the press began there too, so a
  selection dragged out of a field does not throw away what was written.
- Contrast: title 18.8:1 (light) and 17.5:1 (dark); body 11.3:1 and 11.9:1.
