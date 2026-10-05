/**
 * The Following button on a thread, and the menu under it: every reply,
 * mentions only, or nothing (D19). `nothing` is a choice that is kept, so a
 * later reply does not follow the thread again.
 */
import { Bell, BellOff, BellRing, ChevronDown } from "lucide-react";
import { tv } from "../../../ui/tv";
import type { FollowLevel } from "../../shared/types";
import { Popover, PopoverItem } from "./Popover";

export const followMenuStyles = tv({
  slots: {
    // On a phone the button is its icon and its chevron; the level is in the menu.
    words: "max-rail:sr-only",
  },
});

export const FOLLOW_CHOICES: readonly { level: FollowLevel; label: string }[] =
  [
    { level: "all", label: "Every reply" },
    { level: "mentions", label: "Mentions only" },
    { level: "none", label: "Nothing" },
  ];

/** What the button says for where the viewer stands. */
export function followLabel(level: FollowLevel | null | undefined): string {
  switch (level) {
    case "all":
      return "Following · every reply";
    case "mentions":
      return "Following · mentions only";
    case "none":
      return "Not following";
    default:
      return "Follow";
  }
}

export interface FollowMenuProps {
  /** Null when the viewer has no follow row for the thread. */
  level: FollowLevel | null | undefined;
  busy?: boolean;
  onChoose: (level: FollowLevel) => void;
}

export function FollowMenu({ level, busy, onChoose }: FollowMenuProps) {
  const following = level === "all" || level === "mentions";
  const Icon = level === "none" ? BellOff : following ? BellRing : Bell;
  const styles = followMenuStyles();
  return (
    <Popover
      variant="pill"
      size="sm"
      // Said in its words and its ringing bell, so it keeps its quiet box:
      // Reply is this view's one filled action.
      pressed={following ? "worded" : undefined}
      disabled={busy}
      panelLabel="Notify me about"
      label={
        <>
          <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className={styles.words()}>{followLabel(level)}</span>
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </>
      }
    >
      {(close) =>
        FOLLOW_CHOICES.map((choice) => (
          <PopoverItem
            key={choice.level}
            chosen={choice.level === level}
            onClick={() => {
              close();
              if (choice.level !== level) onChoose(choice.level);
            }}
          >
            {choice.label}
          </PopoverItem>
        ))
      }
    </Popover>
  );
}
