import { KNOTS, speed, windColor, type Wind, type FrameInfo } from "./weather";

/** Fractional column index at a real time, never clamped into an expired run. */
export function framePosition(
  frames: readonly Pick<FrameInfo, "validTime">[],
  time: number,
): number | null {
  if (!frames.length || !Number.isFinite(time)) return null;
  const first = Date.parse(frames[0].validTime);
  const last = Date.parse(frames[frames.length - 1].validTime);
  if (time < first || time > last) return null;
  if (time === last) return frames.length - 1;
  const right = frames.findIndex((frame) => Date.parse(frame.validTime) > time);
  if (right < 1) return null;
  const leftTime = Date.parse(frames[right - 1].validTime);
  return (
    right -
    1 +
    (time - leftTime) / (Date.parse(frames[right].validTime) - leftTime)
  );
}

/** Forecast strength for the selected location; grey means not loaded/available. */
export function windTrackBackground(
  values: readonly (Wind | null | undefined)[],
  count: number,
  hours?: readonly number[],
) {
  if (count < 1) return "#b8cbd0";
  const stops = Array.from({ length: Math.max(2, count) }, (_, i) => {
    const value = values[Math.min(i, count - 1)];
    const colour = value
      ? `rgb(${windColor(speed(value) * KNOTS).join(",")})`
      : "#b8cbd0";
    const start = hours?.[0] || 0;
    const end = hours?.[count - 1] || 0;
    const fraction =
      hours && end > start
        ? (hours[Math.min(i, count - 1)] - start) / (end - start)
        : i / Math.max(1, count - 1);
    return `${colour} ${fraction * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
