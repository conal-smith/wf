import type { ConfigContext, ExpoConfig } from "expo/config";
import { version } from "./package.json";

/**
 * One app, three installs side by side, the way t3code ships its mobile app
 * (apps/mobile/app.config.ts there): APP_VARIANT picks the name, the bundle
 * identifier, the scheme and the icon. Anything it does not recognise is
 * production, so a build nobody labelled is the one riders get.
 *
 *   development  a dev client, for `expo start`
 *   staging      TestFlight / Play internal: what the release train stages
 *   production   the App Store and Google Play
 *
 * Nothing variant-specific is read from this file at run time: the app asks
 * the binary who it is (src/config/variant.ts), because one over-the-air
 * update is served to staging and then, unchanged, to production
 * (docs/MOBILE.md), and an update carries the config it was published with.
 */
type Variant = "development" | "staging" | "production";

const VARIANTS: Record<
  Variant,
  { name: string; id: string; scheme: string; icon: string }
> = {
  development: {
    name: "Wingfoil Dev",
    id: "ie.wingfoil.app.dev",
    scheme: "wingfoil-dev",
    icon: "./assets/brand/icon-development.png",
  },
  staging: {
    name: "Wingfoil Staging",
    id: "ie.wingfoil.app.staging",
    scheme: "wingfoil-staging",
    icon: "./assets/brand/icon-staging.png",
  },
  production: {
    name: "Wingfoil",
    id: "ie.wingfoil.app",
    scheme: "wingfoil",
    icon: "./assets/brand/icon.png",
  },
};

const variant: Variant =
  process.env.APP_VARIANT === "development" ||
  process.env.APP_VARIANT === "staging"
    ? process.env.APP_VARIANT
    : "production";
const v = VARIANTS[variant];

/**
 * The EAS project. Until one exists (docs/MOBILE.md, "One-time setup") the
 * app builds and runs with over-the-air updates off.
 */
const projectId = process.env.EAS_PROJECT_ID || undefined;

/** Paper, the ground of every page (ui/theme.css --paper). */
const PAPER = "#f3eee3";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: v.name,
  slug: "wingfoil",
  owner: "sprintengine",
  version,
  orientation: "portrait",
  icon: v.icon,
  scheme: v.scheme,
  userInterfaceStyle: "light",
  backgroundColor: PAPER,
  // The fingerprint is the runtime: an update only reaches binaries whose
  // native code it was built against (fingerprint.config.js says what counts).
  runtimeVersion: { policy: "fingerprint" },
  updates: projectId
    ? {
        url: `https://u.expo.dev/${projectId}`,
        enabled: variant !== "development",
        // Never hold the launch for the network: an update downloaded now is
        // applied the next time the app is left (src/features/updates).
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
        // The channel is the build profile's (eas.json), written into the
        // binary by EAS, so staging and production keep one fingerprint.
      }
    : { enabled: false },
  ios: {
    bundleIdentifier: v.id,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Wingfoil shows where you are on the chart and finds the riding places nearest you.",
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: v.id,
    adaptiveIcon: {
      foregroundImage: "./assets/brand/adaptive-foreground.png",
      monochromeImage: "./assets/brand/adaptive-monochrome.png",
      backgroundColor: PAPER,
    },
    predictiveBackGestureEnabled: true,
    permissions: [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
    ],
    blockedPermissions: ["android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/brand/splash.png",
        imageWidth: 160,
        backgroundColor: PAPER,
      },
    ],
    [
      "expo-font",
      {
        fonts: [
          "./node_modules/@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf",
          "./node_modules/@expo-google-fonts/fraunces/400Regular_Italic/Fraunces_400Regular_Italic.ttf",
          "./node_modules/@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf",
          "./node_modules/@expo-google-fonts/newsreader/400Regular/Newsreader_400Regular.ttf",
          "./node_modules/@expo-google-fonts/newsreader/400Regular_Italic/Newsreader_400Regular_Italic.ttf",
          "./node_modules/@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf",
          "./node_modules/@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf",
          "./node_modules/@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf",
          "./node_modules/@expo-google-fonts/kalam/400Regular/Kalam_400Regular.ttf",
        ],
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    "expo-web-browser",
    [
      "expo-notifications",
      {
        icon: "./assets/brand/notification-icon.png",
        color: "#b0186a",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Wingfoil shows where you are on the chart and finds the riding places nearest you.",
      },
    ],
    "@maplibre/maplibre-react-native",
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: {},
    ...(projectId ? { eas: { projectId } } : {}),
  },
});
