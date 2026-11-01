/**
 * The EPA's bathing water notices on a spot's page: each one standing at a
 * bathing water near the place, in the kit's notice card (ui/Notice.tsx): the
 * restriction as the council wrote it for a title, when it applies, "now"
 * while it does, and what it does to the stars; the cause, the bathing water,
 * how far it is and the council's notice under the chevron. A prohibition or
 * advice against bathing takes the stars (the `water` square), any other
 * notice leaves them (`water-advice`); force5/src/waterQuality.ts has the
 * rule, the MCP's `spotForecast` the notices. Nothing is shown with none, or
 * none checked.
 */
import type { WaterAnswer, WaterItem } from "../../mcp/api/waterQuality";
import { Link, Notice } from "../../ui";
import { noticeListStyles } from "./Warnings";

/** "Bathing is prohibited at Portmarnock, Velvet Strand Beach". */
export const noticeWords = (item: Pick<WaterItem, "restriction" | "beach">) =>
  `${item.restriction} at ${item.beach}`;

/**
 * The restriction in two or three words, where it stands in for the stars
 * (the Your stars card): "Bathing prohibited", "Advice not to bathe".
 */
export function restrictionShort(item: Pick<WaterItem, "restriction">) {
  const words = item.restriction.toLowerCase();
  if (/prohibit/.test(words)) return "Bathing prohibited";
  if (/advi[cs]e/.test(words)) return "Advice not to bathe";
  return "Bathing restricted";
}

/** The notices, a card each. Null with none, or none checked. */
export function WaterNotices({ water }: { water: WaterAnswer }) {
  const s = noticeListStyles();
  if (water.status !== "current" || !water.items.length) return null;
  return (
    <ul className={s.list()} id="water-quality" data-water-quality>
      {water.items.map((item) => (
        <li
          key={item.id}
          data-water-notice={item.replaces_ratings ? "replaces" : "beside"}
        >
          <Notice
            level={item.replaces_ratings ? "water" : "water-advice"}
            title={item.restriction}
            details={
              <p className={s.line()}>
                {item.cause && `${item.cause}. `}
                {item.beach}
                {item.km !== undefined && `, ${item.km.toFixed(1)} km away`}
                {item.notice && (
                  <>
                    {" · "}
                    <Link href={item.notice}>The council&rsquo;s notice</Link>
                  </>
                )}
              </p>
            }
          >
            {item.when}
            {item.in_force_now && " · now"}
            {" · "}
            {item.replaces_ratings ? (
              <strong className={s.effect()}>no stars while it lasts</strong>
            ) : (
              "stars still shown"
            )}
          </Notice>
        </li>
      ))}
    </ul>
  );
}
