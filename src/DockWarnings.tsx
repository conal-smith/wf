import { AlertTriangle, Droplets } from "lucide-react";
import { spotHref } from "../force5/src/siteNav";
import {
  NOTICE_MARK,
  noticeName,
  noticeWhen,
  type SpotNotice,
} from "../force5/src/waterQuality";
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
 * A bathing water notice as the dock marks it (force5/src/waterQuality.ts):
 * under a prohibition or advice against bathing, a tag with the drops where
 * the stars were, in the theme's warn; under any other notice (`bar`), a thin
 * bar under the stars it leaves alone.
 */
export function WaterMark({
  bar = false,
  label = "Bathing water notice",
}: {
  bar?: boolean;
  label?: string;
}) {
  return (
    <span
      className={bar ? "water-bar" : "water-mark"}
      data-water-mark={bar ? "beside" : "replaces"}
      role="img"
      aria-label={label}
    >
      {!bar && (
        <>
          <Droplets size={10} strokeWidth={2.4} aria-hidden="true" />
          <span aria-hidden="true">{NOTICE_MARK}</span>
        </>
      )}
    </span>
  );
}

/**
 * The spot's Met Éireann warnings and bathing water notices, along the top of
 * the dock: each warning's level, kind and validity, its headline on hover;
 * each notice's restriction, bathing water and when; and a way to the spot's
 * page, where each is given in full. Nothing when there are none, or when
 * they could not be checked (the map's own link to met.ie stays).
 */
export default function DockWarnings({
  spotId,
  warnings,
  water = [],
}: {
  spotId: string;
  warnings: readonly PlaceWarning[];
  water?: readonly SpotNotice[];
}) {
  if (!warnings.length && !water.length) return null;
  return (
    <div
      className="dk-warnings"
      role="note"
      aria-label={
        warnings.length && water.length
          ? "Met Éireann warnings and bathing water notices"
          : warnings.length
            ? "Met Éireann warnings"
            : "Bathing water notices"
      }
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
      {water.map((n) => (
        <a
          key={n.notice.id}
          className="dk-warning"
          href={`${spotHref(spotId)}#water-quality`}
          title={`${noticeName(n.notice)} at ${n.notice.beach}${n.notice.description ? `\n${n.notice.description}` : ""}\n${noticeWhen(n)}`}
          data-water-notice={n.replacesStars ? "replaces" : "beside"}
        >
          <WaterMark bar={false} />
          <span className="dk-warning-kind">{noticeName(n.notice)}</span>
          <span className="dk-warning-when">{noticeWhen(n)}</span>
        </a>
      ))}
      <span className="dk-warnings-by">
        {[warnings.length && "Met Éireann", water.length && "EPA"]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}
