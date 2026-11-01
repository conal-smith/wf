/**
 * Met Éireann's warnings on a spot's page: every one in force or still to
 * come at the place, each in the kit's notice card (ui/Notice.tsx): the
 * level's colour, a plain title that says the level in words ("Orange wind
 * warning for Kerry"), its validity, "now" while it is in force, and what it
 * does to the stars, with Met Éireann's kind, areas and words under the
 * chevron. A stormy day can bring four or five, and the forecast they bear on
 * must still be on the first screen (issue 219). Where an orange or red one
 * takes an hour's stars, the hour shows its mark instead (force5/src/warnings.ts
 * has the rule, the MCP's `spotForecast` the warnings). Nothing here is shown
 * when the warnings could not be checked: the footer's link to met.ie stays.
 */
import {
  LEVEL_LABEL,
  validityText,
  warningKind,
} from "../../force5/src/warnings";
import type { WarningItem, WarningsAnswer } from "../../mcp/api/warnings";
import { Notice } from "../../ui";
import { tv } from "../../ui/tv";

export const noticeListStyles = tv({
  slots: {
    list: "m-0 grid list-none gap-2 p-0",
    effect: "font-medium text-ink",
    line: "m-0",
    more: "grid gap-1",
  },
});

/**
 * Met Éireann's headline without the "Status Yellow - " it opens with: the
 * title says the level in its own words. A headline that names another level
 * than its own, or nothing after it, is left as issued.
 */
export function headlineText(
  item: Pick<WarningItem, "level" | "headline">,
): string {
  const status = new RegExp(`^\\s*status\\s+${item.level}\\s*[-–—:]\\s*`, "i");
  const rest = item.headline.replace(status, "");
  return rest.trim() ? rest : item.headline;
}

/**
 * The notice's title, the level in words and then the headline:
 * "Orange wind warning for Kerry", "Yellow small craft warning for all
 * coasts of Ireland". Met Éireann capitalises the kind ("Small Craft
 * warning"); the words up to "warning" are put in sentence case, the places
 * after it left as written.
 */
export function warningTitle(
  item: Pick<WarningItem, "level" | "headline">,
): string {
  const rest = headlineText(item).trim();
  if (/^status\b/i.test(rest)) return rest;
  const level = LEVEL_LABEL[item.level];
  if (rest.toLowerCase().startsWith(`${level.toLowerCase()} `)) return rest;
  const kind = rest.match(/^(.*?\bwarning)\b(.*)$/i);
  const words = kind
    ? kind[1].toLowerCase() + kind[2]
    : rest.charAt(0).toLowerCase() + rest.slice(1);
  return `${level} ${words}`;
}

/** "Orange wind warning", "Yellow small craft warning (marine)". */
export const warningName = (
  item: Pick<WarningItem, "level" | "type" | "marine">,
) =>
  `${LEVEL_LABEL[item.level]} ${warningKind(item).toLowerCase()} warning${item.marine ? " (marine)" : ""}`;

/**
 * When a warning applies, in Irish time, as the second line says it:
 * "Mon 14 Sept, 13:00" to "16:00" the same day, or to "Tue 15 Sept, 10:00".
 */
export function warningWhen(item: Pick<WarningItem, "onset" | "expiry">): {
  onset: string;
  expiry: string;
} {
  const [from, to] = validityText({
    onset: Date.parse(item.onset),
    expiry: Date.parse(item.expiry),
  })
    .split(" – ")
    .map((part) => {
      const at = part.match(/^(.*) (\d{2}:\d{2})$/);
      return at ? { day: at[1], time: at[2] } : { day: part, time: "" };
    });
  const say = ({ day, time }: { day: string; time: string }) =>
    time ? `${day}, ${time}` : day;
  return {
    onset: say(from),
    expiry: from.day === to.day && to.time ? to.time : say(to),
  };
}

/** The warnings, a notice each. Null with none, or none checked. */
export function WarningNotices({ warnings }: { warnings: WarningsAnswer }) {
  const s = noticeListStyles();
  if (warnings.status !== "current" || !warnings.items.length) return null;
  return (
    <ul className={s.list()} id="warnings" data-warnings>
      {warnings.items.map((item) => {
        const when = warningWhen(item);
        return (
          <li key={item.id} data-warning={item.level}>
            <Notice
              level={item.level}
              title={<span data-warning-headline>{warningTitle(item)}</span>}
              details={
                <div className={s.more()}>
                  <p className={s.line()}>
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
              }
            >
              <time dateTime={item.onset}>{when.onset}</time> to{" "}
              <time dateTime={item.expiry}>{when.expiry}</time>
              {item.in_force_now && " · now"}
              {" · "}
              {item.replaces_ratings ? (
                <strong className={s.effect()}>no stars for these hours</strong>
              ) : (
                "stars still shown"
              )}
            </Notice>
          </li>
        );
      })}
    </ul>
  );
}
