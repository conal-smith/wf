/**
 * About: which Wingfoil this is, down to the update it runs, and a visible
 * "Check for updates" with t3code's states (Checking, Downloading, Restarting,
 * Up to date). Tapping the version five times shows the whole runtime and
 * update ids, for a bug report. docs/MOBILE.md says what each line means.
 */
import { Stack } from "expo-router";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/Button";
import { Rule } from "../../components/Rule";
import { T } from "../../components/Text";
import { checkAndFetch, restartIntoUpdate, runningApp, updatesEnabled } from "../../features/updates/appUpdates";
import {
  DETAIL_TAPS,
  checkBusy,
  checkLabel,
  formatPublished,
  shortId,
  type CheckState,
} from "../../features/updates/updatesLogic";
import { useStoreUpdate } from "../../features/updates/useStoreUpdate";
import { colors, hitTarget, space } from "../../theme/tokens";

const SOURCE_URL = "https://github.com/sprintengine/wingfoil";
const LICENCE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

const VARIANT_NAME = { production: "Production", staging: "Staging", development: "Development" } as const;

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const body = (
    <View style={styles.row}>
      <T variant="label" caps color="muted">
        {label}
      </T>
      <T variant="figureSm" tabular selectable style={styles.value}>
        {value}
      </T>
    </View>
  );
  return (
    <>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      <Rule />
    </>
  );
}

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const app = runningApp();
  const store = useStoreUpdate();
  const { isDownloading } = Updates.useUpdates();
  const [state, setState] = useState<CheckState>(updatesEnabled ? "idle" : "off");
  const [taps, setTaps] = useState(0);
  const detail = taps >= DETAIL_TAPS;

  const check = async () => {
    setState("checking");
    try {
      const outcome = await checkAndFetch();
      if (outcome === "off") return setState("off");
      if (outcome === "none") return setState("upToDate");
      setState("restarting");
      await restartIntoUpdate();
    } catch {
      setState("failed");
    }
  };
  // expo-updates says when the check has turned into a download.
  const shown: CheckState = state === "checking" && isDownloading ? "downloading" : state;
  const working = shown === "checking" || shown === "downloading" || shown === "restarting";

  const update = app.isEmbeddedLaunch ? "Shipped with this build" : shortId(app.updateId);

  return (
    <ScrollView
      style={{ backgroundColor: colors.paper }}
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + space["3xl"] }]}
    >
      <Stack.Screen options={{ title: "About" }} />
      <T variant="title" accessibilityRole="header">
        Wingfoil
      </T>
      <T variant="body" color="ink2">
        The wing-foil forecast for Ireland, from wingfoil.ie.
      </T>

      <View style={styles.table}>
        <Rule strong />
        <Row
          label="Version"
          value={app.version || "—"}
          onPress={() => setTaps((n) => (n >= DETAIL_TAPS ? 0 : n + 1))}
        />
        <Row label="Build" value={app.build ?? "—"} />
        <Row label="App" value={VARIANT_NAME[app.variant]} />
        <Row label="Channel" value={app.channel ?? "—"} />
        <Row label="Runtime" value={detail ? (app.runtimeVersion ?? "—") : shortId(app.runtimeVersion, 12)} />
        <Row label="Update" value={detail && app.updateId ? app.updateId : update} />
        <Row label="Published" value={formatPublished(app.createdAt)} />
      </View>

      {app.isEmergencyLaunch ? (
        <T variant="caption" color="warn">
          The last update could not start, so this is the version the app shipped with
          {detail && app.emergencyLaunchReason ? `: ${app.emergencyLaunchReason}` : "."}
        </T>
      ) : null}

      <View style={styles.block}>
        <Button
          kind="pill"
          label={checkLabel(shown)}
          onPress={() => void check()}
          disabled={checkBusy(shown)}
          busy={working}
          accessibilityHint="Looks for a newer version of the app and restarts into it"
        />
        {working ? (
          <T variant="caption" color="muted" accessibilityLiveRegion="polite">
            {checkLabel(shown)}
          </T>
        ) : null}
      </View>

      {store.kind !== "none" ? (
        <View style={styles.block}>
          <T variant="body">
            Wingfoil {store.version} is in {Platform.OS === "ios" ? "the App Store" : "Google Play"}.
          </T>
          <Button
            kind="primary"
            label="Update"
            onPress={() => {
              Linking.openURL(store.url).catch(() => undefined);
            }}
          />
        </View>
      ) : null}

      <View style={styles.block}>
        <T variant="caption" color="ink2">
          Wingfoil is free software under the GNU Affero General Public License, version 3.
        </T>
        <View style={styles.links}>
          <Button kind="quiet" size="sm" label="Source code" onPress={() => void WebBrowser.openBrowserAsync(SOURCE_URL)} />
          <Button kind="quiet" size="sm" label="Licence" onPress={() => void WebBrowser.openBrowserAsync(LICENCE_URL)} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.lg },
  table: { marginTop: space.sm },
  row: {
    minHeight: hitTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
  },
  value: { flexShrink: 1, textAlign: "right" },
  block: { gap: space.sm, alignItems: "flex-start" },
  links: { flexDirection: "row", gap: space.sm, marginLeft: -space.md },
});
