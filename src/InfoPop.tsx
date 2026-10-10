import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../ui/Dialog";

/**
 * The small round button an explanation is behind: an "i" for the small
 * print, or the "?" by the stars (`className="help-q"`). Whatever it opens is
 * a dialog, so it says so.
 */
export function InfoButton({
  label,
  onOpen,
  open,
  className = "info-i",
  children = "i",
}: {
  label: string;
  onOpen: () => void;
  /** Whether its own dialog is open, where it has one of its own. */
  open?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      {children}
    </button>
  );
}

/**
 * The small print, behind an "i": sources, caveats and what a figure means,
 * in a dialog over the dimmed page, titled with the button's own name. It
 * used to open as a box beside the button, which landed on the chart or the
 * forecast it was explaining; a dialog covers both alike and then goes. Its
 * content is only drawn while it is open, and in the body, so it inherits
 * none of the dock's or the panel's lettering.
 */
export function InfoPop({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <InfoButton label={label} open={open} onOpen={() => setOpen(true)} />
      {open &&
        createPortal(
          <Dialog
            open
            title={label}
            size={wide ? "wide" : "md"}
            className="info-pop"
            onClose={() => setOpen(false)}
          >
            {children}
          </Dialog>,
          document.body,
        )}
    </>
  );
}
