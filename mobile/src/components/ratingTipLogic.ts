/**
 * The words of the rating tip's shore line, apart from React Native so they
 * can be tested in Node.
 */
import { SHORE_LABEL, type ShoreAngle } from "../../../force5/src/stars";

/**
 * How the hour's wind meets the shore: its angle; that the angle is unknown
 * this hour; that the beach's facing is unknown and the wind alone is rated;
 * or, at a spot on the water, nothing, as for any other spot (the site's spot
 * page says nothing there either).
 */
export function tipShoreText(
  shore: ShoreAngle | null | undefined,
  facingKnown: boolean,
  onWater: boolean,
): string | null {
  if (shore) return SHORE_LABEL[shore];
  if (facingKnown) return "Shore angle unknown for this hour";
  return onWater ? null : "Facing unknown: the wind alone is rated";
}
