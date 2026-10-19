/**
 * Under each day: the tide across its 24 hours as a curve on a scale of
 * metres, the night hatched and the twilight paler behind it, each turn marked
 * with its time and height and the present drawn where it falls; then the
 * high and low waters and the light, as two small tables a rider can read
 * without looking at the curve at all.
 */
import { useState } from "react";
import { tv } from "../../ui/tv";
import {
  HOUR,
  clock,
  dublinMidnight,
  nextMidnight,
  shadeBands,
  tideCurve,
  tideHeightAt,
  type DaySun,
  type TideTurn,
} from "./spot";

const styles = tv({
  slots: {
    base: "flex flex-col gap-2 pt-2",
    svg: "block w-full touch-pan-y select-none",
    night: "fill-ink/15",
    twilight: "fill-ink/6",
    area: "fill-depth/30",
    line: "fill-none stroke-depth",
    axis: "stroke-ink/50",
    tick: "stroke-ink/50",
    tickText: "fill-ink-muted font-mono text-eyebrow tabular-nums",
    grid: "stroke-ink/10",
    turnText: "fill-ink font-mono text-caption tabular-nums",
    turnUnit: "fill-ink-muted",
    high: "fill-ink stroke-ink",
    low: "fill-card stroke-ink",
    now: "stroke-now",
    cursor: "stroke-ink-muted",
    readout: "fill-ink font-mono text-caption font-semibold tabular-nums",
    none: "fill-ink-muted font-body text-body italic",
    tables: "grid grid-cols-2 gap-x-4 max-sm:gap-x-2",
    table: "w-full border-collapse self-start",
    tr: "border-b border-line bg-sunken/60",
    th: "py-1 pr-1 pl-2 text-left font-body text-body font-normal whitespace-nowrap text-ink",
    td: "py-1 pr-2 pl-1 text-right font-mono text-caption whitespace-nowrap text-ink tabular-nums",
    unit: "text-ink-muted",
    empty: "py-1 pl-2 font-body text-body text-ink-muted italic",
  },
});

const H = 124;
const X_PAD = 4;
/** The left margin the metre scale is set in. */
const GUTTER = 28;
const Y0 = 8;
const Y1 = H - 16;
/**
 * Where the ceiling and 0 m fall: room above the highest water for a high's
 * label and below 0 m for a low's, so neither ever reaches the hours.
 */
const TOP = Y0 + 10;
const BOTTOM = Y1 - 18;
/** The fewest pixels between two lines of the metre scale. */
const GRID_GAP = 18;
/** A figure's advance in the caption's monospace, a little over 0.6em of 11px. */
const CHAR = 6.7;

/**
 * Where each turn's label goes: centred over a high and under a low, kept
 * inside the chart, and moved off the now-line and off the label before it on
 * the same side. Highs and lows sit on opposite sides of the curve, so only
 * labels of a kind can meet.
 */
export function placeLabels(
  turns: readonly { x: number; width: number; tide: "high" | "low" }[],
  left: number,
  right: number,
  nowX: number | null,
): number[] {
  const clamp = (x0: number, w: number) =>
    Math.min(right - w, Math.max(left, x0));
  const ends: Record<string, number> = { high: -Infinity, low: -Infinity };
  return turns.map(({ x, width: w, tide }) => {
    let x0 = clamp(x - w / 2, w);
    if (nowX !== null && nowX > x0 - 4 && nowX < x0 + w + 4) {
      const before = clamp(nowX - 4 - w, w);
      const after = clamp(nowX + 4, w);
      const fits = (a: number) => nowX <= a - 4 || nowX >= a + w + 4;
      x0 =
        [before, after]
          .filter(fits)
          .sort((a, b) => Math.abs(a - x0) - Math.abs(b - x0))[0] ?? x0;
    }
    x0 = Math.max(x0, ends[tide] + 8);
    ends[tide] = x0 + w;
    return x0;
  });
}

export function DayTide({
  date,
  turns,
  sun,
  now,
  width,
  ceiling,
  stationNote,
}: {
  date: string;
  /** Every turn published, so the day's ends can be drawn from the turns either side. */
  turns: readonly TideTurn[];
  sun: DaySun;
  now: number;
  /** The width to draw at, in px. */
  width: number;
  /** The highest water of the week plus a little: every day on one scale. */
  ceiling: number;
  /** Why there is no curve, where there is none. */
  stationNote: string | null;
}) {
  const s = styles();
  const start = dublinMidnight(date);
  const end = nextMidnight(date);
  const x = (time: number) =>
    GUTTER + ((time - start) / (end - start)) * (width - GUTTER - X_PAD);
  const y = (height: number) => BOTTOM - (height / ceiling) * (BOTTOM - TOP);
  const points = tideCurve(turns, start, end, 10);
  // Whole metres, as few as keep the lines apart: 0, 2, 4 on most coasts.
  const step =
    [1, 2, 5].find((m) => (m * (BOTTOM - TOP)) / ceiling >= GRID_GAP) ?? 10;
  const metres = Array.from(
    { length: points.length ? Math.floor(ceiling / step) + 1 : 0 },
    (_, i) => i * step,
  );
  const line = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${x(p.time).toFixed(1)} ${y(p.height).toFixed(1)}`,
    )
    .join("");
  const area = points.length
    ? `${line}L${x(points.at(-1)!.time).toFixed(1)} ${Y1}L${x(points[0].time).toFixed(1)} ${Y1}Z`
    : null;
  const dayTurns = turns.filter((t) => t.time >= start && t.time < end);
  const ticks = Array.from({ length: 9 }, (_, i) => start + i * 3 * HOUR);
  const showNow =
    now >= start && now < end && tideHeightAt(turns, now) !== null;
  const turnLabel = (turn: TideTurn) =>
    `${clock(turn.time)} · ${turn.height.toFixed(1)} m`;
  const labelWidth = (turn: TideTurn) => turnLabel(turn).length * CHAR;
  const labelX = placeLabels(
    dayTurns.map((turn) => ({
      x: x(turn.time),
      width: labelWidth(turn),
      tide: turn.tide,
    })),
    GUTTER + 3,
    width - X_PAD,
    showNow ? x(now) : null,
  );
  const labelY = dayTurns.map((turn) =>
    turn.tide === "high"
      ? y(turn.height) - 6
      : Math.min(Y1 - 3, y(turn.height) + 13),
  );
  // A line of the scale stops short of a label rather than strike through it.
  const gridPath = (metre: number) => {
    const at = y(metre);
    let path = "";
    let from = GUTTER;
    dayTurns
      .map((turn, i) => ({
        x0: labelX[i] - 3,
        x1: labelX[i] + labelWidth(turn) + 3,
        top: labelY[i] - 10,
        bottom: labelY[i] + 3,
      }))
      .filter((box) => at > box.top && at < box.bottom)
      .sort((a, b) => a.x0 - b.x0)
      .forEach((box) => {
        if (box.x0 > from) path += `M${from} ${at}H${box.x0}`;
        from = Math.max(from, box.x1);
      });
    if (width - X_PAD > from) path += `M${from} ${at}H${width - X_PAD}`;
    return path;
  };
  const [hover, setHover] = useState<number | null>(null);
  const hoverHeight = hover === null ? null : tideHeightAt(turns, hover);

  const label = `Tide and light: ${
    dayTurns.length
      ? dayTurns
          .map(
            (t) => `${t.tide} tide ${clock(t.time)}, ${t.height.toFixed(1)} m`,
          )
          .join("; ")
      : (stationNote ?? "no turn this day")
  }`;

  const pointAt = (clientX: number, box: DOMRect) => {
    const f = (clientX - box.left - GUTTER) / (box.width - GUTTER - X_PAD);
    if (f < 0 || f > 1) return null;
    return start + Math.round((f * (end - start)) / 600000) * 600000;
  };

  return (
    <div className={s.base()} data-tide-day={date}>
      <svg
        className={s.svg()}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={label}
        onPointerMove={(event) =>
          setHover(
            pointAt(event.clientX, event.currentTarget.getBoundingClientRect()),
          )
        }
        onPointerLeave={() => setHover(null)}
      >
        {shadeBands(sun, start, end).map((band) => (
          <rect
            key={`${band.kind}-${band.from}`}
            className={band.kind === "night" ? s.night() : s.twilight()}
            data-shade={band.kind}
            x={x(band.from)}
            y={Y0}
            width={Math.max(0, x(band.to) - x(band.from))}
            height={Y1 - Y0}
          />
        ))}
        {metres.map((metre) => (
          <g key={metre}>
            <path
              className={s.grid()}
              data-tide-metre={metre}
              d={gridPath(metre)}
            />
            <text
              className={s.tickText()}
              x={GUTTER - 5}
              y={y(metre) + 3.5}
              textAnchor="end"
            >
              {metre} m
            </text>
          </g>
        ))}
        {ticks.map((tick, i) => (
          <g key={tick}>
            <line
              className={s.tick()}
              x1={x(tick)}
              x2={x(tick)}
              y1={Y1}
              y2={Y1 + 3}
            />
            <text
              className={s.tickText()}
              x={Math.min(width - X_PAD - 6, Math.max(GUTTER + 6, x(tick)))}
              y={H - 3}
              textAnchor="middle"
            >
              {String((i * 3) % 24).padStart(2, "0")}
            </text>
          </g>
        ))}
        {area && <path className={s.area()} d={area} data-tide-curve />}
        {line && (
          <path
            className={s.line()}
            d={line}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        )}
        {!points.length && (
          <text
            className={s.none()}
            x={width / 2}
            y={(Y0 + Y1) / 2 + 4}
            textAnchor="middle"
          >
            {stationNote ?? "No tide predicted for this day"}
          </text>
        )}
        {dayTurns.map((turn) => (
          <circle
            key={turn.time}
            className={turn.tide === "high" ? s.high() : s.low()}
            cx={x(turn.time)}
            cy={y(turn.height)}
            r={2.8}
          />
        ))}
        {showNow && (
          <line
            className={s.now()}
            data-now-marker
            x1={x(now)}
            x2={x(now)}
            y1={Y0}
            y2={Y1}
            strokeWidth={1.2}
          />
        )}
        {dayTurns.map((turn, i) => (
          <text
            key={turn.time}
            className={s.turnText()}
            data-tide-turn={turn.tide}
            x={labelX[i]}
            y={labelY[i]}
          >
            {clock(turn.time)}
            <tspan className={s.turnUnit()}> · </tspan>
            {turn.height.toFixed(1)}
            <tspan className={s.turnUnit()}> m</tspan>
          </text>
        ))}
        <line
          className={s.axis()}
          x1={GUTTER}
          x2={width - X_PAD}
          y1={Y1}
          y2={Y1}
        />
        {hover !== null && (
          <g aria-hidden="true">
            <line
              className={s.cursor()}
              x1={x(hover)}
              x2={x(hover)}
              y1={Y0}
              y2={Y1}
            />
            <text
              className={s.readout()}
              x={x(hover) > width - 110 ? x(hover) - 5 : x(hover) + 5}
              y={Y0 + 11}
              textAnchor={x(hover) > width - 110 ? "end" : "start"}
            >
              {clock(hover)}
              {hoverHeight !== null && ` · ${hoverHeight.toFixed(1)} m`}
            </text>
          </g>
        )}
      </svg>
      <div className={s.tables()}>
        <table className={s.table()} data-tide-table>
          <caption className="sr-only">Tides</caption>
          <tbody>
            {dayTurns.length ? (
              dayTurns.map((turn) => (
                <tr key={turn.time} className={s.tr()}>
                  <th scope="row" className={s.th()}>
                    {turn.tide === "high" ? "High tide" : "Low tide"}
                  </th>
                  <td className={s.td()}>{clock(turn.time)}</td>
                  <td className={s.td()}>
                    {turn.height.toFixed(1)}
                    <span className={s.unit()}> m</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr className={s.tr()}>
                <td colSpan={3} className={s.empty()}>
                  {stationNote ?? "No turn this day"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <table className={s.table()} data-sun-table>
          <caption className="sr-only">Light</caption>
          <tbody>
            {(
              [
                ["First light", sun.firstLight],
                ["Sunrise", sun.sunrise],
                ["Sunset", sun.sunset],
                ["Last light", sun.lastLight],
              ] as const
            ).map(([name, time]) => (
              <tr key={name} className={s.tr()}>
                <th scope="row" className={s.th()}>
                  {name}
                </th>
                <td className={s.td()}>{time === null ? "–" : clock(time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
