/**
 * A message's reactions: a chip per emoji with its count, and the picker that
 * adds one. The picker offers the fixed list and nothing else; the API
 * refuses anything outside it.
 */
import { SmilePlus } from "lucide-react";
import { RING, tv } from "../../../ui/tv";
import { REACTIONS, type Message, type Reaction } from "../../shared/types";
import { Popover } from "./Popover";

export const reactionStyles = tv({
  slots: {
    base: "flex flex-wrap items-center gap-1",
    chip: [
      "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-transparent bg-sunken px-2",
      "font-sans text-body font-semibold text-ink-2 tabular-nums transition-colors duration-fast",
      "not-disabled:hover:border-line-strong pointer-coarse:min-h-touch pointer-coarse:px-3",
      RING,
    ],
    face: [
      "grid size-control-sm cursor-pointer place-items-center rounded-control text-prose",
      "not-disabled:hover:bg-sunken pointer-coarse:size-touch",
      RING,
    ],
  },
  variants: {
    // Yours: outlined and raised as well as filled, and said with aria-pressed.
    mine: {
      true: {
        chip: "border-accent bg-card text-ink shadow-control not-disabled:hover:border-accent",
        face: "border border-accent bg-card shadow-control",
      },
    },
  },
});

/** The chips to draw: the emoji with at least one reaction, in the list's own order. */
export function reactionChips(
  message: Pick<Message, "reactions" | "myReactions">,
): { emoji: Reaction; count: number; mine: boolean }[] {
  return REACTIONS.flatMap((emoji) => {
    const count = message.reactions[emoji] ?? 0;
    return count > 0
      ? [{ emoji, count, mine: message.myReactions?.includes(emoji) ?? false }]
      : [];
  });
}

export interface ReactionsProps {
  message: Pick<Message, "reactions" | "myReactions">;
  /** Put this reaction on, or take it off. Signed out, the page asks for a sign-in. */
  onReact: (emoji: Reaction, on: boolean) => void;
  /** The add button beside the chips. A message's toolbar has one of its own. */
  picker?: boolean;
  className?: string;
}

export function Reactions({
  message,
  onReact,
  picker = false,
  className,
}: ReactionsProps) {
  const chips = reactionChips(message);
  if (!chips.length && !picker) return null;
  const styles = reactionStyles();
  return (
    <div className={styles.base({ className })}>
      {chips.map(({ emoji, count, mine }) => (
        <button
          key={emoji}
          type="button"
          className={reactionStyles({ mine }).chip()}
          aria-pressed={mine}
          aria-label={`${emoji} ${count}, ${mine ? "take yours off" : "add yours"}`}
          onClick={() => onReact(emoji, !mine)}
        >
          <span aria-hidden="true">{emoji}</span>
          <span aria-hidden="true">{count}</span>
        </button>
      ))}
      {picker && (
        <ReactionPicker mine={message.myReactions ?? []} onReact={onReact} />
      )}
    </div>
  );
}

export interface ReactionPickerProps {
  mine: readonly Reaction[];
  onReact: (emoji: Reaction, on: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  /** Which way the faces open. A message's toolbar opens them upwards. */
  side?: "top" | "bottom";
}

/** The panel's faces: the fixed twelve and nothing else, each a toggle. */
export function ReactionFaces({
  mine,
  onReact,
}: Pick<ReactionPickerProps, "mine" | "onReact">) {
  return REACTIONS.map((emoji) => {
    const on = mine.includes(emoji);
    return (
      <button
        key={emoji}
        type="button"
        className={reactionStyles({ mine: on }).face()}
        aria-pressed={on}
        aria-label={emoji}
        onClick={() => onReact(emoji, !on)}
      >
        {emoji}
      </button>
    );
  });
}

/** The add button, and the faces under it. */
export function ReactionPicker({
  mine,
  onReact,
  onOpenChange,
  side,
}: ReactionPickerProps) {
  return (
    <Popover
      size="sm"
      side={side}
      icon
      aria-label="Add a reaction"
      panelLabel="Reactions"
      grid
      onOpenChange={onOpenChange}
      label={<SmilePlus size={15} aria-hidden="true" />}
    >
      {(close) => (
        <ReactionFaces
          mine={mine}
          onReact={(emoji, on) => {
            close();
            onReact(emoji, on);
          }}
        />
      )}
    </Popover>
  );
}
