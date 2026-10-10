import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../ui/Dialog";

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
  className = "",
  wide = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`info-i ${className}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        i
      </button>
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
