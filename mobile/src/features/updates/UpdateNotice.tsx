/**
 * How the app tells a rider about an update, mounted once over every screen
 * (src/app/_layout.tsx). Mostly it says nothing: an over-the-air update is put
 * in place when the rider leaves the app (useAppUpdates). It speaks up in three
 * cases, in this order:
 *
 *  1. this binary is below app/latest.json's minimum: a page that covers the
 *     app and sends them to the store (the forecast it would draw may be wrong);
 *  2. an update has waited half an hour of use: a slip of paper at the top,
 *     "Update ready", with Later and Restart;
 *  3. the store has a newer binary this one cannot catch up with over the air:
 *     the same slip, with Not now and Update.
 *
 * Never a system alert, never over a gesture in progress (hold.ts), never a
 * restart the rider did not ask for while they are looking.
 */
import type { ReactNode } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../components/Button";
import { T } from "../../components/Text";
import { colors, motion, shadow, space } from "../../theme/tokens";
import { useUpdatesHeld } from "./hold";
import { useAppUpdates } from "./useAppUpdates";
import { useStoreUpdate } from "./useStoreUpdate";

const STORE_NAME = Platform.OS === "ios" ? "the App Store" : "Google Play";

export function UpdateNotice() {
  const insets = useSafeAreaInsets();
  const held = useUpdatesHeld();
  const ota = useAppUpdates();
  const store = useStoreUpdate();

  const open = (url: string) => {
    Linking.openURL(url).catch(() => undefined);
  };

  if (store.kind === "required")
    return (
      <View
        style={[styles.cover, { paddingTop: insets.top + space["4xl"], paddingBottom: insets.bottom + space["2xl"] }]}
        accessibilityViewIsModal
      >
        <T variant="eyebrow" caps color="muted">
          Update needed
        </T>
        <T variant="title" accessibilityRole="header">
          Time for a new Wingfoil
        </T>
        <T variant="prose" color="ink2">
          This version is too old to read today&apos;s forecast reliably. Wingfoil {store.version} is free in{" "}
          {STORE_NAME}.
        </T>
        <Button
          kind="primary"
          size="lg"
          label={Platform.OS === "ios" ? "Open the App Store" : "Open Google Play"}
          onPress={() => open(store.url)}
          style={styles.coverAction}
        />
      </View>
    );

  let slip: ReactNode = null;
  if (ota.offer)
    slip = (
      <Slip
        key="ota"
        eyebrow="Update ready"
        text="It installs when you next leave the app."
        secondary={{ label: "Later", onPress: ota.later }}
        primary={{ label: "Restart", onPress: () => void ota.restart(), busy: ota.restarting }}
      />
    );
  else if (store.kind === "available")
    slip = (
      <Slip
        key="store"
        eyebrow={`New in ${STORE_NAME}`}
        text={`Wingfoil ${store.version} has changes this version cannot pick up by itself.`}
        secondary={{ label: "Not now", onPress: store.dismiss }}
        primary={{ label: "Update", onPress: () => open(store.url) }}
      />
    );

  if (!slip || held) return null;
  return (
    <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space.sm }]}>
      {slip}
    </View>
  );
}

interface Action {
  label: string;
  onPress: () => void;
  busy?: boolean;
}

function Slip({ eyebrow, text, primary, secondary }: { eyebrow: string; text: string; primary: Action; secondary: Action }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(motion.base)}
      exiting={FadeOutUp.duration(motion.fast)}
      style={styles.slip}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.words}>
        <T variant="eyebrow" caps color="muted">
          {eyebrow}
        </T>
        <T variant="caption" color="ink2">
          {text}
        </T>
      </View>
      <View style={styles.actions}>
        <Button kind="quiet" size="sm" label={secondary.label} onPress={secondary.onPress} />
        <Button kind="primary" size="sm" label={primary.label} onPress={primary.onPress} busy={primary.busy} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", left: space.md, right: space.md },
  slip: {
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    boxShadow: shadow.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  words: { gap: space.xs },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.paper,
    paddingHorizontal: space["2xl"],
    gap: space.lg,
  },
  coverAction: { alignSelf: "flex-start", marginTop: space.md },
});
