/**
 * One Irish day of the dock: its heading (the day's name and date, no
 * rating: the hours carry the stars), then a column per hour down the rows,
 * the night hatched behind them, and the tide's curve. A day is one item of the strip's list, so only the
 * days near the screen are drawn, and it is redrawn when its data changes,
 * never as the time scrolls (the cursor is drawn over the list).
 *
 * Each row of marks (the stars, the arrows, the tide) is one drawing for the
 * whole day; the figures are text. Every hour is one pressable column that a
 * screen reader reads as a sentence.
 */
import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { SHORE_LABEL, shoreAngle } from "../../../../force5/src/stars";
import type { Units } from "../../../../force5/src/units";
import type { PlaceHour } from "../../../../src/ratings";
import type { StripColumn, StripDay, StripGeometry } from "../../../../src/strip";
import { ArrowMark, SkyGlyph, StarsMark } from "../../components/Glyphs";
import { T } from "../../components/Text";
import { colors, fonts, space, withAlpha } from "../../theme/tokens";
import type { BlendDrawing } from "./blendLogic";
import {
  darkRuns,
  dayHead,
  handoverLabel,
  hatchPath,
  hourReading,
  speedIn,
  starSize,
  windInk,
  wingFor,
  type DayTidePaths,
  type DockHandover,
  type MoreCells,
  type RowLayout,
} from "./dockLogic";

export interface DockDayProps {
  day: StripDay;
  strip: readonly StripColumn[];
  g: StripGeometry;
  /** The spot's hours on the whole strip; null until its square is read. */
  hours: readonly PlaceHour[] | null;
  daylight: readonly boolean[];
  layout: RowLayout;
  units: Units;
  facing: number | null;
  /** A spot is open: with none, the days and the hours alone. */
  spot: boolean;
  /** The top of the hour now: earlier hours are faded. */
  nowHour: number;
  tide: DayTidePaths | null;
  tideNote: string | null;
  more: MoreCells | null;
  blend: BlendDrawing | null;
  blendNote: string | null;
  /** Dynamic Type's share of the text sizes, 1–1.35. */
  scale: number;
  onHour: (column: number) => void;
  onStars: (column: number) => void;
  /** Where the model the stars come from changes along the strip. */
  handovers: readonly DockHandover[];
}

const PAST = 0.42;

export const DockDay = memo(function DockDay(props: DockDayProps) {
  const { day, strip, g, hours, daylight, layout, units, facing, spot, nowHour, scale } = props;
  const origin = g.x[day.start];
  const end = day.start + day.count - 1;
  const width = g.x[end] + g.w[end] - origin;
  const at = layout.at;
  const columns = useMemo(
    () => Array.from({ length: day.count }, (_, k) => day.start + k),
    [day.start, day.count],
  );
  const bodyTop = at.hour?.y ?? 0;
  const bodyHeight = layout.height - bodyTop;
  const hatch = useMemo(
    () =>
      spot
        ? darkRuns(daylight, g, day)
            .map((run) => hatchPath(run.x, run.w, bodyHeight))
            .join("")
        : "",
    [spot, daylight, g, day, bodyHeight],
  );
  const fs = (size: number) => ({ fontSize: size * scale, lineHeight: size * scale * 1.2 });
  const local = (i: number) => g.x[i] - origin;
  const past = (i: number) => strip[i].time + 3600000 <= nowHour;
  const read = !!hours;

  const press = (i: number) => (event: GestureResponderEvent) => {
    const y = event.nativeEvent.locationY + bodyTop;
    if (at.stars && y >= at.stars.y && y < at.stars.y + at.stars.h && hours?.[i]?.rating)
      props.onStars(i);
    else props.onHour(i);
  };

  return (
    <View style={[styles.day, { width, height: layout.height }]}>
      {/* The night, hatched from the hours to the foot, as one band. */}
      {hatch ? (
        <Svg style={[styles.abs, { top: bodyTop }]} width={width} height={bodyHeight} pointerEvents="none">
          <Path d={hatch} stroke={withAlpha(colors.ink, 0.13)} strokeWidth={1} />
        </Svg>
      ) : null}

      {/* The day's heading: its name and date, and no verdict on the day. */}
      {at.day && (
        <View style={[styles.head, { height: at.day.h }]} pointerEvents="none">
          <T allowFontScaling={false} style={[styles.headName, fs(13)]} numberOfLines={1}>
            {dayHead(day)}
          </T>
        </View>
      )}

      {/* The stars, one drawing for the day. */}
      {at.stars && read && (
        <Svg style={[styles.abs, { top: at.stars.y }]} width={width} height={at.stars.h} pointerEvents="none">
          {columns.map((i) => {
            const rating = hours![i]?.rating;
            if (!rating) return null;
            return (
              <G key={i} opacity={past(i) ? PAST : 1}>
                <StarsMark
                  stars={rating.stars}
                  potential={rating.potential}
                  cx={local(i) + g.w[i] / 2}
                  cy={at.stars!.h / 2}
                  size={starSize(g.w[i])}
                  ink={rating.stars >= 5 ? colors.magenta : colors.ink}
                />
              </G>
            );
          })}
        </Svg>
      )}

      {/* Where the wind goes: red where it blows off the beach. */}
      {at.from && read && (
        <Svg style={[styles.abs, { top: at.from.y }]} width={width} height={at.from.h} pointerEvents="none">
          {columns.map((i) => {
            const from = hours![i]?.from;
            if (from === null || from === undefined) return null;
            const angle = facing === null ? null : shoreAngle(from, facing);
            const off = angle === "offshore" || angle === "cross-off";
            return (
              <G key={i} opacity={past(i) ? PAST : 1}>
                <ArrowMark
                  from={from}
                  x={local(i) + g.w[i] / 2}
                  y={at.from!.h / 2}
                  size={13 * scale}
                  color={off ? colors.pen : colors.ink}
                />
              </G>
            );
          })}
        </Svg>
      )}

      {/* The blend chart, through this day's window onto the strip's paths. */}
      {at.blend && (
        <View style={[styles.abs, { top: at.blend.y, height: at.blend.h, width }]} pointerEvents="none">
          {props.blend ? (
            <BlendWindow drawing={props.blend} origin={origin} width={width} height={at.blend.h} />
          ) : (
            <T variant="caption" color="muted" style={styles.note} numberOfLines={1}>
              {props.blendNote ?? ""}
            </T>
          )}
        </View>
      )}

      {/* The tide under the hours, its turns named. */}
      {at.tide && (
        <View style={[styles.abs, { top: at.tide.y, height: at.tide.h, width }]} pointerEvents="none">
          {props.tide ? (
            <Svg width={width} height={at.tide.h}>
              <Path d={props.tide.fill} fill={withAlpha(colors.depth, 0.16)} />
              <Path d={props.tide.line} fill="none" stroke={colors.depth} strokeWidth={1.4} />
              {props.tide.turns.map((turn) => (
                <G key={turn.key}>
                  <Circle
                    cx={turn.x}
                    cy={turn.y}
                    r={2.6}
                    fill={turn.high ? colors.ink : colors.paper}
                    stroke={colors.ink}
                    strokeWidth={1}
                  />
                  {turn.label &&
                    // The paper's halo first, then the ink over it.
                    [colors.paper, colors.ink].map((ink) => (
                      <SvgText
                        key={ink}
                        x={turn.label!.x}
                        y={turn.high ? 10 : at.tide!.h - 2}
                        textAnchor={turn.label!.anchor}
                        fontFamily={fonts.monoMedium}
                        fontSize={9.5}
                        fill={colors.ink}
                        stroke={ink === colors.paper ? colors.paper : "none"}
                        strokeWidth={ink === colors.paper ? 3 : 0}
                      >
                        {turn.text}
                      </SvgText>
                    ))}
                </G>
              ))}
            </Svg>
          ) : day.start === 0 || width > 200 ? (
            <T variant="caption" color="muted" style={styles.note} numberOfLines={1}>
              {props.tideNote ?? ""}
            </T>
          ) : null}
        </View>
      )}

      {/* The more rows' notes, where a row has nothing per hour to show. */}
      {props.more &&
        (["waves", "sky", "air", "rain"] as const).map((row) => {
          const slot = at[row];
          const data = props.more![row];
          if (!slot || data.cells || !data.note) return null;
          return (
            <View key={row} style={[styles.abs, { top: slot.y, height: slot.h, width }]} pointerEvents="none">
              <T variant="caption" color="muted" style={styles.note} numberOfLines={1}>
                {data.note}
              </T>
            </View>
          );
        })}

      {/* The hours: a column each, the figures in it, pressable. */}
      {columns.map((i) => {
        const column = strip[i];
        const hour = hours?.[i] ?? null;
        const w = g.w[i];
        const wing = wingFor(hour?.rating);
        const fade = past(i) ? styles.past : null;
        const night = spot && daylight[i] === false;
        const label = spot
          ? `${hourReading(column, hour, units)}${wing ? `, ${wing} square metre wing` : ""}${
              hour?.rating?.shore && facing !== null && !/offshore/.test(SHORE_LABEL[hour.rating.shore])
                ? `, ${SHORE_LABEL[hour.rating.shore]}`
                : ""
            }`
          : hourReading(column, undefined, units).replace(", not read yet", "");
        return (
          <Pressable
            key={column.validTime}
            onPress={press(i)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint="Shows this hour on the chart"
            style={[styles.column, { left: local(i), width: w, top: bodyTop, height: bodyHeight }]}
          >
            {at.hour && (
              <View style={[styles.cell, styles.hourCell, { height: at.hour.h }]}>
                <T
                  allowFontScaling={false}
                  variant="label"
                  color={night ? "muted" : "ink"}
                  style={[fs(11), fade]}
                >
                  {String(column.hour).padStart(2, "0")}
                </T>
              </View>
            )}
            {spot && !read && at.stars && <Skeleton top={at.stars.y - bodyTop} h={at.stars.h} />}
            {spot && !read && at.wind && <Skeleton top={at.wind.y - bodyTop} h={at.wind.h} />}
            {at.wind && read && (
              <View style={[styles.cellAbs, { top: at.wind.y - bodyTop, height: at.wind.h }, fade]}>
                {hour && hour.windKn !== null ? (
                  <>
                    <T allowFontScaling={false} tabular style={[styles.kn, fs(12.5)]}>
                      {speedIn(hour.windKn, units)}
                      {hour.gustKn !== null ? (
                        <T allowFontScaling={false} tabular color="muted" style={[styles.gu, fs(9.5)]}>
                          {` g${speedIn(hour.gustKn, units)}`}
                        </T>
                      ) : null}
                    </T>
                    <View style={[styles.windBar, { backgroundColor: windInk(hour.windKn), width: w - 12 }]} />
                  </>
                ) : (
                  <T allowFontScaling={false} color="muted" style={fs(11)}>
                    –
                  </T>
                )}
              </View>
            )}
            {at.wing && read && wing !== null && (
              <View style={[styles.cellAbs, { top: at.wing.y - bodyTop, height: at.wing.h }, fade]}>
                <T allowFontScaling={false} tabular style={[styles.wing, fs(12)]}>
                  {wing}
                </T>
              </View>
            )}
            {props.more && <MoreCellsColumn more={props.more} i={i} at={at} top={bodyTop} fs={fs} w={w} />}
          </Pressable>
        );
      })}

      {/* Where one model's run ends and the next takes over: the pen's dashed
          stem at the column's edge, and its words in the day's heading. */}
      {spot &&
        read &&
        props.handovers
          .filter((change) => change.at >= day.start && change.at <= end)
          .map((change) => {
            const x = local(change.at);
            const size = 13 * scale;
            const label = at.day
              ? handoverLabel(x, width, (dayHead(day).length * 7.5 + 12) * scale, change.text.length * 6 * scale)
              : null;
            return (
              <Svg
                key={change.at}
                style={styles.abs}
                width={width}
                height={layout.height}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Path
                  d={`M${x} ${at.day ? at.day.h : bodyTop}V${layout.height}`}
                  stroke={colors.penInk}
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                />
                {label && at.day ? (
                  <SvgText
                    x={label.x}
                    y={at.day.h / 2 + size * 0.35}
                    textAnchor={label.anchor}
                    fontFamily={fonts.hand}
                    fontSize={size}
                    fill={colors.penInk}
                  >
                    {change.text}
                  </SvgText>
                ) : null}
              </Svg>
            );
          })}

      {/* The day's edge: a heavy ink rule down every row. */}
      <View style={styles.edge} pointerEvents="none" />
    </View>
  );
});

function Skeleton({ top, h }: { top: number; h: number }) {
  return <View style={[styles.skeleton, { top: top + h * 0.3, height: h * 0.4 }]} />;
}

function MoreCellsColumn({
  more,
  i,
  at,
  top,
  fs,
  w,
}: {
  more: MoreCells;
  i: number;
  at: RowLayout["at"];
  top: number;
  fs: (size: number) => { fontSize: number; lineHeight: number };
  w: number;
}) {
  const wave = more.waves.cells?.[i];
  const sky = more.sky.cells?.[i];
  const air = more.air.cells?.[i];
  const rain = more.rain.cells?.[i];
  return (
    <>
      {at.waves && wave && (
        <View
          style={[styles.cellAbs, styles.rowCell, { top: at.waves.y - top, height: at.waves.h }]}
          accessibilityLabel={`Waves ${wave.words}`}
        >
          {wave.from !== null && (
            <Svg width={11} height={11} viewBox="-7 -7 14 14">
              <ArrowMark from={wave.from} x={0} y={0} size={14} color={colors.depth} />
            </Svg>
          )}
          <T allowFontScaling={false} tabular style={[styles.small, fs(11)]}>
            {wave.height.toFixed(1)}
          </T>
          {w >= 58 && wave.period !== null && (
            <T allowFontScaling={false} tabular color="muted" style={fs(9)}>
              {Math.round(wave.period)}s
            </T>
          )}
        </View>
      )}
      {at.sky && sky && (
        <View style={[styles.cellAbs, { top: at.sky.y - top, height: at.sky.h }]} accessibilityLabel={sky.words}>
          <SkyGlyph icon={sky.icon} size={15} />
        </View>
      )}
      {at.air && air !== null && air !== undefined && (
        <View style={[styles.cellAbs, { top: at.air.y - top, height: at.air.h }]}>
          <T allowFontScaling={false} tabular style={[styles.small, fs(11)]}>
            {air}°
          </T>
        </View>
      )}
      {at.rain && rain && (
        <View
          style={[
            styles.cellAbs,
            { top: at.rain.y - top, height: at.rain.h, backgroundColor: withAlpha(colors.depth, 0.08 + rain.tint * 0.4) },
          ]}
          accessibilityLabel={`Rain ${rain.words}`}
        >
          <T allowFontScaling={false} tabular style={[styles.small, fs(11)]}>
            {rain.text}
          </T>
        </View>
      )}
    </>
  );
}

/** The blend's paths, seen through one day's window. */
const BlendWindow = memo(function BlendWindow({
  drawing,
  origin,
  width,
  height,
}: {
  drawing: BlendDrawing;
  origin: number;
  width: number;
  height: number;
}) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="wind" gradientUnits="userSpaceOnUse" x1="0" y1={drawing.y0} x2="0" y2={drawing.yMax}>
          {drawing.stops.map((stop) => (
            <Stop key={stop.offset} offset={stop.offset} stopColor={stop.colour} />
          ))}
        </LinearGradient>
      </Defs>
      <G transform={`translate(${-origin} 0)`}>
        {drawing.nights.map((night) => (
          <Rect key={night.x} x={night.x} y={0} width={night.w} height={height} fill={withAlpha(colors.ink, 0.06)} />
        ))}
        {drawing.ticks.map((tick) => (
          <Path
            key={tick.value}
            d={`M${origin} ${tick.y}H${origin + width}`}
            stroke={withAlpha(colors.ink, 0.12)}
            strokeWidth={1}
          />
        ))}
        {drawing.bands.map((band, k) => (
          <Path key={`b${k}`} d={band.d} fill="url(#wind)" opacity={band.opacity} />
        ))}
        {drawing.gusts.map((band, k) => (
          <Path key={`g${k}`} d={band.d} fill="url(#wind)" opacity={band.opacity} />
        ))}
        {drawing.lines.map((line, k) => (
          <Path key={`l${k}`} d={line.d} fill="none" stroke={line.color} strokeWidth={1} opacity={0.4} />
        ))}
        {drawing.sparse ? (
          <Path d={drawing.sparse} fill="none" stroke={colors.ink} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
        ) : null}
        <Path d={drawing.median} fill="none" stroke={colors.ink} strokeWidth={1.8} />
        {drawing.arrows
          .filter((a) => a.x >= origin - 8 && a.x <= origin + width + 8)
          .map((a) => (
            <ArrowMark key={a.x} from={a.from} x={a.x} y={a.y} size={11} />
          ))}
      </G>
    </Svg>
  );
});

const styles = StyleSheet.create({
  day: { overflow: "hidden" },
  abs: { position: "absolute", left: 0 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.sm - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headName: { fontFamily: fonts.displayBold, color: colors.ink },
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: colors.ink,
  },
  column: { position: "absolute" },
  cell: { alignItems: "center", justifyContent: "center" },
  hourCell: { borderBottomWidth: 1, borderBottomColor: colors.ink },
  cellAbs: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCell: { flexDirection: "row", gap: space["2xs"] },
  kn: { fontFamily: fonts.monoBold, color: colors.ink },
  gu: { fontFamily: fonts.mono },
  windBar: { height: 3, borderRadius: 1.5, marginTop: space["2xs"] },
  wing: { fontFamily: fonts.monoBold, color: colors.ink },
  small: { fontFamily: fonts.monoMedium, color: colors.ink },
  past: { opacity: PAST },
  note: { paddingHorizontal: space.sm, paddingTop: space.xs, fontFamily: fonts.bodyItalic },
  skeleton: {
    position: "absolute",
    left: space.sm,
    right: space.sm,
    backgroundColor: colors.sunken,
    borderRadius: 2,
  },
});
