/**
 * The rider's one model (force5/src/lead.ts, 23 October 2026): the one the
 * chart draws, the dock and the spot pages give, and the stars rate, on its
 * own settings page beside "Models in the blend". Past the end of its run
 * ECMWF takes over on its own, with no setting for it. It writes the rider
 * (force5.prefs.v1) through `withRiderModel`, so the chart, the dock, the spot
 * pages and the alerts follow at once.
 */
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { tick } from "../../components/haptics";
import { ListSection } from "../../components/List";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, hitTarget, space } from "../../theme/tokens";
import { SettingsPage } from "./SettingsPage";
import { MODEL_NOTE, modelChoiceRows } from "./settingsLogic";

function Check() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" accessible={false}>
      <Path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** One choice of several: its name, a line of small print, a tick when it is the one. */
function RadioRow({ label, detail, on, onPress }: { label: string; detail?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={() => {
        if (on) return;
        tick();
        onPress();
      }}
      style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <T variant="prose">{label}</T>
        {detail ? (
          <T variant="caption" color="muted">
            {detail}
          </T>
        ) : null}
      </View>
      <View style={styles.check}>{on ? <Check /> : null}</View>
    </Pressable>
  );
}

/** Settings → Model: the one model the rider sees and the stars rate. */
export function ModelChoiceScreen() {
  const { prefs, setModel } = usePrefs();
  return (
    <SettingsPage title="Model">
      <ListSection title="Model" footer={MODEL_NOTE}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Model">
          {modelChoiceRows(prefs.rider.starsFrom).map((row) => (
            <RadioRow key={row.id} label={row.name} detail={row.detail} on={row.on} onPress={() => setModel(row.id)} />
          ))}
        </View>
      </ListSection>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: hitTarget + space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  flex: { flex: 1 },
  check: { width: space.xl, alignItems: "center" },
});
