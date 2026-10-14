/**
 * The chart's box as a sheet (the site's `Dialog`): paper, a double rule
 * along its top edge, the title in the display face and a way to close it,
 * over the chart dimmed. The layers, the key and a tapped point's forecast
 * open in one; the dock is the chart's own sheet (DockSheet.tsx).
 */
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useCallback, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "../../components/Text";
import { colors, hitTarget, radius, space } from "../../theme/tokens";
import { CloseGlyph } from "./ChartControls";

interface Props {
  sheetRef: Ref<BottomSheetModal>;
  title: string;
  /** A line in the mono label over the title. */
  kicker?: string;
  snapPoints: (string | number)[];
  onDismiss?: () => void;
  onClose: () => void;
  /** Dim the chart behind: off for the small point sheet, which leaves the chart in use. */
  backdrop?: boolean;
  children: ReactNode;
}

export function ChartSheet({ sheetRef, title, kicker, snapPoints, onDismiss, onClose, backdrop = true, children }: Props) {
  const insets = useSafeAreaInsets();
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.18} pressBehavior="close" />
    ),
    [],
  );
  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onDismiss={onDismiss}
      backdropComponent={backdrop ? renderBackdrop : undefined}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      accessible={false}
    >
      <View style={styles.head}>
        <View style={styles.titles}>
          {kicker ? (
            <T variant="eyebrow" caps color="muted">
              {kicker}
            </T>
          ) : null}
          <T variant="lead" accessibilityRole="header" numberOfLines={2}>
            {title}
          </T>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && styles.closeDown]}
        >
          <CloseGlyph size={18} />
        </Pressable>
      </View>
      <BottomSheetScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space["2xl"] }]}>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

/** A section under a heavy rule, the broadsheet's (Pane kind="ruled"). */
export function SheetSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T variant="eyebrow" caps accessibilityRole="header">
          {title}
        </T>
        {aside}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.paper,
    borderRadius: radius.box,
    borderTopWidth: 3,
    borderColor: colors.ink,
  },
  handle: { backgroundColor: colors.lineStrong, width: 36 },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  titles: { flex: 1, gap: space["2xs"], paddingTop: space.xs },
  close: { width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center" },
  closeDown: { backgroundColor: colors.sunken },
  body: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xl },
  section: { gap: space.md, borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
