/**
 * Alerts: the rider's star-condition rules, each with its next window, on or
 * off at a touch. Empty, it says what an alert is for and offers one thing to
 * do. The rules live on the phone first and are sent to wingfoil.ie quietly
 * (features/alerts/sync.ts); the line under the title says whether they have
 * been.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { matchWindow, ruleSummary } from "../../../../alerts/shared/copy";
import type { AlertMatch, AlertRule, PreviewPayload } from "../../../../alerts/shared/protocol";
import { Button } from "../../components/Button";
import { thud, tick } from "../../components/haptics";
import { Rule } from "../../components/Rule";
import { Stars } from "../../components/Stars";
import { T } from "../../components/Text";
import { spotById } from "../../data/spots";
import { nextMatch, spotsSummary, syncLine } from "../../features/alerts/alertsLogic";
import { SwitchRow } from "../../features/alerts/controls";
import { PermissionNote } from "../../features/alerts/PermissionNote";
import { useRuleMatches } from "../../features/alerts/preview";
import { alertsStore, useAlerts } from "../../features/alerts/store";
import { removeThisPhone, requestSync, serverPreview } from "../../features/alerts/sync";
import { colors, hitTarget, space } from "../../theme/tokens";

const nameOf = (id: string) => spotById(id)?.name ?? id;
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false });

const openEditor = (id: string) => router.push({ pathname: "/alert/[id]", params: { id } });

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const alerts = useAlerts();
  const local = useRuleMatches(alerts.rules);
  const [server, setServer] = useState<PreviewPayload | null>(null);

  // The API's own preview, for when the phone has no published blend to hand.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      if (alerts.rules.length && !local)
        void serverPreview().then((p) => {
          if (current) setServer(p);
        });
      return () => {
        current = false;
      };
    }, [alerts.rules.length, local]),
  );

  const matchesOf = useMemo(() => {
    const fromServer = new Map(server?.rules.map((r) => [r.ruleId, r.matches]) ?? []);
    return (rule: AlertRule): AlertMatch[] | null =>
      local?.get(rule.id) ?? fromServer.get(rule.id) ?? null;
  }, [local, server]);

  const line = syncLine(alerts, alerts.status, clock);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space["4xl"] }]}
      contentInsetAdjustmentBehavior="never"
    >
      <View style={styles.head}>
        <T variant="title" accessibilityRole="header">
          Alerts
        </T>
        {line ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${line} Send again`}
            onPress={() => void requestSync()}
            hitSlop={space.sm}
          >
            <T variant="caption" color="muted">
              {line}
            </T>
          </Pressable>
        ) : null}
      </View>

      {alerts.rules.length === 0 ? (
        <Empty />
      ) : (
        <>
          <PermissionNote hasRules />
          <View>
            {alerts.rules.map((rule, i) => (
              <View key={rule.id}>
                {i > 0 ? <Rule /> : null}
                <RuleRow rule={rule} matches={matchesOf(rule)} />
              </View>
            ))}
          </View>
          <Rule strong />
          <Button
            label="New alert"
            kind="primary"
            size="lg"
            onPress={() => openEditor("new")}
            disabled={alerts.rules.length >= 20}
            accessibilityHint={alerts.rules.length >= 20 ? "Twenty alerts is the most a phone can have." : undefined}
            style={styles.newButton}
          />
          <View style={styles.settings}>
            <T variant="eyebrow" caps color="muted" accessibilityRole="header">
              On this phone
            </T>
            <SwitchRow
              label="Quiet overnight"
              note="Nothing from 22:00 to 07:00; what is found then arrives at 07:00."
              value={alerts.quietHours}
              onChange={(quietHours) => alertsStore.update(() => ({ quietHours }))}
            />
            <SwitchRow
              label="New versions"
              note="A note when an update to the app is out."
              value={alerts.appUpdates}
              onChange={(appUpdates) => alertsStore.update(() => ({ appUpdates }))}
            />
            <Button
              label="Remove this phone"
              kind="quiet"
              size="sm"
              accessibilityHint="Deletes your alerts here and on wingfoil.ie."
              onPress={() =>
                Alert.alert(
                  "Remove this phone?",
                  "Your alerts are deleted from this phone and from wingfoil.ie, and nothing more is sent.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => {
                        thud();
                        void removeThisPhone().catch(() =>
                          Alert.alert("Could not reach wingfoil.ie", "Try again when you are online."),
                        );
                      },
                    },
                  ],
                )
              }
              style={styles.remove}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Empty() {
  return (
    <View style={styles.empty}>
      <T variant="headline">Know when it is on.</T>
      <T variant="prose" color="ink2">
        Pick your spots, the stars you ride for, and the days and hours you can go. When a window is
        forecast, Wingfoil tells you, a day or three ahead: once, and again only if it moves.
      </T>
      <View style={styles.example} accessible accessibilityLabel="For example: Brandon Bay, four stars, Saturday 14:00 to 17:00. West-south-west 18 to 22 knots, gusts 26.">
        <T variant="spot">Brandon Bay</T>
        <View style={styles.exampleLine}>
          <Stars stars={4} size={12} />
          <T variant="figureSm" tabular>
            Sat 14:00–17:00
          </T>
        </View>
        <T variant="figureSm" color="muted" tabular>
          WSW 18–22 kn, gusts 26. Your 5.0 m wing.
        </T>
      </View>
      <Button label="Set up an alert" kind="primary" size="lg" onPress={() => openEditor("new")} style={styles.newButton} />
    </View>
  );
}

function RuleRow({ rule, matches }: { rule: AlertRule; matches: AlertMatch[] | null }) {
  const next = matches ? nextMatch(matches) : null;
  const ahead =
    rule.leadDays === 1 ? "today or tomorrow" : `the next ${rule.leadDays} days`;
  return (
    <View style={[styles.row, !rule.enabled && styles.rowOff]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${rule.name}. ${rule.minStars} stars or better at ${spotsSummary(rule.spots, nameOf, 3)}.`}
        accessibilityHint="Edit this alert"
        onPress={() => openEditor(rule.id)}
        style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
      >
        <T variant="lead" numberOfLines={1}>
          {rule.name}
        </T>
        <View style={styles.inline}>
          <Stars stars={rule.minStars} size={11} />
          <T variant="caption" color="ink2" numberOfLines={1} style={styles.grow}>
            {" or better · "}
            {spotsSummary(rule.spots, nameOf)}
          </T>
        </View>
        <T variant="caption" color="muted" numberOfLines={1}>
          {ruleSummary(rule)}
        </T>
        <T variant="figureSm" color={next ? "ink" : "muted"} numberOfLines={1} tabular style={styles.next}>
          {!rule.enabled
            ? "Off"
            : !matches
              ? "Next: waiting for the forecast"
              : next
                ? `Next: ${matchWindow(next)} ${nameOf(next.spotId)}${matches.length > 1 ? ` +${matches.length - 1}` : ""}`
                : `Nothing in ${ahead}`}
        </T>
      </Pressable>
      <Switch
        accessibilityLabel={`${rule.name} on`}
        value={rule.enabled}
        onValueChange={(enabled) => {
          tick();
          alertsStore.setEnabled(rule.id, enabled);
        }}
        trackColor={{ false: colors.line, true: colors.ink }}
        thumbColor={colors.paper}
        ios_backgroundColor={colors.line}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.lg, gap: space.lg },
  head: { gap: space.xs },
  empty: { gap: space.lg, paddingTop: space.xl },
  example: {
    gap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  exampleLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  newButton: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowOff: { opacity: 0.55 },
  rowBody: { flex: 1, gap: space["2xs"], minHeight: hitTarget },
  pressed: { backgroundColor: colors.sunken },
  inline: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  next: { marginTop: space.xs },
  settings: { gap: space.sm, paddingTop: space.lg },
  remove: { alignSelf: "flex-start", marginTop: space.sm },
});
