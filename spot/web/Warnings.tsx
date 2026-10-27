/**
 * Met Éireann's warnings on a spot's page: every one in force or still to
 * come at the place, under the place's name, a line each: its level, its
 * headline and its validity, with Met Éireann's kind, areas and words folded
 * under it. What a warning does to the stars is said once, under the list.
 * A stormy day can bring four or five, and the forecast they bear on must
 * still be on the first screen (issue 219). The mark stands in an hour's stars
 * under orange or red, or beside them under yellow (force5/src/warnings.ts
 * has the rule, the MCP's `spotForecast` the warnings). Nothing here is shown
 * when the warnings could not be checked: the footer's link to met.ie stays.
 */
import { AlertTriangle, ChevronRight } from "lucide-react";
import {
  LEVEL_LABEL,
  MET_WARNINGS_PAGE,
  validityText,
  warningKind,
  type WarningLevel,
} from "../../force5/src/warnings";
import type { WarningItem, WarningsAnswer } from "../../mcp/api/warnings";
import { Kicker } from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";

const styles = tv({
  slots: {
    // In the column on a phone and a narrow screen, a line a warning. Where
    // the page has a margin, the list stands in it with the bathing water
    // notices (SpotApp's `notices`).
    section: "flex flex-col gap-1.5",
    list: "m-0 flex list-none flex-col gap-1 p-0",
    item: "border-0 border-l-3 pl-1.5",
    summary: [
      "flex cursor-pointer list-none items-start gap-x-1 rounded-control py-0.5",
      // ui-lint-allow: Safari draws a summary's triangle unless this hides it; the chevron is ours.
      "[&::-webkit-details-marker]:hidden",
      RING,
    ],
    chevron:
      "mt-1 shrink-0 text-ink-muted transition-transform group-open/warning:rotate-90 motion-reduce:transition-none",
    // The mark, the headline and when, run together as words are, so a
    // headline too long for the line wraps under its mark.
    text: "min-w-0 font-body text-body",
    mark: "mr-2 inline-flex align-middle",
    headline: "mr-2 font-semibold text-ink",
    when: ["inline-block text-ink-2", MONO_LABEL],
    time: "whitespace-nowrap",
    now: "text-now",
    more: "flex flex-col gap-1 pt-0.5 pb-1.5 pl-5 font-body text-body text-ink-2",
    kind: "m-0 text-ink",
    line: "m-0",
    note: "m-0 font-body text-caption text-ink-muted",
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

/**
 * Met Éireann's headline without the "Status Yellow - " it opens with: the
 * mark beside it already says the level, in its colour. A headline that names
 * another level than its own, or nothing after it, is left as issued.
 */
export function headlineText(
  item: Pick<WarningItem, "level" | "headline">,
): string {
  const status = new RegExp(`^\\s*status\\s+${item.level}\\s*[-–—:]\\s*`, "i");
  const rest = item.headline.replace(status, "");
  return rest.trim() ? rest : item.headline;
}

/** "Orange wind warning", "Yellow small craft warning (marine)". */
export const warningName = (
  item: Pick<WarningItem, "level" | "type" | "marine">,
) =>
  `${LEVEL_LABEL[item.level]} ${warningKind(item).toLowerCase()} warning${item.marine ? " (marine)" : ""}`;

/**
 * What the warnings listed do to the stars, said once for all of them: a
 * yellow leaves the stars, an orange or red takes them.
 */
export function ruleText(
  items: readonly Pick<WarningItem, "replaces_ratings">[],
) {
  const stays = items.some((item) => !item.replaces_ratings);
  const takes = items.some((item) => item.replaces_ratings);
  return [
    stays &&
      "Yellow: the stars still show beside it; see whether it bears on the water.",
    takes && "Orange and red: no stars for the hours they cover.",
  ]
    .filter(Boolean)
    .join(" ");
}

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
              <details className="group/warning">
                <summary className={s.summary()}>
                  <ChevronRight
                    size={14}
                    strokeWidth={1.75}
                    className={s.chevron()}
                    aria-hidden="true"
                  />
                  <span className={s.text()}>
                    <span className={s.mark()}>
                      <WarningMark level={item.level} />
                    </span>
                    <span className={s.headline()} data-warning-headline>
                      {headlineText(item)}
                    </span>
                    <span className={s.when()}>
                      <time className={s.time()} dateTime={item.onset}>
                        {onset}
                      </time>{" "}
                      –{" "}
                      <time className={s.time()} dateTime={item.expiry}>
                        {expiry}
                      </time>
                      {item.in_force_now && (
                        <span className={s.now()}> · now</span>
                      )}
                    </span>
                  </span>
                </summary>
                <div className={s.more()}>
                  <p className={s.kind()}>
                    {warningKind(item)} warning
                    {item.marine ? " (marine)" : ""}
                    {item.areas.length > 0 && `: ${item.areas.join(", ")}`}
                  </p>
                  {item.description
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={index} className={s.line()}>
                        {line}
                      </p>
                    ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <p className={s.note()} data-warnings-rule>
        {ruleText(warnings.items)} Issued by Met Éireann (CC BY 4.0).{" "}
        <a className={s.link()} href={MET_WARNINGS_PAGE}>
          The latest at met.ie
        </a>
      </p>
    </section>
  );
}
