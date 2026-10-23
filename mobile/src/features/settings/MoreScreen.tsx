/**
 * The More tab, as a native grouped list set the broadsheet way: who the
 * stars are for, how the forecast is shown, how it is made, and the house's
 * own pages, with the source the AGPL asks to be offered.
 */
import { router } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { windModels } from "../../../../force5/src/manifests";
import { UNITS } from "../../../../force5/src/units";
import { ListRow, ListSection, ScreenTitle } from "../../components/List";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, space } from "../../theme/tokens";
import { DOCK_ROWS, dockRowOn } from "../dock/dockLogic";
import { openLink } from "./SettingsPage";
import { SOURCE_CODE_URL, modelValue, riderSummary } from "./settingsLogic";

const go = (path: string) => () => router.push(path as never);

export function MoreScreen() {
  const { prefs } = usePrefs();
  const unit = UNITS.find((u) => u.id === prefs.units);
  const rowsOn = DOCK_ROWS.filter((r) => dockRowOn(prefs, r.row)).length;
  const models = windModels();
  const inBlend = models.filter((m) => prefs.blendModels.includes(m.id)).length;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <ScreenTitle title="More" kicker="wingfoil.ie" />

      <ListSection title="Your riding" footer="The stars on the chart, the dock and every spot are rated for this rider.">
        <ListRow label="Rider" value={riderSummary(prefs.rider)} onPress={go("/settings/rider")} hint="Level, weight and wings" />
      </ListSection>

      <ListSection title="The forecast" footer="The chart, the wind and the stars are your model's forecast. The blend gives the agreement beside them.">
        <ListRow
          label="Model"
          value={modelValue(prefs.rider.starsFrom)}
          onPress={go("/settings/model")}
          hint="The model the chart draws and the stars rate"
        />
        <ListRow label="Models in the blend" value={`${inBlend} of ${models.length}`} onPress={go("/settings/models")} />
        <ListRow label="Units" value={unit?.label ?? prefs.units} onPress={go("/settings/units")} />
        <ListRow label="Dock rows" value={`${rowsOn} of ${DOCK_ROWS.length}`} onPress={go("/settings/rows")} />
      </ListSection>

      <ListSection title="How it works">
        <ListRow label="How the stars work" onPress={go("/stars")} />
        <ListRow label="Sources and credits" onPress={go("/settings/sources")} />
        <ListRow label="Ask your AI assistant" detail="The forecast in Claude, ChatGPT and more" onPress={go("/settings/ai")} />
      </ListSection>

      <ListSection title="wingfoil.ie">
        <ListRow label="About and updates" onPress={go("/settings/about")} />
        <ListRow label="wingfoil.ie" detail="The chart on the web" external onPress={() => openLink("https://wingfoil.ie/")} />
        <ListRow label="Privacy" external onPress={() => openLink("https://wingfoil.ie/privacy")} />
        <ListRow
          label="Source code"
          detail="Free software under the GNU AGPL v3"
          external
          onPress={() => openLink(SOURCE_CODE_URL)}
        />
      </ListSection>

      <T variant="caption" color="muted" style={styles.small}>
        Model forecasts only, never a safety statement. Look at the water, and never ride alone in offshore wind.
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space["4xl"] * 3 },
  small: { paddingHorizontal: space.lg, paddingTop: space.xl, fontFamily: fonts.bodyItalic },
});
