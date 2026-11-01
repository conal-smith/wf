/**
 * The spot page's warnings and notices, one group above the cards: Met
 * Éireann's weather warnings (./Warnings.tsx), then the EPA's bathing water
 * notices (./WaterQuality.tsx), under one sentence-case label, with the two
 * sources sharing a line of small print underneath. Nothing with neither.
 */
import { MET_WARNINGS_PAGE } from "../../force5/src/warnings";
import { BEACHES_PAGE } from "../../force5/src/waterQuality";
import type { WarningsAnswer } from "../../mcp/api/warnings";
import type { WaterAnswer } from "../../mcp/api/waterQuality";
import { Link } from "../../ui";
import { tv } from "../../ui/tv";
import { WarningNotices } from "./Warnings";
import { WaterNotices } from "./WaterQuality";

const styles = tv({
  slots: {
    group: "grid gap-2",
    label: "m-0 font-body text-body font-medium text-ink-muted",
    foot: "m-0 mt-0.5 font-body text-label leading-normal text-ink-muted",
  },
});

/** Whether the page has any warning or notice to show. */
export const hasNotices = (warnings: WarningsAnswer, water: WaterAnswer) =>
  (warnings.status === "current" && warnings.items.length > 0) ||
  (water.status === "current" && water.items.length > 0);

export function SpotNotices({
  warnings,
  water,
}: {
  warnings: WarningsAnswer;
  water: WaterAnswer;
}) {
  const s = styles();
  if (!hasNotices(warnings, water)) return null;
  const warned = warnings.status === "current" && warnings.items.length > 0;
  const watered = water.status === "current" && water.items.length > 0;
  return (
    <section
      className={s.group()}
      aria-labelledby="notices-title"
      data-notices
    >
      <h2 className={s.label()} id="notices-title">
        Warnings and notices
      </h2>
      <WarningNotices warnings={warnings} />
      <WaterNotices water={water} />
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
