import { AlertTriangle, ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../ui/Button";
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

/** One warning: its level, its kind and its validity, to the spot's page. */
function WarningLink({ spotId, w }: { spotId: string; w: PlaceWarning }) {
  return (
    <a
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
  );
}

/**
 * The spot's Met Éireann warnings, along the top of the dock: each one's
 * level, kind and validity, its headline on hover, and a way to the spot's
 * page, where each is given in full. Nothing when there are none, or when
 * the warnings could not be checked (the map's own link to met.ie stays).
 *
 * On a phone the strip is one line that says how many there are: the
 * highest level's tag, "3 warnings" and their kinds, cut short where the
 * screen ends. A press opens it to every warning in full, one under the
 * other, each over as many lines as it needs; a strip that scrolled
 * sideways showed the first and hid the rest past the screen's edge.
 */
export default function DockWarnings({
  spotId,
  warnings,
  phone = false,
}: {
  spotId: string;
  warnings: readonly PlaceWarning[];
  phone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Another spot's warnings open folded, as its hours open on the hour.
  useEffect(() => setOpen(false), [spotId]);
  if (!warnings.length) return null;
  if (!phone)
    return (
      <div
        className="dk-warnings"
        role="note"
        aria-label="Met Éireann warnings"
        data-dock-warnings
      >
        {warnings.map((w) => (
          <WarningLink key={w.warning.capId} spotId={spotId} w={w} />
        ))}
        <span className="dk-warnings-by">Met Éireann</span>
      </div>
    );
  // Highest level first (warnings.ts `placeWarnings`): the first is the tag.
  const [top] = warnings;
  const kinds = [...new Set(warnings.map((w) => warningKind(w.warning)))];
  const many = warnings.length > 1;
  return (
    <div
      className={`dk-warnings is-folding${open ? " is-open" : ""}`}
      role="note"
      aria-label="Met Éireann warnings"
      data-dock-warnings
    >
      <Button
        variant="quiet"
        size="sm"
        className="dk-warnings-sum"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={
          many
            ? `${warnings.length} Met Éireann warnings: ${kinds.join(", ")}`
            : `Met Éireann warning: ${warningKind(top.warning)}`
        }
        data-warnings-summary
        onClick={() => setOpen(!open)}
      >
        <WarnMark level={top.level} />
        <span className="dk-warnings-count" aria-hidden="true">
          {many ? `${warnings.length} warnings` : warningKind(top.warning)}
        </span>
        <span className="dk-warnings-kinds" aria-hidden="true">
          {many ? kinds.join(", ") : validityText(top)}
        </span>
        <ChevronDown
          className="dk-warnings-chev"
          size={16}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </Button>
      <div className="dk-warnings-list" id={listId} hidden={!open}>
        {warnings.map((w) => (
          <WarningLink key={w.warning.capId} spotId={spotId} w={w} />
        ))}
        <span className="dk-warnings-by">Met Éireann</span>
      </div>
    </div>
  );
}
