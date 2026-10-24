import { Check, UserRound } from "lucide-react";
import { Button, Kicker } from "../../ui";
import { riderSummary, type ProfileProposal } from "../shared/protocol";
import type { ProposalStatus } from "./chat";

/**
 * A profile change Gust has prepared. Nothing is saved until the rider taps
 * Confirm; then the map rates everything for the new profile.
 */
export function ProposalCard({
  proposal,
  status,
  onConfirm,
  onDismiss,
}: {
  proposal: ProfileProposal;
  status: ProposalStatus;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <article
      className="flex flex-col gap-3 rounded-surface border border-ink bg-card paper-grain p-4 font-body text-ink inset-shadow-frame shadow-card"
      aria-label="Rider profile proposal"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-ink text-ink">
          <UserRound size={16} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <Kicker>Rider profile</Kicker>
          <p className="m-0 font-display text-prose font-semibold">
            {proposal.summary}
          </p>
          <p className="m-0 font-body text-caption text-ink-muted italic">
            Stars and wing sizes everywhere on the map follow your profile.
          </p>
        </div>
      </div>
      {status === "pending" ? (
        <div className="flex gap-2">
          <Button variant="pill" size="sm" className="px-4" onClick={onConfirm}>
            Confirm
          </Button>
          <Button variant="quiet" size="sm" onClick={onDismiss}>
            Not now
          </Button>
        </div>
      ) : (
        <p
          className="m-0 inline-flex items-center gap-1 font-mono text-caption text-ink-2"
          role="status"
        >
          {status === "saved" ? (
            <>
              <Check size={14} className="text-ok" aria-hidden="true" /> Saved:{" "}
              {riderSummary(proposal.rider)}
            </>
          ) : (
            "Not saved."
          )}
        </p>
      )}
    </article>
  );
}
