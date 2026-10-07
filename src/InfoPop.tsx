import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * The small print, behind an "i": sources, caveats and what a figure means,
 * in a box that opens under its button (or over it, where there is no room)
 * and closes on Escape or a tap anywhere else. A button at the foot of the
 * chart says `side="above"`: below it is the dock, which has room for the box
 * only by covering the forecast the box is about.
 */
export function InfoPop({
  label,
  children,
  className = "",
  wide = false,
  side = "below",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  /** Where the box goes when it fits both ways. */
  side?: "below" | "above";
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const r = button.current!.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 280;
    const h = box.current?.offsetHeight ?? 160;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    const fitsBelow = r.bottom + h + 8 < window.innerHeight;
    const fitsAbove = r.top - h - 6 >= 8;
    const top = (side === "above" ? !fitsAbove && fitsBelow : fitsBelow)
      ? r.bottom + 6
      : Math.max(8, r.top - h - 6);
    setPlace({ left, top });
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => {
      const t = event.target as Node;
      if (!button.current?.contains(t) && !box.current?.contains(t))
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`info-i ${className}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={box}
            id={id}
            role="dialog"
            aria-label={label}
            className={`info-pop chart-box${wide ? " is-wide" : ""}`}
            style={
              place
                ? { left: place.left, top: place.top }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
