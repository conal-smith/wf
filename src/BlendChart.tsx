import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BlendInput, HourStats } from "../force5/src/blend";
import { modelEntry, modelHue } from "../force5/src/manifests";
import type { NightInterval } from "../force5/src/sun";
import { convert, unitLabel, type Units } from "../force5/src/units";
import { compass, dayLabel, timeLabel } from "../force5/src/weather";
import type { DockColumn } from "../force5/src/timeline";
import {
  agreementLabel,
  areaPath,
  axisTicks,
  bandPath,
  linePath,
  timeToX,
  valueScale,
  windGradientStops,
} from "./chart";

/**
 * The wave band's own value axis, in metres. Waves do not belong on the wind
 * scale, so the band gets a fixed nought-to-six-metre domain of its own — six
 * metres is a storm sea on this coast — and a fixed slice of the plot's foot.
 * It is drawn inside the existing plot box, so it costs the dock no height.
 */
const WAVE_BAND_MAX_M = 6;
const WAVE_BAND_HEIGHT = 18;

export interface BlendChartProps {
  width: number;
  height: number;
  /** Column centres in pixels; the chart never assumes even spacing. */
  centres: readonly number[];
  columns: readonly DockColumn[];
  /** Columns grouped into three-hour candles; one arrow sits on each group. */
  groups: readonly (readonly number[])[];
  /** How many distinct models put a value on each column. */
  support: readonly number[];
  stats: readonly HourStats[];
  lines: readonly BlendInput[];
  directions: readonly (number | null)[];
  nights: readonly NightInterval[];
  units: Units;
  /** Top of the value axis, in display units. */
  max: number;
  /**
   * Significant wave height in metres per column for the optional band along
   * the chart's foot, or null when the reader has it switched off.
   */
  waves?: readonly (number | null)[] | null;
  reducedMotion: boolean;
}

export default function BlendChart({
  width,
  height,
  centres,
  columns,
  groups,
  support,
  stats,
  lines,
  directions,
  nights,
  units,
  max,
  waves,
  reducedMotion,
}: BlendChartProps) {
  // React's generated ids carry colons, which cannot appear in an SVG url().
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const gradientId = `blend-${uid}`;
  const clipId = `blend-clip-${uid}`;
  const plot = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  // A touch keeps the card until the next tap; a tap anywhere else clears it.
  useEffect(() => {
    if (hover === null) return;
    const away = (event: PointerEvent) => {
      if (!plot.current?.contains(event.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hover]);

  const y = valueScale(max, height);
  /** Display units, which is the only space the chart draws in. */
  const show = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? null
      : convert(value, units);
  const series = (pick: (hour: HourStats) => number | null) =>
    stats.map((hour) => show(pick(hour)));

  const minimum = series((hour) => hour.min);
  const maximum = series((hour) => hour.max);
  const q25 = series((hour) => hour.q25);
  const q75 = series((hour) => hour.q75);
  const median = series((hour) => hour.median);
  const gustMax = series((hour) => hour.gust.max);
  const gustMedian = series((hour) => hour.gust.median);
  // The middle fifth: the data layer publishes quartiles, so the inner core is
  // drawn between the median and each quartile rather than at q40/q60.
  const core = (side: readonly (number | null)[]) =>
    side.map((value, index) =>
      value === null || median[index] === null
        ? null
        : (value + median[index]!) / 2,
    );

  const nightRects = nights.flatMap((night, index) => {
    const from = timeToX(columns, night.from.getTime(), centres);
    const to = timeToX(columns, night.to.getTime(), centres);
    const left =
      from ??
      (night.to.getTime() > Date.parse(columns[0].validTime) ? 0 : null);
    const right =
      to ??
      (night.from.getTime() < Date.parse(columns[columns.length - 1].validTime)
        ? width
        : null);
    if (left === null || right === null || right <= left) return [];
    return [{ key: index, x: left, width: right - left }];
  });

  // The band only earns its place if the plot is tall enough to give it a foot
  // without eating into the wind band; a shorter chart simply goes without.
  const waveBand =
    waves &&
    waves.some((value) => value !== null) &&
    height > 3 * WAVE_BAND_HEIGHT
      ? areaPath(
          centres,
          waves,
          (metres: number) =>
            height -
            Math.max(0, Math.min(1, metres / WAVE_BAND_MAX_M)) *
              WAVE_BAND_HEIGHT,
          height,
        )
      : null;

  /**
   * A line for every model and every ensemble member, ninety-odd curves with
   * two ensembles in. They depend on nothing the pointer moves, so a hover —
   * which re-renders on every mouse move to place its card — reuses them
   * rather than recomputing every spline.
   */
  const modelLines = useMemo(
    () =>
      lines.map((line, index) => {
        const hue = modelHue(line.model);
        const member = line.memberIndex !== undefined;
        return (
          <g key={`${line.model}-${line.memberIndex ?? "mean"}-${index}`}>
            <path
              className="model-line"
              d={linePath(centres, line.speed.map(show), y)}
              stroke={hue.wind}
              opacity={member ? 0.12 : 0.35}
            />
            {!member && (
              <path
                className="model-line model-gust-line"
                d={linePath(centres, line.gust.map(show), y)}
                stroke={hue.wind}
                opacity="0.22"
              />
            )}
          </g>
        );
      }),
    // `show` and `y` are rebuilt each render from `units`, `max` and `height`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, centres, units, max, height],
  );

  const nowX = timeToX(columns, Date.now(), centres);
  const hovered = hover === null ? null : stats[hover.index];
  const hoverModels =
    hover === null
      ? []
      : Array.from(new Set(lines.map((line) => line.model))).flatMap((id) => {
          const speeds = lines
            .filter((line) => line.model === id)
            .map((line) => ({
              speed: show(line.speed[hover.index]),
              gust: show(line.gust[hover.index]),
            }))
            .filter((entry) => entry.speed !== null);
          if (!speeds.length) return [];
          const mean = (values: (number | null)[]) => {
            const usable = values.filter((v): v is number => v !== null);
            return usable.length
              ? usable.reduce((sum, v) => sum + v, 0) / usable.length
              : null;
          };
          return [
            {
              id,
              name: modelEntry(id)?.name ?? id,
              members: speeds.length,
              speed: mean(speeds.map((entry) => entry.speed)),
              gust: mean(speeds.map((entry) => entry.gust)),
            },
          ];
        });

  /**
   * Later days have fewer models behind them, and a band drawn the same way
   * either side of that would read as a confident narrowing rather than as one
   * model's opinion. Under three contributing models the band's own edge is
   * drawn dashed over that stretch.
   */
  const thin = (values: readonly (number | null)[]) =>
    values.map((value, index) => ((support[index] ?? 0) < 3 ? value : null));
  const sparseEdge =
    support.some((count) => count > 0 && count < 3) &&
    stats.some((hour) => hour.n > 0)
      ? `${linePath(centres, thin(maximum), y)} ${linePath(
          centres,
          thin(minimum),
          y,
        )}`.trim()
      : "";

  // One arrow per three-hour group, so an hourly run does not draw a thicket of
  // them and a three-hourly one still gets one on every column.
  const arrowColumns = new Set(groups.map((group) => group[0]));

  const arrow = (angle: number, x: number, cy: number) => (
    // Meteorological bearing is where the wind comes from; the arrow travels
    // downwind, so it is rotated by the bearing itself.
    <g key={`arrow-${x}`} transform={`translate(${x} ${cy}) rotate(${angle})`}>
      <path className="chart-arrow-halo" d="M0 -5 L0 5 M-3 1.6 L0 5 L3 1.6" />
      <path className="chart-arrow" d="M0 -5 L0 5 M-3 1.6 L0 5 L3 1.6" />
    </g>
  );

  return (
    <>
      <svg
        ref={plot}
        className="blend-chart"
        width={width}
        height={height}
        role="img"
        aria-label={`Model blend for the selected spot: wind between ${Math.round(
          Math.min(...minimum.filter((v): v is number => v !== null), max),
        )} and ${Math.round(
          Math.max(...maximum.filter((v): v is number => v !== null), 0),
        )} ${unitLabel(units)} across ${lines.length} model lines.${
          waveBand
            ? ` A band along the foot shows wave height up to ${WAVE_BAND_MAX_M} metres; the Waves row prints it.`
            : ""
        }${
          sparseEdge
            ? " Where fewer than three models cover an hour the band's edge is dashed."
            : ""
        } The table view lists every value.`}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const box = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - box.left;
          setHover({
            index: nearestColumn(centres, x),
            x: event.clientX,
            y: box.top,
          });
        }}
        onPointerDown={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover({
            index: nearestColumn(centres, event.clientX - box.left),
            x: event.clientX,
            y: box.top,
          });
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") setHover(null);
        }}
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1={y(0)}
            x2="0"
            y2={y(max)}
          >
            {windGradientStops(max, units).map((stop) => (
              <stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.colour}
              />
            ))}
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {nightRects.map((rect) => (
            <rect
              key={rect.key}
              className="chart-night"
              x={rect.x}
              y="0"
              width={rect.width}
              height={height}
            />
          ))}
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
          {/* Behind the wind blend and along its foot: waves share the time
              axis only, and the Waves row prints the numbers. */}
          {waveBand && <path className="wave-band" d={waveBand} />}
          {/* Multiply so the core darkens exactly where the models agree. */}
          <g style={{ mixBlendMode: "multiply" }}>
            <path
              className="blend-band"
              d={bandPath(centres, minimum, maximum, y)}
              fill={`url(#${gradientId})`}
              opacity="0.5"
            />
            <path
              className="blend-band"
              d={bandPath(centres, q25, q75, y)}
              fill={`url(#${gradientId})`}
              opacity="0.22"
            />
            <path
              className="blend-band"
              d={bandPath(centres, core(q25), core(q75), y)}
              fill={`url(#${gradientId})`}
              opacity="0.2"
            />
            <path
              className="blend-gust"
              d={bandPath(centres, median, gustMax, y)}
              fill={`url(#${gradientId})`}
              opacity="0.22"
            />
            <path
              className="blend-gust"
              d={bandPath(centres, median, gustMedian, y)}
              fill={`url(#${gradientId})`}
              opacity="0.16"
            />
          </g>
          {modelLines}
          {sparseEdge && <path className="blend-sparse" d={sparseEdge} />}
          <path className="median-line" d={linePath(centres, median, y)} />
          {directions.map((angle, index) =>
            angle === null || median[index] === null || !arrowColumns.has(index)
              ? null
              : arrow(angle, centres[index], y(median[index]!)),
          )}
          {nowX !== null && (
            <line
              className="chart-now"
              x1={nowX}
              x2={nowX}
              y1="0"
              y2={height}
            />
          )}
          {hover !== null && hovered && hovered.n > 0 && (
            <line
              className="chart-cursor"
              x1={centres[hover.index]}
              x2={centres[hover.index]}
              y1="0"
              y2={height}
            />
          )}
        </g>
      </svg>
      {hover !== null &&
        hovered &&
        hovered.n > 0 &&
        // Into the body: the dock is backdrop-filtered, which makes it the
        // containing block for fixed children and would hide the card below
        // the fold.
        createPortal(
          <div
            className={`chart-hover-card${reducedMotion ? " is-static" : ""}`}
            role="status"
            style={{
              left: Math.min(Math.max(hover.x, 120), window.innerWidth - 120),
              top: hover.y - 10,
            }}
          >
            <strong>
              {dayLabel(hovered.time)} {timeLabel(hovered.time)}
            </strong>
            <dl>
              {hoverModels.map((model) => (
                <div key={model.id}>
                  <dt>
                    <i style={{ background: modelHue(model.id).wind }} />
                    {model.name}
                    {model.members > 1 && (
                      <small>{model.members} members</small>
                    )}
                  </dt>
                  <dd>
                    {model.speed === null ? "—" : Math.round(model.speed)}
                    {model.gust !== null && (
                      <small>g {Math.round(model.gust)}</small>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              Median {Math.round(show(hovered.median) ?? 0)} {unitLabel(units)}
              {directions[hover.index] !== null &&
                ` from ${compass(directions[hover.index]!)}`}
              {" · ±"}
              {((show(hovered.spread) ?? 0) / 2).toFixed(1)} {unitLabel(units)}
              {` · ${agreementLabel(hovered.agreement)}`}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Column whose centre is nearest a pointer, so a press never misses a column. */
function nearestColumn(centres: readonly number[], x: number): number {
  let best = 0;
  for (let index = 1; index < centres.length; index++)
    if (Math.abs(centres[index] - x) < Math.abs(centres[best] - x))
      best = index;
  return best;
}
