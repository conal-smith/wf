# Dialog

The chart's box as a modal (`ui/Dialog.tsx`, `dialogStyles`), and the
question with one destructive answer built on it (`ui/ConfirmDialog.tsx`). A
native `dialog`, so focus is trapped, Escape cancels and the page behind is
inert. Its buttons are the Button component's classes.

## Anatomy

- Box: `.wf-dialog` — 11/12 of the width up to `sem.container.dialog`,
  `sem.space.x7` inset (`sem.space.x5` under `sem.breakpoint.wide`), a grid
  with `sem.space.x5` between its parts. A sheet: flat paper
  (`sem.color.card` with `sem.texture.grain`), a `sem.rule.hairline` ink
  border plus `sem.shadow.frame` (the hairline inside it), then
  `sem.shadow.sheet`. A sheet's corner (`sem.radius.dialog`, 18px). Sentences
  in `sem.font.family.body`.
- Backdrop: `::backdrop` in `sem.color.scrim`, a wash of paper, over a
  `sem.blur.scrim` blur of the page or the map behind; it fades in with
  `sem.animate.scrim-in`. Where the browser cannot blur, or the reader asks for
  less transparency, it is `sem.color.scrim-solid` with no blur. The product's
  one recipe for it is ui/Backdrop.tsx (`scrim`, `Backdrop`).
- Head: `.wf-dialog__head` — the title and the close button, top-aligned and
  `sem.space.x3` apart, over a hairline ink rule with `sem.space.x3` beneath.
- Title: `.wf-dialog__title` — the display face at `sem.font.size.lead` and
  `sem.font.weight.lead`, in ink.
- Aside: `.wf-dialog__aside` — optional, between the title and the close: a
  figure in the mono face at `sem.font.size.label`, `sem.color.ink-muted`,
  centred on the row. A wizard says how far through it is here ("2 / 6").
- Close: an icon button, quiet and small (`.wf-button--icon.wf-button--sm`),
  `aria-label="Close"`, a 15px X.
- Body: `.wf-dialog__body` — a grid, `sem.space.x3` gaps, `sem.font.size.prose`
  in `sem.color.ink-2`.
- Actions: `.wf-dialog__actions` — a wrapping row set right, `sem.space.x2`
  apart. The filled action, if any, comes last.

## Variants

- **Md** (the default) — up to `sem.container.dialog` (420px).
- **Wide** (`--wide`) — up to `sem.container.dialog-wide` (640px), for a form
  or a table.
- **Dismissible** (the default) — draws the close button. A question with its
  own Cancel does without it.
- **Named** (`label`) — a dialog whose title changes under it, as a wizard's
  steps are each titled by their own question, takes a name of its own
  (`aria-label`) in place of `aria-labelledby`, so it is the same
  dialog to a screen reader from step to step.
- **ConfirmDialog** — no close button; Cancel (`.wf-button--pill`) then the
  destructive answer (`.wf-button--danger`), named for what it does ("Remove
  listing").

## States

- Opening: `sem.animate.dialog-in`, a 150ms rise of `sem.space.x2` from
  nothing; none for a reader who asks for less motion.
- Closed: the native dialog is hidden by the browser; the grid is set only on
  `[open]`. Any other element carrying the class is a static rendering and is
  drawn open.
- Busy: work is under way that closing would orphan. Every way out is held
  shut: the close button and both answers are disabled, Escape and a click on
  the backdrop do nothing. Mark the box `aria-busy="true"`.

## Usage

- One filled action, last in the row: the primary pill, or in a ConfirmDialog
  the warm danger pill, and never both.
- Title the dialog with the question or the thing ("Remove this listing?",
  "Share Rusheen Bay"); keep the body to a sentence or two, figures where they
  can be.
- A destructive confirmation is a dialog of its own: ConfirmDialog, not a second
  button in another dialog.
- Only a press that begins and ends outside the box closes it, so a selection
  dragged out of a field does not throw away what was written.

## Accessibility

- `dialog` opened with `showModal()`, `aria-labelledby` pointing at the title.
  A static rendering uses `role="dialog"` and `aria-modal="true"`.
- Opening remembers what held the focus; closing hands it back (or to
  `returnFocus` when the opener has gone, a row in a closed menu).
- In a ConfirmDialog Cancel comes first in the document, so it opens with the
  focus: Enter on a dialog that has just appeared is never the answer that
  cannot be taken back.
- The close button carries `aria-label="Close"`; its icon is `aria-hidden`.
- Ink on paper 14.6:1, ink-2 9.5:1; the scrim is a softening, not a contrast
  aid.
