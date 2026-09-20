/**
 * A button that opens a small panel under itself: the Following menu, a
 * thread's overflow, the reaction picker. A disclosure, as the site menu is,
 * not a menubar: the panel holds ordinary buttons, Tab moves through them,
 * and Escape, a press outside or focus leaving closes it.
 */
import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "../../../ui";
import { HOVER, RING, tv } from "../../../ui/tv";

export const popoverStyles = tv({
  slots: {
    base: "relative inline-flex",
    panel:
      "absolute z-popover flex w-max min-w-44 flex-col gap-0.5 rounded-control border border-line bg-card p-1 font-sans shadow-marker",
    // A row of a panel that is a list of choices.
    item: [
      "flex min-h-control-sm w-full cursor-pointer items-center gap-2 rounded-control px-2 text-left text-body whitespace-nowrap text-ink-2",
      "pointer-coarse:min-h-touch",
      RING,
      HOVER,
    ],
    check: "ml-auto shrink-0",
  },
  variants: {
    align: { start: { panel: "left-0" }, end: { panel: "right-0" } },
    // Over the trigger where what is under it would be covered: the reply
    // slot is docked over the foot of the stream.
    side: {
      bottom: { panel: "top-full mt-1" },
      top: { panel: "bottom-full mb-1" },
    },
    // The picker is a grid of faces, not a list of words.
    grid: { true: { panel: "min-w-0 grid grid-cols-6 gap-0.5" } },
    // The choice that stands: heavier, and ticked.
    chosen: { true: { item: "font-semibold text-ink" } },
  },
  defaultVariants: { align: "end", side: "bottom" },
});

type TriggerProps = Pick<ButtonProps, "variant" | "size" | "pressed"> &
  (
    | { icon: true; "aria-label": string }
    | { icon?: false; "aria-label"?: string }
  );

export type PopoverProps = TriggerProps & {
  /** What the trigger shows. */
  label: ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
  grid?: boolean;
  /** Names the panel for a screen reader. */
  panelLabel: string;
  disabled?: boolean;
  className?: string;
  /** Told when the panel opens or closes, for a parent that stays drawn while it is open. */
  onOpenChange?: (open: boolean) => void;
  /** The panel's content, given the way to close it. */
  children: (close: () => void) => ReactNode;
};

export interface PopoverItemProps {
  /** One of several, and the one that stands: said with `aria-current` and a tick. */
  chosen?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** A row of a panel that lists choices or actions. */
export function PopoverItem({
  chosen,
  disabled,
  onClick,
  children,
}: PopoverItemProps) {
  const styles = popoverStyles({ chosen: chosen === true });
  return (
    <button
      type="button"
      className={styles.item()}
      aria-current={chosen ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {chosen && (
        <Check className={styles.check()} size={14} aria-hidden="true" />
      )}
    </button>
  );
}

export function Popover({
  label,
  align,
  side,
  grid,
  panelLabel,
  disabled,
  className,
  onOpenChange,
  children,
  ...trigger
}: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const styles = popoverStyles({ align, side, grid });

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  // Closing by choice puts the focus back on the trigger; one engine never
  // focuses a button that was clicked, and would drop it onto the body.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
    // `close` and `setOpen` are this render's, and only read while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <span
      ref={root}
      className={styles.base({ className })}
      onBlur={(event) => {
        if (
          open &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      <Button
        {...trigger}
        ref={button}
        disabled={disabled}
        aria-expanded={open}
        // The controlled element only exists while the panel does.
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
      </Button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          className={styles.panel()}
          role="group"
          aria-label={panelLabel}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}
