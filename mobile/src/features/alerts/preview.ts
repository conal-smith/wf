/**
 * What alerts would find in the forecast the phone already has: the published
 * blend's squares for the alerts' spots (read through the site's one loader,
 * which keeps them), rated for this rider (src/spotBlend.ts spotBlendHours)
 * and matched by the very code the API sends from (alerts/shared/match.ts).
 * So the editor can say "3 windows in the next 3 days" as a rule is shaped,
 * offline too, once the blend has been read.
 *
 * The API evaluates the published blend of every model; a rider who blends
 * their own set has no published blend on the chart, and the tab asks the API
 * for its preview instead (sync.ts serverPreview).
 */
import { useEffect, useMemo, useState } from "react";
import { matchRule, type HoursOf } from "../../../../alerts/shared/match";
import type { AlertMatch, AlertRule } from "../../../../alerts/shared/protocol";
import { readForecastJson } from "../../../../force5/src/manifests";
import { squaresFor } from "../../../../force5/src/squares";
import type { PlaceHour } from "../../../../src/ratings";
import { loadBlendSquares, spotBlendHours } from "../../../../src/spotBlend";
import { useForecast } from "../../data/forecast";
import { spotById } from "../../data/spots";

export interface AlertHours {
  /** Null until the blend's squares for these spots are read, or when there is no published blend. */
  hoursOf: HoursOf | null;
  axis: readonly string[];
  now: number;
}

export function useAlertHours(spotIds: readonly string[]): AlertHours {
  const { published, axis, rider, now } = useForecast();
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
    void loadBlendSquares(readForecastJson, blend, squaresFor(places))
      .then((loaded) => {
        if (!current) return;
        const map = new Map(places.map((p) => [p.id, spotBlendHours(loaded, p, axis, rider)]));
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
    if (!hours || hours.key !== key) return null;
    return (id) => hours.map.get(id) ?? null;
  }, [hours, key]);
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
