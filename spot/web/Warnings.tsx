/**
 * Met Éireann's warnings on a spot's page: every one in force or still to
 * come at the place, its level, kind, headline and validity as Met Éireann
 * issued them, under the place's name; and the mark that stands in an hour's
 * stars under orange or red, or beside them under yellow (force5/src/warnings.ts
 * has the rule, the MCP's `spotForecast` the warnings). Nothing here is shown
 * when the warnings could not be checked: the footer's link to met.ie stays.
 */
import { AlertTriangle } from "lucide-react";
import {
  LEVEL_LABEL,
  MET_WARNINGS_PAGE,
  validityText,
  warningKind,
  type WarningLevel,
} from "../../force5/src/warnings";
import type { WarningItem, WarningsAnswer } from "../../mcp/api/warnings";
import { Kicker } from "../../ui";
import { MONO_LABEL, tv } from "../../ui/tv";

const styles = tv({
  slots: {
    section: "flex flex-col gap-2",
    list: "m-0 flex list-none flex-col gap-2 p-0",
    item: "flex flex-col gap-1 border-0 border-l-3 py-1 pl-3",
    title: "flex flex-wrap items-center gap-x-2 gap-y-1",
    kind: "font-body text-prose font-semibold text-ink",
    headline: "m-0 font-body text-prose text-ink",
    when: ["m-0 text-ink-2", MONO_LABEL],
    now: "text-now",
    rule: "m-0 font-body text-body text-ink-2 italic",
    more: "font-body text-body text-ink-2",
    summary: "cursor-pointer text-ink underline underline-offset-4",
    line: "m-0 mt-1",
    credit: "m-0 font-body text-caption text-ink-muted",
    link: "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
  },
  variants: {
    level: {
      yellow: { item: "border-met-yellow" },
      orange: { item: "border-met-orange" },
      red: { item: "border-met-red" },
    },
  },
});

const markStyles = tv({
  base: "inline-flex shrink-0 items-center gap-1 rounded-control font-mono font-semibold leading-none uppercase",
  variants: {
    level: {
      yellow: "bg-met-yellow text-ink",
      orange: "bg-met-orange text-ink",
      red: "bg-met-red text-ink-inverse",
    },
    size: {
      // In place of an hour's stars, or in a warning's title.
      word: "px-1.5 py-1 text-eyebrow",
      // Beside an hour's stars: the triangle alone.
      dot: "p-0.5",
    },
  },
  defaultVariants: { size: "word" },
});

/** A warning's level as a mark: its colour, a triangle and, unless `dot`, its name. */
export function WarningMark({
  level,
  dot = false,
  label,
}: {
  level: WarningLevel;
  dot?: boolean;
  /** What a screen reader hears; the level's name by default. */
  label?: string;
}) {
  return (
    <span
      className={markStyles({ level, size: dot ? "dot" : "word" })}
      data-warning-mark={level}
      role="img"
      aria-label={label ?? `${LEVEL_LABEL[level]} warning`}
      title={label}
    >
      <AlertTriangle size={dot ? 9 : 10} strokeWidth={2.4} aria-hidden="true" />
      {!dot && <span aria-hidden="true">{LEVEL_LABEL[level]}</span>}
    </span>
  );
}

const when = (item: WarningItem) =>
  validityText({
    onset: Date.parse(item.onset),
    expiry: Date.parse(item.expiry),
  });

/** "Orange wind warning", "Yellow small craft warning (marine)". */
export const warningName = (
  item: Pick<WarningItem, "level" | "type" | "marine">,
) =>
  `${LEVEL_LABEL[item.level]} ${warningKind(item).toLowerCase()} warning${item.marine ? " (marine)" : ""}`;

/** The warnings under the place's name. Null with none, or none checked. */
export function WarningsPanel({ warnings }: { warnings: WarningsAnswer }) {
  const s = styles();
  if (warnings.status !== "current" || !warnings.items.length) return null;
  return (
    <section
      className={s.section()}
      aria-labelledby="warnings-title"
      id="warnings"
      data-warnings
    >
      <Kicker as="h2" id="warnings-title" tone="ink">
        Met Éireann warnings
      </Kicker>
      <ul className={s.list()}>
        {warnings.items.map((item) => {
          const [onset, expiry] = when(item).split(" – ");
          return (
            <li
              key={item.id}
              className={styles({ level: item.level }).item()}
              data-warning={item.level}
            >
              <div className={s.title()}>
                <WarningMark level={item.level} />
                <span className={s.kind()}>
                  {warningKind(item)} warning
                  {item.marine ? " (marine)" : ""}
                </span>
              </div>
              <p className={s.headline()}>{item.headline}</p>
              <p className={s.when()}>
                <time dateTime={item.onset}>{onset}</time> –{" "}
                <time dateTime={item.expiry}>{expiry}</time>
                {item.in_force_now && <span className={s.now()}> · now</span>}
              </p>
              <p className={s.rule()}>
                {item.replaces_ratings
                  ? "No stars for the hours it covers."
                  : "The stars still show beside it: see whether it bears on the water."}
              </p>
              {item.description && (
                <details className={s.more()}>
                  <summary className={s.summary()}>
                    What Met Éireann says
                  </summary>
                  {item.description.split("\n").map((line, index) => (
                    <p key={index} className={s.line()}>
                      {line}
                    </p>
                  ))}
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <p className={s.credit()}>
        Issued by Met Éireann, shown as issued (CC BY 4.0).{" "}
        <a className={s.link()} href={MET_WARNINGS_PAGE}>
          The latest at met.ie
        </a>
      </p>
    </section>
  );
}
