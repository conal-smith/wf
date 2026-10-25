import { AlertTriangle } from "lucide-react";
import { spotHref } from "../force5/src/siteNav";
import {
  LEVEL_LABEL,
  validityText,
  warningKind,
  type PlaceWarning,
  type WarningLevel,
} from "../force5/src/warnings";

/**
 * A warning's level as the dock marks it, in the theme's `met-*` colours, Met
 * Éireann's own levels: in a star cell under orange or red, a tag with a
 * triangle and the level's name where the stars were; under yellow (`bar`),
 * a thin bar under the stars it leaves alone, which the narrow cells have
 * room for beside five of them.
 */
export function WarnMark({
  level,
  bar = false,
  label,
}: {
  level: WarningLevel;
  bar?: boolean;
  label?: string;
}) {
  return (
    <span
      className={`${bar ? "warn-bar" : "warn-mark"} lv-${level}`}
      data-warning-mark={level}
      role="img"
      aria-label={label ?? `${LEVEL_LABEL[level]} warning`}
    >
      {!bar && (
        <>
          <AlertTriangle size={10} strokeWidth={2.4} aria-hidden="true" />
          <span aria-hidden="true">{LEVEL_LABEL[level]}</span>
        </>
      )}
    </span>
  );
}

/**
 * The spot's Met Éireann warnings, along the top of the dock: each one's
 * level, kind and validity, its headline on hover, and a way to the spot's
 * page, where each is given in full. Nothing when there are none, or when
 * the warnings could not be checked (the map's own link to met.ie stays).
 */
export default function DockWarnings({
  spotId,
  warnings,
}: {
  spotId: string;
  warnings: readonly PlaceWarning[];
}) {
  if (!warnings.length) return null;
  return (
    <div
      className="dk-warnings"
      role="note"
      aria-label="Met Éireann warnings"
      data-dock-warnings
    >
      {warnings.map((w) => (
        <a
          key={w.warning.capId}
          className={`dk-warning lv-${w.level}`}
          href={`${spotHref(spotId)}#warnings`}
          title={`${w.warning.headline}\n${validityText(w)}`}
          data-warning={w.level}
        >
          <WarnMark level={w.level} />
          <span className="dk-warning-kind">
            {warningKind(w.warning)}
            {w.marine ? " (marine)" : ""}
          </span>
          <span className="dk-warning-when">{validityText(w)}</span>
        </a>
      ))}
      <span className="dk-warnings-by">Met Éireann</span>
    </div>
  );
}
