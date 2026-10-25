/**
 * The particles, the wind's lines in ink over the chart: a Skia canvas above the map whose picture is
 * recorded on the UI thread every step (particleSim.ts), so React renders
 * nothing per frame. The JS thread only resamples the field when the camera
 * comes to rest or the hour changes (useWind.ts) and posts it here.
 *
 * While the camera moves the lines fade out rather than swim behind the map
 * (the native map's camera reaches JavaScript a frame or two late); they are
 * born again over the new view when it settles. The frame callback stops
 * whenever the lines are not shown: the camera moving, the Particles layer
 * off, the screen out of focus, the app in the background, or reduced motion.
 *
 * The rings of the lights are cut out of the canvas, so the lines pass under
 * them as they do on the site, where the canvas sits under the markers.
 */
import {
  Canvas,
  ClipOp,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkPaint,
  type SkPath,
  type SkPicture,
} from "@shopify/react-native-skia";
import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors, motion } from "../../theme/tokens";
import {
  advance,
  BINS,
  createSim,
  inkAlpha,
  inkWidth,
  LEVELS,
  loadField,
  STEP_MS,
  traceRuns,
  type FieldMessage,
  type Sim,
} from "./particleSim";

/** The most lines drawn at once, whatever the screen: a mid-range phone's budget. */
const MAX_LINES = 600;
const KEYS = BINS * LEVELS;
const DIFFERENCE = ClipOp.Difference;
const STROKE = PaintStyle.Stroke;
const ROUND_CAP = StrokeCap.Round;
const ROUND_JOIN = StrokeJoin.Round;
const INK = colors.ink;
/** The ring's radius, and a little air round it. */
const HOLE = 9.5;

interface Graphics {
  paints: SkPaint[];
  paths: SkPath[];
  holes: SkPath | null;
  holesKey: number;
}

interface Props {
  /** The field to drift on, or null for none yet. */
  field: FieldMessage | null;
  /** The lights' centres on the screen, x then y, for the field's camera. */
  holes: number[];
  /** Draw at all (the Particles layer on, focus, foreground, motion). */
  on: boolean;
  /** The camera is moving: fade out and rest. */
  moving: boolean;
}

export const WindParticles = memo(function WindParticles({ field, holes, on, moving }: Props) {
  const fieldSV = useSharedValue<FieldMessage | null>(null);
  const holesSV = useSharedValue<{ key: number; xy: number[] }>({ key: 0, xy: [] });
  const sim = useSharedValue<Sim | null>(null);
  const gfx = useSharedValue<Graphics | null>(null);
  const last = useSharedValue(0);
  const picture = useSharedValue<SkPicture>(createPicture(() => {}));
  const opacity = useSharedValue(0);

  useEffect(() => {
    fieldSV.value = field;
  }, [field, fieldSV]);
  useEffect(() => {
    holesSV.value = { key: Date.now(), xy: holes };
  }, [holes, holesSV]);

  const frame = useFrameCallback((info) => {
    "worklet";
    const message = fieldSV.value;
    if (!message) return;
    let s = sim.value;
    if (!s) {
      s = createSim(MAX_LINES);
      sim.value = s;
    }
    if (s.fieldId !== message.id) loadField(s, message, Math.random);
    if (info.timestamp - last.value < STEP_MS) return;
    last.value = info.timestamp;
    advance(s, Math.random);

    let g = gfx.value;
    if (!g) {
      const paints: SkPaint[] = [];
      const paths: SkPath[] = [];
      for (let key = 0; key < KEYS; key++) {
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(INK));
        paint.setAlphaf(inkAlpha(key));
        paint.setStyle(STROKE);
        paint.setStrokeWidth(inkWidth(key));
        paint.setStrokeCap(ROUND_CAP);
        paint.setStrokeJoin(ROUND_JOIN);
        paint.setAntiAlias(true);
        paints.push(paint);
        paths.push(Skia.Path.Make());
      }
      g = { paints, paths, holes: null, holesKey: -1 };
      gfx.value = g;
    }
    const cut = holesSV.value;
    if (g.holesKey !== cut.key) {
      g.holesKey = cut.key;
      if (cut.xy.length) {
        const path = Skia.Path.Make();
        for (let i = 0; i + 1 < cut.xy.length; i += 2) path.addCircle(cut.xy[i], cut.xy[i + 1], HOLE);
        g.holes = path;
      } else g.holes = null;
    }
    const paths = g.paths;
    for (let key = 0; key < KEYS; key++) paths[key].reset();
    traceRuns(s, (key, x, y, start) => {
      if (start) paths[key].moveTo(x, y);
      else paths[key].lineTo(x, y);
    });
    const graphics = g;
    picture.value = createPicture((canvas) => {
      if (graphics.holes) canvas.clipPath(graphics.holes, DIFFERENCE, true);
      for (let key = 0; key < KEYS; key++)
        if (!graphics.paths[key].isEmpty()) canvas.drawPath(graphics.paths[key], graphics.paints[key]);
    });
  }, false);

  const shown = on && !moving && !!field;
  useEffect(() => {
    // Resting while hidden: the last picture fades out frozen.
    frame.setActive(shown);
    opacity.value = withTiming(shown ? 1 : 0, { duration: shown ? motion.base : motion.fast });
  }, [on, shown, field, frame, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!on) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fade]} accessible={false}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
      </View>
    </Animated.View>
  );
});
