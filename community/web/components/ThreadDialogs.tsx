/**
 * The two questions a thread asks in a dialog: why a message is being
 * reported, and why a thread is being locked. Neither holds the view's filled
 * action while it is closed, and each has exactly one while it is open.
 */
import { useEffect, useId, useState } from "react";
import {
  Button,
  Dialog,
  Field,
  Select,
  TextArea,
  TextInput,
} from "../../../ui";
import { REPORT_REASONS, type ReportReason } from "../api";

const NOTE_MAX = 500;
const REASON_MAX = 200;

const said = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

export interface ReportDialogProps {
  open: boolean;
  /** Whose message it is, for the title. */
  author: string;
  /** Rejects with what the reader is told. */
  onReport: (reason: ReportReason, note: string) => Promise<void>;
  onClose: () => void;
}

/** A reason and a note. It reaches the site's team in their bell (D21). */
export function ReportDialog({
  open,
  author,
  onReport,
  onClose,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0].id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const reasonId = useId();
  const noteId = useId();

  useEffect(() => {
    if (!open) return;
    setReason(REPORT_REASONS[0].id);
    setNote("");
    setError(null);
    setSent(false);
  }, [open]);

  const send = () => {
    setBusy(true);
    setError(null);
    onReport(reason, note)
      .then(
        () => setSent(true),
        (failure: unknown) =>
          setError(said(failure, "The report could not be sent.")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      title={sent ? "Thanks, that has been sent" : `Report ${author}’s message`}
      busy={busy}
      onClose={onClose}
      actions={
        sent ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="pill" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={send}>
              {busy ? "Sending…" : "Send report"}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p>The site’s team will look at it. Nobody else is told.</p>
      ) : (
        <>
          <Field label="What is wrong with it?" htmlFor={reasonId}>
            <Select
              id={reasonId}
              value={reason}
              disabled={busy}
              onChange={(event) =>
                setReason(event.target.value as ReportReason)
              }
            >
              {REPORT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Anything to add?"
            hint="Optional"
            htmlFor={noteId}
            error={error ?? undefined}
          >
            <TextArea
              id={noteId}
              value={note}
              maxLength={NOTE_MAX}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </>
      )}
    </Dialog>
  );
}

export interface LockDialogProps {
  open: boolean;
  /** Rejects with what the reader is told. */
  onLock: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** Staff only. The reason is shown to everyone, where the composer was. */
export function LockDialog({ open, onLock, onClose }: LockDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  const lock = () => {
    setBusy(true);
    setError(null);
    onLock(reason.trim())
      .then(onClose, (failure: unknown) =>
        setError(said(failure, "The thread could not be locked.")),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      title="Lock this thread"
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button variant="pill" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !reason.trim()}
            onClick={lock}
          >
            {busy ? "Locking…" : "Lock thread"}
          </Button>
        </>
      }
    >
      <Field
        label="Why?"
        hint="Everyone sees this"
        htmlFor={reasonId}
        error={error ?? undefined}
      >
        <TextInput
          id={reasonId}
          value={reason}
          maxLength={REASON_MAX}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
