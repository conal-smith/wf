import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** The confirmed work is under way: both answers wait, and so does Escape. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A modal question with one destructive answer. Cancel comes first in the
 * document, so it is what opens with the focus: Enter on a dialog that has
 * just appeared must not be the answer that cannot be taken back.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      busy={busy}
      dismissible={false}
      onClose={onCancel}
      actions={
        <>
          <Button variant="pill" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
