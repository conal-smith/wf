/**
 * Layers (src/MapControls.tsx): how the wind is drawn, which parts of the
 * chart, the satellite image under it at which tide, and the rider's model,
 * with its run: the one the map draws and the stars rate, the same choice as
 * Settings → Model (force5/src/lead.ts). Every choice is kept as the site
 * keeps it (wingfoil.map.wind.v1, wingfoil.map.layers.v1, and the model in
 * force5.prefs.v1).
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { memo, type Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from "react-native";
import { MODELS, type ModelId } from "../../../../force5/src/models";
import { approxMetres, SATELLITE_LABEL, SATELLITE_OPTIONS, type SatelliteOption } from "../../../../force5/src/satellite";
import type { SatelliteStation } from "../../../../force5/src/satelliteIndex";
import { tick } from "../../components/haptics";
import { Segmented } from "../../components/Segmented";
import { T } from "../../components/Text";
import { colors, hitTarget, space } from "../../theme/tokens";
import { MODEL_NOTE } from "../settings/settingsLogic";
import { ChartSheet, SheetSection } from "./ChartSheet";
import { KnotScale } from "./KnotScale";
import { CHART_LABEL, type ChartLayers, type MapLayers } from "./mapLogic";
import { WIND_LABEL, WIND_STYLES, type WindStyle } from "./windLogic";

interface Props {
  sheetRef: Ref<BottomSheetModal>;
  onClose: () => void;
  windStyle: WindStyle;
  onWindStyle: (style: WindStyle) => void;
  layers: MapLayers;
  onLayers: (layers: MapLayers) => void;
  satelliteStation: SatelliteStation | null;
  satelliteError: string | null;
  model: string | undefined;
  run: string | null;
  staleness: "fresh" | "stale" | "expired";
  pendingModel: ModelId | null;
  modelDisabled: boolean;
  onModel: (id: ModelId) => void;
  onFoilKey: () => void;
  reducedMotion: boolean;
}

export const LayersSheet = memo(function LayersSheet(props: Props) {
  const { layers, onLayers } = props;
  const set = (key: keyof ChartLayers, value: boolean) => {
    tick();
    onLayers({ ...layers, [key]: value });
  };
  return (
    <ChartSheet sheetRef={props.sheetRef} title="Layers" snapPoints={["72%", "94%"]} onClose={props.onClose}>
      <SheetSection title="Wind">
        <Segmented
          accessibilityLabel="How the wind is drawn"
          value={props.windStyle}
          segments={WIND_STYLES.map((style) => ({ value: style, label: WIND_LABEL[style] }))}
          onChange={props.onWindStyle}
        />
        <KnotScale faint={props.windStyle === "wash"} />
        {props.reducedMotion && props.windStyle !== "arrows" ? (
          <T variant="caption" color="muted">
            Reduce Motion is on: the wind is drawn as still arrows in ink.
          </T>
        ) : null}
      </SheetSection>

      <SheetSection title="Chart">
        {(Object.keys(CHART_LABEL) as (keyof ChartLayers)[]).map((key) => (
          <View key={key} style={styles.switchRow}>
            <T variant="body" style={styles.flex}>
              {CHART_LABEL[key]}
            </T>
            {key === "foil" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="About tidal depth"
                onPress={props.onFoilKey}
                style={styles.about}
              >
                <T variant="label" caps color="ink2">
                  Key
                </T>
              </Pressable>
            ) : null}
            <Switch
              accessibilityLabel={CHART_LABEL[key]}
              value={layers[key]}
              onValueChange={(value) => set(key, value)}
              trackColor={{ false: colors.sunken, true: colors.ink }}
              thumbColor={colors.paper}
              ios_backgroundColor={colors.sunken}
            />
          </View>
        ))}
      </SheetSection>

      <SheetSection title="Satellite">
        <Segmented
          accessibilityLabel="Satellite image under the chart"
          value={layers.satellite}
          segments={SATELLITE_OPTIONS.map((option) => ({ value: option, label: SATELLITE_LABEL[option] }))}
          onChange={(option: SatelliteOption) => onLayers({ ...layers, satellite: option })}
        />
        {props.satelliteError ? (
          <T variant="caption" color="warn">
            {props.satelliteError}
          </T>
        ) : layers.satellite !== "off" && props.satelliteStation ? (
          <T variant="figureSm" color="ink2">
            {props.satelliteStation.name}: high {approxMetres(props.satelliteStation.high)}, low{" "}
            {approxMetres(props.satelliteStation.low)}
          </T>
        ) : null}
      </SheetSection>

      <SheetSection
        title="Model"
        aside={
          props.run ? (
            <T variant="label" caps color={props.staleness === "fresh" ? "muted" : "warn"}>
              {props.run} run{props.staleness === "expired" ? " · archived" : props.staleness === "stale" ? " · older" : ""}
            </T>
          ) : null
        }
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Model">
          {MODELS.map((entry) => {
            const on = props.model === entry.id;
            const busy = props.pendingModel === entry.id;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="radio"
                accessibilityLabel={`Use ${entry.name} model`}
                accessibilityHint={entry.detail}
                accessibilityState={{ checked: on, disabled: props.modelDisabled, busy }}
                disabled={props.modelDisabled}
                onPress={() => {
                  if (on) return;
                  tick();
                  props.onModel(entry.id);
                }}
                style={({ pressed }) => [styles.model, pressed && styles.modelDown, props.modelDisabled && !busy && styles.off]}
              >
                <View style={[styles.radio, on && styles.radioOn]} />
                <View style={styles.flex}>
                  <T variant="lead">{entry.name}</T>
                  <T variant="caption" color="muted">
                    {entry.detail}
                  </T>
                </View>
                {busy ? <ActivityIndicator color={colors.ink} /> : null}
              </Pressable>
            );
          })}
        </View>
        <T variant="caption" color="muted">
          {MODEL_NOTE}
        </T>
      </SheetSection>
    </ChartSheet>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switchRow: { flexDirection: "row", alignItems: "center", minHeight: hitTarget, gap: space.sm },
  about: { minHeight: hitTarget, paddingHorizontal: space.sm, justifyContent: "center" },
  model: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: hitTarget + space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  modelDown: { backgroundColor: colors.sunken },
  off: { opacity: 0.5 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.ink },
  radioOn: { backgroundColor: colors.ink, boxShadow: `inset 0 0 0 3px ${colors.paper}` },
});
