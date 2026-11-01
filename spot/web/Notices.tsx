/**
 * The spot page's warnings and notices, one group above the cards: Met
 * Éireann's weather warnings (./Warnings.tsx), then the EPA's bathing water
 * notices (./WaterQuality.tsx), under one sentence-case label, with the two
 * sources sharing a line of small print underneath. Nothing with neither.
 *
 * A stormy day can bring four or five, and the forecast they bear on must
 * still start on the first screen (issue 219): every one that takes the
 * stars is shown, the others until two are, and the rest open from a
 * "more" under them.
 */
import { useState } from "react";
import { MET_WARNINGS_PAGE } from "../../force5/src/warnings";
import { BEACHES_PAGE } from "../../force5/src/waterQuality";
import type { WarningsAnswer } from "../../mcp/api/warnings";
import type { WaterAnswer } from "../../mcp/api/waterQuality";
import { Button, Link } from "../../ui";
import { tv } from "../../ui/tv";
import { WarningNotices } from "./Warnings";
import { WaterNotices } from "./WaterQuality";

const styles = tv({
  slots: {
    group: "grid gap-2",
    label: "m-0 font-body text-body font-medium text-ink-muted",
    more: "justify-self-start",
    foot: "m-0 mt-0.5 font-body text-label leading-normal text-ink-muted",
  },
});

/** Whether the page has any warning or notice to show. */
export const hasNotices = (warnings: WarningsAnswer, water: WaterAnswer) =>
  (warnings.status === "current" && warnings.items.length > 0) ||
  (water.status === "current" && water.items.length > 0);

/** How many notices show before the rest fold behind "more". */
export const NOTICES_SHOWN = 2;

/**
 * The notices kept behind "more", as `w:<id>` (a warning) and `n:<id>` (a
 * bathing water notice): none that takes the stars, and none of the first
 * `shown`.
 */
export function foldedNotices(
  warnings: WarningsAnswer,
  water: WaterAnswer,
  shown = NOTICES_SHOWN,
): Set<string> {
  const all = [
    ...(warnings.status === "current" ? warnings.items : []).map((item) => ({
      key: `w:${item.id}`,
      takes: item.replaces_ratings,
    })),
    ...(water.status === "current" ? water.items : []).map((item) => ({
      key: `n:${item.id}`,
      takes: item.replaces_ratings,
    })),
  ];
  let room = shown - all.filter((n) => n.takes).length;
  const folded = new Set<string>();
  for (const n of all) {
    if (n.takes) continue;
    if (room > 0) room--;
    else folded.add(n.key);
  }
  return folded;
}

export function SpotNotices({
  warnings,
  water,
}: {
  warnings: WarningsAnswer;
  water: WaterAnswer;
}) {
  const s = styles();
  const [open, setOpen] = useState(false);
  if (!hasNotices(warnings, water)) return null;
  const more = foldedNotices(warnings, water);
  const folded = open ? undefined : more;
  const warned = warnings.status === "current" && warnings.items.length > 0;
  const watered = water.status === "current" && water.items.length > 0;
  return (
    <section className={s.group()} aria-labelledby="notices-title" data-notices>
      <h2 className={s.label()} id="notices-title">
        Warnings and notices
      </h2>
      <WarningNotices warnings={warnings} folded={folded} />
      <WaterNotices water={water} folded={folded} />
      {more.size > 0 && (
        <Button
          variant="quiet"
          size="sm"
          className={s.more()}
          aria-expanded={open}
          aria-controls={[warned && "warnings", watered && "water-quality"]
            .filter(Boolean)
            .join(" ")}
          data-notices-more
          onClick={() => setOpen((was) => !was)}
        >
          {open ? "Show fewer" : `Show ${more.size} more`}
        </Button>
      )}
      <p className={s.foot()} data-notices-source>
        {warned && (
          <>
            Weather warnings issued by Met Éireann (CC BY 4.0),{" "}
            <Link href={MET_WARNINGS_PAGE}>the latest at met.ie</Link>.
          </>
        )}
        {warned && watered && " "}
        {watered && (
          <>
            Bathing water notices from the EPA, as the council issued them (CC
            BY 4.0), <Link href={BEACHES_PAGE}>the latest at beaches.ie</Link>.
          </>
        )}
      </p>
    </section>
  );
}
