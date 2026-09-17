import { useId } from "react";
import type { Candle } from "../force5/src/blend";
import type { NightInterval } from "../force5/src/sun";
import { convert, unitLabel, type Units } from "../force5/src/units";
import { windColor } from "../force5/src/weather";
import type { DockColumn } from "../force5/src/timeline";
import { axisTicks, timeToX, valueScale } from "./chart";

export interface CandleChartProps {
  width: number;
  height: number;
  /** Column edges in pixels, one more than the number of columns. */
  edges: readonly number[];
  columns: readonly DockColumn[];
  candles: readonly Candle[];
  nights: readonly NightInterval[];
  units: Units;
  max: number;
}

/** A body thinner than this reads as a line, so it is floored. */
const MIN_BODY = 2;

export default function CandleChart({
  width,
  height,
  edges,
  columns,
  candles,
  nights,
  units,
  max,
}: CandleChartProps) {
  const clipId = `candle-clip-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const y = valueScale(max, height);
  const show = (value: number) => convert(value, units);
  const columnCentres = centres(edges);
  const nowX = timeToX(columns, Date.now(), columnCentres);

  return (
    <svg
      className="candle-chart"
      width={width}
      height={height}
      role="img"
      aria-label={`Candles per three-hour column: wick shows the full model range, body the middle half, tick the median, in ${unitLabel(
        units,
      )}. The table view lists every value.`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {nights.map((night, index) => {
          const from = timeToX(columns, night.from.getTime(), columnCentres);
          const to = timeToX(columns, night.to.getTime(), columnCentres);
          const left = from ?? 0;
          const right = to ?? width;
          if (right <= left) return null;
          return (
            <rect
              key={index}
              className="chart-night"
              x={left}
              y="0"
              width={right - left}
              height={height}
            />
          );
        })}
        {axisTicks(max).map((tick) => (
          <line
            key={tick}
            className="chart-gridline"
            x1="0"
            x2={width}
            y1={y(tick)}
            y2={y(tick)}
          />
        ))}
        {candles.map((candle) => {
          // Each candle knows which columns it covers, so a six-hourly column
          // past the seam gets the width the header already gave it.
          const left = edges[candle.columns[0]];
          const right =
            edges[Math.min((candle.columns.at(-1) ?? 0) + 1, edges.length - 1)];
          if (left === undefined || right === undefined) return null;
          const span = right - left;
          const bodyWidth = Math.max(6, span * 0.52);
          const centre = left + span / 2 - (candle.gust ? span * 0.08 : 0);
          const bodyTop = y(show(candle.q75));
          const bodyBottom = y(show(candle.q25));
          const bodyHeight = Math.max(MIN_BODY, bodyBottom - bodyTop);
          const colour = windColor(convert(candle.median, "kn"));
          return (
            <g key={candle.time} className="candle">
              <line
                className="candle-wick"
                x1={centre}
                x2={centre}
                y1={y(show(candle.hi))}
                y2={y(show(candle.lo))}
              />
              <rect
                className="candle-body"
                x={centre - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                fill={`rgb(${colour.join(",")})`}
              />
              <line
                className="candle-median"
                x1={centre - bodyWidth / 2}
                x2={centre + bodyWidth / 2}
                y1={y(show(candle.median))}
                y2={y(show(candle.median))}
              />
              {candle.gust && (
                <rect
                  className="candle-gust"
                  x={centre + bodyWidth / 2 + 3}
                  y={y(show(candle.gust.hi))}
                  width="3"
                  height={Math.max(
                    MIN_BODY,
                    y(show(candle.gust.lo)) - y(show(candle.gust.hi)),
                  )}
                />
              )}
            </g>
          );
        })}
        {nowX !== null && (
          <line className="chart-now" x1={nowX} x2={nowX} y1="0" y2={height} />
        )}
      </g>
    </svg>
  );
}

/** Column centres from edges, so the Now line lands where the header says. */
function centres(edges: readonly number[]): number[] {
  return edges.slice(0, -1).map((edge, index) => (edge + edges[index + 1]) / 2);
}
