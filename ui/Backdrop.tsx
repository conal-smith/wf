import { useEffect, useState } from "react";
import { tv } from "./tv";

/**
 * The backdrop behind every dialog and sheet, in one place: the page, or the
 * moving map, blurred under a wash of paper, fading in and out.
 *
 * - A modal <dialog> has it as its `::backdrop`: `BACKDROP` in its classes,
 *   as ui/Dialog.tsx does. Use the kit's Dialog and it is there already.
 * - Anything else that covers the page (a sheet, a tour's step) draws
 *   `<Backdrop>` under itself, which closes on a press and on Escape.
 *
 * The look is the theme's `scrim` utility (ui/theme.css): its colour, its blur,
 * and what it falls back to where the browser cannot blur or the reader asks
 * for less transparency or less motion.
 */

/** A <dialog>'s classes for the backdrop, and for fading out as it closes. */
export const BACKDROP = "backdrop:scrim modal-fade";

/** How long the backdrop takes to fade: the theme's fast duration. */
export const FADE_MS = 150;

/**
 * What an overlay that fades out should draw: `value` while it is set, then
 * the last value it had for as long as the fade takes, then null. An owner
 * that mounts its dialog only while it is open keeps it mounted this little
 * longer, so the dialog (closed at once, its focus handed back) can fade:
 *
 *     const shown = useFadeOut(panel);
 *     {shown && <Dialog open={panel !== null} …>{content(shown)}</Dialog>}
 */
export function useFadeOut<T>(value: T | null | undefined | false): T | null {
  const live = value || value === 0 ? (value as T) : null;
  const [kept, setKept] = useState<T | null>(live);
  useEffect(() => {
    if (live !== null) {
      setKept(live);
      return;
    }
    const timer = setTimeout(() => setKept(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [live]);
  return live ?? kept;
}

export const backdropStyles = tv({
  base: "fixed inset-0 z-dialog scrim transition-opacity duration-fast motion-reduce:transition-none",
  variants: {
    /** Fading out: it takes no pointer while it goes. */
    closing: { true: "pointer-events-none opacity-0" },
  },
});

export interface BackdropProps {
  open: boolean;
  /** Asked for by a press on the backdrop, and by Escape. */
  onClose?: () => void;
  /** Its layer, for one that sits under something other than a dialog. */
  className?: string;
}

/**
 * The backdrop as an element of its own, for an overlay that is not a modal
 * <dialog>: drawn under it, at the dialog's layer unless told otherwise. It is
 * mounted while open and for its fade after, and is hidden from assistive
 * technology: what it covers is the overlay's to make inert.
 */
export function Backdrop({ open, onClose, className }: BackdropProps) {
  const shown = useFadeOut(open);
  useEffect(() => {
    if (!open || !onClose) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose]);
  if (!shown) return null;
  return (
    <div
      aria-hidden="true"
      data-backdrop=""
      className={backdropStyles({ closing: !open, className })}
      onClick={open ? onClose : undefined}
    />
  );
}
