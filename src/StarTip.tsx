/**
 * An hour's stars, explained where they are: hover them, focus them or tap
 * them and a card says what the rating is and what it rests on. The spot
 * page's own (spot/web/RatingTip.tsx), carried over so the map's bundle does
 * not reach into the spot page's: the same behaviour, drawn as the chart's
 * box. The card is positioned in the viewport and rendered into the body, so
 * the strip's scroller never clips it; it closes on scroll, on Escape and on a
 * tap anywhere else.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** The card's width, and how close it may come to the viewport's edges. */
const WIDTH = 280;
const MARGIN = 12;
const GAP = 6;
/** Long enough to cross from the stars into the card without it closing. */
const CLOSE_MS = 150;

interface Place {
  left: number;
  top: number;
  width: number;
}

export interface StarTipProps {
  /** What the stars say, for a screen reader: "3 of 5 stars". */
  label: string;
  /** The stars themselves. */
  children: ReactNode;
  /** The explanation. */
  detail: ReactNode;
}

export function StarTip({ label, children, detail }: StarTipProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  /** How the last press came: a mouse click pins the card, a tap toggles it. */
  const pointer = useRef("");
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_MS);
  };

  // Place the card once it has rendered and has a height to place.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(
      Math.max(box.left, MARGIN),
      window.innerWidth - width - MARGIN,
    );
    const height = card.current?.offsetHeight ?? 0;
    const below = box.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const top = fitsBelow ? below : Math.max(MARGIN, box.top - GAP - height);
    setPlace({ left, top, width });
  }, [open]);

  // While open: a scroll anywhere moves the stars out from under the card, so
  // close it; so does Escape, and a tap outside both.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || card.current?.contains(target))
        return;
      hide();
    };
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="star-tip"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") show();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") hideSoon();
        }}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        // Keyboard focus opens it; the focus a tap gives does not, or the
        // tap's own click would close it again at once.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={hideSoon}
        onClick={() => {
          if (pointer.current === "mouse") show();
          else if (open) hide();
          else show();
          pointer.current = "";
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="tooltip"
            className="star-tip-card chart-box"
            data-rating-tip
            style={
              place
                ? { left: place.left, top: place.top, width: place.width }
                : { left: 0, top: 0, width: WIDTH, visibility: "hidden" }
            }
            onPointerEnter={show}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") hideSoon();
            }}
          >
            {detail}
          </div>,
          document.body,
        )}
    </>
  );
}
