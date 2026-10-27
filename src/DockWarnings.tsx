import { AlertTriangle, ChevronDown, Droplets } from "lucide-react";
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
import {
  NOTICE_MARK,
  noticeName,
  noticeWhen,
  type SpotNotice,
} from "../force5/src/waterQuality";

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

/** One bathing water notice: its restriction and when, to the spot's page. */
function NoticeLink({ spotId, n }: { spotId: string; n: SpotNotice }) {
  return (
    <a
      className="dk-warning"
      href={`${spotHref(spotId)}#water-quality`}
      title={`${noticeName(n.notice)} at ${n.notice.beach}${n.notice.description ? `\n${n.notice.description}` : ""}\n${noticeWhen(n)}`}
      data-water-notice={n.replacesStars ? "replaces" : "beside"}
    >
      <WaterMark />
      <span className="dk-warning-kind">{noticeName(n.notice)}</span>
      <span className="dk-warning-when">{noticeWhen(n)}</span>
    </a>
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
 * The spot's Met Éireann warnings and bathing water notices, along the top of
 * the dock: each warning's level, kind and validity, its headline on hover;
 * each notice's restriction and when; and a way to the spot's page, where
 * each is given in full. Nothing when there are none, or when they could not
 * be checked (the map's own link to met.ie stays).
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
  water = [],
  phone = false,
}: {
  spotId: string;
  warnings: readonly PlaceWarning[];
  water?: readonly SpotNotice[];
  phone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Another spot's warnings open folded, as its hours open on the hour.
  useEffect(() => setOpen(false), [spotId]);
  if (!warnings.length && !water.length) return null;
  const label =
    warnings.length && water.length
      ? "Met Éireann warnings and bathing water notices"
      : warnings.length
        ? "Met Éireann warnings"
        : "Bathing water notices";
  const items = (
    <>
      {warnings.map((w) => (
        <WarningLink key={w.warning.capId} spotId={spotId} w={w} />
      ))}
      {water.map((n) => (
        <NoticeLink key={n.notice.id} spotId={spotId} n={n} />
      ))}
      <span className="dk-warnings-by">
        {[warnings.length && "Met Éireann", water.length && "EPA"]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </>
  );
  if (!phone)
    return (
      <div
        className="dk-warnings"
        role="note"
        aria-label={label}
        data-dock-warnings
      >
        {items}
      </div>
    );
  // Highest level first (warnings.ts `placeWarnings`): the first is the tag,
  // then the notices', those that take the stars first.
  const [top] = warnings;
  const [notice] = water;
  const kinds = [
    ...new Set([
      ...warnings.map((w) => warningKind(w.warning)),
      ...water.map((n) => noticeName(n.notice)),
    ]),
  ];
  const total = warnings.length + water.length;
  const many = total > 1;
  const counted = [
    warnings.length &&
      `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`,
    water.length &&
      `${water.length} water notice${water.length > 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      className={`dk-warnings is-folding${open ? " is-open" : ""}`}
      role="note"
      aria-label={label}
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
            ? `${counted}: ${kinds.join(", ")}`
            : top
              ? `Met Éireann warning: ${warningKind(top.warning)}`
              : `Bathing water notice: ${noticeName(notice.notice)}`
        }
        data-warnings-summary
        onClick={() => setOpen(!open)}
      >
        {top ? <WarnMark level={top.level} /> : <WaterMark />}
        <span className="dk-warnings-count" aria-hidden="true">
          {many
            ? counted
            : top
              ? warningKind(top.warning)
              : noticeName(notice.notice)}
        </span>
        <span className="dk-warnings-kinds" aria-hidden="true">
          {many
            ? kinds.join(", ")
            : top
              ? validityText(top)
              : noticeWhen(notice)}
        </span>
        <ChevronDown
          className="dk-warnings-chev"
          size={16}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </Button>
      <div className="dk-warnings-list" id={listId} hidden={!open}>
        {items}
      </div>
    </div>
  );
}
