/**
 * A little feedback on the moments that matter: choosing, switching, saving.
 * Fire and forget: a device without a taptic engine just says nothing.
 */
import * as Haptics from "expo-haptics";

export const tick = () => void Haptics.selectionAsync().catch(() => undefined);
export const thud = () =>
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
export const done = () =>
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
export const refused = () =>
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
