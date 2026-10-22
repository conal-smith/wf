/**
 * Everything the chart explains (src/MapInfo.tsx, src/FoilLegend.tsx): what
 * its marks mean, how the stars are given, the foilable depth's colours and
 * tide, and where it all comes from. One sheet over the dimmed chart, so
 * none of it sits on the map.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { memo, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { DEPTHS } from "../../../../force5/src/chartStyle";
import {
  FOIL_CLEARANCE_METRES,
  levelLine,
  surveyLine,
  type FoilArea,
  type FoilColours,
} from "../../../../force5/src/foilDepth";
import { SATELLITE_ATTRIBUTION } from "../../../../force5/src/satellite";
import type { Rider } from "../../../../force5/src/stars";
import { riderLine } from "../../../../src/riderLine";
import { Button } from "../../components/Button";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { colors, cssVariables, fonts, hitTarget, space } from "../../theme/tokens";
import { ChartSheet, SheetSection } from "./ChartSheet";
import { KnotScale } from "./KnotScale";
import { appFoilColours } from "./mapStyle";

/** A light as the key shows it (src/MapInfo.tsx `KeyLight`). */
function KeyLight({
  stars,
  arrow = false,
  struck = false,
  cross = false,
  wedge = false,
}: {
  stars: number;
  arrow?: boolean;
  struck?: boolean;
  cross?: boolean;
  wedge?: boolean;
}) {
  const fill = struck ? colors.paper : stars === 5 ? colors.magenta : stars >= 3 ? colors.ink : colors.paper;
  const ring = struck ? colors.pen : stars === 5 ? colors.magenta : colors.ink;
  const figure = struck ? colors.pen : stars >= 3 ? colors.paper : colors.ink;
  return (
    <Svg width={34} height={arrow || wedge ? 34 : 24} viewBox={arrow || wedge ? "-17 -17 34 34" : "-17 -12 34 24"}>
      {wedge && <Path d="M0 0L15 0A15 15 0 0 1 6.3 13.6Z" fill={colors.ink} stroke={colors.ink} strokeWidth={2} opacity={0.45} />}
      {arrow && (
        <Path
          d="M5.5 -5.5L13 -13M8.2 -13.4L13.6 -13.6L13.4 -8.2"
          stroke={cross ? colors.pen : colors.ink}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
      <Circle
        r={7.6}
        fill={fill}
        stroke={ring}
        strokeWidth={1.1}
        strokeDasharray={stars === 0 && !struck ? "2 1.6" : undefined}
        strokeOpacity={stars === 0 && !struck ? 0.5 : 1}
      />
      {struck && <Line x1={-5.6} y1={5.6} x2={5.6} y2={-5.6} stroke={colors.pen} strokeWidth={1.6} strokeLinecap="round" />}
      <SvgText
        y={3.4}
        textAnchor="middle"
        fontSize={9.5}
        fontFamily={fonts.monoBold}
        fill={figure}
        opacity={stars === 0 && !struck ? 0.5 : 1}
      >
        {stars}
      </SvgText>
    </Svg>
  );
}

function KeyRow({ mark, children }: { mark: ReactNode; children: string }) {
  return (
    <View style={styles.keyRow} accessible accessibilityLabel={children}>
      <View style={styles.mark}>{mark}</View>
      <T variant="body" style={styles.flex}>
        {children}
      </T>
    </View>
  );
}

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void WebBrowser.openBrowserAsync(url).catch(() => undefined)}
      style={styles.link}
    >
      <T variant="body" style={styles.underline}>
        {label}
      </T>
    </Pressable>
  );
}

/**
 * The map's depth scale, 0 to 6 m of water at this tide (depthScale), as the
 * site's key draws it (src/FoilLegend.tsx `fk-scale`).
 */
function DepthScale({ palette }: { palette: FoilColours }) {
  const c = FOIL_CLEARANCE_METRES;
  const stops: [number, string][] = [
    [0, palette.edge],
    [(c - 0.02) / 6, palette.shallow],
    [c / 6, palette.enough],
    [0.5, palette.deep],
    [1, palette.deeper],
  ];
  const ticks: [string, number][] = [
    ["0", 0],
    [`${c} m`, c / 6],
    ["3 m", 0.5],
    ["6 m+", 1],
  ];
  return (
    <View
      accessible
      accessibilityLabel={`Depth of water at this tide: pale at the edge, light blue while too shallow, strong blue from ${c} m, fading to 6 m`}
    >
      <T variant="caption" color="muted">
        Depth of water at this tide
      </T>
      <Svg width="100%" height={12}>
        <Defs>
          <LinearGradient id="foil-scale" x1="0" y1="0" x2="1" y2="0">
            {stops.map(([at, colour]) => (
              <Stop key={at} offset={at} stopColor={colour} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height={12} fill="url(#foil-scale)" stroke={colors.ink} strokeWidth={1} />
      </Svg>
      <View style={styles.ticks}>
        {ticks.map(([label, at]) => (
          <T
            key={label}
            variant="caption"
            color="muted"
            style={[
              styles.tick,
              { left: `${at * 100}%`, transform: [{ translateX: at === 0 ? 0 : at === 1 ? -36 : -18 }] },
              at === 0 && styles.tickStart,
              at === 1 && styles.tickEnd,
            ]}
          >
            {label}
          </T>
        ))}
      </View>
    </View>
  );
}

export interface FoilKeyProps {
  on: boolean;
  area: FoilArea | null;
  station: string | null;
  tide: number | null;
  sea: number | null;
  when: string;
  readout: string | null;
  error: string | null;
  floor: number;
  attribution: string | null;
}

/** The foilable-depth layer's key (src/FoilLegend.tsx). */
export function FoilKey(p: FoilKeyProps) {
  const palette = appFoilColours();
  const swatch = (colour: string) => <View style={[styles.swatch, { backgroundColor: colour }]} />;
  return (
    <View style={styles.gap}>
      <T variant="body" color={p.error ? "warn" : "ink"} accessibilityLiveRegion="polite">
        {!p.on
          ? "Off. Turn it on in Layers, under Chart: “Foilable depth at the tide”."
          : p.error
            ? p.error
            : p.area && p.station
              ? p.tide === null
                ? `No tide prediction at ${p.station} for ${p.when}.`
                : `${p.when} · ${levelLine(p.tide, p.station, p.sea ?? undefined)}`
              : "Loading the survey…"}
      </T>
      <DepthScale palette={palette} />
      <KeyRow mark={swatch(palette.enough)}>{`Deep enough, ${FOIL_CLEARANCE_METRES} m or more`}</KeyRow>
      <KeyRow mark={swatch(palette.shallow)}>Wet, too shallow for the mast</KeyRow>
      <KeyRow mark={<View style={[styles.line, { borderTopColor: palette.line }]} />}>The waterline at this tide</KeyRow>
      <KeyRow mark={swatch(palette.dry)}>Dry at this tide</KeyRow>
      {p.on ? (
        <T variant="pen" color="penInk">
          {p.readout ?? "Tap the water on the chart, and its depth at this hour is read out."}
        </T>
      ) : null}
      <T variant="caption" color="muted">
        {`Approximate: astronomical tide, no surge or waves${p.on && p.area ? `; survey ${surveyLine(p.area)}` : ""}. Each stretch of coast follows its nearest tide station. The shore is OpenStreetMap’s coastline; the foreshore’s heights come from satellite images at known tides where there are some, and where no survey reached the depth is estimated from the surveys round it (a tap says so). Water more than ${-p.floor} m deep at the lowest tide is not drawn: it is deep enough at any tide. Not for navigation.`}
      </T>
    </View>
  );
}

interface Props {
  sheetRef: Ref<BottomSheetModal>;
  onClose: () => void;
  scale: string;
  rider: Rider;
  spotId: string | null;
  satellite: string | null;
  satelliteError: string | null;
  satelliteAttribution: string | null;
  foil: FoilKeyProps;
  model: { name: string; run: string | null } | null;
  blendModels: number;
}

export const InfoSheet = memo(function InfoSheet(props: Props) {
  return (
    <ChartSheet sheetRef={props.sheetRef} kicker="Ireland" title="Wing Foil Chart" snapPoints={["72%", "94%"]} onClose={props.onClose}>
      <SheetSection title="Map key" aside={<T variant="figureSm" color="muted">{props.scale}</T>}>
        <KeyRow mark={<KeyLight stars={4} arrow />}>Stars at the hour shown; the arrow blows downwind.</KeyRow>
        <KeyRow mark={<KeyLight stars={4} wedge />}>
          Wedge, on the spot you open: the headings you can hold out to sea at your level in this wind. Longer the better powered.
        </KeyRow>
        <KeyRow mark={<KeyLight stars={5} />}>Five stars, in magenta</KeyRow>
        <KeyRow mark={<KeyLight stars={2} />}>One or two stars: a plain ring</KeyRow>
        <KeyRow mark={<KeyLight stars={0} />}>Dashed: no stars at this hour</KeyRow>
        <KeyRow mark={<KeyLight stars={1} struck />}>Offshore: not safe</KeyRow>
        <KeyRow mark={<KeyLight stars={3} arrow cross />}>Red arrow: cross-offshore. Fine at an angle; not for learners.</KeyRow>
        <KeyRow
          mark={
            <Svg width={34} height={20} viewBox="0 0 34 20">
              <Path d="M3 15 C10 13 16 8 31 5" stroke={colors.ink} strokeWidth={1.4} fill="none" strokeLinecap="round" />
              <Path d="M5 18 C12 16 18 12 26 10" stroke={colors.ink} strokeWidth={1} fill="none" opacity={0.45} strokeLinecap="round" />
            </Svg>
          }
        >
          Wind, at the hour shown
        </KeyRow>
        <KeyRow
          mark={
            <Svg width={34} height={24} viewBox="-17 -12 34 24">
              <G>
                <Path d="M-14 4 C-10 -9 10 -10 13 3 C11 10 -10 11 -14 4Z" stroke={colors.pen} strokeWidth={1.6} fill="none" />
              </G>
            </Svg>
          }
        >
          The pen: the spot you open, or a point you tap
        </KeyRow>
        <T variant="label" caps color="ink2">
          Wash and arrows
        </T>
        <KnotScale />
        <View style={styles.tints} accessible accessibilityLabel="Depth tints, 0 to 50 metres and more">
          {[0, 1, 2, 5, 10, 20, 50].map((d) => (
            <View
              key={d}
              style={[
                styles.tint,
                { backgroundColor: cssVariables.getPropertyValue(`--map-d${(DEPTHS as readonly number[]).includes(d) ? d : 50}`) },
              ]}
            >
              <T variant="figureSm" color="depth">
                {d === 50 ? "50+" : d}
              </T>
            </View>
          ))}
        </View>
        <T variant="caption" color="muted">
          Depths in metres below chart datum
        </T>
        {props.satellite || props.satelliteError ? (
          <T variant="caption" color={props.satelliteError ? "warn" : "muted"}>
            {props.satelliteError ??
              `${props.satellite}. Sentinel-2's clear looks at that tide, at the nearest tide station; the land is one summer composite in both.`}
          </T>
        ) : null}
      </SheetSection>

      <SheetSection title="Star ratings">
        <KeyRow mark={<Stars stars={3} potential={5} size={11} />}>
          Solid stars are the rating. Outlined stars are what the wind speed alone would have earned, before anything was taken off.
        </KeyRow>
        <KeyRow mark={<Stars stars={1} potential={2} size={11} />}>
          A dot is a star out of reach: not even the wind speed alone would have earned it.
        </KeyRow>
        <T variant="body">Dark hours aren’t rated. Your weight and level are in Settings.</T>
        <T variant="figureSm">Rated for {riderLine(props.rider)}</T>
        <Button
          label="How the stars work"
          kind="pill"
          onPress={() => {
            props.onClose();
            router.push((props.spotId ? `/stars?spot=${encodeURIComponent(props.spotId)}` : "/stars") as never);
          }}
          style={styles.start}
        />
      </SheetSection>

      <SheetSection title="Foilable depth">
        <FoilKey {...props.foil} />
      </SheetSection>

      <SheetSection title="Sources">
        <T variant="body">
          Wind: {props.model ? `${props.model.name} on the map${props.model.run ? ` (${props.model.run} run)` : ""}` : "HARMONIE on the map"}; the
          stars rate HARMONIE&rsquo;s own forecast while it reaches the hour, then a blend of {props.blendModels} models.
        </T>
        <T variant="body">Depths: EMODnet Bathymetry, metres below chart datum.</T>
        {props.foil.attribution ? (
          <T variant="body">
            Foilable depth: {props.foil.attribution} Heights above LAT against the tide predictions below.
          </T>
        ) : null}
        <T variant="body">Coast and places: © OpenStreetMap contributors, OpenFreeMap.</T>
        <View style={styles.links}>
          <Link label="OpenStreetMap" url="https://www.openstreetmap.org/copyright" />
          <Link label="OpenFreeMap" url="https://openfreemap.org/" />
        </View>
        <T variant="body">
          Tides: Marine Institute predictions (CC BY 4.0); in Northern Ireland, wingfoil.ie&rsquo;s own from the
          Environment Agency&rsquo;s tide gauges (Open Government Licence v3.0) and the EOT20 ocean tide model
          (DGFI-TUM, CC BY 4.0).
        </T>
        <T variant="body">Satellite imagery and intertidal heights: {props.satelliteAttribution ?? SATELLITE_ATTRIBUTION}</T>
        <T variant="body">
          Places: Fáilte Ireland (CC BY 4.0), OpenStreetMap (ODbL) and linked guides; not verified launches.
        </T>
        <T variant="caption" color="muted">
          A model cannot see every headland. Check Met Éireann warnings and the water before you go. Not for navigation.
        </T>
        <Link label="Met Éireann warnings" url="https://www.met.ie/warnings" />
      </SheetSection>
    </ChartSheet>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.sm },
  keyRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 34 },
  mark: { width: 40, alignItems: "center" },
  swatch: { width: 22, height: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  line: { width: 22, height: 0, borderTopWidth: 2 },
  ticks: { height: 16, marginTop: space.xs },
  tick: { position: "absolute", width: 36, textAlign: "center" },
  tickStart: { textAlign: "left" },
  tickEnd: { textAlign: "right" },
  tints: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.depth },
  tint: { flex: 1, alignItems: "center", paddingVertical: space.xs },
  start: { alignSelf: "flex-start" },
  links: { flexDirection: "row", gap: space.lg },
  link: { minHeight: hitTarget, justifyContent: "center" },
  underline: { textDecorationLine: "underline" },
});
