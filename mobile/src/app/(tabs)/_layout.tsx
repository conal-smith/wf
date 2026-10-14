import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors, fonts } from "../../theme/tokens";

/** Every tab is drawn on paper, as every page of the site is. */
const paper = { backgroundColor: colors.paper };

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
      <NativeTabs.Trigger name="index" contentStyle={paper}>
        <NativeTabs.Trigger.Label>Chart</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "map", selected: "map.fill" }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="spots" contentStyle={paper}>
        <NativeTabs.Trigger.Label>Spots</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "star", selected: "star.fill" }} md="star" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="alerts" contentStyle={paper}>
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bell", selected: "bell.fill" }} md="notifications" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" contentStyle={paper}>
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
