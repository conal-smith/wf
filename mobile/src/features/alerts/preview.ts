/**
 * What alerts would find in the forecast the phone already has: the published
 * blend's squares for the alerts' spots (read through the site's one loader,
 * which keeps them), rated for this rider (src/spotBlend.ts spotBlendHours)
 * and matched by the very code the API sends from (alerts/shared/match.ts).
 * So the editor can say "3 windows in the next 3 days" as a rule is shaped,
 * offline too, once the blend has been read.
 *
 * The API evaluates the published blend of every model; a rider who blends
 * their own set, or whose stars come from other models than the blend's, has
 * no published blend on the chart, and the tab asks the API for its preview
 * instead (sync.ts serverPreview). A spot the rider rates from a model of its
 * own is never rated from the blend: its hours are the forecast's own row,
 * worked out from that model's square (data/forecast.tsx), and unknown until
 * that square is read.
 */
import { useEffect, useMemo, useState } from "react";
import { matchRule, type HoursOf } from "../../../../alerts/shared/match";
import type { AlertMatch, AlertRule } from "../../../../alerts/shared/protocol";
import { readForecastJson } from "../../../../force5/src/manifests";
import { squaresFor } from "../../../../force5/src/squares";
import type { PlaceHour } from "../../../../src/ratings";
import { loadBlendSquares, spotBlendHours } from "../../../../src/spotBlend";
import { fromPublished } from "../../../../src/useRatings";
import { useForecast } from "../../data/forecast";
import { spotById } from "../../data/spots";

export interface AlertHours {
  /** Null until the blend's squares for these spots are read, or when there is no published blend. */
  hoursOf: HoursOf | null;
  axis: readonly string[];
  now: number;
}

export function useAlertHours(spotIds: readonly string[]): AlertHours {
  const { published, axis, rider, now, hours: table, version } = useForecast();
  const [hours, setHours] = useState<{ key: string; map: Map<string, PlaceHour[] | null> } | null>(null);
  const ids = [...new Set(spotIds)].sort().join(",");
  const key = published
    ? `${published.base}|${axis[0] ?? ""}|${axis.length}|${JSON.stringify(rider)}|${ids}`
    : null;

  useEffect(() => {
    const blend = published;
    if (!key || !blend) return;
    let current = true;
    const places = ids
      .split(",")
      .filter(Boolean)
      .flatMap((id) => {
        const spot = spotById(id);
        return spot ? [{ id, lat: spot.lat, lon: spot.lon, facing: spot.facing ?? null }] : [];
      });
    const fromBlend = fromPublished(blend, rider) ? places : [];
    void loadBlendSquares(readForecastJson, blend, squaresFor(fromBlend))
      .then((loaded) => {
        if (!current) return;
        const map = new Map(
          places.map((p) => [
            p.id,
            fromPublished(loaded, rider) ? spotBlendHours(loaded, p, axis, rider) : null,
          ]),
        );
        setHours({ key, map });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // `key` names everything read here; a new object for the same blend is no news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const hoursOf = useMemo<HoursOf | null>(() => {
    if (!hours || hours.key !== key || !published) return null;
    // A rider whose model is not the published blend's reads the forecast's row, from their model.
    return (id) =>
      fromPublished(published, rider)
        ? (hours.map.get(id) ?? null)
        : (table.get(id) ?? null);
    // `table` is one Map filled in place; `version` says when it gained rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, key, published, rider, table, version]);
  return { hoursOf, axis, now };
}

/** Each rule's coming windows, by rule id; null while the forecast is not to hand. */
export function useRuleMatches(rules: readonly AlertRule[]): Map<string, AlertMatch[]> | null {
  const spots = useMemo(() => rules.flatMap((r) => r.spots), [rules]);
  const { hoursOf, axis, now } = useAlertHours(spots);
  return useMemo(() => {
    if (!hoursOf) return null;
    return new Map(rules.map((rule) => [rule.id, matchRule(rule, axis, hoursOf, now)]));
  }, [rules, hoursOf, axis, now]);
}
