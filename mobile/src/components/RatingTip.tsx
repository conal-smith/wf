/**
 * Why an hour has its stars: the site's RatingTip (ui/RatingTip.tsx), the one
 * explanation everywhere, opened by a tap on an hour's stars in the dock or on
 * the spot page. A card of the chart's paper, ruled twice in ink, over a
 * scrim: the session and the wing, the wind and what it rides like, the shore,
 * and every reason a star came off, in the pen's ink.
 */
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { SESSION_LABEL, SHORE_LABEL, starsText, type HourRating } from "../../../force5/src/stars";
import type { Units } from "../../../force5/src/units";
import { compass } from "../../../force5/src/weather";
import { windIn } from "../../../spot/web/spot";
import { colors, fonts, hitTarget, shadow, space } from "../theme/tokens";
import { Button } from "./Button";
import { WindArrow } from "./Glyphs";
import { Rule } from "./Rule";
import { Stars } from "./Stars";
import { T } from "./Text";

export interface HourExplanation {
  /** "Sat · 14:00". */
  when: string;
  rating: HourRating | null;
  daylight: boolean;
  windKn: number | null;
  gustKn: number | null;
  from: number | null;
  units: Units;
  /** "Riding · ~80 kg": who the stars are for. */
  riderText: string;
  /** The rider's sweet spot in knots. */
  sweet: { low: number; high: number };
  /** Where the shore is not known, the wind alone is rated. */
  facingKnown: boolean;
}

/** The one-line verdict: "Cruising on a 5 m" / "Dark: not rated". */
export function verdictText(rating: HourRating | null, daylight: boolean): string {
  if (!rating) return daylight ? "No wind reading" : "Dark: not rated";
  const wing = rating.wing.own ?? rating.wing.recommended;
  return `${SESSION_LABEL[rating.session]}${rating.potential > 0 ? ` on a ${wing} m` : ""}`;
}

export function RatingTip({
  explanation,
  onClose,
  onHow,
}: {
  /** The hour to explain, or null when closed. */
  explanation: HourExplanation | null;
  onClose: () => void;
  /** "How the stars work". */
  onHow?: () => void;
}) {
  const e = explanation;
  return (
    <Modal
      visible={!!e}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait"]}
    >
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      {e && (
        <View style={styles.wrap} pointerEvents="box-none">
          <View style={styles.card} accessibilityViewIsModal>
            <View style={styles.inner}>
              <View style={styles.head}>
                <T variant="eyebrow" caps color="muted">
                  {e.when}
                </T>
                {e.rating ? (
                  <Stars stars={e.rating.stars} potential={e.rating.potential} size={14} />
                ) : null}
              </View>
              <T variant="spot" style={styles.verdict} accessibilityRole="header">
                {verdictText(e.rating, e.daylight)}
              </T>
              {e.rating ? (
                <T variant="caption" color="muted">
                  {starsText(e.rating)}
                </T>
              ) : null}
              {e.windKn !== null && (
                <View style={styles.line}>
                  {e.from !== null && <WindArrow from={e.from} size={14} />}
                  <T variant="figureSm" tabular>
                    {e.from !== null ? `${compass(e.from)} ` : ""}
                    {windIn(e.windKn, e.units)}
                    {e.gustKn !== null ? ` g${windIn(e.gustKn, e.units)}` : ""}
                    {e.rating && e.rating.liftKn >= 0.95
                      ? ` → rides like ${windIn(e.rating.rideKn, e.units)}`
                      : ""}
                  </T>
                </View>
              )}
              {e.windKn !== null && (
                <T variant="body" color="ink2">
                  {e.rating?.shore
                    ? SHORE_LABEL[e.rating.shore]
                    : e.facingKnown
                      ? "Shore angle unknown for this hour"
                      : "Facing unknown: the wind alone is rated"}
                </T>
              )}
              {e.rating?.reasons.map((reason) => (
                <T key={reason} variant="body" color="penInk" style={styles.reason}>
                  − {reason}
                </T>
              ))}
              {e.rating && !e.rating.reasons.length && e.rating.stars === e.rating.potential && (
                <T variant="body" color="muted">
                  Nothing taken off
                </T>
              )}
              <Rule style={styles.rule} />
              <T variant="caption" color="muted">
                Rated for {e.riderText} · best {e.sweet.low}–{e.sweet.high} kn
              </T>
              <View style={styles.actions}>
                {onHow && (
                  <Button
                    kind="quiet"
                    size="sm"
                    label="How the stars work"
                    onPress={() => {
                      onClose();
                      onHow();
                    }}
                  />
                )}
                <Button kind="pill" size="sm" label="Done" onPress={onClose} />
              </View>
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  wrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  card: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
    padding: space["2xs"],
    boxShadow: shadow.surface,
  },
  inner: {
    borderWidth: 1,
    borderColor: colors.ink,
    padding: space.lg,
    gap: space.sm,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  verdict: { fontSize: 19, lineHeight: 24 },
  line: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: space["2xl"] },
  reason: { fontFamily: fonts.bodyItalic },
  rule: { marginVertical: space.xs },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space.sm,
    minHeight: hitTarget,
  },
});
