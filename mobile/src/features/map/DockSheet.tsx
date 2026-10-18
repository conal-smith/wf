/**
 * The dock, in the chart's own sheet: a peek a little over the tab bar with
 * the strip of hours and the open spot's line, and a pull up to most of the
 * screen for its week (features/dock/ForecastDock.tsx). There is no sheet
 * until a spot is open, as on the site: the chart has the whole screen.
 *
 * App updates wait while the sheet is being dragged (features/updates/hold.ts).
 */
import BottomSheet from "@gorhom/bottom-sheet";
import { memo, useCallback, useState, type Ref } from "react";
import { StyleSheet } from "react-native";
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { colors, radius, shadow, space } from "../../theme/tokens";
import { ForecastDock } from "../dock/ForecastDock";
import { useUpdateHold } from "../updates/hold";

/** The peek's height over the tab bar, and how far up the open dock comes. */
export const PEEK = 150;
const SNAPS = [PEEK, "70%"];

interface Props {
  sheetRef: Ref<BottomSheet>;
  /** The tab bar's height under the sheet. */
  bottomInset: number;
  onDetent: (detent: "peek" | "open") => void;
  detent: "peek" | "open";
  onOpenSpotPage: (id: string) => void;
  onShowOnChart: () => void;
}

export const DockSheet = memo(function DockSheet(props: Props) {
  const index = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  useUpdateHold(dragging);
  // Between two detents is a drag (or the settle after one): hold updates till it rests.
  useAnimatedReaction(
    () => Math.abs(index.value - Math.round(index.value)) > 0.001,
    (moving, was) => {
      if (moving !== was) scheduleOnRN(setDragging, moving);
    },
  );
  const onChange = useCallback(
    (at: number) => {
      if (at >= 0) props.onDetent(at >= 1 ? "open" : "peek");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onDetent],
  );
  return (
    <BottomSheet
      ref={props.sheetRef}
      index={0}
      snapPoints={SNAPS}
      enableDynamicSizing={false}
      bottomInset={props.bottomInset}
      animatedIndex={index}
      onChange={onChange}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      handleStyle={styles.handleBox}
      accessibilityLabel="Forecast dock"
    >
      <ForecastDock detent={props.detent} onOpenSpotPage={props.onOpenSpotPage} onShowOnChart={props.onShowOnChart} />
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.paper,
    borderRadius: radius.box,
    borderTopWidth: 3,
    borderColor: colors.ink,
    boxShadow: shadow.dock,
  },
  handleBox: { paddingVertical: space.sm },
  handle: { backgroundColor: colors.lineStrong, width: 36 },
});
