import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors, fonts } from "../../theme/tokens";

/** Four places: the chart, the rider's spots, their alerts, and the rest. */
export default function TabsLayout() {
  return (
    <NativeTabs
      backgroundColor={colors.paper}
      tintColor={colors.ink}
      iconColor={{ default: colors.muted, selected: colors.ink }}
      labelStyle={{ fontFamily: fonts.monoMedium, fontSize: 10 }}
      indicatorColor={colors.sunken}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Chart</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "map", selected: "map.fill" }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="spots">
        <NativeTabs.Trigger.Label>Spots</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "star", selected: "star.fill" }} md="star" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bell", selected: "bell.fill" }} md="notifications" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
