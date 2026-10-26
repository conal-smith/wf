// What the site's forecast code expects of the platform, then the device's
// localStorage: the stores below read it as they load.
import "../config/polyfills";
import "../data/storage";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ForecastProvider } from "../data/forecast";
import { useVerifyHarness } from "../dev/useVerifyHarness";
import { PrefsProvider } from "../data/prefs";
import { useNotificationRouting } from "../features/alerts/useNotificationRouting";
import { UpdateNotice } from "../features/updates/UpdateNotice";
import { colors, fonts } from "../theme/tokens";

// The fonts are embedded at build time (expo-font in app.config.ts), so the
// first frame can be drawn as soon as React is up.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 220, fade: true });

export const unstable_settings = { anchor: "(tabs)" };

function Routes() {
  useNotificationRouting();
  useVerifyHarness();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.displayBold, color: colors.ink },
        headerLargeTitleStyle: { fontFamily: fonts.displayBold, color: colors.ink },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.paper },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="spot/[id]" options={{ title: "" }} />
      <Stack.Screen name="alert/[id]" options={{ presentation: "modal", title: "Alert" }} />
      {/* Cancel or Save closes it: a swipe down would lose the edits without a word. */}
      <Stack.Screen
        name="your-stars"
        options={{ presentation: "modal", title: "Your stars", gestureEnabled: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.paper }}>
      <PrefsProvider>
        <ForecastProvider>
          <BottomSheetModalProvider>
            <StatusBar style="dark" />
            <Routes />
            <UpdateNotice />
          </BottomSheetModalProvider>
        </ForecastProvider>
      </PrefsProvider>
    </GestureHandlerRootView>
  );
}
