/**
 * Under each day (spot/web/DayTide.tsx): the tide across its 24 hours as a
 * curve, the night hatched and the twilight paler behind it, the turns marked
 * and the present drawn where it falls; then the high and low waters and the
 * light as two small tables a rider can read without the curve at all.
 */
import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import type { TideCurve } from "../../../../force5/src/tides";
import {
  HOUR,
  clock,
  dublinMidnight,
  nextMidnight,
  shadeBands,
  type DaySun,
} from "../../../../spot/web/spot";
import { T } from "../../components/Text";
import { colors, fonts, space, withAlpha } from "../../theme/tokens";
import { dayTideCurve, dayTurns, tideWords } from "./spotLogic";

const H = 84;
const X_PAD = 4;
const Y0 = 8;
const Y1 = H - 16;

export const DayTide = memo(function DayTide({
  date,
  curve,
  sun,
  now,
  width,
  ceiling,
  note,
}: {
  date: string;
  curve: TideCurve | null;
  sun: DaySun;
  now: number;
  width: number;
  ceiling: number;
  /** Why there is no curve, where there is none. */
  note: string | null;
}) {
  const start = dublinMidnight(date);
  const end = nextMidnight(date);
  const x = (time: number) => X_PAD + ((time - start) / (end - start)) * (width - X_PAD * 2);
  const y = (height: number) => Y1 - (height / ceiling) * (Y1 - Y0);
  const points = useMemo(() => (curve ? dayTideCurve(curve, date) : []), [curve, date]);
  const turns = useMemo(() => (curve ? dayTurns(curve, date) : []), [curve, date]);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)} ${y(p.height).toFixed(1)}`).join("");
  const area = points.length
    ? `${line}L${x(points.at(-1)!.time).toFixed(1)} ${Y1}L${x(points[0].time).toFixed(1)} ${Y1}Z`
    : null;
  const ticks = Array.from({ length: 9 }, (_, i) => start + i * 3 * HOUR);
  const showNow = now >= start && now < end && points.length > 0;
  const label = `Tide and light: ${tideWords(turns, note)}. Sunrise ${sun.sunrise ? clock(sun.sunrise) : "none"}, sunset ${
    sun.sunset ? clock(sun.sunset) : "none"
  }.`;

  return (
    <View style={styles.base}>
      <Svg width={width} height={H} accessible accessibilityRole="image" accessibilityLabel={label}>
        {shadeBands(sun, start, end).map((band) => (
          <Rect
            key={`${band.kind}-${band.from}`}
            x={x(band.from)}
            y={Y0}
            width={Math.max(0, x(band.to) - x(band.from))}
            height={Y1 - Y0}
            fill={withAlpha(colors.ink, band.kind === "night" ? 0.15 : 0.06)}
          />
        ))}
        {ticks.map((tick, i) => (
          <SvgText
            key={tick}
            x={Math.min(width - X_PAD - 6, Math.max(X_PAD + 6, x(tick)))}
            y={H - 3}
            textAnchor="middle"
            fontFamily={fonts.monoMedium}
            fontSize={10}
            fill={colors.muted}
          >
            {String((i * 3) % 24).padStart(2, "0")}
          </SvgText>
        ))}
        {area && <Path d={area} fill={withAlpha(colors.depth, 0.3)} />}
        {line ? <Path d={line} fill="none" stroke={colors.depth} strokeWidth={1.6} strokeLinejoin="round" /> : null}
        {!points.length && (
          <SvgText
            x={width / 2}
            y={(Y0 + Y1) / 2 + 4}
            textAnchor="middle"
            fontFamily={fonts.bodyItalic}
            fontSize={14}
            fill={colors.muted}
          >
            {note ?? "No tide predicted for this day"}
          </SvgText>
        )}
        {turns.map((turn) => (
          <Circle
            key={turn.time}
            cx={x(turn.time)}
            cy={y(turn.height)}
            r={2.8}
            fill={turn.high ? colors.ink : colors.paper}
            stroke={colors.ink}
          />
        ))}
        {showNow && <Line x1={x(now)} x2={x(now)} y1={Y0} y2={Y1} stroke={colors.now} strokeWidth={1.2} />}
        <Line x1={X_PAD} x2={width - X_PAD} y1={Y1} y2={Y1} stroke={withAlpha(colors.ink, 0.5)} />
      </Svg>
      <View style={styles.tables} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.table}>
          {turns.length ? (
            turns.map((turn) => (
              <View key={turn.time} style={styles.tr}>
                <T variant="body" style={styles.th}>
                  {turn.high ? "High tide" : "Low tide"}
                </T>
                <T variant="figureSm" tabular>
                  {clock(turn.time)}
                </T>
                <T variant="figureSm" tabular>
                  {turn.height.toFixed(1)}
                  <T variant="caption" color="muted">
                    {" "}
                    m
                  </T>
                </T>
              </View>
            ))
          ) : (
            <View style={styles.tr}>
              <T variant="body" color="muted" style={styles.empty}>
                {note ?? "No turn this day"}
              </T>
            </View>
          )}
        </View>
        <View style={styles.table}>
          {(
            [
              ["First light", sun.firstLight],
              ["Sunrise", sun.sunrise],
              ["Sunset", sun.sunset],
              ["Last light", sun.lastLight],
            ] as const
          ).map(([name, time]) => (
            <View key={name} style={styles.tr}>
              <T variant="body" style={styles.th}>
                {name}
              </T>
              <T variant="figureSm" tabular>
                {time === null ? "–" : clock(time)}
              </T>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  base: { gap: space.sm, paddingTop: space.sm, paddingBottom: space.lg },
  tables: { flexDirection: "row", gap: space.md },
  table: { flex: 1, alignSelf: "flex-start" },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: space["2xl"] + space.xs,
    paddingHorizontal: space.sm,
    backgroundColor: withAlpha(colors.sunken, 0.6),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  th: { flex: 1 },
  empty: { fontFamily: fonts.bodyItalic },
});
