/**
 * "How the stars work" (spot/web/StarsPage.tsx): the rating in figures, for
 * the rider the app is set to. The wind you can ride, what it is worth against
 * your band, the five ways the wind meets a beach and what each costs, the
 * rest that takes stars off, the wing, and one hour of the live forecast worked
 * through line by line (spot/web/ledger.ts, tested against the rating itself).
 */
import { Stack, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  SKILLS,
  rideableWind,
  starsText,
  windBand,
  windScore,
  type Rider,
  type Skill,
} from "../../../../force5/src/stars";
import { compass } from "../../../../force5/src/weather";
import type { Ledger } from "../../../../spot/web/ledger";
import { clock, dayNames, dublinDate } from "../../../../spot/web/spot";
import { Rule } from "../../components/Rule";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast } from "../../data/forecast";
import { spotById } from "../../data/spots";
import { colors, fonts, hitTarget, space, withAlpha } from "../../theme/tokens";
import { RiderLine, useRider } from "../settings/RiderFields";
import { SKILL_LABEL, riderWords } from "../settings/settingsLogic";
import { workedHour } from "./infoLogic";

export function StarsScreen() {
  const [rider] = useRider();
  const { width } = useWindowDimensions();
  const inner = width - space.lg * 2;
  return (
    <>
      <Stack.Screen
        options={{ title: "How the stars work", headerLargeTitleEnabled: true }}
      />
      <ScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <T variant="prose" color="ink2" style={styles.deck}>
          We rate every daylight hour out of five stars. The rating depends on
          your level and your weight, so set those first.
        </T>
        <RiderLine />
        <View style={styles.key}>
          <KeyLine mark={<Stars stars={3} potential={5} size={14} />}>
            Solid stars are the rating. Outlined stars are what the wind speed
            alone would have earned, before anything was taken off.
          </KeyLine>
          <KeyLine mark={<Stars stars={1} potential={2} size={14} />}>
            A dot is a star out of reach: not even the wind speed alone would
            have earned it.
          </KeyLine>
          <KeyLine
            mark={
              <T variant="label" caps color="muted">
                Dark
              </T>
            }
          >
            Hours in the dark are not rated: from sunset to sunrise they are
            folded away, and draw no stars.
          </KeyLine>
        </View>

        <Section n={1} title="Gusts help," soft="up to a point">
          <P>
            On a light day the gusts are what get you up on the foil, and once
            you are up you can glide through the lulls. So in light wind we
            count the wind as a little stronger than its average. The stronger
            the wind, the less we add, and once you are well powered we add
            nothing: there, gusts are just more power to hold.
          </P>
          <P>
            Learners get the smallest boost, because they still drop off the
            foil in the lulls. Advanced riders get the most.
          </P>
          {(
            [
              [9, 17],
              [14, 22],
              [20, 30],
            ] as const
          ).map(([w, g]) => (
            <T key={w} variant="prose" color="ink2">
              {w} knots gusting {g} is rated as{" "}
              <T variant="figureSm" tabular>
                {rideableWind(w, g, rider).toFixed(1)} knots
              </T>
            </T>
          ))}
        </Section>

        <Section n={2} title="How much wind" soft="suits you">
          <P>
            Each level has its own range. Below the minimum you cannot stay up
            on the foil for long. In the middle of the sweet spot the hour gets
            five stars. Past the maximum it is more than you will want to hold.
          </P>
          <ScoreChart rider={rider} width={inner} />
          <BandTable rider={rider} />
        </Section>

        <Section n={3} title="Wind" soft="direction">
          <P>
            What matters is the angle between the wind and the beach. Onshore
            wind blows straight in from the sea. Offshore wind blows straight
            out to sea, and that is the dangerous one: if you fall or break
            something, it carries you away from land.
          </P>
          <Sectors width={Math.min(380, inner)} />
          <ShoreTable rider={rider} />
          <P>
            Cross-offshore costs learners the most, because a learner drifts
            downwind and ends up further out. An advanced rider can get back
            upwind, so it costs them least. Straight offshore never gets more
            than one star, and none for a learner.
          </P>
        </Section>

        <Section n={4} title="What else" soft="takes stars off">
          <OtherTable rider={rider} />
          <T variant="body" color="muted" style={styles.italic}>
            Tap an hour&rsquo;s stars, in the dock or on a spot&rsquo;s page, to
            see what it lost, and why.
          </T>
        </Section>

        <Section n={5} title="Which" soft="wing">
          <P>
            We suggest a wing size for every hour. For an 80 kg rider that is
            about 5.5 m² at 15 knots, 4.5 m² at 20 knots and 3 m² at 30 knots.
            Learners get a size bigger, advanced riders a little smaller.
          </P>
          <P>
            If you have told us which wings you own, we pick the smallest one
            that is big enough. If none of them suits the wind, the hour loses a
            star.
          </P>
        </Section>

        <Section n={6} title="An" soft="example">
          <P>One hour from the live forecast, worked through step by step.</P>
          <WorkedExample rider={rider} />
        </Section>

        <T variant="caption" color="muted" style={styles.italic}>
          wingfoil.ie star rating, version 2.
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

function KeyLine({
  mark,
  children,
}: {
  mark: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.keyLine}>
      <View style={styles.keyMark}>{mark}</View>
      <T variant="body" color="ink2" style={styles.flex}>
        {children}
      </T>
    </View>
  );
}

function Section({
  n,
  title,
  soft,
  children,
}: {
  n: number;
  title: string;
  soft: string;
  children: React.ReactNode;
}) {
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

/** Stars on the wind alone, against the wind you can ride: tap along it to read a speed. */
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
    path += `${path ? "L" : "M"}${X(k).toFixed(1)} ${Y(windScore(k, band)).toFixed(1)}`;
  const quarter = (band.sweetHigh - band.sweetLow) / 4;
  const label = `Stars on the wind alone for ${riderWords(rider)}: none below ${Math.round(band.min - 2)} knots, five from ${Math.round(
    band.sweetLow + quarter,
  )} to ${Math.round(band.sweetHigh - quarter)}, two at ${Math.round(band.max)}, none past ${Math.round(band.max + 6)}.`;
  const mono = { fontFamily: fonts.monoMedium, fontSize: 10 };
  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) =>
        setHover(
          Math.round(
            ((e.nativeEvent.locationX - left) / (W - left - right)) * 40,
          ),
        )
      }
      onResponderMove={(e) => {
        const k = Math.round(
          ((e.nativeEvent.locationX - left) / (W - left - right)) * 40,
        );
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
          <Line
            key={n}
            x1={X(0)}
            x2={X(40)}
            y1={Y(n)}
            y2={Y(n)}
            stroke={withAlpha(colors.ink, 0.1)}
          />
        ))}
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <SvgText
            key={`t${n}`}
            x={X(0) - 6}
            y={Y(n) + 3}
            textAnchor="end"
            fill={colors.muted}
            {...mono}
          >
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
        <SvgText
          x={X(band.min) - 4}
          y={Y(5) - 5}
          textAnchor="end"
          fill={colors.magenta}
          {...mono}
        >
          {`min ${Math.round(band.min)}`}
        </SvgText>
        <SvgText
          x={X(band.max) + 4}
          y={Y(5) - 5}
          fill={colors.magenta}
          {...mono}
        >
          {`max ${Math.round(band.max)}`}
        </SvgText>
        {hover !== null && hover >= 0 && hover <= 40 && (
          <>
            <Line
              x1={X(hover)}
              x2={X(hover)}
              y1={Y(5)}
              y2={Y(0)}
              stroke={colors.muted}
            />
            <Circle
              cx={X(hover)}
              cy={Y(windScore(hover, band))}
              r={3}
              fill={colors.ink}
            />
            <SvgText
              x={X(hover) > W - 120 ? X(hover) - 6 : X(hover) + 6}
              y={Y(0) - 6}
              textAnchor={X(hover) > W - 120 ? "end" : "start"}
              fill={colors.ink}
              fontFamily={fonts.monoBold}
              fontSize={12}
            >
              {`${hover} kn → ${windScore(hover, band).toFixed(1)}★`}
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

function BandTable({ rider }: { rider: Rider }) {
  return (
    <>
      <Table
        head={["Level", "Min", "Sweet spot", "Max"]}
        rows={SKILLS.map((skill) => {
          const band = windBand({ ...rider, skill });
          return [
            SKILL_LABEL[skill] + (skill === rider.skill ? " · you" : ""),
            String(Math.round(band.min)),
            `${Math.round(band.sweetLow)}–${Math.round(band.sweetHigh)}`,
            String(Math.round(band.max)),
          ];
        })}
        you={{ row: SKILLS.indexOf(rider.skill) }}
      />
      <T variant="caption" color="muted">
        In knots, for someone who weighs {rider.weightKg ?? 80} kg. Heavier
        riders need more wind, lighter riders less.
      </T>
    </>
  );
}

const SECTORS = [
  {
    from: 0,
    to: 30,
    name: "onshore",
    words: "Onshore",
    away: false,
    tint: 0.55,
  },
  {
    from: 30,
    to: 70,
    name: "cross-on",
    words: "Cross-onshore",
    away: false,
    tint: 0.32,
  },
  {
    from: 70,
    to: 110,
    name: "cross",
    words: "Cross-shore",
    away: false,
    tint: 0.16,
  },
  {
    from: 110,
    to: 150,
    name: "cross-off",
    words: "Cross-offshore",
    away: true,
    tint: 0.22,
  },
  {
    from: 150,
    to: 180,
    name: "offshore",
    words: "Offshore",
    away: true,
    tint: 0.42,
  },
] as const;

const SHORE_COST: Record<
  (typeof SECTORS)[number]["name"],
  Record<Skill, string>
> = {
  onshore: { beginner: "−1", intermediate: "−1", advanced: "−1" },
  "cross-on": { beginner: "none", intermediate: "none", advanced: "none" },
  cross: { beginner: "−½", intermediate: "none", advanced: "none" },
  "cross-off": { beginner: "−3", intermediate: "−1½", advanced: "−1" },
  offshore: {
    beginner: "no stars",
    intermediate: "1 at most",
    advanced: "1 at most",
  },
};

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
  return (
    <Table
      head={["Wind", ...SKILLS.map((s) => SKILL_LABEL[s])]}
      rows={SECTORS.map((s) => [
        `${s.words} ${s.from}–${s.to}°`,
        ...SKILLS.map((k) => SHORE_COST[s.name][k]),
      ])}
      you={{ column: SKILLS.indexOf(rider.skill) + 1 }}
    />
  );
}

function OtherTable({ rider }: { rider: Rider }) {
  const learning = rider.skill === "beginner";
  return (
    <Table
      head={["If", "Riding or advanced", "Learning"]}
      rows={[
        ["Gusts stronger than your maximum", "−1", "−1"],
        [
          "Gusts 70% over the average, when you are already well powered",
          "−½",
          "none",
        ],
        [
          "Gusts 35%, 50% or 70% over the average, at any wind speed",
          "none",
          "−¾, −1½ or −2¼",
        ],
        ["The forecast models disagree", "−1", "−1"],
        ["The models differ a little", "−¼", "−¼"],
        ["None of your wings suits the wind", "−1", "−1"],
      ]}
      you={{ column: learning ? 2 : 1 }}
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
  exampleLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: hitTarget,
  },
  underline: { textDecorationLine: "underline" },
});
