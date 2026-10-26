/**
 * "How the stars work" (spot/web/StarsPage.tsx): the rating in plain words and
 * figures, for the rider the app is set to. Everyone starts from ours; the
 * four numbers on the wind that make the stars, how a gust is read, the five
 * ways the wind meets a beach and what each costs, what never moves a star,
 * the wing, and one hour of the live forecast worked through line by line
 * (spot/web/ledger.ts, tested against the rating itself).
 */
import { Stack, router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import {
  GUST_EASE_KN,
  directionCosts,
  starsText,
  windBand,
  windStars,
  type DirectionKey,
  type Rider,
} from "../../../../force5/src/stars";
import { leadText, starsFromAt } from "../../../../force5/src/lead";
import { compass } from "../../../../force5/src/weather";
import type { Ledger } from "../../../../spot/web/ledger";
import { clock, dayNames, dublinDate } from "../../../../spot/web/spot";
import { costLabel, rateExample } from "../../../../spot/web/yourStars";
import { Rule } from "../../components/Rule";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast } from "../../data/forecast";
import { spotById } from "../../data/spots";
import { colors, fonts, hitTarget, space, withAlpha } from "../../theme/tokens";
import { CustomiseLink, RiderLine, useRider } from "../settings/RiderFields";
import { riderWords, starsName } from "../settings/settingsLogic";
import { AGREED_HOURS, hourName, workedHour } from "./infoLogic";

export function StarsScreen() {
  const [rider] = useRider();
  const { width } = useWindowDimensions();
  const inner = width - space.lg * 2;
  const band = windBand(rider);
  const k = (kn: number) => Math.round(kn);
  return (
    <>
      <Stack.Screen options={{ title: "How the stars work", headerLargeTitleEnabled: true }} />
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <T variant="prose" color="ink2" style={styles.deck}>
          We rate every daylight hour out of five stars. Everyone starts from ours; in Customise you can make them
          your own.
        </T>
        <RiderLine />
        <View style={styles.key}>
          <KeyLine mark={<Stars stars={3} potential={5} size={14} />}>
            Solid stars are the rating. Outlined stars are stars the hour lost to the gusts or the shore, and
            nothing else.
          </KeyLine>
          <KeyLine mark={<Stars stars={2} size={14} />}>A dot is a star the steady wind never earned.</KeyLine>
          <KeyLine
            mark={
              <T variant="label" caps color="muted">
                Dark
              </T>
            }
          >
            Hours in the dark are not rated: from sunset to sunrise they are folded away, and draw no stars.
          </KeyLine>
        </View>

        <Section n={1} title="Four numbers" soft="for the wind">
          <P>
            The stars come from four numbers you can move in Customise: too light ({k(band.min)} kn), the sweet
            spot ({k(band.sweetLow)}–{k(band.sweetHigh)} kn) and too much, in gusts ({k(band.max)} kn).
          </P>
          <P>
            Steady wind under too light gets no stars. At too light it gets one star, then a star a knot up to four;
            five through the sweet spot; then fewer, down to one star {GUST_EASE_KN} kn under too much and none 3 kn
            under it.
          </P>
          <ScoreChart rider={rider} width={inner} />
          <BandTable rider={rider} />
          <CustomiseLink />
        </Section>

        <Section n={2} title="Gusts," soft="read lighter">
          <P>
            A gust past too much means no stars, not even outlined ones. Otherwise the gust is read {GUST_EASE_KN} kn
            lighter, and if that is worth fewer stars the hour takes the lower; those stars show as outlines.
          </P>
          <AgreedTable rider={rider} />
        </Section>

        <Section n={3} title="Wind" soft="direction">
          <P>
            What matters is the angle between the wind and the beach. Onshore wind blows straight in from the sea.
            Offshore wind blows straight out to sea: if you fall or break something, it carries you away from land.
          </P>
          <Sectors width={Math.min(380, inner)} />
          <ShoreTable rider={rider} />
          <P>
            Offshore is never: we don&rsquo;t recommend going out in an offshore wind, and no setting changes that.
            Cross-offshore costs one star unless you change it in Customise; the rest cost nothing. Stars come off
            whole.
          </P>
        </Section>

        <Section n={4} title="What never" soft="changes the stars">
          <P>
            Your weight and your wings: they pick the wing size shown beside the stars. How far upwind you ride: it
            moves the wedge on the chart, not the stars.
          </P>
          <P>
            Every hour is rated from one model&rsquo;s own forecast, the model you see on the chart:{" "}
            {leadText(starsFromAt(rider.starsFrom))} for you, as the run reaches the hour. Whether the other models
            agree is shown beside the stars, and never changes them.
          </P>
          <T variant="body" color="muted" style={styles.italic}>
            Tap an hour&rsquo;s stars, in the dock or on a spot&rsquo;s page, to see what it lost, and why.
          </T>
        </Section>

        <Section n={5} title="Which" soft="wing">
          <P>
            We suggest a wing size for every hour. For an 80 kg rider that is about 5.5 m² at 15 knots, 4.5 m² at 20
            knots and 3 m² at 30 knots; heavier riders a size bigger, lighter riders smaller.
          </P>
          <P>
            If you have told us which wings you own, we pick the smallest one that is big enough. The wing never
            changes the stars.
          </P>
        </Section>

        <Section n={6} title="An" soft="example">
          <P>One hour from the live forecast, worked through step by step.</P>
          <WorkedExample rider={rider} />
        </Section>

        <T variant="caption" color="muted" style={styles.italic}>
          wingfoil.ie star rating, version 7.
        </T>
      </ScrollView>
    </>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <T variant="prose" color="ink2">
    {children}
  </T>
);

function KeyLine({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.keyLine}>
      <View style={styles.keyMark}>{mark}</View>
      <T variant="body" color="ink2" style={styles.flex}>
        {children}
      </T>
    </View>
  );
}

function Section({ n, title, soft, children }: { n: number; title: string; soft: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Rule strong />
      <T variant="lead" accessibilityRole="header">
        {n}. {title} <T variant="spot">{soft}</T>
      </T>
      {children}
    </View>
  );
}

/** About how wide a character of the chart's mono is, at its size. */
const EYEBROW_CHAR = 6.4;

/** Stars for a steady wind, from the rider's four numbers: tap along it to read a speed. */
function ScoreChart({ rider, width }: { rider: Rider; width: number }) {
  const band = windBand(rider);
  const W = width;
  const H = 170;
  const left = 30;
  const right = 14;
  const X = (k: number) => left + (k / 40) * (W - left - right);
  const Y = (stars: number) => H - 24 - (stars / 5) * (H - 44);
  const [hover, setHover] = useState<number | null>(null);
  let path = "";
  for (let k = 0; k <= 40; k += 0.25)
    path += `${path ? "L" : "M"}${X(k).toFixed(1)} ${Y(windStars(k, band)).toFixed(1)}`;
  const r = (kn: number) => Math.round(kn);
  const label = `Stars for a steady wind, ${starsName(rider).toLowerCase()}: none under ${r(band.min)} knots, one at ${r(
    band.min,
  )}, five from ${r(band.sweetLow)} to ${r(band.sweetHigh)}, one at ${r(band.max - 5)}, none from ${r(band.max - 3)}.`;
  const mono = { fontFamily: fonts.monoMedium, fontSize: 10 };
  // Too light, the sweet spot and too much are named in one row over the
  // plot, where the curve never reaches (spot/web/StarsPage.tsx): too light's
  // name ends at its line and too much's starts at its own, each kept inside
  // the chart, and the sweet spot's sits between them, clear of both.
  const minText = `too light ${r(band.min)}`;
  const maxText = `too much ${r(band.max)}`;
  const textWidth = (text: string) => text.length * EYEBROW_CHAR;
  const minEnd = Math.max(X(0) + textWidth(minText), X(band.min) - 4);
  const maxStart = Math.min(W - 2 - textWidth(maxText), X(band.max) + 4);
  const half = textWidth("sweet spot") / 2;
  const names = {
    min: minEnd,
    max: maxStart,
    sweet: Math.min(Math.max((X(band.sweetLow) + X(band.sweetHigh)) / 2, minEnd + 8 + half), maxStart - 8 - half),
  };
  const at = (x: number) => Math.round(((x - left) / (W - left - right)) * 40);
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => setHover(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => {
        const k = at(e.nativeEvent.locationX);
        setHover(k < 0 || k > 40 ? null : k);
      }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Svg width={W} height={H}>
        <Rect
          x={X(band.sweetLow)}
          y={Y(5)}
          width={X(band.sweetHigh) - X(band.sweetLow)}
          height={Y(0) - Y(5)}
          fill={withAlpha(colors.magenta, 0.08)}
        />
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Line key={n} x1={X(0)} x2={X(40)} y1={Y(n)} y2={Y(n)} stroke={withAlpha(colors.ink, 0.1)} />
        ))}
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <SvgText key={`t${n}`} x={X(0) - 6} y={Y(n) + 3} textAnchor="end" fill={colors.muted} {...mono}>
            {`${n}★`}
          </SvgText>
        ))}
        {[0, 10, 20, 30, 40].map((k) => (
          <SvgText
            key={k}
            x={X(k)}
            y={H - 8}
            textAnchor={k === 40 ? "end" : "middle"}
            fill={colors.muted}
            {...mono}
          >
            {k === 40 ? "40 kn" : String(k)}
          </SvgText>
        ))}
        <Path d={path} fill="none" stroke={colors.ink} strokeWidth={1.8} />
        {[band.min, band.max].map((k) => (
          <Line
            key={k}
            x1={X(k)}
            x2={X(k)}
            y1={Y(5)}
            y2={Y(0)}
            stroke={withAlpha(colors.magenta, 0.6)}
            strokeDasharray="3 3"
          />
        ))}
        <SvgText x={names.min} y={Y(5) - 5} textAnchor="end" fill={colors.magenta} {...mono}>
          {minText}
        </SvgText>
        <SvgText x={names.sweet} y={Y(5) - 5} textAnchor="middle" fill={colors.magenta} {...mono}>
          sweet spot
        </SvgText>
        <SvgText x={names.max} y={Y(5) - 5} fill={colors.magenta} {...mono}>
          {maxText}
        </SvgText>
        {hover !== null && hover >= 0 && hover <= 40 && (
          <>
            <Line x1={X(hover)} x2={X(hover)} y1={Y(5)} y2={Y(0)} stroke={colors.muted} />
            <Circle cx={X(hover)} cy={Y(windStars(hover, band))} r={3} fill={colors.ink} />
            <SvgText
              x={X(hover) > W - 120 ? X(hover) - 6 : X(hover) + 6}
              y={Y(0) - 6}
              textAnchor={X(hover) > W - 120 ? "end" : "start"}
              fill={colors.ink}
              fontFamily={fonts.monoBold}
              fontSize={12}
            >
              {`${hover} kn → ${Math.round(windStars(hover, band))}★`}
            </SvgText>
          </>
        )}
      </Svg>
    </View>
  );
}

function Table({
  head,
  rows,
  you,
}: {
  head: readonly string[];
  rows: readonly (readonly string[])[];
  /** The column (1-based, after the label) or row that is the rider's own. */
  you?: { column?: number; row?: number };
}) {
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.th]}>
        {head.map((h, i) => (
          <T
            key={h}
            variant="eyebrow"
            caps
            color="muted"
            style={[
              i ? styles.td : styles.tdFirst,
              you?.column === i && styles.you,
            ]}
          >
            {h}
          </T>
        ))}
      </View>
      {rows.map((row, r) => (
        <View
          key={row[0]}
          style={[styles.tr, you?.row === r && styles.you]}
          accessible
          accessibilityLabel={row
            .map((c, i) => (i ? `${head[i]}: ${c}` : c))
            .join(", ")}
        >
          {row.map((cell, i) => (
            <T
              key={i}
              variant={i ? "figureSm" : "body"}
              tabular={!!i}
              style={[
                i ? styles.td : styles.tdFirst,
                you?.column === i && styles.you,
              ]}
            >
              {cell}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Ours, and the rider's own beside it once they have one. */
type Column = "ours" | "yours";
const columns = (rider: Rider): Column[] => (rider.custom ? ["ours", "yours"] : ["ours"]);
const columnRider = (rider: Rider, column: Column): Rider =>
  column === "yours" ? rider : { ...rider, custom: null };
const COLUMN_NAME: Record<Column, string> = { ours: "Ours", yours: "Yours" };
/** The column the rider is rated on, 1-based after the label. */
const youColumn = (rider: Rider) => (rider.custom ? 2 : 1);

function BandTable({ rider }: { rider: Rider }) {
  const cols = columns(rider);
  const bands = cols.map((column) => windBand(columnRider(rider, column)));
  const r = (kn: number) => String(Math.round(kn));
  return (
    <>
      <Table
        head={["Knots", ...cols.map((c) => COLUMN_NAME[c])]}
        rows={[
          ["Too light, under", ...bands.map((b) => r(b.min))],
          ["Sweet spot", ...bands.map((b) => `${r(b.sweetLow)}–${r(b.sweetHigh)}`)],
          ["Too much, in gusts", ...bands.map((b) => r(b.max))],
        ]}
        you={{ column: youColumn(rider) }}
      />
      <T variant="caption" color="muted">
        Your weight never changes them: move them in Customise if the wind suits you differently.
      </T>
    </>
  );
}

/** The agreed hours, cross-shore, rated on ours and on the rider's own beside it. */
function AgreedTable({ rider }: { rider: Rider }) {
  const cols = columns(rider);
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.th]}>
        <T variant="eyebrow" caps color="muted" style={styles.tdFirst}>
          Hour, kn
        </T>
        {cols.map((column, i) => (
          <T
            key={column}
            variant="eyebrow"
            caps
            color="muted"
            style={[styles.td, youColumn(rider) === i + 1 && styles.you]}
          >
            {COLUMN_NAME[column]}
          </T>
        ))}
      </View>
      {AGREED_HOURS.map(([wind, gust]) => {
        const rated = cols.map((column) => rateExample(columnRider(rider, column), wind, gust, "cross"));
        return (
          <View
            key={`${wind}-${gust}`}
            style={styles.tr}
            accessible
            accessibilityLabel={`${hourName(wind, gust)}: ${rated
              .map((h, i) => `${COLUMN_NAME[cols[i]]} ${starsText(h)}`)
              .join(", ")}`}
          >
            <T variant="figureSm" tabular style={styles.tdFirst}>
              {hourName(wind, gust)}
            </T>
            {rated.map((h, i) => (
              <View key={cols[i]} style={[styles.td, youColumn(rider) === i + 1 && styles.you]}>
                <Stars stars={h.stars} potential={h.potential} size={12} />
              </View>
            ))}
          </View>
        );
      })}
      <T variant="caption" color="muted" style={styles.note}>
        Cross-shore. Solid stars, then the outlines the gusts took.
      </T>
    </View>
  );
}

const SECTORS = [
  {
    from: 0,
    to: 30,
    name: "onshore",
    key: "onshore" as DirectionKey,
    words: "Onshore",
    away: false,
    tint: 0.55,
  },
  {
    from: 30,
    to: 70,
    name: "cross-on",
    key: "crossOn" as DirectionKey,
    words: "Cross-onshore",
    away: false,
    tint: 0.32,
  },
  {
    from: 70,
    to: 110,
    name: "cross",
    key: "cross" as DirectionKey,
    words: "Cross-shore",
    away: false,
    tint: 0.16,
  },
  {
    from: 110,
    to: 150,
    name: "cross-off",
    key: "crossOff" as DirectionKey,
    words: "Cross-offshore",
    away: true,
    tint: 0.22,
  },
  {
    from: 150,
    to: 180,
    name: "offshore",
    key: "offshore" as DirectionKey,
    words: "Offshore",
    away: true,
    tint: 0.42,
  },
] as const;

function Sectors({ width }: { width: number }) {
  const R = 118;
  const PAD = 24;
  const cx = 160;
  const cy = R + PAD;
  const H = 2 * (R + PAD);
  const D = Math.PI / 180;
  const pt = (a: number, r: number) =>
    [cx + Math.sin(a * D) * r, cy - Math.cos(a * D) * r] as const;
  const wedge = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0, R);
    const [x1, y1] = pt(a1, R);
    return `M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`;
  };
  const mono = { fontFamily: fonts.monoMedium, fontSize: 10 };
  return (
    <View
      style={styles.centre}
      accessible
      accessibilityRole="image"
      accessibilityLabel="The wind against the beach, measured from straight onshore: onshore within 30 degrees, cross-onshore 30 to 70, cross-shore 70 to 110, cross-offshore 110 to 150, offshore from 150 to 180, either side."
    >
      <Svg width={width} height={(width * H) / 320} viewBox={`0 0 320 ${H}`}>
        <Rect
          x={cx - R - 30}
          y={cy - R - PAD}
          width={2 * R + 60}
          height={R + PAD}
          fill={colors.sea}
        />
        <Rect
          x={cx - R - 30}
          y={cy}
          width={2 * R + 60}
          height={R + PAD}
          fill={colors.land}
        />
        {SECTORS.map((s) =>
          [wedge(s.from, s.to), wedge(-s.to, -s.from)].map((d, i) => (
            <Path
              key={`${s.name}-${i}`}
              d={d}
              fill={s.away ? colors.pen : colors.depth}
              fillOpacity={s.tint}
              stroke={colors.paper}
              strokeWidth={1}
            />
          )),
        )}
        <Line
          x1={cx - R - 30}
          x2={cx + R + 30}
          y1={cy}
          y2={cy}
          stroke={colors.ink}
          strokeWidth={2}
        />
        {[0, 30, 70, 110, 150, 180].flatMap((a) =>
          (a === 0 || a === 180 ? [a] : [a, -a]).map((b) => {
            const [x, y] = pt(b, R + 11);
            return (
              <SvgText
                key={b}
                x={x}
                y={y + 3}
                textAnchor="middle"
                fill={colors.muted}
                {...mono}
              >
                {`${a}°`}
              </SvgText>
            );
          }),
        )}
        {SECTORS.map((s) => {
          const [x, y] = pt((s.from + s.to) / 2, R * 0.66);
          return (
            <SvgText
              key={s.name}
              x={x}
              y={y + (s.name === "cross" ? -5 : 4)}
              textAnchor="middle"
              fill={colors.ink}
              fontFamily={fonts.bodyItalic}
              fontSize={13}
            >
              {s.name}
            </SvgText>
          );
        })}
        <SvgText x={cx - R - 24} y={cy - R - 10} fill={colors.depth} {...mono}>
          SEA
        </SvgText>
        <SvgText x={cx - R - 24} y={cy + R + 18} fill={colors.relief} {...mono}>
          LAND
        </SvgText>
        <Circle cx={cx} cy={cy} r={3} fill={colors.ink} />
        <SvgText x={cx + 8} y={cy - 6} fill={colors.ink} {...mono}>
          beach
        </SvgText>
      </Svg>
    </View>
  );
}

function ShoreTable({ rider }: { rider: Rider }) {
  const cols = columns(rider);
  return (
    <Table
      head={["Wind", ...cols.map((c) => COLUMN_NAME[c])]}
      rows={SECTORS.map((s) => [
        `${s.words} ${s.from}–${s.to}°`,
        ...cols.map((column) => costLabel(directionCosts(columnRider(rider, column))[s.key])),
      ])}
      you={{ column: youColumn(rider) }}
    />
  );
}

function WorkedExample({ rider }: { rider: Rider }) {
  const { spot, hours, version, strip, now } = useForecast();
  const { starred } = useFavourites();
  const picked = useMemo(
    () =>
      workedHour(
        [spot?.id, ...starred].filter((id): id is string => !!id),
        hours,
        strip,
        rider,
        spotById,
        now,
      ),
    // `hours` is one Map filled in place; `version` says when it moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spot?.id, starred, hours, version, strip, rider, now],
  );
  if (!picked)
    return (
      <T variant="body" color="muted" style={styles.italic}>
        Open a spot on the chart, or star one, and an hour of its forecast is
        worked through here.
      </T>
    );
  const { place, time, hour, result } = picked;
  return (
    <>
      <LedgerTable
        title={`${place.name}, ${dayNames(dublinDate(time), now).short} ${clock(time)}`}
        reading={`${compass(hour.from)} ${hour.windKn.toFixed(1)} g${hour.gustKn === null ? "–" : hour.gustKn.toFixed(1)} kn`}
        ledger={result}
      />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${starsText(result.rating)} on ${place.name}'s page, for ${riderWords(rider)}`}
        onPress={() =>
          router.push({
            pathname: "/spot/[id]",
            params: { id: place.id, t: new Date(time).toISOString() },
          })
        }
        style={styles.exampleLink}
      >
        <Stars
          stars={result.rating.stars}
          potential={result.rating.potential}
          size={14}
        />
        <T variant="body" color="ink2" style={styles.underline}>
          on the spot page, for {riderWords(rider)}
        </T>
      </Pressable>
    </>
  );
}

function LedgerTable({
  title,
  reading,
  ledger: worked,
}: {
  title: string;
  reading: string;
  ledger: Ledger;
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tr}>
        <T variant="body" style={styles.tdFirst}>
          {title}
        </T>
        <T variant="figureSm" tabular style={styles.right}>
          {reading}
        </T>
      </View>
      {worked.lines.map((line) => (
        <View
          key={line.what}
          style={[styles.tr, line.total && styles.total]}
          accessible
          accessibilityLabel={`${line.what}: ${line.figure}`}
        >
          <T variant="body" style={styles.tdFirst}>
            {line.what}
          </T>
          <T variant="figureSm" tabular style={styles.right}>
            {line.figure}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: space.lg,
    paddingBottom: space["4xl"] * 2,
    gap: space.md,
  },
  deck: { fontFamily: fonts.bodyItalic, paddingTop: space.sm },
  key: { gap: space.sm, paddingVertical: space.sm },
  keyLine: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  keyMark: { width: space["4xl"] * 2 - space.lg, paddingTop: space["2xs"] },
  flex: { flex: 1 },
  section: { gap: space.sm, paddingTop: space.lg },
  italic: { fontFamily: fonts.bodyItalic },
  centre: { alignItems: "center" },
  table: { borderTopWidth: 1, borderTopColor: colors.ink },
  tr: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  th: { borderBottomColor: colors.ink, borderBottomWidth: 1 },
  tdFirst: { flex: 2 },
  td: { flex: 1 },
  right: { flex: 1, textAlign: "right" },
  you: { backgroundColor: withAlpha(colors.magenta, 0.07) },
  total: { borderTopWidth: 2, borderTopColor: colors.ink },
  note: { paddingTop: space.sm },
  exampleLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: hitTarget,
  },
  underline: { textDecorationLine: "underline" },
});
