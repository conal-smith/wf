/**
 * One alert, made or changed: which spots, how many stars, which days and
 * hours, how long a window and how far ahead. As it is shaped, the forecast
 * the phone already has says how many windows it would find (the same
 * matching the API sends from). Opened as a modal with `id` = an alert's id
 * or "new", and `spot` to start from a spot.
 */
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { matchFigures, matchWindow } from "../../../../alerts/shared/copy";
import { LIMITS, WEEKDAYS, type AlertRule } from "../../../../alerts/shared/protocol";
import { hourLabel, WEEKDAY_SHORT } from "../../../../alerts/shared/time";
import { Button } from "../../components/Button";
import { done, refused, thud, tick } from "../../components/haptics";
import { Rule } from "../../components/Rule";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { useFavourites } from "../../data/favourites";
import { useForecast } from "../../data/forecast";
import { searchSpots, spotById } from "../../data/spots";
import {
  DAY_PRESETS,
  draftProblem,
  draftRule,
  ruleName,
  toggleDay,
} from "../../features/alerts/alertsLogic";
import { Chip, Section, Stepper, SwitchRow } from "../../features/alerts/controls";
import { useRuleMatches } from "../../features/alerts/preview";
import { alertsStore, useAlerts } from "../../features/alerts/store";
import { colors, hitTarget, radius, space, type as typeScale } from "../../theme/tokens";

const nameOf = (id: string) => spotById(id)?.name ?? id;
const sameDays = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && b.every((d) => a.includes(d));

export default function AlertEditor() {
  const { id, spot } = useLocalSearchParams<{ id: string; spot?: string }>();
  const insets = useSafeAreaInsets();
  const alerts = useAlerts();
  const existing = alerts.rules.find((r) => r.id === id) ?? null;
  // An id this phone no longer has opens as a new alert.
  const isNew = id === "new" || !existing;
  const [draft, setDraft] = useState<AlertRule>(() => {
    if (existing) return existing;
    const from = spot ? spotById(spot) : undefined;
    return draftRule(from ? { id: from.id, name: from.name } : null);
  });
  const [problem, setProblem] = useState<string | null>(null);
  const change = (patch: Partial<AlertRule>) => {
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = () => {
    const why = draftProblem(draft);
    if (why) {
      refused();
      setProblem(why);
      return;
    }
    done();
    alertsStore.saveRule({ ...draft, name: ruleName(draft, nameOf) });
    router.back();
  };

  const remove = () =>
    Alert.alert("Delete this alert?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          thud();
          alertsStore.deleteRule(draft.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: isNew ? "New alert" : "Edit alert" }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space["4xl"] }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Section title="Name">
          <TextInput
            accessibilityLabel="Name"
            value={draft.name}
            onChangeText={(name) => change({ name: name.slice(0, LIMITS.nameChars) })}
            placeholder={draft.spots.length ? ruleName({ ...draft, name: "" }, nameOf) : "Saturday at Brandon"}
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="done"
            maxLength={LIMITS.nameChars}
          />
        </Section>
        <Rule />

        <SpotPicker spots={draft.spots} onChange={(spots) => change({ spots })} />
        <Rule />

        <Section title="Stars">
          <Stepper
            label="Stars or better"
            value={draft.minStars}
            min={LIMITS.minStars.min}
            max={LIMITS.minStars.max}
            onChange={(minStars) => change({ minStars })}
            format={(n) => `${n} star${n === 1 ? "" : "s"} or better`}
          >
            <Stars stars={draft.minStars} size={18} best={draft.minStars === 5} />
          </Stepper>
          <Preview rule={draft} />
        </Section>
        <Rule />

        <Section title="Days">
          <View style={styles.wrap}>
            {DAY_PRESETS.map((p) => (
              <Chip
                key={p.label}
                label={p.label}
                on={sameDays(draft.days, p.days)}
                onPress={() => change({ days: [...p.days] })}
              />
            ))}
          </View>
          <View style={styles.wrap}>
            {WEEKDAYS.map((d) => (
              <Chip
                key={d}
                label={WEEKDAY_SHORT[d]}
                on={draft.days.includes(d)}
                onPress={() => change({ days: toggleDay(draft.days, d) })}
              />
            ))}
          </View>
        </Section>
        <Rule />

        <Section
          title="Hours, Irish time"
          aside={
            <Chip
              label="Daylight"
              on={draft.fromHour === 0 && draft.toHour === 24}
              accessibilityLabel="Any hour of daylight"
              onPress={() => change({ fromHour: 0, toHour: 24 })}
            />
          }
        >
          <View style={styles.hours}>
            <View style={styles.hour}>
              <T variant="label" caps color="muted">
                From
              </T>
              <Stepper
                label="From"
                value={draft.fromHour}
                min={0}
                max={draft.toHour - 1}
                onChange={(fromHour) => change({ fromHour })}
                format={hourLabel}
              />
            </View>
            <View style={styles.hour}>
              <T variant="label" caps color="muted">
                Until
              </T>
              <Stepper
                label="Until"
                value={draft.toHour}
                min={draft.fromHour + 1}
                max={24}
                onChange={(toHour) => change({ toHour })}
                format={hourLabel}
              />
            </View>
          </View>
          <T variant="caption" color="muted">
            The night is never rated, so the hours are only ever daylight.
          </T>
        </Section>
        <Rule />

        <Section title="A window is">
          <Stepper
            label="Hours in a row"
            value={draft.minHours}
            min={LIMITS.minHours.min}
            max={LIMITS.minHours.max}
            onChange={(minHours) => change({ minHours })}
            format={(n) => `${n} h or more`}
          />
        </Section>
        <Rule />

        <Section title="Tell me">
          <Stepper
            label="How far ahead"
            value={draft.leadDays}
            min={LIMITS.leadDays.min}
            max={LIMITS.leadDays.max}
            onChange={(leadDays) => change({ leadDays })}
            format={(n) => (n === 1 ? "today or tomorrow" : `up to ${n} days ahead`)}
          />
          <SwitchRow
            label="If it is called off"
            note="A word when a window you were told of is no longer forecast."
            value={draft.calledOff}
            onChange={(calledOff) => change({ calledOff })}
          />
          <SwitchRow
            label="Quiet overnight"
            note="For every alert on this phone: nothing from 22:00 to 07:00."
            value={alerts.quietHours}
            onChange={(quietHours) => alertsStore.update(() => ({ quietHours }))}
          />
        </Section>
        <Rule strong />

        {problem ? (
          <T variant="body" color="warn" accessibilityLiveRegion="polite" style={styles.problem}>
            {problem}
          </T>
        ) : null}
        <View style={styles.actions}>
          <Button label={isNew ? "Save alert" : "Save"} kind="primary" size="lg" onPress={save} />
          {!isNew ? <Button label="Delete" kind="danger" onPress={remove} /> : null}
        </View>
      </ScrollView>
    </>
  );
}

/** How many windows the draft would find now, and the first few. */
function Preview({ rule }: { rule: AlertRule }) {
  const { published } = useForecast();
  const rules = useMemo(() => [{ ...rule, enabled: true }], [rule]);
  const matches = useRuleMatches(rules)?.get(rule.id) ?? null;
  const ahead = rule.leadDays === 1 ? "today or tomorrow" : `in the next ${rule.leadDays} days`;
  let line: string;
  if (!rule.spots.length) line = "Pick a spot to see what it would find.";
  else if (!published) line = "The preview needs the published forecast, which is not loaded.";
  else if (!matches) line = "Reading the forecast…";
  else if (!matches.length) line = `Nothing ${ahead} at the moment.`;
  else line = `${matches.length} window${matches.length === 1 ? "" : "s"} ${ahead}.`;
  return (
    <View style={styles.preview} accessibilityLiveRegion="polite">
      <T variant="body" color={matches?.length ? "ink" : "muted"}>
        {line}
      </T>
      {matches?.slice(0, 3).map((m) => (
        <View key={`${m.spotId}|${m.day}`} style={styles.previewRow}>
          <Stars stars={m.stars} potential={m.peakStars} size={11} />
          <View style={styles.grow}>
            <T variant="figureSm" tabular numberOfLines={1}>
              {matchWindow(m)} {nameOf(m.spotId)}
            </T>
            <T variant="caption" color="muted" numberOfLines={1}>
              {matchFigures(m)}
            </T>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The alert's spots, chosen by search, the rider's starred and most-opened first. */
function SpotPicker({ spots, onChange }: { spots: string[]; onChange: (spots: string[]) => void }) {
  const [query, setQuery] = useState("");
  const { starred, frequent } = useFavourites();
  const suggestions = useMemo(() => {
    if (query.trim()) return searchSpots(query, 12);
    const ids = [...new Set([...starred, ...frequent.map((f) => f.id)])];
    return ids.flatMap((id) => {
      const s = spotById(id);
      return s ? [s] : [];
    });
  }, [query, starred, frequent]);
  const full = spots.length >= LIMITS.spotsPerRule;
  const toggle = (id: string) => {
    if (spots.includes(id)) onChange(spots.filter((s) => s !== id));
    else if (full) refused();
    else onChange([...spots, id]);
  };

  return (
    <Section
      title={`Spots${spots.length ? ` · ${spots.length}` : ""}`}
      aside={
        full ? (
          <T variant="caption" color="muted">
            {LIMITS.spotsPerRule} at most
          </T>
        ) : undefined
      }
    >
      {spots.length ? (
        <View style={styles.wrap}>
          {spots.map((id) => (
            <Chip key={id} label={nameOf(id)} on onPress={() => toggle(id)} trailing="×" accessibilityLabel={`Remove ${nameOf(id)}`} />
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Find a spot"
        value={query}
        onChangeText={setQuery}
        placeholder="Find a spot or a county"
        placeholderTextColor={colors.muted}
        style={styles.input}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {!query.trim() && suggestions.length ? (
        <T variant="label" caps color="muted">
          Your spots
        </T>
      ) : null}
      {!suggestions.length ? (
        <T variant="caption" color="muted">
          {query.trim() ? "No spot by that name." : "Star a spot on the chart to have it here, or search."}
        </T>
      ) : null}
      {suggestions.map((s) => {
        const on = spots.includes(s.id);
        return (
          <Pressable
            key={s.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${s.name}${s.county ? `, ${s.county}` : ""}`}
            onPress={() => {
              tick();
              toggle(s.id);
            }}
            style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
          >
            <View style={styles.grow}>
              <T variant="spot" numberOfLines={1}>
                {s.name}
              </T>
              {s.county ? (
                <T variant="caption" color="muted">
                  {s.county}
                </T>
              ) : null}
            </View>
            <T variant="figure" color={on ? "ink" : "muted"}>
              {on ? "✓" : "+"}
            </T>
          </Pressable>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm },
  input: {
    ...typeScale.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: hitTarget,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  hours: { flexDirection: "row", flexWrap: "wrap", gap: space.xl },
  hour: { gap: space.xs },
  preview: { gap: space.sm, paddingTop: space.sm },
  previewRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  grow: { flex: 1 },
  suggestion: { flexDirection: "row", alignItems: "center", minHeight: hitTarget, gap: space.md, paddingVertical: space.xs },
  pressed: { backgroundColor: colors.sunken },
  problem: { paddingTop: space.md },
  actions: { flexDirection: "row", alignItems: "center", gap: space.md, paddingTop: space.lg },
});
