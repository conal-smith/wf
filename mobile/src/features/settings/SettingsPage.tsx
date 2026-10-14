/**
 * A settings page under the root stack: the native large title, and a scroll
 * that lets it collapse. Paper all the way down.
 */
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { colors, space } from "../../theme/tokens";

export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitleEnabled: true }} />
      <ScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </>
  );
}

/** A page of the site or elsewhere, in the system's own browser sheet. */
export const openLink = (url: string) =>
  void WebBrowser.openBrowserAsync(url, {
    controlsColor: colors.ink,
    toolbarColor: colors.paper,
    dismissButtonStyle: "done",
  }).catch(() => undefined);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: space["4xl"] * 2 },
});
