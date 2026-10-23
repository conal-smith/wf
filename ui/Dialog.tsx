import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { BACKDROP } from "./Backdrop";
import { Button } from "./Button";
import { tv, type VariantProps } from "./tv";

export const dialogStyles = tv({
  slots: {
    // `open:` and not a bare `grid`: a display of its own would show a closed
    // dialog, which the browser hides with nothing stronger than `display`.
    // The chart's box: paper with its grain, in a double rule.
    base: [
      "m-auto w-11/12 gap-5 rounded-dialog border border-ink bg-card paper-grain p-7 font-body text-ink shadow-surface inset-shadow-frame max-wide:p-5",
      "open:grid open:animate-dialog-in motion-reduce:animate-none",
      // The map or the page behind, blurred under a wash of paper, fading in
      // as the box arrives and out with it as it goes (ui/Backdrop.tsx).
      BACKDROP,
    ],
    head: "flex items-start justify-between gap-3 border-b border-ink pb-3",
    title: "m-0 font-display text-lead text-ink",
    body: "grid gap-3 text-prose text-ink-2",
    actions: "flex flex-wrap items-center justify-end gap-2",
  },
  variants: {
    size: {
      md: { base: "max-w-dialog" },
      wide: { base: "max-w-dialog-wide" },
    },
  },
  defaultVariants: { size: "md" },
});

/** As much of a <dialog> as opening and closing one needs. */
export interface ModalHost {
  readonly open: boolean;
  showModal(): void;
  close(): void;
}

/** As much of an element as giving focus back to it needs. */
export interface FocusTarget {
  readonly isConnected: boolean;
  focus(): void;
}

/**
 * Bring a dialog in line with `open`, and look after the focus around it.
 *
 * Opening remembers what held the focus; closing hands it back. The browser
 * does the same for a dialog it closes itself, but not reliably for a button
 * that was clicked rather than tabbed to, which one engine never focuses. The
 * opener is only read at the moment the dialog really opens, so running this
 * twice for one change, as a strict render does, remembers the opener and not
 * something inside the dialog.
 */
export function syncModal(
  host: ModalHost,
  open: boolean,
  opener: { current: FocusTarget | null },
  focused: () => FocusTarget | null,
): void {
  if (open && !host.open) {
    opener.current = focused();
    host.showModal();
  }
  if (!open && host.open) {
    host.close();
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }
}

/** As much of a pointer event as telling the backdrop from the box needs. */
export interface PointAt {
  readonly target: unknown;
  readonly clientX: number;
  readonly clientY: number;
}

/** As much of a <dialog> as knowing where its box is needs. */
export interface BoxHost {
  getBoundingClientRect(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

/**
 * The backdrop is part of the dialog as far as a pointer can tell, and so is
 * the dialog's own padding: only a point outside the box counts.
 */
export function onBackdrop(host: BoxHost | null, at: PointAt): boolean {
  if (!host || at.target !== host) return false;
  const box = host.getBoundingClientRect();
  return (
    at.clientX < box.left ||
    at.clientX > box.right ||
    at.clientY < box.top ||
    at.clientY > box.bottom
  );
}

/**
 * A click on the backdrop, told from a press that only ends there. A selection
 * dragged out of a field and let go past the edge is a click on the dialog too
 * (the dialog is what the two ends have in common), and closing on it would
 * throw away what was being written. So the press has to begin there as well.
 */
export function backdropPress(host: () => BoxHost | null) {
  let began = false;
  return {
    down(at: PointAt): void {
      began = onBackdrop(host(), at);
    },
    click(at: PointAt): boolean {
      const was = began;
      began = false;
      return was && onBackdrop(host(), at);
    },
  };
}

export type DialogProps = VariantProps<typeof dialogStyles> & {
  open: boolean;
  title: string;
  /** Asked for by Escape, by a click on the backdrop and by the close button. */
  onClose: () => void;
  /** Work is under way that closing would orphan: every way out is held shut. */
  busy?: boolean;
  /** The row of buttons under the body. The filled one, if any, comes last. */
  actions?: ReactNode;
  /** Draw the close button. A question with its own Cancel does without it. */
  dismissible?: boolean;
  /**
   * Where focus goes on close, for an opener that does not hold the focus when
   * the dialog opens: a row in a menu that has since closed, say.
   */
  returnFocus?: RefObject<HTMLElement | null>;
  className?: string;
  children?: ReactNode;
};

/**
 * A modal. Native <dialog>, so the focus is trapped, Escape cancels and the
 * page behind is inert without any of that being written here.
 *
 * It fades out when `open` goes false while it is still mounted. An owner
 * that draws it only while open can keep it the fade longer with
 * `useFadeOut` (ui/Backdrop.tsx); one that unmounts it at once closes it at
 * once, as before.
 */
export function Dialog({
  open,
  title,
  onClose,
  busy = false,
  actions,
  dismissible = true,
  returnFocus,
  size,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<FocusTarget | null>(null);
  const [press] = useState(() => backdropPress(() => ref.current));
  const titleId = useId();
  const styles = dialogStyles({ size });

  useEffect(() => {
    if (!ref.current) return;
    syncModal(
      ref.current,
      open,
      opener,
      () =>
        returnFocus?.current ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null),
    );
  }, [open, returnFocus]);

  // A dialog unmounted while open is closed on the way out, so its opener
  // still gets the focus back.
  useEffect(() => {
    const host = ref.current;
    return () => {
      if (host) syncModal(host, false, opener, () => null);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.base({ className })}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape. The dialog is closed by `open` going false, not by the
        // browser, so that the owner's state and the screen cannot disagree.
        // React hands a dialog opened from inside this one its cancel too:
        // that Escape is the inner one's, and this one stays open.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!busy) onClose();
      }}
      onPointerDown={(event) => press.down(event)}
      onClick={(event) => {
        if (press.click(event) && !busy) onClose();
      }}
    >
      <div className={styles.head()}>
        <h2 className={styles.title()} id={titleId}>
          {title}
        </h2>
        {dismissible && (
          <Button
            variant="quiet"
            size="sm"
            icon
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </Button>
        )}
      </div>
      {children && <div className={styles.body()}>{children}</div>}
      {actions && <div className={styles.actions()}>{actions}</div>}
    </dialog>
  );
}
