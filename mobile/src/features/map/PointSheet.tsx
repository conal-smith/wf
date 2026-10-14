/**
 * A point tapped on the open water (src/App.tsx `pickPoint`): its wind for
 * the day, read out of the map model's own frames a tile an hour
 * (usePointSeries), and with the foil layer on, the seabed under it at the
 * hour's tide. Not rated: stars are for a riding place, measured against its
 * beach, and a point has none. The pen rings the point on the chart.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { memo, useMemo, type Ref } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { compass } from "../../../../force5/src/weather";
import type { PlaceHour } from "../../../../src/ratings";
import { dayLong, hourLabel, type StripColumn, type StripDay } from "../../../../src/strip";
import { WindArrow } from "../../components/Glyphs";
import { tick } from "../../components/haptics";
import { T } from "../../components/Text";
import { colors, hitTarget, space } from "../../theme/tokens";
import { ChartSheet, SheetSection } from "./ChartSheet";

export interface Picked {
  lon: number;
  lat: number;
  /** The nearest town's name, or the coordinates. */
  name: string;
  /** The coordinates, when the name is a town's. */
  coords: string;
}

interface Props {
  sheetRef: Ref<BottomSheetModal>;
  picked: Picked | null;
  hours: readonly PlaceHour[] | undefined;
  pending: boolean;
  failed: boolean;
  strip: readonly StripColumn[];
  days: readonly StripDay[];
  selected: number;
  onSelect: (iso: string) => void;
  /** The foil readout at the hour, or null. */
  foil: string | null;
  foilOn: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

const kn = (v: number | null) => (v === null ? "–" : String(Math.round(v)));

export const PointSheet = memo(function PointSheet(props: Props) {
  const { hours, strip, selected } = props;
  const day = props.days.find((d) => selected >= d.start && selected < d.start + d.count) ?? null;
  const hour = hours?.[selected];
  const columns = useMemo(
    () => (day ? strip.slice(day.start, day.start + day.count).map((c, i) => ({ c, at: day.start + i })) : []),
    [day, strip],
  );
  const headline =
    hour && hour.windKn !== null
      ? `${kn(hour.windKn)}${hour.gustKn !== null ? ` g${kn(hour.gustKn)}` : ""} kn${hour.from !== null ? ` · ${compass(hour.from)}` : ""}`
      : null;
  return (
    <ChartSheet
      sheetRef={props.sheetRef}
      kicker={props.picked?.coords || "On the water"}
      title={props.picked?.name ?? ""}
      snapPoints={["42%", "70%"]}
      onClose={props.onClose}
      onDismiss={props.onDismiss}
      backdrop={false}
    >
      <View style={styles.reading} accessible accessibilityLiveRegion="polite">
        {headline ? (
          <T variant="figure" tabular>
            {headline}
          </T>
        ) : props.pending ? (
          <ActivityIndicator color={colors.ink} accessibilityLabel="Reading the wind here" />
        ) : (
          <T variant="body" color="muted">
            {props.failed ? "The wind here could not be read." : "No forecast for this hour here."}
          </T>
        )}
        <T variant="caption" color="muted">
          The map model’s wind, not rated: stars are for a riding place and its beach.
        </T>
      </View>

      {day ? (
        <SheetSection title={dayLong(day.noon)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hours}>
            {columns.map(({ c, at }) => {
              const h = hours?.[at];
              const on = at === selected;
              return (
                <Pressable
                  key={c.validTime}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${hourLabel(c.time)}:00, ${h?.windKn != null ? `${Math.round(h.windKn)} knots${h.gustKn != null ? ` gusting ${Math.round(h.gustKn)}` : ""}${h.from != null ? ` from the ${compass(h.from)}` : ""}` : "no reading"}`}
                  onPress={() => {
                    tick();
                    props.onSelect(c.validTime);
                  }}
                  style={[styles.cell, on && styles.cellOn, !h?.daylight && styles.night]}
                >
                  <T variant="label" color={on ? "ink" : "muted"} tabular>
                    {hourLabel(c.time)}
                  </T>
                  <T variant="figureSm" tabular>
                    {kn(h?.windKn ?? null)}
                  </T>
                  <T variant="caption" color="muted" tabular>
                    {h?.gustKn != null ? `g${kn(h.gustKn)}` : " "}
                  </T>
                  {h?.from != null ? <WindArrow from={h.from} /> : <View style={styles.arrowSpace} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </SheetSection>
      ) : null}

      {props.foilOn ? (
        <SheetSection title="Foilable depth">
          <T variant="pen" color="penInk">
            {props.foil ?? "Reading the seabed here…"}
          </T>
        </SheetSection>
      ) : null}
    </ChartSheet>
  );
});

const styles = StyleSheet.create({
  reading: { gap: space.xs },
  hours: { gap: space.xs },
  cell: {
    minWidth: hitTarget,
    alignItems: "center",
    gap: space["2xs"],
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderWidth: 1,
    borderColor: "transparent",
  },
  cellOn: { borderColor: colors.ink },
  night: { backgroundColor: colors.sunken },
  arrowSpace: { height: 13 },
});
