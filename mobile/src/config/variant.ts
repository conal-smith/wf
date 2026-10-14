/**
 * Which app this is, asked of the binary rather than of the bundle: one
 * over-the-air update runs on the staging app and then, unchanged, on the
 * production one (docs/MOBILE.md), so the bundle cannot know. The identifier
 * is app.config.ts's: ie.wingfoil.app, then .staging or .dev.
 */
import * as Application from "expo-application";
import { variantOf, type Variant } from "./endpoints";

export type { Variant };

export const variant: Variant = variantOf(Application.applicationId);
