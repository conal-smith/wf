/**
 * The EPA's bathing water notices on a spot's page: each one standing at a
 * bathing water near the place, its restriction and cause as the council wrote
 * them, when it applies, how far the bathing water is and the council's
 * notice; and the mark that stands in an hour's stars under a prohibition or
 * an advice against bathing, or beside them otherwise
 * (force5/src/waterQuality.ts has the rule, the MCP's `spotForecast` the
 * notices). Nothing is shown with none, or none checked.
 */
import { Droplets } from "lucide-react";
import { BEACHES_PAGE, NOTICE_MARK } from "../../force5/src/waterQuality";
import type { WaterAnswer, WaterItem } from "../../mcp/api/waterQuality";
import { Kicker } from "../../ui";
import { MONO_LABEL, tv } from "../../ui/tv";

const styles = tv({
  slots: {
    section: "flex flex-col gap-2",
    list: "m-0 flex list-none flex-col gap-2 p-0",
    item: "flex flex-col gap-1 border-0 border-l-3 border-warn py-1 pl-3",
    title: "flex flex-wrap items-center gap-x-2 gap-y-1",
    restriction: "font-body text-prose font-semibold text-ink",
    cause: "m-0 font-body text-prose text-ink",
    when: ["m-0 text-ink-2", MONO_LABEL],
    now: "text-now",
    credit: "m-0 font-body text-caption text-ink-muted",
    link: "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
  },
});

const markStyles = tv({
  base: "inline-flex shrink-0 items-center gap-1 rounded-control border border-warn bg-warn-ground font-mono font-semibold leading-none text-warn uppercase",
  variants: {
    size: {
      // In place of an hour's stars.
      word: "px-1.5 py-1 text-eyebrow",
      // Beside an hour's stars: the drops alone.
      dot: "p-0.5",
    },
  },
  defaultVariants: { size: "word" },
});

/** A bathing water notice as a mark: the drops and, unless `dot`, "Water". */
export function WaterMark({
  dot = false,
  label = "Bathing water notice",
}: {
  dot?: boolean;
  /** What a screen reader hears. */
  label?: string;
}) {
  return (
    <span
      className={markStyles({ size: dot ? "dot" : "word" })}
      data-water-mark={dot ? "beside" : "replaces"}
      role="img"
      aria-label={label}
      title={label}
    >
      <Droplets size={dot ? 9 : 10} strokeWidth={2.4} aria-hidden="true" />
      {!dot && <span aria-hidden="true">{NOTICE_MARK}</span>}
    </span>
  );
}

/** "Bathing is prohibited at Portmarnock, Velvet Strand Beach". */
export const noticeWords = (item: Pick<WaterItem, "restriction" | "beach">) =>
  `${item.restriction} at ${item.beach}`;

/** The notices under the place's name. Null with none, or none checked. */
export function WaterQualityPanel({ water }: { water: WaterAnswer }) {
  const s = styles();
  if (water.status !== "current" || !water.items.length) return null;
  return (
    <section
      className={s.section()}
      aria-labelledby="water-quality-title"
      id="water-quality"
      data-water-quality
    >
      <Kicker as="h2" id="water-quality-title" tone="ink">
        Bathing water notices
      </Kicker>
      <ul className={s.list()}>
        {water.items.map((item) => (
          <li
            key={item.id}
            className={s.item()}
            data-water-notice={item.replaces_ratings ? "replaces" : "beside"}
          >
            <div className={s.title()}>
              <WaterMark dot={!item.replaces_ratings} />
              <span className={s.restriction()}>{item.restriction}</span>
            </div>
            {item.cause && <p className={s.cause()}>{item.cause}.</p>}
            <p className={s.when()}>
              {item.when}
              {item.in_force_now && <span className={s.now()}> · now</span>}
              {" · "}
              {item.beach}
              {item.km !== undefined && `, ${item.km.toFixed(1)} km`}
              {item.replaces_ratings && " · no stars"}
            </p>
            {item.notice && (
              <a className={s.link()} href={item.notice}>
                The council&rsquo;s notice
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className={s.credit()}>
        From the EPA, as the council issued it (CC BY 4.0).{" "}
        <a className={s.link()} href={BEACHES_PAGE}>
          The latest at beaches.ie
        </a>
      </p>
    </section>
  );
}
