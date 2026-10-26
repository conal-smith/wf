/**
 * "Your stars": the app's Customise, the web wizard's steps 2–4
 * (src/Customise.tsx, as approved in the mock-up of 25 October 2026). The
 * rider's weight and units, the wizard's first step, are in Settings.
 *
 *   What wind suits you?   four handles on one axis (too light, the sweet
 *                          spot's two ends, too much in gusts) with the stars
 *                          they make by steady wind right under the track,
 *                          read-only, and the knots once;
 *   Configure stars based  the shore web: a dot in for a star off, in whole
 *   on wind direction      stars; offshore locked at never;
 *   Can you ride upwind?   Not yet / A little / Yes across the top, the
 *                          picture (CAN'T GO, RIDE, DRIFT) and two angles:
 *                          into the wind, and below across.
 *
 * A modal of its own, Cancel in its head: each opening starts again from
 * what is saved (the rider's own, else ours), so Cancel keeps nothing; Back
 * and Next walk the steps, and Save, on the last, keeps them. "Reset to ours" shows
 * once anything differs from ours. Save keeps a rating and an angle only
 * while it is not ours (yourStarsLogic.ts `withYourStars`). Everything is
 * kept in knots, as the rating is, and drawn in the rider's unit. The
 * arithmetic is the site's (spot/web/yourStars.ts, force5/src/stars.ts); the
 * touch and the words are yourStarsLogic.ts.
 *
 * Nothing here traps the page's scroll: the scales move on a sideways drag
 * only, and a dot or a handle on a picture only once a drag starts on it.
 */
import { Stack, router } from "expo-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Pattern, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { NEVER, type CustomRating, type DirectionKey } from "../../../../force5/src/stars";
import {
  DIRECTION_NAME,
  WEB_DIRS,
  WEB_R,
  WIND_KEYS,
  WIND_TOP,
  costLabel,
  forceTicks,
  moveWind,
  moveWindForce,
  offAt,
  polar,
  said,
  setDirection,
  shoreLocked,
  shown,
  starRuns,
  stepped,
  unitScale,
  webRadius,
  type UnitScale,
  type WindKey,
} from "../../../../spot/web/yourStars";
import { Button } from "../../components/Button";
import { done, tick } from "../../components/haptics";
import { Segmented } from "../../components/Segmented";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, hitTarget, radius, space, starColors, withAlpha } from "../../theme/tokens";
import { STAR } from "./StarRating";
import {
  DIRECTION_LINE,
  DIRECTION_SHORT,
  DOWNWIND_MAX,
  SCALE_TO,
  SHORE_ORDER,
  STEPS,
  UP,
  UPWIND_MAX,
  UP_ANSWERS,
  answerOf,
  degAtX,
  differsFromOurs,
  dotAt,
  edgeAngle,
  edgeAt,
  grabHandle,
  knAtX,
  offWind,
  oursStars,
  stripWords,
  upPoint,
  windLabels,
  yourStarsOf,
  type YourStars,
} from "./yourStarsLogic";

/** A ref to the value as last rendered, for callbacks that run later. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Half a touch target: a finger this close to a handle or a dot has it. */
const REACH = hitTarget / 2;

export function YourStarsScreen() {
  const { prefs, setYourStars } = usePrefs();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const inner = width - space.lg * 2;
  const unit = useMemo(() => unitScale(prefs.units), [prefs.units]);
  // What was saved when the screen opened: Cancel keeps nothing.
  const [draft, setDraft] = useState<YourStars>(() => yourStarsOf(prefs.rider, prefs.units));
  const [step, setStep] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const st = STEPS[step];
  const last = step === STEPS.length - 1;
  const go = (to: number) => {
    setStep(to);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const setRating = (change: (rating: CustomRating) => CustomRating) =>
    setDraft((d) => ({ ...d, rating: change(d.rating) }));

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: "Your stars",
          headerLeft: () => <Button label="Cancel" kind="quiet" size="sm" onPress={() => router.back()} />,
        }}
      />
      <ScrollView
        ref={scroll}
        style={styles.root}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.head}>
          <T variant="lead" accessibilityRole="header" style={styles.flex}>
            {st.title}
          </T>
          <T variant="eyebrow" color="muted" accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
            {step + 1} / {STEPS.length}
          </T>
        </View>
        <View style={styles.progress} accessible={false}>
          {STEPS.map((s, i) => (
            <View key={s.id} style={[styles.bar, i <= step && styles.barDone]} />
          ))}
        </View>
        <T variant="body" color="ink2" style={styles.sub}>
          {st.sub}
        </T>
        {st.id === "wind" ? (
          <WindStep
            rating={draft.rating}
            unit={unit}
            width={inner}
            onMove={(key, kn) => setRating((r) => (unit.force ? moveWindForce : moveWind)(r, key, kn))}
          />
        ) : st.id === "shore" ? (
          <ShoreStep
            rating={draft.rating}
            width={inner}
            onChange={(key, off) => setRating((r) => setDirection(r, key, off))}
          />
        ) : (
          <UpwindStep
            yours={draft}
            width={inner}
            onChange={(change) => setDraft((d) => ({ ...d, ...change }))}
          />
        )}
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
        {differsFromOurs(draft, prefs.units) ? (
          <Button
            label="Reset to ours"
            kind="quiet"
            size="sm"
            style={styles.reset}
            onPress={() => setDraft(oursStars(prefs.units))}
          />
        ) : null}
        {step ? <Button label="Back" kind="pill" onPress={() => go(step - 1)} /> : null}
        <Button
          label={last ? "Save" : "Next"}
          kind="primary"
          onPress={() => {
            if (!last) return go(step + 1);
            done();
            setYourStars(draft);
            router.back();
          }}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ the wind */

const mono = { fontFamily: fonts.monoMedium } as const;
/** IBM Plex Mono sets every character 0.6 em wide: a label's width without measuring it. */
const textWidth = (text: string, size: number, spacing: number) => text.length * (size * 0.6 + spacing);

/** The slider's frame, in points: room left of the axis for the strip's star, and the rows from the top. */
const RANGE = { left: 18, right: 8, height: 96, track: 34, trackH: 16, strip: 56, stripH: 13, ticks: 76 } as const;
const LABEL = { size: 10, spacing: 1 } as const;
const NAMES = { light: "TOO LIGHT", sweet: "SWEET SPOT", much: "TOO MUCH, IN GUSTS", none: "no stars past here" };
const HANDLE_NAMES: Record<WindKey, string> = {
  min: "Too light below",
  sweetLow: "Sweet spot from",
  sweetHigh: "Sweet spot to",
  max: "Too much, in gusts",
};

/** The axis's ticks in the rider's unit: every tick of it, or every other force. */
function ticksOf(unit: UnitScale): { kn: number; label: string }[] {
  if (unit.force)
    return forceTicks(1, SCALE_TO).map((t) => ({ kn: t.kn, label: t.force % 2 ? "" : `F${t.force}` }));
  const out = [];
  const top = SCALE_TO * unit.perKn;
  for (let v = unit.tick; v <= top + 1e-6; v += unit.tick) out.push({ kn: v / unit.perKn, label: String(v) });
  return out;
}

/**
 * "What wind suits you?": the track and its four handles, the stars they make
 * by steady wind right under it, and the knots once. A sideways drag anywhere
 * along it takes the nearest handle, a tap brings the nearest there, and a
 * screen reader's swipe up or down moves one a step of the rider's unit.
 */
function WindStep({
  rating,
  unit,
  width,
  onMove,
}: {
  rating: CustomRating;
  unit: UnitScale;
  width: number;
  onMove: (key: WindKey, kn: number) => void;
}) {
  const w = rating.wind;
  const W = width - RANGE.left - RANGE.right;
  const perKn = W / SCALE_TO;
  const X = (kn: number) => RANGE.left + Math.min(kn, SCALE_TO) * perKn;
  const now = useLatest({ values: w, onMove });
  const [drag] = useState(() => ({ held: null as WindKey | null, from: 0, last: null as number | null }));
  /* eslint-disable react-hooks/immutability --
     a gesture's callbacks run as the finger moves, never while rendering. */
  const gesture = useMemo(() => {
    const at = (x: number) => knAtX(x - RANGE.left, W, SCALE_TO, unit);
    const move = (key: WindKey, kn: number) => {
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
          drag.held = grabHandle(WIND_KEYS, now.current.values, at(drag.from), dx, (REACH * 0.75) / perKn);
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
        const key = grabHandle(WIND_KEYS, now.current.values, at(e.x), 0, 0);
        drag.last = now.current.values[key];
        move(key, at(e.x));
      });
    return Gesture.Exclusive(pan, tap);
  }, [W, unit, perKn, now, drag]);
  /* eslint-enable react-hooks/immutability */

  const runs = useMemo(() => starRuns(w, SCALE_TO), [w]);
  const label = (text: string) => textWidth(text, LABEL.size, LABEL.spacing);
  const noneSize = textWidth(NAMES.none, 9, 0.5);
  const at = windLabels(width, X(w.min), X(w.max), {
    light: label(NAMES.light),
    much: label(NAMES.much),
    none: noneSize,
  });
  const ticks = ticksOf(unit);
  const { track, trackH, strip, stripH } = RANGE;
  const ink = (n: number) => (n <= 2 ? colors.ink : colors.inkInverse);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.range, { width }]}>
        <Svg width={width} height={RANGE.height} accessible={false}>
          <Defs>
            <ClipPath id="track">
              <Rect x={RANGE.left} y={track} width={W} height={trackH} rx={trackH / 2} />
            </ClipPath>
            <Pattern id="over" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Line x1={0} y1={0} x2={0} y2={5} stroke={colors.pen} strokeWidth={1.5} />
            </Pattern>
          </Defs>
          <SvgText {...mono} x={at.light} y={14} fontSize={LABEL.size} letterSpacing={LABEL.spacing} fill={colors.muted}>
            {NAMES.light}
          </SvgText>
          <SvgText
            {...mono}
            x={(X(w.sweetLow) + X(w.sweetHigh)) / 2}
            y={14}
            textAnchor="middle"
            fontSize={LABEL.size}
            letterSpacing={LABEL.spacing}
            fill={colors.muted}
          >
            {NAMES.sweet}
          </SvgText>
          <SvgText {...mono} x={at.much} y={14} fontSize={LABEL.size} letterSpacing={LABEL.spacing} fill={colors.penInk}>
            {NAMES.much}
          </SvgText>
          <G clipPath="url(#track)">
            <Rect x={RANGE.left} y={track} width={W} height={trackH} fill={colors.paper} />
            <Rect x={X(w.min)} y={track} width={X(w.sweetLow) - X(w.min)} height={trackH} fill={withAlpha(colors.ink, 0.2)} />
            <Rect x={X(w.sweetLow)} y={track} width={X(w.sweetHigh) - X(w.sweetLow)} height={trackH} fill={colors.ink} />
            <Rect x={X(w.sweetHigh)} y={track} width={X(w.max) - X(w.sweetHigh)} height={trackH} fill={withAlpha(colors.ink, 0.2)} />
            <Rect x={X(w.max)} y={track} width={RANGE.left + W - X(w.max)} height={trackH} fill="url(#over)" />
          </G>
          <Rect x={RANGE.left} y={track} width={W} height={trackH} rx={trackH / 2} fill="none" stroke={colors.ink} />
          {/* The stars the handles make, by steady wind: read-only, right under the track. */}
          <Path
            d={STAR}
            transform={`translate(${RANGE.left - 8.5} ${strip + stripH / 2}) scale(1.1)`}
            fill={starColors[5]}
            stroke={colors.ink}
            strokeOpacity={0.55}
            strokeWidth={0.8}
          />
          {runs
            .filter((r) => r.stars)
            .map((r) => {
              const x = X(Math.max(0, r.from - 0.5));
              const x2 = X(Math.min(SCALE_TO, r.to + 0.5));
              return (
                <G key={r.from}>
                  <Rect x={x} y={strip} width={x2 - x} height={stripH} fill={starColors[r.stars]} />
                  {x2 - x >= 10 ? (
                    <SvgText
                      fontFamily={fonts.monoBold}
                      x={(x + x2) / 2}
                      y={strip + 9.5}
                      textAnchor="middle"
                      fontSize={9}
                      fill={ink(r.stars)}
                    >
                      {String(r.stars)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          <SvgText {...mono} x={at.none} y={strip + 9.5} fontSize={9} letterSpacing={0.5} fill={colors.penInk}>
            {NAMES.none}
          </SvgText>
          {ticks.map((t, i) => {
            const x = X(t.kn);
            const end = i === ticks.length - 1;
            return (
              <G key={t.kn}>
                <Line x1={x} x2={x} y1={RANGE.ticks - 6} y2={RANGE.ticks - 2} stroke={colors.ink} />
                {t.label ? (
                  <SvgText
                    {...mono}
                    x={end ? Math.min(x + 6, width) : x}
                    y={RANGE.ticks + 10}
                    textAnchor={end ? "end" : "middle"}
                    fontSize={10}
                    fill={colors.muted}
                  >
                    {end && !unit.force ? `${t.label} ${unit.label}` : t.label}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
        <View
          style={[styles.strip, { left: RANGE.left, top: strip, width: W }]}
          accessible
          accessibilityLabel={stripWords(runs, unit)}
          pointerEvents="none"
        />
        {WIND_KEYS.map((k, i) => (
          <View
            key={k}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={HANDLE_NAMES[k]}
            accessibilityValue={{
              min: 0,
              max: Number((WIND_TOP * unit.perKn).toFixed(unit.dp)),
              now: Number(shown(w[k], unit)),
              text: said(w[k], unit),
            }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) =>
              onMove(k, stepped(w[k], e.nativeEvent.actionName === "increment" ? 1 : -1, unit))
            }
            style={[styles.handle, { left: X(w[k]) - REACH, top: track + trackH / 2 - REACH }]}
          >
            <View style={[styles.knob, i === 3 && styles.knobTop]}>
              <T variant="label" tabular color={i === 3 ? "penInk" : "ink"} style={styles.knobText}>
                {shown(w[k], unit)}
              </T>
            </View>
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

/* ----------------------------------------------------------- the shore */

/** The web's frame, in its own units: the sea above the beach, the land below. */
const WEB_BOX = { x: -158, y: -140, w: 316, h: 284 } as const;
const f1 = (n: number) => n.toFixed(1);
/** Every dot's place round the web, both sides for the four that come from either. */
const SPOKES = WEB_DIRS.flatMap((d) => d.at.map((a) => ({ key: d.key, a })));
const RING = [...SPOKES].sort((p, q) => ((p.a + 360) % 360) - ((q.a + 360) % 360));
/** The way the wind blows, an arrowhead past the rim. */
const arrow = (a: number) => {
  const [tx, ty] = polar(a, WEB_R + 1);
  const [hx, hy] = polar(a, WEB_R + 12);
  const [lx, ly] = polar(a - 3.5, WEB_R + 7);
  const [rx, ry] = polar(a + 3.5, WEB_R + 7);
  return `M${f1(tx)} ${f1(ty)}L${f1(hx)} ${f1(hy)}M${f1(lx)} ${f1(ly)}L${f1(hx)} ${f1(hy)}L${f1(rx)} ${f1(ry)}`;
};

/**
 * "Configure stars based on wind direction": the beach from above, sea up and
 * land down, a dot for each way the wind blows, drawn where it blows to: on
 * the rim it takes nothing off, at the middle all five stars, in whole stars.
 * Offshore is locked at never. Beside it (under it, on a phone), each way of
 * wind and what it costs.
 */
function ShoreStep({
  rating,
  width,
  onChange,
}: {
  rating: CustomRating;
  width: number;
  onChange: (key: DirectionKey, off: number) => void;
}) {
  const off = rating.direction;
  const webWidth = Math.min(width, 340);
  const s = webWidth / WEB_BOX.w;
  const height = WEB_BOX.h * s;
  const now = useLatest({ off, onChange });
  const [drag] = useState(() => ({
    held: null as DirectionKey | null,
    start: [0, 0] as [number, number],
    last: null as number | null,
  }));

  /* eslint-disable react-hooks/immutability -- as WindStep's */
  const gesture = useMemo(() => {
    const toWeb = (x: number, y: number): [number, number] => [x / s + WEB_BOX.x, y / s + WEB_BOX.y];
    // Claimed only once a drag starts on a dot: anywhere else, and anything
    // that is not yet a drag, is the page's to scroll.
    return Gesture.Pan()
      .runOnJS(true)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        const touch = e.changedTouches[0];
        const [x, y] = toWeb(touch.x, touch.y);
        drag.held = dotAt(x, y, now.current.off, REACH / s);
        if (!drag.held) return manager.fail();
        drag.start = [touch.x, touch.y];
        drag.last = now.current.off[drag.held];
      })
      .onTouchesMove((e, manager) => {
        const touch = e.changedTouches[0];
        if (drag.held && Math.hypot(touch.x - drag.start[0], touch.y - drag.start[1]) > 3) manager.activate();
      })
      .onTouchesUp((_e, manager) => manager.end())
      .onUpdate((e) => {
        if (!drag.held) return;
        const [x, y] = toWeb(e.x, e.y);
        const next = Math.round(offAt(x, y));
        if (next !== drag.last) {
          tick();
          drag.last = next;
          now.current.onChange(drag.held, next);
        }
      })
      .onFinalize(() => {
        drag.held = null;
      });
  }, [s, now, drag]);
  /* eslint-enable react-hooks/immutability */

  const R = WEB_R;
  return (
    <View style={styles.shore}>
      <GestureDetector gesture={gesture}>
        <View style={[styles.web, { width: webWidth, height }]}>
          <Svg width={webWidth} height={height} viewBox={`${WEB_BOX.x} ${WEB_BOX.y} ${WEB_BOX.w} ${WEB_BOX.h}`} accessible={false}>
            <Rect x={-158} y={-140} width={316} height={140} fill={colors.sea} />
            <Rect x={-158} y={0} width={316} height={144} fill={colors.land} />
            <Line x1={-158} x2={158} y1={0} y2={0} stroke={colors.ink} strokeWidth={1.5} />
            <SvgText {...mono} x={-150} y={-128} fontSize={9} letterSpacing={1.3} fill={colors.muted}>
              SEA
            </SvgText>
            <SvgText {...mono} x={-150} y={138} fontSize={9} letterSpacing={1.3} fill={colors.muted}>
              LAND
            </SvgText>
            <Circle r={R} fill={colors.paper} fillOpacity={0.55} stroke={colors.ink} />
            {[1, 2, 3, 4].map((n) => (
              <Circle key={n} r={webRadius(n)} fill="none" stroke={withAlpha(colors.ink, 0.13)} />
            ))}
            <SvgText {...mono} x={4} y={-R + 10} fontSize={7} fill={colors.muted}>
              0★
            </SvgText>
            <SvgText {...mono} x={4} y={f1(-webRadius(2) + 9)} fontSize={7} fill={colors.muted}>
              −2★
            </SvgText>
            {SPOKES.map(({ key, a }) => {
              const [x, y] = polar(a, R);
              const danger = key === "offshore" || key === "crossOff";
              const side = Math.abs(a) === 90;
              const [lx, ly] = polar(a, side ? R + 4 : R + 19);
              return (
                <G key={`${key}${a}`}>
                  <Line x1={0} y1={0} x2={f1(x)} y2={f1(y)} stroke={withAlpha(colors.ink, 0.27)} />
                  <Path
                    d={arrow(a)}
                    fill="none"
                    stroke={danger ? colors.pen : colors.ink}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <SvgText
                    {...mono}
                    x={f1(lx)}
                    y={f1(side ? 14 : ly + 3)}
                    textAnchor={a === 90 ? "start" : a === -90 ? "end" : "middle"}
                    fontSize={8.5}
                    letterSpacing={0.5}
                    fill={danger ? colors.penInk : colors.ink2}
                  >
                    {DIRECTION_SHORT[key]}
                  </SvgText>
                </G>
              );
            })}
            <Polygon
              points={RING.map(({ key, a }) => polar(a, webRadius(off[key])).map(f1).join(",")).join(" ")}
              fill={withAlpha(colors.ink, 0.13)}
              stroke={colors.ink}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <Circle r={9} fill={colors.paper} stroke={colors.pen} />
            <SvgText {...mono} y={2.2} textAnchor="middle" fontSize={5.5} fill={colors.penInk}>
              NEVER
            </SvgText>
            {SPOKES.map(({ key, a }) => {
              const [x, y] = polar(a, webRadius(off[key]));
              return (
                <Circle
                  key={`dot${key}${a}`}
                  cx={f1(x)}
                  cy={f1(y)}
                  r={6.5}
                  fill={off[key] >= NEVER ? colors.pen : colors.ink}
                  stroke={colors.paper}
                  strokeWidth={2}
                />
              );
            })}
            <SvgText {...mono} x={0} y={138} textAnchor="middle" fontSize={9} letterSpacing={1.3} fill={colors.muted}>
              ARROWS: THE WAY THE WIND BLOWS
            </SvgText>
          </Svg>
          {/* Each direction once to a screen reader, where its dot is: swipe up for a star less off. */}
          {WEB_DIRS.map((d) => {
            const [x, y] = polar(d.at[0], webRadius(off[d.key]));
            const locked = shoreLocked(d.key);
            const place = { left: (x - WEB_BOX.x) * s - REACH, top: (y - WEB_BOX.y) * s - REACH };
            return locked ? (
              <View
                key={d.key}
                accessible
                accessibilityLabel={`${DIRECTION_NAME[d.key]}: never, locked`}
                style={[styles.dot, place]}
              />
            ) : (
              <View
                key={d.key}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`${DIRECTION_NAME[d.key]}: stars taken off`}
                accessibilityValue={{ min: 0, max: NEVER, now: off[d.key], text: costLabel(off[d.key]) }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(e) => {
                  tick();
                  onChange(d.key, off[d.key] + (e.nativeEvent.actionName === "increment" ? -1 : 1));
                }}
                style={[styles.dot, place]}
              />
            );
          })}
        </View>
      </GestureDetector>
      <View style={styles.dirs}>
        {SHORE_ORDER.map((key) => {
          const locked = shoreLocked(key);
          const never = off[key] >= NEVER;
          return (
            <View
              key={key}
              style={styles.dir}
              accessible
              accessibilityLabel={`${DIRECTION_NAME[key]}: ${costLabel(off[key])}${locked ? ", locked" : ""}. ${DIRECTION_LINE[key]}`}
            >
              <View style={styles.dirHead}>
                <T variant="body" style={styles.dirName}>
                  {DIRECTION_NAME[key]}
                </T>
                <View style={styles.cost}>
                  <T variant="label" tabular color={never ? "penInk" : "ink"} style={styles.costText}>
                    {costLabel(off[key])}
                  </T>
                  {locked ? <Lock /> : null}
                </View>
              </View>
              <T variant="caption" color={locked ? "ink2" : "muted"}>
                {DIRECTION_LINE[key]}
              </T>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Lock() {
  return (
    <Svg width={11} height={11} viewBox="0 0 12 12" accessible={false}>
      <Rect x={2.5} y={5.5} width={7} height={5} rx={1} fill={colors.penInk} />
      <Path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke={colors.penInk} strokeWidth={1.3} />
    </Svg>
  );
}

/* ---------------------------------------------------------- the upwind */

/**
 * "Can you ride upwind?": the three answers across the top, the picture (a
 * handle each side for each angle, dragged round the circle), and the two
 * angles as sliders: into the wind, and below straight across. They move no
 * stars; the loupe and the light's wedge follow them.
 */
function UpwindStep({
  yours,
  width,
  onChange,
}: {
  yours: YourStars;
  width: number;
  onChange: (change: Partial<Pick<YourStars, "upwind" | "downwind">>) => void;
}) {
  const answer = answerOf(yours.upwind);
  const picWidth = Math.min(width, 300);
  const s = picWidth / UP.vw;
  const now = useLatest({ yours, onChange });
  const [drag] = useState(() => ({ held: null as "upwind" | "downwind" | null, last: null as number | null }));

  /* eslint-disable react-hooks/immutability -- as WindStep's */
  const gesture = useMemo(() => {
    const toPic = (x: number, y: number): [number, number] => [x / s + UP.vx, y / s];
    return Gesture.Pan()
      .runOnJS(true)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        const touch = e.changedTouches[0];
        const [x, y] = toPic(touch.x, touch.y);
        drag.held = edgeAt(x, y, now.current.yours, REACH / s);
        if (!drag.held) return manager.fail();
        drag.last = now.current.yours[drag.held];
        manager.activate();
      })
      .onTouchesUp((_e, manager) => manager.end())
      .onUpdate((e) => {
        if (!drag.held) return;
        const [x, y] = toPic(e.x, e.y);
        const next = edgeAngle(drag.held, offWind(x, y));
        if (next !== drag.last) {
          tick();
          drag.last = next;
          now.current.onChange(drag.held === "upwind" ? { upwind: next } : { downwind: next });
        }
      })
      .onFinalize(() => {
        drag.held = null;
      });
  }, [s, now, drag]);
  /* eslint-enable react-hooks/immutability */

  return (
    <View style={styles.upwind}>
      <Segmented<string>
        wide
        value={answer ? String(answer.into) : ""}
        accessibilityLabel="Can you ride upwind?"
        segments={UP_ANSWERS.map((a) => ({
          value: String(a.into),
          label: a.name,
          accessibilityLabel: `${a.name}: ${a.line}`,
        }))}
        onChange={(v) => onChange({ upwind: Number(v) })}
      />
      <T variant="caption" color="muted" style={styles.answerLine}>
        {answer ? answer.line : `Your own: ${yours.upwind}° into the wind.`}
      </T>
      <GestureDetector gesture={gesture}>
        <View style={[styles.pic, { width: picWidth, height: UP.vh * s }]}>
          <UpwindPicture upwind={yours.upwind} downwind={yours.downwind} width={picWidth} />
        </View>
      </GestureDetector>
      <View style={styles.angles}>
        <AngleSlider
          value={yours.upwind}
          max={UPWIND_MAX}
          word="into the wind"
          label="Degrees into the wind"
          ends={["Straight across", `${UPWIND_MAX}° into it`]}
          width={width}
          onChange={(upwind) => onChange({ upwind })}
        />
        <AngleSlider
          second
          value={yours.downwind}
          max={DOWNWIND_MAX}
          word="below across"
          label="Degrees below straight across"
          ends={["Straight across", `${DOWNWIND_MAX}° downwind`]}
          width={width}
          onChange={(downwind) => onChange({ downwind })}
        />
      </View>
    </View>
  );
}

const lab = { ...mono, fontSize: 9, letterSpacing: 0.9 } as const;
const strong = { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.9 } as const;

/** The course round the wind, as the approved mock-up draws it: CAN'T GO, RIDE, DRIFT. */
function UpwindPicture({ upwind, downwind, width }: { upwind: number; downwind: number; width: number }) {
  const { cx, cy, r, vx, vw, vh } = UP;
  const up = 90 - upwind;
  const deep = 90 + downwind;
  const xy = (a: number, rr: number) => upPoint(a, rr).map(f1).join(" ");
  const sector = (a1: number, a2: number, rr: number) =>
    `M${cx} ${cy}L${xy(a1, rr)}A${rr} ${rr} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${xy(a2, rr)}Z`;
  const angle = (side: number) => {
    const rr = r * 0.82;
    const parts = [];
    if (upwind) {
      const [x1, y1] = upPoint(side * 90, rr);
      const [x2, y2] = upPoint(side * up, rr);
      const [lx, ly] = upPoint(side * (up - 9), r + 14);
      parts.push(
        <Path
          key={`u${side}`}
          d={`M${f1(x1)} ${f1(y1)}A${rr} ${rr} 0 0 ${side > 0 ? 0 : 1} ${f1(x2)} ${f1(y2)}`}
          fill="none"
          stroke={colors.magenta}
          strokeWidth={2}
        />,
        <SvgText
          key={`ut${side}`}
          fontFamily={fonts.monoBold}
          fontSize={11}
          x={f1(lx)}
          y={f1(ly + 4)}
          textAnchor={side > 0 ? "start" : "end"}
          fill={colors.magenta}
        >
          {`${upwind}°`}
        </SvgText>,
      );
    }
    if (downwind) {
      const [x1, y1] = upPoint(side * 90, rr);
      const [x2, y2] = upPoint(side * deep, rr);
      const [lx, ly] = upPoint(side * (deep + 9), r + 14);
      parts.push(
        <Path
          key={`d${side}`}
          d={`M${f1(x1)} ${f1(y1)}A${rr} ${rr} 0 0 ${side > 0 ? 1 : 0} ${f1(x2)} ${f1(y2)}`}
          fill="none"
          stroke={colors.ink}
          strokeWidth={1.5}
        />,
        <SvgText
          key={`dt${side}`}
          fontFamily={fonts.monoBold}
          fontSize={11}
          x={f1(lx)}
          y={f1(ly + 8)}
          textAnchor={side > 0 ? "start" : "end"}
          fill={colors.ink}
        >
          {`${downwind}°`}
        </SvgText>,
      );
    }
    return parts;
  };
  const ride = (side: number) => {
    const wide = deep - up >= 30;
    const [x, y] = upPoint((side * (up + deep)) / 2, wide ? r * 0.6 : r * 0.56);
    const at = { x: f1(x), y: f1(y + (wide ? 3 : -8)), textAnchor: "middle" as const };
    // On a narrow course the word sits over the lines: a halo of paper under it.
    return (
      <G key={`ride${side}`}>
        {wide ? null : (
          <SvgText {...strong} {...at} fill={colors.paper} stroke={colors.paper} strokeWidth={3} strokeLinejoin="round">
            RIDE
          </SvgText>
        )}
        <SvgText {...strong} {...at} fill={colors.ink}>
          RIDE
        </SvgText>
      </G>
    );
  };
  const handle = (side: number, kind: "upwind" | "downwind") => {
    const [x, y] = upPoint(side * (kind === "upwind" ? up : deep), r);
    return (
      <Circle
        key={`${kind}${side}`}
        cx={f1(x)}
        cy={f1(y)}
        r={7}
        fill={kind === "upwind" ? colors.ink : colors.paper}
        stroke={kind === "upwind" ? colors.paper : colors.ink}
        strokeWidth={2}
      />
    );
  };
  return (
    <Svg
      width={width}
      height={(width * vh) / vw}
      viewBox={`${vx} 0 ${vw} ${vh}`}
      accessible
      accessibilityLabel={`The way you ride round the wind: you can't go within ${up}° of it, you ride from ${upwind}° into the wind to ${downwind}° below straight across, and further down you drift and lose ground.`}
    >
      <Defs>
        <Pattern id="hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Line x1={0} y1={0} x2={0} y2={5} stroke={colors.ink} strokeWidth={0.8} strokeOpacity={0.55} />
        </Pattern>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} fill={colors.sunken} stroke={colors.line} />
      <Path d={sector(-up, up, r)} fill="url(#hatch)" stroke={colors.ink} strokeDasharray="3 3" />
      {deep - up > 0.5 ? (
        <>
          <Path d={sector(up, deep, r)} fill={colors.paper} stroke={colors.ink} strokeWidth={1.5} strokeLinejoin="round" />
          <Path d={sector(-deep, -up, r)} fill={colors.paper} stroke={colors.ink} strokeWidth={1.5} strokeLinejoin="round" />
        </>
      ) : (
        <Path d={`M${cx} ${cy}L${xy(up, r)}M${cx} ${cy}L${xy(-up, r)}`} stroke={colors.ink} strokeWidth={1.5} />
      )}
      <Path d={sector(deep, 360 - deep, r)} fill="none" stroke={colors.ink} strokeDasharray="2 3" strokeOpacity={0.6} />
      <Line x1={cx - r - 8} x2={cx + r + 8} y1={cy} y2={cy} stroke={colors.ink} strokeOpacity={0.4} strokeDasharray="1 3" />
      <SvgText {...lab} x={cx + r + 10} y={cy + 3} fill={colors.muted}>
        ACROSS
      </SvgText>
      <SvgText {...lab} x={cx - r - 10} y={cy + 3} textAnchor="end" fill={colors.muted}>
        ACROSS
      </SvgText>
      <SvgText {...strong} x={cx} y={cy - r * 0.5} textAnchor="middle" fill={colors.ink}>
        CAN’T GO
      </SvgText>
      {ride(1)}
      {ride(-1)}
      <SvgText {...strong} x={cx} y={cy + r * 0.55} textAnchor="middle" fill={colors.ink}>
        DRIFT
      </SvgText>
      <SvgText {...lab} x={cx} y={cy + r * 0.55 + 12} textAnchor="middle" fill={colors.muted}>
        YOU LOSE GROUND
      </SvgText>
      {angle(1)}
      {angle(-1)}
      <Path d={`M${cx} 6V${cy - r - 12}`} stroke={colors.ink} strokeWidth={2.5} />
      <Path d={`M${cx - 6} ${cy - r - 14}L${cx + 6} ${cy - r - 14}L${cx} ${cy - r - 3}Z`} fill={colors.ink} />
      <SvgText {...strong} x={cx + 10} y={18} fill={colors.ink}>
        WIND
      </SvgText>
      <Path
        d={`M${cx} ${cy - 12}C${cx + 5} ${cy - 4} ${cx + 5} ${cy + 8} ${cx} ${cy + 12}C${cx - 5} ${cy + 8} ${cx - 5} ${cy - 4} ${cx} ${cy - 12}Z`}
        fill={colors.ink}
      />
      {handle(1, "downwind")}
      {handle(-1, "downwind")}
      {handle(1, "upwind")}
      {handle(-1, "upwind")}
    </Svg>
  );
}

const KNOB = 22;

/** One angle: the figure, what it is, and a slider from 0 to `max` in whole degrees. */
function AngleSlider({
  value,
  max,
  word,
  label,
  ends,
  width,
  second,
  onChange,
}: {
  value: number;
  max: number;
  word: string;
  label: string;
  ends: [string, string];
  width: number;
  second?: boolean;
  onChange: (deg: number) => void;
}) {
  const track = width - KNOB;
  const now = useLatest({ value, onChange });
  /* eslint-disable react-hooks/immutability -- as WindStep's */
  const gesture = useMemo(() => {
    const set = (x: number) => {
      const next = degAtX(x - KNOB / 2, track, max);
      if (next === now.current.value) return;
      tick();
      now.current.value = next;
      now.current.onChange(next);
    };
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onUpdate((e) => set(e.x));
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((e, ok) => ok && set(e.x));
    return Gesture.Exclusive(pan, tap);
  }, [track, max, now]);
  /* eslint-enable react-hooks/immutability */
  const x = (value / max) * track;
  return (
    <View>
      <View style={styles.angleHead}>
        <T variant="figure" tabular style={styles.angleFigure}>
          {value}°
        </T>
        <T variant="label" caps color="ink2">
          {word}
        </T>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.slider, { width }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max, now: value, text: `${value}°` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) =>
            onChange(Math.max(0, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? 1 : -1))))
          }
        >
          <View style={[styles.rail, { left: KNOB / 2, width: track }]} />
          <View style={[styles.rail, styles.railOn, { left: KNOB / 2, width: x }]} />
          <View style={[styles.sliderKnob, second && styles.sliderKnobSecond, { left: x }]} />
        </View>
      </GestureDetector>
      <View style={styles.ends} accessible={false}>
        <T variant="eyebrow" caps color="muted">
          {ends[0]}
        </T>
        <T variant="eyebrow" caps color="muted">
          {ends[1]}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space["2xl"] },
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "baseline", gap: space.md, paddingBottom: space.md },
  progress: { flexDirection: "row", gap: space["2xs"], height: 3 },
  bar: { flex: 1, backgroundColor: withAlpha(colors.ink, 0.13) },
  barDone: { backgroundColor: colors.ink },
  sub: { paddingTop: space.lg, paddingBottom: space.lg },
  range: { height: RANGE.height },
  strip: { position: "absolute", height: RANGE.stripH },
  handle: {
    position: "absolute",
    width: hitTarget,
    height: hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    minWidth: 30,
    height: 26,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  knobTop: { borderColor: colors.penInk },
  knobText: { fontFamily: fonts.monoBold, letterSpacing: 0 },
  shore: { gap: space.md },
  web: { alignSelf: "center" },
  dot: { position: "absolute", width: hitTarget, height: hitTarget },
  dirs: { borderTopWidth: 2, borderTopColor: colors.ink },
  dir: {
    gap: space["2xs"],
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  dirHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dirName: { flex: 1, fontFamily: fonts.displayBold },
  cost: { flexDirection: "row", alignItems: "center", gap: space.xs },
  costText: { fontFamily: fonts.monoBold },
  upwind: { gap: space.sm },
  answerLine: { fontFamily: fonts.bodyItalic, minHeight: hitTarget / 2 },
  pic: { alignSelf: "center" },
  angles: { gap: space.xl, paddingTop: space.sm },
  angleHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  angleFigure: { minWidth: space["4xl"] },
  slider: { height: hitTarget, justifyContent: "center" },
  rail: {
    position: "absolute",
    top: hitTarget / 2 - 2,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  railOn: { backgroundColor: colors.ink },
  sliderKnob: {
    position: "absolute",
    top: (hitTarget - KNOB) / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.ink,
  },
  sliderKnobSecond: { borderColor: colors.ink, backgroundColor: colors.paper },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    backgroundColor: colors.paper,
  },
  reset: { marginRight: "auto" },
});
