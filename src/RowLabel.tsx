import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Inline stroke glyph; the row's name is carried by `label`, not by text. */
  glyph: ReactNode;
  label: string;
  /** One sentence in plain words explaining what the row means. */
  help: string;
  /** Unit shown beside the glyph where the row prints numbers. */
  unit?: string;
}

const LONG_PRESS_MS = 400;

/**
 * A row's glyph label. The dock has no room for nine written row names, so each
 * row is a glyph with a real accessible name and an explanation on hover, focus
 * or long press. The tooltip is positioned in the viewport and rendered into
 * the document body: the dock is a backdrop-filtered surface, which makes it
 * the containing block for fixed children and would put the tip off-screen.
 */
export default function RowLabel({ glyph, label, help, unit }: Props) {
  const id = `row-help-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const open = () => {
    const box = button.current?.getBoundingClientRect();
    if (box) setTip({ left: box.right + 6, top: box.top + box.height / 2 });
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      <button
        ref={button}
        className="row-label"
        type="button"
        aria-label={label}
        aria-describedby={tip ? id : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(event) => {
          event.preventDefault();
          if (tip) close();
          else open();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          timer.current = window.setTimeout(open, LONG_PRESS_MS);
        }}
        onPointerUp={() => window.clearTimeout(timer.current)}
        onPointerCancel={close}
      >
        {glyph}
        {unit && <small>{unit}</small>}
      </button>
      {tip &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="row-tip"
            style={{ left: tip.left, top: tip.top }}
          >
            <strong>{label}</strong>
            {help}
          </span>,
          document.body,
        )}
    </>
  );
}
