/**
 * The More tab's pages: the rider, the units, the dock's rows, the models in
 * the blend, and where the data comes from. Each writes the site's own
 * preference (force5.prefs.v1) through `usePrefs().update`, so the chart, the
 * dock and the spot pages follow at once.
 */
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { windModels } from "../../../../force5/src/manifests";
import { setRow } from "../../../../force5/src/prefs";
import { ESTIMATE_WEIGHT_KG } from "../../../../force5/src/stars";
import { UNITS } from "../../../../force5/src/units";
import { bandKnots } from "../../../../spot/web/spot";
import { tick } from "../../components/haptics";
import { ListRow, ListSection, ListSwitch } from "../../components/List";
import { T } from "../../components/Text";
import { useForecast } from "../../data/forecast";
import { usePrefs } from "../../data/prefs";
import { colors, fonts, hitTarget, space } from "../../theme/tokens";
import { DOCK_ROWS, dockRowOn } from "../dock/dockLogic";
import { CustomiseLink, LevelSwitch, WeightField, WingChips, useRider } from "./RiderFields";
import { SettingsPage, openLink } from "./SettingsPage";
import { CREDITS, LICENCE_URL, SOURCE_CODE_URL, modelRows, riderWords, runText, toggleBlendModel } from "./settingsLogic";

export function RiderScreen() {
  const [rider, change] = useRider();
  const band = bandKnots(rider);
  return (
    <SettingsPage title="Your riding">
      <ListSection title="Level">
        <View style={styles.block}>
          <View>
            <LevelSwitch />
            <CustomiseLink />
          </View>
          <T variant="body" color="ink2">
            {riderWords(rider)}: below {band.min} kn you cannot stay up for long; {band.sweetLow}–{band.sweetHigh} kn
            is the sweet spot; past {band.max} kn is more than you will want to hold.
          </T>
        </View>
      </ListSection>
      <ListSection
        title="Weight"
        footer={`Heavier riders need more wind. Until you set it, the stars assume ${ESTIMATE_WEIGHT_KG} kg.`}
      >
        <View style={styles.block}>
          <WeightField rider={rider} onChange={change} />
        </View>
      </ListSection>
      <ListSection
        title="Wings you own, m²"
        footer="With none chosen, each hour suggests the size a rider like you would take. With your wings, it picks the smallest one big enough, and an hour none of them suits loses a star."
      >
        <View style={styles.block}>
          <WingChips rider={rider} onChange={change} />
        </View>
      </ListSection>
    </SettingsPage>
  );
}

function Check() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" accessible={false}>
      <Path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={colors.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UnitsScreen() {
  const { prefs, update } = usePrefs();
  return (
    <SettingsPage title="Units">
      <ListSection title="Wind speed" footer="Every speed is kept in metres per second and shown in the units you choose.">
        <View accessibilityRole="radiogroup">
          {UNITS.map((unit) => {
            const on = prefs.units === unit.id;
            return (
              <Pressable
                key={unit.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={unit.name}
                onPress={() => {
                  if (on) return;
                  tick();
                  update((p) => ({ ...p, units: unit.id }));
                }}
                style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
              >
                <T variant="prose" style={styles.flex}>
                  {unit.name}
                </T>
                <T variant="figureSm" color="muted">
                  {unit.label}
                </T>
                <View style={styles.check}>{on ? <Check /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </ListSection>
    </SettingsPage>
  );
}

export function RowsScreen() {
  const { prefs, update } = usePrefs();
  const always = DOCK_ROWS.filter((r) => !r.more);
  const fold = DOCK_ROWS.filter((r) => r.more);
  const row = (info: (typeof DOCK_ROWS)[number]) =>
    info.key ? (
      <ListSwitch
        key={info.row}
        label={info.label}
        detail={info.row === "sea" ? "Untouched, it shows where a station measures the sea" : undefined}
        value={dockRowOn(prefs, info.row, info.row === "sea" ? false : true)}
        onChange={(on) => update((p) => setRow(p, info.key!, on))}
      />
    ) : (
      <ListRow key={info.row} label={info.label} value="Always" />
    );
  return (
    <SettingsPage title="Dock rows">
      <ListSection title="Under the hours">{always.map(row)}</ListSection>
      <ListSection title="More rows" footer="Opened with the chevron in the dock's head: the waves, the sky, the air, the rain and the sea.">
        {fold.map(row)}
      </ListSection>
    </SettingsPage>
  );
}

export function ModelsScreen() {
  const { prefs, update } = usePrefs();
  const { models, published, wantModels } = useForecast();
  useEffect(() => {
    wantModels();
  }, [wantModels]);
  const entries = useMemo(() => windModels(), []);
  const rows = modelRows(entries, models, prefs.blendModels, true);
  const order = entries.map((e) => e.id);
  const own = order.some((id) => !prefs.blendModels.includes(id));
  return (
    <SettingsPage title="Models in the blend">
      <ListSection
        title="Wind models"
        footer={
          own
            ? "You have left a model out, so the blend is worked out on this phone from the models you keep."
            : published
              ? `The published blend of every model, worked out ${runText(published.generatedAt)}.`
              : "The blend of every model."
        }
      >
        {rows.map((row) => (
          <ListSwitch
            key={row.id}
            label={row.name}
            detail={[row.detail, row.status].filter(Boolean).join(" · ")}
            value={row.on}
            disabled={row.on && prefs.blendModels.length === 1}
            onChange={(on) =>
              update((p) => ({ ...p, blendModels: toggleBlendModel(p.blendModels, row.id, on, order) }))
            }
          />
        ))}
      </ListSection>
      {published && !own ? (
        <ListSection title="Behind the published blend">
          {published.sources.map((source) => (
            <ListRow key={source.id} label={source.name} value={`Run ${runText(source.runTime)}`} />
          ))}
        </ListSection>
      ) : null}
      <T variant="caption" color="muted" style={styles.small}>
        The stars rate HARMONIE&rsquo;s own forecast while it reaches the hour; past it, a weighted median of the other
        models, each counting by how well it has verified against Irish stations that far into its run.
      </T>
    </SettingsPage>
  );
}

export function SourcesScreen() {
  const { models } = useForecast();
  const live = models.flatMap((m) =>
    m.wind?.attribution ? [{ name: m.entry.name, text: m.wind.attribution }] : [],
  );
  return (
    <SettingsPage title="Sources and credits">
      <ListSection title="The data" footer="Data keeps its own licence, credited where it is shown.">
        {CREDITS.map((credit) => (
          <ListRow key={credit.what} label={credit.what} detail={credit.who} />
        ))}
      </ListSection>
      {live.length ? (
        <ListSection title="As the runs credit themselves">
          {live.map((item) => (
            <ListRow key={item.name} label={item.name} detail={item.text} />
          ))}
        </ListSection>
      ) : null}
      <ListSection title="The code" footer="wingfoil.ie is free software: you may run, study, change and share it under the GNU Affero General Public License v3.">
        <ListRow label="Source code" detail={SOURCE_CODE_URL.replace("https://", "")} external onPress={() => openLink(SOURCE_CODE_URL)} />
        <ListRow label="Licence" detail="GNU AGPL v3" external onPress={() => openLink(LICENCE_URL)} />
      </ListSection>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.md, paddingVertical: space.md },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: hitTarget + space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.sunken },
  flex: { flex: 1 },
  check: { width: space.xl, alignItems: "center" },
  small: { paddingHorizontal: space.lg, paddingTop: space.xl, fontFamily: fonts.bodyItalic },
});
