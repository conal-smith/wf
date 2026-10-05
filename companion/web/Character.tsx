/**
 * The companion's character: the one place he is drawn from. Everything in
 * the panel and on the launcher draws `Character`, never a drawing directly,
 * so the owner's call on who he is (Gust, the ink blob with a wing, or the
 * Almanac's puffin, ui/Puffin.tsx) is a change to this file alone. Every mood
 * in mood.ts must have a face here.
 */
import { Gust } from "./Gust";
import type { GustMood } from "./mood";

export interface CharacterProps {
  mood?: GustMood;
  /** Width in px. */
  size?: number;
  /** Announced, with his mood, where the character itself carries meaning. */
  labelled?: boolean;
  className?: string;
}

export function Character(props: CharacterProps) {
  return <Gust {...props} />;
}
