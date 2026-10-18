/**
 * "Your star rating" (design-system/patterns/your-stars.html, and the site's
 * spot/web/YourStarsDialog.tsx): a rider sets their own stars. Start from a
 * level; drag the four wind handles and the gusts' two, and pick the most the
 * gusts take off; drag each direction's dot in and out on the beach, offshore
 * up over the sea and onshore down over the land; and see it all together,
 * and against the level, before saving.
 *
 * A modal of its own: each opening starts again from what is saved, so Cancel
 * (or the back button) keeps nothing. Everything is kept in knots, as the
 * rating is, and drawn in the rider's unit. The arithmetic is the site's
 * (spot/web/yourStars.ts, force5/src/stars.ts); the touch is yourStarsLogic.ts.
 *
 * Nothing here traps the page's scroll: a scale's handles move on a sideways
 * drag only, a dot only once a drag starts on it, and the grid reads a tap.
 */
import { Stack, router } from "expo-router";
import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import {
  SKILLS,
  SKILL_LABEL,
  gustLoss,
  standardRating,
  windScore,
  type CustomRating,
  type DirectionKey,
  type Rider,
  type Skill,
} from "../../../../force5/src/stars";
import {
  DIRECTION_KEYS,
  DIRECTION_NAME,
  DIRECTION_WORD,
  EXAMPLES,
  GRID_STEP,
  GUST_KEYS,
  GUST_TOP,
  SHADE,
  WEB_DIRS,
  WEB_R,
  WIND_KEYS,
  WIND_TOP,
  breakdown,
  gridStars,
  halfStars,
  moveGust,
  moveWind,
  offAt,
  onLevel,
  polar,
  rateExample,
  setDirection,
  shown,
  sliceAt,
  stepped,
  unitScale,
  webRadius,
  withRating,
  type UnitScale,
} from "../../../../spot/web/yourStars";
import { Button } from "../../components/Button";
import { done, tick } from "../../components/haptics";
import { Rule } from "../../components/Rule";
import { Segmented } from "../../components/Segmented";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, hitTarget, radius, space, windScale, withAlpha } from "../../theme/tokens";
import { StepButton } from "../settings/RiderFields";
import { GRID, dotAt, grabHandle, gridPick, knAtX } from "./yourStarsLogic";

/** A ref to the value as last rendered, for callbacks that run later. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Room right of a curve for its star figures. */
const AXIS_RIGHT = space["3xl"];
/** Half a touch target: a finger this close to a handle or a dot has it. */
const REACH = hitTarget / 2;

export function YourStarsScreen() {
  const { prefs, setCustomStars } = usePrefs();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const inner = width - space.lg * 2;
  const unit = useMemo(() => unitScale(prefs.units), [prefs.units]);
  // The rider as they were when the screen opened: Cancel keeps nothing.
  const [rider] = useState<Rider>(prefs.rider);
  const [draft, setDraft] = useState<CustomRating>(() => rider.custom ?? standardRating(rider));
  // The grid and the examples rate hundreds of hours: they follow a drag a
  // frame behind rather than holding it up.
  const later = useDeferredValue(draft);

  const level = standardRating(rider, draft.base);
  const baseName = SKILL_LABEL[draft.base];

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: "Your star rating" }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.block}>
          <T variant="eyebrow" caps color="muted" accessibilityRole="header">
            Start from
          </T>
          <Segmented<Skill>
            value={draft.base}
            accessibilityLabel="Start from"
            segments={SKILLS.map((skill) => ({ value: skill, label: SKILL_LABEL[skill] }))}
            onChange={(skill) => setDraft(standardRating(rider, skill))}
          />
        </View>

        <Block title="Wind speed: stars">
          <Curve kind="wind" yours={draft} level={level} unit={unit} width={inner} />
          <Legend name={baseName} />
          <Handles
            keys={WIND_KEYS}
            values={draft.wind}
            top={WIND_TOP}
            unit={unit}
            scale="wind"
            width={inner - AXIS_RIGHT}
            labels={{
              min: "Minimum wind speed",
              sweetLow: "Ideal wind speed from",
              sweetHigh: "Ideal wind speed to",
              max: "Maximum wind speed",
            }}
            spans={[
              ["min", "sweetLow", "edge"],
              ["sweetLow", "sweetHigh", "fill"],
              ["sweetHigh", "max", "edge"],
            ]}
            onMove={(key, kn) => setDraft((d) => moveWind(d, key, kn))}
          />
          <View style={styles.figs}>
            <Fig name="Minimum" kn={draft.wind.min} unit={unit} />
            <Fig name="Ideal from" kn={draft.wind.sweetLow} unit={unit} />
            <Fig name="Ideal to" kn={draft.wind.sweetHigh} unit={unit} />
            <Fig name="Maximum" kn={draft.wind.max} unit={unit} />
          </View>
        </Block>

        <Block title="Gusts: stars taken off">
          <Curve kind="gust" yours={draft} level={level} unit={unit} width={inner} />
          <Legend name={baseName} />
          <Handles
            keys={GUST_KEYS}
            values={draft.gust}
            top={GUST_TOP}
            unit={unit}
            scale="gust"
            width={inner - AXIS_RIGHT}
            labels={{
              fine: "Gusts have no effect up to",
              worst: "Gusts take off the most from",
            }}
            spans={[["fine", "worst", "fill"]]}
            onMove={(key, kn) => setDraft((d) => moveGust(d, key, kn))}
          />
          <View style={styles.figs}>
            <Fig name="No effect up to" kn={draft.gust.fine} unit={unit} />
            <Fig name="Most off from" kn={draft.gust.worst} unit={unit} />
          </View>
          <View style={styles.most}>
            <T variant="eyebrow" caps color="muted">
              Most off
            </T>
            <Segmented<string>
              value={String(draft.gust.most)}
              accessibilityLabel="The most the gusts take off"
              segments={[
                { value: "1", label: "1★", accessibilityLabel: "1 star" },
                { value: "2", label: "2★", accessibilityLabel: "2 stars" },
                { value: "3", label: "3★", accessibilityLabel: "3 stars" },
                { value: "5", label: "All", accessibilityLabel: "All stars" },
              ]}
              onChange={(most) => setDraft((d) => ({ ...d, gust: { ...d.gust, most: Number(most) } }))}
            />
          </View>
        </Block>

        <Block title="Wind direction: stars taken off">
          <DirectionWeb
            rating={draft}
            width={Math.min(inner, 384)}
            onChange={(key, off) => setDraft((d) => setDirection(d, key, off))}
          />
        </Block>

        <Block title="Together: wind speed, gusts and direction">
          <Together rider={withRating(rider, later)} unit={unit} width={inner} />
        </Block>

        <Block title="Examples">
          <Examples rider={rider} rating={later} unit={unit} />
        </Block>
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <Button label="Cancel" kind="pill" onPress={() => router.back()} />
        <Button
          label="Save"
          kind="primary"
          onPress={() => {
            done();
            setCustomStars(draft);
            router.back();
          }}
        />
      </View>
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Rule />
      <View style={styles.block}>
        <T variant="eyebrow" caps accessibilityRole="header">
          {title}
        </T>
        {children}
      </View>
    </>
  );
}

function Legend({ name }: { name: string }) {
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.legendItem}>
        <Svg width={20} height={4}>
          <Line x1={0} x2={20} y1={2} y2={2} stroke={colors.ink} strokeWidth={2} />
        </Svg>
        <T variant="label" caps color="muted">
          Yours
        </T>
      </View>
      <View style={styles.legendItem}>
        <Svg width={20} height={4}>
          <Line x1={0} x2={20} y1={2} y2={2} stroke={colors.lineStrong} strokeWidth={1.25} strokeDasharray="3 3" />
        </Svg>
        <T variant="label" caps color="muted">
          {name}
        </T>
      </View>
    </View>
  );
}

function Fig({ name, kn, unit }: { name: string; kn: number; unit: UnitScale }) {
  return (
    <View style={styles.fig} accessible accessibilityLabel={`${name}: ${shown(kn, unit)} ${unit.label}`}>
      <T variant="eyebrow" caps color="muted">
        {name}
      </T>
      <T variant="figure" tabular>
        {shown(kn, unit)}{" "}
        <T variant="label" color="muted">
          {unit.label}
        </T>
      </T>
    </View>
  );
}

const axisText = { fontFamily: fonts.mono, fontSize: 10, fill: colors.muted } as const;

/** An axis along the bottom in the rider's unit, every tick of it. */
function XAxis({ topKn, y, plot, unit }: { topKn: number; y: number; plot: number; unit: UnitScale }) {
  const top = topKn * unit.perKn;
  const labels = [];
  for (let v = 0; v <= top + 1e-6; v += unit.tick) {
    const x = (v / top) * plot;
    const end = x > plot - 20;
    labels.push(
      <SvgText key={v} {...axisText} x={end ? plot : x} y={y} textAnchor={v ? (end ? "end" : "middle") : "start"}>
        {`${v}${end ? ` ${unit.label}` : ""}`}
      </SvgText>,
    );
  }
  return <>{labels}</>;
}

const line = (top: number, X: (kn: number) => number, Y: (kn: number) => number) => {
  const points: string[] = [];
  for (let kn = 0; kn <= top; kn += 0.25) points.push(`${X(kn).toFixed(1)},${Y(kn).toFixed(1)}`);
  return points.join(" ");
};

/**
 * Stars for each wind speed, 0 to 40 kn, or stars taken off for each gust,
 * 0 to 50 kn, hanging from the top line: theirs solid, the level's dashed.
 */
const Curve = memo(function Curve({
  kind,
  yours,
  level,
  unit,
  width,
}: {
  kind: "wind" | "gust";
  yours: CustomRating;
  level: CustomRating;
  unit: UnitScale;
  width: number;
}) {
  const plot = width - AXIS_RIGHT;
  const top = kind === "wind" ? WIND_TOP : GUST_TOP;
  const X = (kn: number) => (kn / top) * plot;
  const Y = kind === "wind" ? (stars: number) => 74 - (stars / 5) * 64 : (stars: number) => 8 + (stars / 5) * 64;
  const of = (r: CustomRating) =>
    line(top, X, (kn) => Y(kind === "wind" ? windScore(kn, r.wind) : gustLoss(kn, r.gust)));
  const mine = of(yours);
  const rows = kind === "wind" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5];
  const floor = kind === "wind" ? 74 : Y(0);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        kind === "wind"
          ? "Stars for each wind speed, yours against the level you started from"
          : "Stars the gusts take off for each gust speed, yours against the level you started from"
      }
    >
      <Svg width={width} height={92}>
        {rows.map((n) => (
          <Line key={`l${n}`} x1={0} x2={plot} y1={Y(n)} y2={Y(n)} stroke={colors.line} strokeWidth={1} />
        ))}
        {rows.map((n) => (
          <SvgText key={`t${n}`} {...axisText} x={plot + 4} y={Y(n) + 3}>
            {kind === "wind" ? `${n}★` : n ? `−${n}★` : "0"}
          </SvgText>
        ))}
        <Polygon points={`0,${floor} ${mine} ${plot},${floor}`} fill={colors.sunken} />
        <Polyline points={of(level)} fill="none" stroke={colors.lineStrong} strokeWidth={1.25} strokeDasharray="3 3" />
        <Polyline points={mine} fill="none" stroke={colors.ink} strokeWidth={2} strokeLinejoin="round" />
        <XAxis topKn={top} y={90} plot={plot} unit={unit} />
      </Svg>
    </View>
  );
});

/**
 * A scale of handles, each a control of its own: a sideways drag anywhere
 * along it takes the nearest handle, a tap brings the nearest there, and a
 * screen reader's swipe up or down moves it a step of the rider's unit.
 */
function Handles<K extends string>({
  keys,
  values,
  top,
  unit,
  scale,
  width,
  labels,
  spans,
  onMove,
}: {
  keys: readonly K[];
  values: Record<K, number>;
  top: number;
  unit: UnitScale;
  scale: "wind" | "gust";
  width: number;
  labels: Record<K, string>;
  spans: [K, K, "fill" | "edge"][];
  onMove: (key: K, kn: number) => void;
}) {
  const perKn = width / top;
  // The gestures read the values as they are now, and keep the drag's own
  // state where a new render cannot reset it.
  const now = useLatest({ values, onMove });
  const [drag] = useState(() => ({ held: null as K | null, from: 0, last: null as number | null }));
  /* eslint-disable react-hooks/immutability --
     a gesture's callbacks run as the finger moves, never while rendering. */
  const gesture = useMemo(() => {
    const at = (x: number) => knAtX(x, width, top, unit);
    const move = (key: K, kn: number) => {
      if (kn !== drag.last) tick();
      drag.last = kn;
      now.current.onMove(key, kn);
    };
    // Sideways only: a drag that sets off up or down is the page's scroll.
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onBegin((e) => {
        drag.held = null;
        drag.from = e.x;
      })
      .onUpdate((e) => {
        const dx = e.x - drag.from;
        // The handle is taken once the finger has said which way it goes.
        if (!drag.held && dx) {
          drag.held = grabHandle(keys, now.current.values, at(drag.from), dx, (REACH * 0.75) / perKn);
          drag.last = now.current.values[drag.held];
        }
        if (drag.held) move(drag.held, at(e.x));
      })
      .onFinalize(() => {
        drag.held = null;
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((e, ok) => {
        if (!ok) return;
        const key = grabHandle(keys, now.current.values, at(e.x), 0, 0);
        drag.last = now.current.values[key];
        move(key, at(e.x));
      });
    return Gesture.Exclusive(pan, tap);
  }, [keys, width, top, unit, perKn, now, drag]);
  /* eslint-enable react-hooks/immutability */

  const stops = windScale.filter(([kn]) => kn % 5 === 0 && kn <= top);
  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.band, { width }]}>
        <Svg width={width} height={4} style={styles.scale}>
          <Defs>
            <LinearGradient id={`scale-${scale}`} x1="0" x2="1" y1="0" y2="0">
              {stops.map(([kn, color]) => (
                <Stop key={kn} offset={kn / top} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={width} height={4} fill={`url(#scale-${scale})`} />
        </Svg>
        {spans.map(([from, to, kind]) => (
          <View
            key={`${from}-${to}`}
            style={[
              styles.span,
              kind === "edge" && styles.edge,
              { left: values[from] * perKn, width: (values[to] - values[from]) * perKn },
            ]}
          />
        ))}
        {keys.map((k) => (
          <View
            key={k}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={labels[k]}
            accessibilityValue={{
              min: 0,
              max: Number((top * unit.perKn).toFixed(unit.dp)),
              now: Number(shown(values[k], unit)),
              text: `${shown(values[k], unit)} ${unit.label}`,
            }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) =>
              onMove(k, stepped(values[k], e.nativeEvent.actionName === "increment" ? 1 : -1, unit))
            }
            style={[styles.handle, { left: values[k] * perKn - REACH }]}
          >
            <View style={styles.thumb} />
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

/** Where a direction's slices run, either side of the beach. */
const arcs = (d: (typeof WEB_DIRS)[number]) =>
  d.from === 0
    ? [[-30, 30]]
    : d.to === 180
      ? [[150, 210]]
      : [
          [d.from, d.to],
          [-d.to, -d.from],
        ];
const f = (n: number) => n.toFixed(1);
const wedge = (a1: number, a2: number) => {
  const [x1, y1] = polar(a1, WEB_R);
  const [x2, y2] = polar(a2, WEB_R);
  return `M0,0 L${f(x1)},${f(y1)} A${WEB_R},${WEB_R} 0 0 1 ${f(x2)},${f(y2)}Z`;
};
/** The web's frame, in its own units: the rim, and room round it for the names. */
const WEB_BOX = { x: -180, y: -128, w: 360, h: 256 } as const;
const webText = { fontFamily: fonts.mono } as const;

/**
 * The beach from above, sea up and land down, and a dot for each way the wind
 * can blow, drawn where it blows to: on the rim it takes nothing off, at the
 * middle all five stars, in half stars. Drag a dot; tap a slice to bring its
 * dot to the top; the picked one has − and + under the web.
 */
function DirectionWeb({
  rating,
  width,
  onChange,
}: {
  rating: CustomRating;
  width: number;
  onChange: (key: DirectionKey, off: number) => void;
}) {
  const [picked, setPicked] = useState<DirectionKey>("crossOff");
  const off = rating.direction;
  const s = width / WEB_BOX.w;
  const height = WEB_BOX.h * s;
  const now = useLatest({ off, picked, onChange });
  const [drag] = useState(() => ({
    held: null as DirectionKey | null,
    start: [0, 0] as [number, number],
    last: null as number | null,
  }));

  /* eslint-disable react-hooks/immutability -- as Handles' */
  const gesture = useMemo(() => {
    const toWeb = (x: number, y: number): [number, number] => [x / s + WEB_BOX.x, y / s + WEB_BOX.y];
    // Claimed only once a drag starts on a dot: anywhere else, and anything
    // that is not yet a drag, is the page's to scroll.
    const pan = Gesture.Pan()
      .runOnJS(true)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        const touch = e.changedTouches[0];
        const [x, y] = toWeb(touch.x, touch.y);
        drag.held = dotAt(x, y, now.current.off, now.current.picked, REACH / s);
        if (!drag.held) return manager.fail();
        drag.start = [touch.x, touch.y];
        drag.last = now.current.off[drag.held];
        setPicked(drag.held);
      })
      .onTouchesMove((e, manager) => {
        const touch = e.changedTouches[0];
        if (drag.held && Math.hypot(touch.x - drag.start[0], touch.y - drag.start[1]) > 3) manager.activate();
      })
      .onTouchesUp((_e, manager) => manager.end())
      .onUpdate((e) => {
        if (!drag.held) return;
        const [x, y] = toWeb(e.x, e.y);
        const next = Math.round(offAt(x, y) * 2) / 2;
        if (next !== drag.last) {
          tick();
          drag.last = next;
          now.current.onChange(drag.held, next);
        }
      })
      .onFinalize(() => {
        drag.held = null;
      });
    // A tap on a dot or its slice brings that direction to the top, and changes nothing.
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((e, ok) => {
        if (!ok) return;
        const [x, y] = toWeb(e.x, e.y);
        const key = dotAt(x, y, now.current.off, now.current.picked, REACH / s) ?? sliceAt(x, y);
        if (key && key !== now.current.picked) {
          tick();
          setPicked(key);
        }
      });
    return Gesture.Simultaneous(pan, tap);
  }, [s, now, drag]);
  /* eslint-enable react-hooks/immutability */

  const ring = [0, 50, 90, 130, 180, -130, -90, -50].map((a) => {
    const d = WEB_DIRS.find((x) => x.at.includes(a))!;
    return polar(a, webRadius(off[d.key]));
  });
  const picks = WEB_DIRS.find((d) => d.key === picked)!;
  const step = (key: DirectionKey, by: number) => {
    tick();
    setPicked(key);
    onChange(key, off[key] + by);
  };

  return (
    <>
      <GestureDetector gesture={gesture}>
        <View style={[styles.web, { width, height }]}>
          <Svg
            width={width}
            height={height}
            viewBox={`${WEB_BOX.x} ${WEB_BOX.y} ${WEB_BOX.w} ${WEB_BOX.h}`}
            accessible={false}
          >
            <Path d={`M${-WEB_R},0 A${WEB_R},${WEB_R} 0 0 1 ${WEB_R},0Z`} fill={colors.depth} opacity={0.22} />
            <Path d={`M${WEB_R},0 A${WEB_R},${WEB_R} 0 0 1 ${-WEB_R},0Z`} fill={colors.land} opacity={0.7} />
            {WEB_DIRS.flatMap((d) =>
              arcs(d).map(([a1, a2]) => (
                <Path
                  key={`${d.key}${a1}`}
                  d={wedge(a1, a2)}
                  fill={d.key === picked ? withAlpha(colors.ink, 0.08) : "transparent"}
                />
              )),
            )}
            {[1, 2, 3, 4].map((n) => (
              <Circle key={n} r={webRadius(n)} fill="none" stroke={colors.ink} strokeOpacity={0.18} strokeWidth={0.5} />
            ))}
            {[30, 70, 110, 150].flatMap((a) =>
              [a, -a].map((aa) => {
                const [x, y] = polar(aa, WEB_R);
                return (
                  <Line key={aa} x1={0} y1={0} x2={f(x)} y2={f(y)} stroke={colors.ink} strokeOpacity={0.12} strokeWidth={0.5} />
                );
              }),
            )}
            {[1, 2, 3, 4].map((n) => {
              const [x, y] = polar(-30, webRadius(n));
              return (
                <SvgText key={n} {...webText} x={f(x - 2)} y={f(y - 2)} textAnchor="end" fontSize={7} fill={colors.muted}>
                  {`−${n}`}
                </SvgText>
              );
            })}
            <Circle r={WEB_R} fill="none" stroke={colors.ink} strokeWidth={1} />
            <Line x1={-WEB_R - 8} x2={WEB_R + 8} y1={0} y2={0} stroke={colors.ink} strokeWidth={2} />
            <SvgText {...webText} x={-WEB_R + 14} y={-8} fontSize={7.5} letterSpacing={0.6} fill={colors.muted}>
              SEA
            </SvgText>
            <SvgText {...webText} x={-WEB_R + 14} y={15} fontSize={7.5} letterSpacing={0.6} fill={colors.muted}>
              LAND
            </SvgText>
            <Polygon
              points={ring.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}
              fill={withAlpha(colors.ink, 0.07)}
              stroke={colors.ink}
              strokeWidth={1.25}
              strokeLinejoin="round"
            />
            {/* Names round the outside: once, on the right, for the four that come from either side. */}
            {WEB_DIRS.map((d) => {
              const a = d.at[0];
              const [x, y] = polar(a, WEB_R + 12);
              const name = DIRECTION_NAME[d.key].toUpperCase();
              const ends = a === 0 || a === 180;
              return (
                <SvgText
                  key={d.key}
                  {...webText}
                  x={ends ? 0 : f(x)}
                  y={f(a === 0 ? y - 2 : a === 180 ? y + 9 : a === 90 ? y - 5 : y + 3)}
                  textAnchor={ends ? "middle" : "start"}
                  fontSize={8}
                  letterSpacing={0.5}
                  fill={colors.ink2}
                >
                  {name}
                </SvgText>
              );
            })}
            {WEB_DIRS.flatMap((d) =>
              d.at.map((a) => {
                const [x, y] = polar(a, webRadius(off[d.key]));
                const on = d.key === picked;
                return (
                  <Circle
                    key={`${d.key}${a}`}
                    cx={f(x)}
                    cy={f(y)}
                    r={on ? 5.5 : 4.5}
                    fill={on ? colors.ink : colors.paper}
                    stroke={colors.ink}
                    strokeWidth={1.5}
                  />
                );
              }),
            )}
            {picks.at.map((a) => {
              const [x, y] = polar(a, webRadius(off[picked]));
              return <Circle key={`top${a}`} cx={f(x)} cy={f(y)} r={5.5} fill={colors.ink} stroke={colors.ink} strokeWidth={1.5} />;
            })}
          </Svg>
          {/* Each direction once to a screen reader, where its dot is: swipe up for half a star less off. */}
          {WEB_DIRS.map((d) => {
            const [x, y] = polar(d.at[0], webRadius(off[d.key]));
            return (
              <View
                key={d.key}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`${DIRECTION_NAME[d.key]}: stars taken off`}
                accessibilityValue={{ text: `${halfStars(off[d.key])} stars` }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(e) => step(d.key, e.nativeEvent.actionName === "increment" ? -0.5 : 0.5)}
                onAccessibilityTap={() => setPicked(d.key)}
                style={[styles.dot, { left: (x - WEB_BOX.x) * s - REACH, top: (y - WEB_BOX.y) * s - REACH }]}
              />
            );
          })}
        </View>
      </GestureDetector>
      <View style={styles.picked}>
        <T variant="label" caps>
          {DIRECTION_NAME[picked]}
        </T>
        <StepButton
          label="−"
          a11y={`${DIRECTION_NAME[picked]}: take off half a star more`}
          disabled={off[picked] >= 5}
          onPress={() => step(picked, 0.5)}
        />
        <T
          variant="figure"
          tabular
          align="center"
          style={styles.pickedValue}
          accessibilityLabel={`${DIRECTION_NAME[picked]}: ${halfStars(off[picked])} stars`}
        >
          {halfStars(off[picked])}★
        </T>
        <StepButton
          label="+"
          a11y={`${DIRECTION_NAME[picked]}: take off half a star less`}
          disabled={off[picked] <= 0}
          onPress={() => step(picked, -0.5)}
        />
      </View>
    </>
  );
}

/** The squares of one shade as a path: hundreds of squares, drawn as a few paths. */
function squares(cells: (number | null)[][], X: (kn: number) => number, Y: (kn: number) => number) {
  const paths = new Map<number | null, string>();
  cells.forEach((column, i) =>
    column.forEach((stars, j) => {
      const x = X(i * GRID_STEP);
      const y = Y((j + 1) * GRID_STEP);
      const w = X((i + 1) * GRID_STEP) - x + (stars === null ? 0 : 0.3);
      const h = Y(j * GRID_STEP) - y + (stars === null ? 0 : 0.3);
      paths.set(stars, `${paths.get(stars) ?? ""}M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`);
    }),
  );
  return paths;
}

/** Every wind and gust for one direction, shaded by the stars, with a readout of the square tapped. */
const Together = memo(function Together({ rider, unit, width }: { rider: Rider; unit: UnitScale; width: number }) {
  const [dir, setDir] = useState<DirectionKey>("crossOn");
  const [pick, setPick] = useState<[number, number]>([18, 27]);
  const cells = useMemo(() => gridStars(rider, dir), [rider, dir]);
  const { left, width: w, height: h } = GRID;
  const X = (kn: number) => left + (kn / WIND_TOP) * w;
  const Y = (kn: number) => h - (kn / GUST_TOP) * h;
  const paths = useMemo(() => squares(cells, X, Y), [cells]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pw, pg] = pick;
  const { rating, wind, gusts, direction } = breakdown(rider, pw, pg, dir);
  const topW = WIND_TOP * unit.perKn;
  const topG = GUST_TOP * unit.perKn;
  const s = width / 400;
  const height = 278 * s;

  const gesture = useMemo(() => {
    const at = (x: number, y: number) => setPick(gridPick(x / s, y / s - 18));
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((e, ok) => ok && at(e.x, e.y));
    // Held a moment, a finger can run over the squares; a drag straight
    // away is the page's scroll.
    const scrub = Gesture.Pan()
      .runOnJS(true)
      .activateAfterLongPress(250)
      .onStart((e) => at(e.x, e.y))
      .onUpdate((e) => at(e.x, e.y));
    return Gesture.Simultaneous(tap, scrub);
  }, [s]);

  const sx = left + ((Math.floor(pw / GRID_STEP) * GRID_STEP) / WIND_TOP) * w;
  const sy = h - (((Math.floor(pg / GRID_STEP) + 1) * GRID_STEP) / GUST_TOP) * h;
  const why = [
    gusts ? `, gusts −${Number(gusts.toFixed(1))}` : "",
    direction ? `, direction ${halfStars(direction)}` : "",
  ].join("");
  const axes = [];
  for (let v = 0; v <= topW + 1e-6; v += unit.tick)
    axes.push(
      <SvgText key={`w${v}`} {...axisText} x={left + (v / topW) * w} y={h + 14} textAnchor="middle">
        {String(v)}
      </SvgText>,
    );
  for (let v = unit.tick; v <= topG + 1e-6; v += unit.tick)
    axes.push(
      <SvgText key={`g${v}`} {...axisText} x={left - 4} y={h - (v / topG) * h + 3} textAnchor="end">
        {String(v)}
      </SvgText>,
    );

  return (
    <>
      <T variant="body">For wind that is</T>
      <View style={styles.dirs} accessibilityRole="radiogroup" accessibilityLabel="Show the stars for wind that is">
        {DIRECTION_KEYS.map((key) => {
          const on = key === dir;
          return (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={DIRECTION_NAME[key]}
              hitSlop={space.xs}
              onPress={() => {
                if (on) return;
                tick();
                setDir(key);
              }}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && styles.chipPressed]}
            >
              <T variant="label" caps color={on ? "inkInverse" : "ink2"}>
                {DIRECTION_NAME[key].toLowerCase()}
              </T>
            </Pressable>
          );
        })}
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel="Stars for every wind speed and gust: darker is more stars"
        >
          <Svg width={width} height={height} viewBox="0 -18 400 278">
            {[...paths].map(([stars, d]) => (
              <Path
                key={String(stars)}
                d={d}
                fill={stars === null ? colors.sunken : colors.ink}
                opacity={stars === null ? 1 : SHADE[stars]}
              />
            ))}
            {axes}
            <SvgText {...axisText} x={left + w} y={h + 28} textAnchor="end">
              {`wind speed, ${unit.label} →`}
            </SvgText>
            <SvgText {...axisText} x={0} y={-8} textAnchor="start">
              {`gusts, ${unit.label} ↑`}
            </SvgText>
            <Rect
              x={sx}
              y={sy}
              width={(GRID_STEP / WIND_TOP) * w}
              height={(GRID_STEP / GUST_TOP) * h}
              fill="none"
              stroke={colors.magenta}
              strokeWidth={2}
            />
          </Svg>
        </View>
      </GestureDetector>
      <View style={styles.key} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <T variant="label" caps color="muted">
          Blank: no stars ·
        </T>
        <T variant="label" color="muted">
          1★
        </T>
        {SHADE.slice(1).map((o) => (
          <View key={o} style={[styles.swatch, { opacity: o }]} />
        ))}
        <T variant="label" color="muted">
          5★
        </T>
      </View>
      <View style={styles.readout} accessible accessibilityLiveRegion="polite">
        <T variant="figureSm" tabular>
          {shown(pw, unit)} gusting {shown(pg, unit)} {unit.label}
        </T>
        <Stars stars={rating.stars} potential={rating.potential} size={12} />
        <T variant="caption" color="muted" style={styles.why}>
          wind {Number(wind.toFixed(1))}★{why}
        </T>
      </View>
    </>
  );
});

/** The examples' hours, on the level the rating started from and on the rating. */
const Examples = memo(function Examples({
  rider,
  rating,
  unit,
}: {
  rider: Rider;
  rating: CustomRating;
  unit: UnitScale;
}) {
  const yours = withRating(rider, rating);
  const theirs = onLevel(rider, rating);
  const baseName = SKILL_LABEL[rating.base];
  return (
    <View>
      <View style={[styles.tr, styles.th]}>
        <T variant="eyebrow" caps color="muted" style={styles.forecast}>
          Forecast, {unit.label}
        </T>
        <T variant="eyebrow" caps color="muted" style={styles.starsCell}>
          {baseName}
        </T>
        <T variant="eyebrow" caps color="muted" style={styles.starsCell}>
          Yours
        </T>
      </View>
      {EXAMPLES.map(([wind, gust, dir]) => {
        const o = rateExample(theirs, wind, gust, dir);
        const y = rateExample(yours, wind, gust, dir);
        const text = `${shown(wind, unit)} gusting ${shown(gust, unit)}${dir === "crossOn" ? "" : `, ${DIRECTION_WORD[dir]}`}`;
        return (
          <View
            key={`${wind}-${gust}-${dir}`}
            style={styles.tr}
            accessible
            accessibilityLabel={`${text} ${unit.label}: ${baseName} ${o.stars} stars, yours ${y.stars}`}
          >
            <T variant="figureSm" tabular style={[styles.forecast, o.stars !== y.stars && styles.moved]}>
              {text}
            </T>
            <View style={styles.starsCell}>
              <Stars stars={o.stars} potential={o.potential} size={12} />
            </View>
            <View style={styles.starsCell}>
              <Stars stars={y.stars} potential={y.potential} size={12} />
            </View>
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.lg, paddingBottom: space["2xl"] },
  block: { gap: space.sm, paddingVertical: space.lg },
  legend: { flexDirection: "row", gap: space.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
  figs: { flexDirection: "row", flexWrap: "wrap", rowGap: space.sm },
  fig: { width: "50%", gap: space["2xs"] },
  most: { gap: space.xs },
  band: { height: hitTarget, justifyContent: "center" },
  scale: { position: "absolute", left: 0, opacity: 0.35 },
  span: { position: "absolute", height: 4, backgroundColor: colors.ink },
  edge: { opacity: 0.35 },
  handle: {
    position: "absolute",
    top: 0,
    width: hitTarget,
    height: hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    width: 11,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
  },
  web: { alignSelf: "center" },
  dot: { position: "absolute", width: hitTarget, height: hitTarget },
  picked: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md },
  pickedValue: { minWidth: space["4xl"] + space.md },
  dirs: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: hitTarget - space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipPressed: { backgroundColor: colors.sunken },
  key: { flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  swatch: { width: space.lg, height: space.md, backgroundColor: colors.ink },
  readout: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, minHeight: hitTarget },
  why: { fontFamily: fonts.bodyItalic },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs + space["2xs"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  th: { borderBottomWidth: 1, borderBottomColor: colors.ink },
  forecast: { flex: 1 },
  starsCell: { width: space["4xl"] * 2 - space.md },
  moved: { fontFamily: fonts.monoBold },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    backgroundColor: colors.paper,
  },
});
