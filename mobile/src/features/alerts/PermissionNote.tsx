/**
 * Asking for notifications the right way round: say what will be sent first,
 * then show the system prompt; once refused for good, point at Settings; and
 * on a build that cannot have push at all, say so plainly.
 */
import { StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { done, refused } from "../../components/haptics";
import { T } from "../../components/Text";
import { colors, space } from "../../theme/tokens";
import { usePushPermission } from "./permissions";

export function PermissionNote({ hasRules }: { hasRules: boolean }) {
  const { permission, support, ask, openSettings } = usePushPermission();
  if (!hasRules || permission === "granted" || permission === "unknown") return null;

  if (support !== "ok")
    return (
      <View style={styles.note} accessibilityRole="summary">
        <T variant="lead">Push is not available on this build</T>
        <T variant="body" color="ink2">
          {support === "simulator"
            ? "A simulator cannot receive notifications. Your alerts are saved and checked; try them on a phone."
            : "This build of the app was made without push notifications. Your alerts are saved, and start arriving on a build that has them."}
        </T>
      </View>
    );

  if (permission === "blocked")
    return (
      <View style={styles.note} accessibilityRole="summary">
        <T variant="lead">Notifications are off for Wingfoil</T>
        <T variant="body" color="ink2">
          Your alerts are saved, but the phone will not show them. Turn notifications on in Settings.
        </T>
        <Button label="Open Settings" kind="primary" onPress={openSettings} style={styles.action} />
      </View>
    );

  return (
    <View style={styles.note} accessibilityRole="summary">
      <T variant="lead">Let Wingfoil tell you</T>
      <T variant="body" color="ink2">
        One notification when a window you asked for is forecast, another only if it moves or its stars
        change. Nothing overnight unless you say so, and nothing else.
      </T>
      <Button
        label="Allow notifications"
        kind="primary"
        onPress={() =>
          void ask().then((answer) => (answer === "granted" ? done() : refused()))
        }
        style={styles.action}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    gap: space.sm,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.ink,
  },
  action: { alignSelf: "flex-start", marginTop: space.xs },
});
