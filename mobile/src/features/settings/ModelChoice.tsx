/**
 * Which one model the stars come from (force5/src/lead.ts, the ruling of 19
 * October 2026): the rider's choice for every spot and the one that takes
 * over where its run ends, on its own settings page beside "Models in the
 * blend"; and a model of a spot's own, chosen on the spot page or from the
 * dock's chip, which shows while a spot has one so nobody wonders why two
 * spots disagree. Each writes the rider (force5.prefs.v1) through
 * `withRiderStarsFrom`, so the chart, the dock, the spot pages and the alerts
 * follow at once.
 */
import { memo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { modelName, spotOverride, starsFromAt, starsFromText } from "../../../../force5/src/lead";
import { Button } from "../../components/Button";
import { Chevron } from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { ListRow, ListSection } from "../../components/List";
import { Rule } from "../../components/Rule";
import { T } from "../../components/Text";
import { usePrefs } from "../../data/prefs";
import { spotById } from "../../data/spots";
import { colors, controlHeight, fonts, hitTarget, radius, shadow, space } from "../../theme/tokens";
import { STAR } from "../stars/StarRating";
import { SettingsPage } from "./SettingsPage";
import {
  STARS_FROM_NOTE,
  pickStarsModel,
  spotOverrides,
  spotStarsRows,
  starsModelRows,
  thenRows,
  thenTitle,
} from "./settingsLogic";

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

/** Settings → Stars from: the model, the one that takes over, and the spots of the rider's own. */
export function StarsFromScreen() {
  const { prefs, setStarsFrom } = usePrefs();
  const choice = prefs.rider.starsFrom;
  const from = starsFromAt(choice);
  const own = spotOverrides(choice);
  return (
    <SettingsPage title="Stars from">
      <ListSection title="Stars from" footer="Every hour is rated from this model's own wind, gust and direction while its run reaches the hour.">
        <View accessibilityRole="radiogroup" accessibilityLabel="Stars from">
          {starsModelRows(choice).map((row) => (
            <RadioRow
              key={row.id}
              label={row.name}
              detail={row.detail}
              on={row.on}
              onPress={() => setStarsFrom({ everywhere: pickStarsModel(from, row.id) })}
            />
          ))}
        </View>
      </ListSection>
      <ListSection
        title={thenTitle(choice)}
        footer={`Past the end of ${modelName(from.model)}'s run, this one rates the hours left. An hour neither reaches has no stars.`}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={thenTitle(choice)}>
          {thenRows(choice).map((row) => (
            <RadioRow
              key={row.id}
              label={row.name}
              detail={row.detail}
              on={row.on}
              onPress={() => setStarsFrom({ everywhere: { then: row.id } })}
            />
          ))}
        </View>
      </ListSection>
      {own.length ? (
        <ListSection title="Spots of your own" footer="Rated from another model, chosen on the spot's page. Tap one to rate it like everywhere else.">
          {own.map((spot) => (
            <ListRow
              key={spot.id}
              label={spotById(spot.id)?.name ?? spot.id}
              value={spot.name}
              hint={`Rates ${spotById(spot.id)?.name ?? "this spot"} from ${starsFromText(from)} again`}
              onPress={() => setStarsFrom({ spot: spot.id, model: null })}
            />
          ))}
        </ListSection>
      ) : null}
      <T variant="caption" color="muted" style={styles.small}>
        {STARS_FROM_NOTE}
      </T>
    </SettingsPage>
  );
}

/** The models to choose from at one spot, over a scrim. */
export function SpotStarsSheet({ spotId, visible, onClose }: { spotId: string; visible: boolean; onClose: () => void }) {
  const { prefs, setStarsFrom } = usePrefs();
  const choice = prefs.rider.starsFrom;
  const name = spotById(spotId)?.name ?? "this spot";
  const from = starsFromAt(choice);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait"]}
    >
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      {visible ? (
        <View style={styles.wrap} pointerEvents="box-none">
          <View style={styles.card} accessibilityViewIsModal>
            <View style={styles.inner}>
              <T variant="eyebrow" caps color="muted" accessibilityRole="header">
                Stars at {name}
              </T>
              <View accessibilityRole="radiogroup" accessibilityLabel={`Stars at ${name}`}>
                {spotStarsRows(choice, spotId).map((row) => (
                  <RadioRow
                    key={row.value}
                    label={row.label}
                    on={row.on}
                    onPress={() => setStarsFrom({ spot: spotId, model: row.value === "same" ? null : row.value })}
                  />
                ))}
              </View>
              <T variant="caption" color="muted" style={styles.italic}>
                For a spot where you trust another model more. Where its run ends, {modelName(from.then)} takes over,
                as everywhere.
              </T>
              <Rule style={styles.rule} />
              <View style={styles.actions}>
                <Button kind="pill" size="sm" label="Done" onPress={onClose} />
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

/** The dock's head while the open spot has a model of its own: "★ from GFS", a tap to change it. */
export const SpotStarsChip = memo(function SpotStarsChip({ spotId }: { spotId: string }) {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const own = spotOverride(prefs.rider.starsFrom, spotId);
  if (!own) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stars here from ${modelName(own)}: change`}
        hitSlop={(hitTarget - controlHeight.sm) / 2}
        onPress={() => {
          tick();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      >
        <Svg width={10} height={10} viewBox="-5 -5 10 10" accessible={false}>
          <Path d={STAR} fill={colors.magenta} />
        </Svg>
        <T variant="label" caps color="magenta">
          from {modelName(own)}
        </T>
      </Pressable>
      <SpotStarsSheet spotId={spotId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
});

/** The spot page's line under who the stars are for: where they come from here, a tap to change it. */
export function SpotStarsLine({ spotId }: { spotId: string }) {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const choice = prefs.rider.starsFrom;
  const here = starsFromAt(choice, spotId);
  const own = spotOverride(choice, spotId);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stars from ${starsFromText(here)}${own ? ", at this spot only" : ""}`}
        accessibilityHint="Chooses another model for this spot"
        onPress={() => {
          tick();
          setOpen(true);
        }}
        style={styles.line}
      >
        <T variant="eyebrow" caps color="muted">
          Stars from
        </T>
        <T variant="label" caps color={own ? "magenta" : "ink"} style={styles.underline}>
          {starsFromText(here)}
          {own ? " · here only" : ""}
        </T>
        <Chevron up={false} size={11} />
      </Pressable>
      <SpotStarsSheet spotId={spotId} visible={open} onClose={() => setOpen(false)} />
    </>
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
  small: { paddingHorizontal: space.lg, paddingTop: space.xl, fontFamily: fonts.bodyItalic },
  italic: { fontFamily: fonts.bodyItalic },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  wrap: { ...StyleSheet.absoluteFill, justifyContent: "center", paddingHorizontal: space.lg },
  card: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ink,
    padding: space["2xs"],
    boxShadow: shadow.surface,
  },
  inner: { borderWidth: 1, borderColor: colors.ink, padding: space.lg, gap: space.sm },
  rule: { marginVertical: space.xs },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", minHeight: hitTarget },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    height: controlHeight.sm,
    paddingHorizontal: space.sm + space["2xs"],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.magenta,
    alignSelf: "center",
    marginLeft: space.xs,
  },
  chipPressed: { backgroundColor: colors.sunken },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hitTarget, alignSelf: "flex-start" },
  underline: { textDecorationLine: "underline", textDecorationColor: colors.lineStrong },
});
