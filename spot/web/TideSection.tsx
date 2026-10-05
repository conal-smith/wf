/**
 * Tide and daylight for one day: the tide curve across 24 hours with the
 * night and twilight shaded behind it and the present marked, then the turns
 * and the sun as two small tables — the chart's own numbers, for anyone who
 * would rather read than look.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpotForecast } from "../../mcp/api/forecast";
import { Notice, Segmented } from "../../ui";
import { tv } from "../../ui/tv";
import {
  clock,
  dayNames,
  daySun,
  dublinDate,
  dublinMidnight,
  nextMidnight,
  shadeBands,
  tideCurve,
  tideHeightAt,
  tideTrend,
  type TideTurn,
} from "./spot";

const styles = tv({
  slots: {
    section: "flex scroll-mt-24 flex-col gap-4",
    head: "flex flex-wrap items-end justify-between gap-3",
    title: "m-0 text-title",
    sub: "m-0 text-body text-ink-muted",
    card: "flex flex-col gap-4 rounded-surface border border-line bg-card p-5 shadow-control max-wide:p-4",
    chart: "relative w-full",
    svg: "block w-full touch-pan-y select-none",
    night: "fill-inverse/12",
    twilight: "fill-inverse/5",
    area: "fill-basemap-water/70",
    line: "fill-none stroke-ink-2",
    grid: "stroke-line",
    tick: "fill-ink-muted text-caption tabular-nums",
    turnDot: "fill-card stroke-ink-2",
    turnText: "fill-ink text-caption font-semibold tabular-nums",
    sunText: "fill-ink-muted text-caption tabular-nums",
    now: "stroke-now-marker",
    nowText: "fill-now text-eyebrow uppercase",
    cursor: "stroke-ink-muted",
    readout: "fill-ink text-caption font-semibold tabular-nums",
    tables: "grid gap-4 wide:grid-cols-2",
    table: "w-full max-w-dialog border-collapse text-body tabular-nums",
    caption: "pb-2 text-left text-label text-ink",
    th: "py-1.5 pr-3 text-left font-normal text-ink-muted",
    td: "py-1.5 pr-3 text-ink",
    tr: "border-t border-line",
    legend:
      "flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted",
    swatch: "inline-block size-3 rounded-full align-middle",
    swatchNight: "bg-inverse/12",
    swatchTwilight: "bg-inverse/5 ring-1 ring-line",
    swatchTide: "bg-basemap-water",
  },
});

const HEIGHT = 200;
const PAD_TOP = 30;
const PAD_BOTTOM = 22;

/** The element's width, kept current: the chart draws at its real size. */
function useWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function tideTurns(forecast: SpotForecast): TideTurn[] {
  const tides = forecast.tides;
  if (!tides || !("events" in tides)) return [];
  return tides.events.map((event) => ({
    time: Date.parse(event.time),
    tide: event.tide,
    height: event.height_m,
  }));
}

export function TideSection({
  forecast,
  dates,
  selected,
  onSelect,
  now,
}: {
  forecast: SpotForecast;
  dates: readonly string[];
  selected: string;
  onSelect: (date: string) => void;
  now: number;
}) {
  const s = styles();
  const tides = forecast.tides;
  const turns = useMemo(() => tideTurns(forecast), [forecast]);
  const station = tides && "station" in tides ? tides : null;
  const note = tides && "note" in tides ? tides.note : null;
  const start = dublinMidnight(selected);
  const end = nextMidnight(selected);
  const sun = daySun(forecast.spot.lat, forecast.spot.lon, selected);
  const dayTurns = turns.filter((t) => t.time >= start && t.time < end);
  const lastTurn = turns.at(-1)?.time ?? null;
  const names = dayNames(selected, now);

  return (
    <section
      id="tide-and-daylight"
      className={s.section()}
      aria-labelledby="tide-title"
    >
      <div className={s.head()}>
        <div className="flex flex-col gap-1">
          <h2 id="tide-title" className={s.title()}>
            Tide and daylight for {forecast.spot.name}
          </h2>
          <p className={s.sub()}>
            {station
              ? `Predicted at ${station.station}, ${station.distance_km} km away · heights above ${station.datum}`
              : "Daylight from the sun's position at the spot"}
          </p>
        </div>
        <Segmented
          aria-label="Day"
          value={selected}
          onChange={onSelect}
          className="max-w-full overflow-x-auto scrollbar-none"
          options={dates.map((date) => ({
            value: date,
            label: dayNames(date, now).short,
          }))}
        />
      </div>
      {!station && (
        <Notice>
          No tide predictions for this spot
          {note ? `: ${note}` : "."} Daylight is still shown.
        </Notice>
      )}
      <div className={s.card()} data-tide-day={selected}>
        <TideChart
          turns={turns}
          start={start}
          end={end}
          sun={sun}
          now={now}
          label={`${names.full}: ${
            dayTurns.length
              ? dayTurns
                  .map(
                    (t) =>
                      `${t.tide} ${clock(t.time)} ${t.height.toFixed(1)} m`,
                  )
                  .join(", ")
              : "no tide turns published"
          }; sunrise ${sun.sunrise ? clock(sun.sunrise) : "none"}, sunset ${
            sun.sunset ? clock(sun.sunset) : "none"
          }.`}
        />
        <div className={s.legend()} aria-hidden="true">
          {station && (
            <span>
              <i className={s.swatch({ className: s.swatchTide() })} /> Tide
            </span>
          )}
          <span>
            <i className={s.swatch({ className: s.swatchTwilight() })} />{" "}
            Twilight
          </span>
          <span>
            <i className={s.swatch({ className: s.swatchNight() })} /> Dark
          </span>
        </div>
        {station && !dayTurns.length && (
          <p className={s.sub()}>
            {lastTurn !== null && lastTurn < end
              ? `Tide predictions are published to ${clock(lastTurn)} on ${
                  dayNames(dublinDate(lastTurn), now).full
                }.`
              : "No tide turns fall on this day."}
          </p>
        )}
        <div className={s.tables()}>
          <table className={s.table()} data-tide-table>
            <caption className={s.caption()}>Tides</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Tide</th>
                <th scope="col">Time</th>
                <th scope="col">Height</th>
              </tr>
            </thead>
            <tbody>
              {dayTurns.map((turn) => (
                <tr key={turn.time} className={s.tr()}>
                  <th scope="row" className={s.th()}>
                    {turn.tide === "high" ? "High" : "Low"}
                  </th>
                  <td className={s.td()}>{clock(turn.time)}</td>
                  <td className={s.td()}>{turn.height.toFixed(2)} m</td>
                </tr>
              ))}
              {!dayTurns.length && (
                <tr className={s.tr()}>
                  <td className={s.th()} colSpan={3}>
                    {station ? "None published for this day" : "Not available"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <table className={s.table()} data-sun-table>
            <caption className={s.caption()}>Daylight</caption>
            <tbody>
              {(
                [
                  ["First light", sun.firstLight],
                  ["Sunrise", sun.sunrise],
                  ["Sunset", sun.sunset],
                  ["Last light", sun.lastLight],
                ] as const
              ).map(([label, time]) => (
                <tr key={label} className={s.tr()}>
                  <th scope="row" className={s.th()}>
                    {label}
                  </th>
                  <td className={s.td()}>
                    {time === null ? "–" : clock(time)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TideChart({
  turns,
  start,
  end,
  sun,
  now,
  label,
}: {
  turns: readonly TideTurn[];
  start: number;
  end: number;
  sun: ReturnType<typeof daySun>;
  now: number;
  label: string;
}) {
  const s = styles();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const curve = useMemo(
    () => tideCurve(turns, start, end, 10),
    [turns, start, end],
  );
  const dayTurns = turns.filter((t) => t.time >= start && t.time < end);
  // One scale for every day of the station, so a neap day looks like one.
  const heights = turns.map((t) => t.height);
  const low = heights.length ? Math.min(0, ...heights) : 0;
  const high = heights.length ? Math.max(...heights) : 1;
  const span = Math.max(0.5, high - low);
  const x = (time: number) => ((time - start) / (end - start)) * width;
  const y = (height: number) =>
    PAD_TOP + (1 - (height - low) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const bands = shadeBands(sun, start, end);
  const path = curve.length
    ? curve
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(p.time).toFixed(1)} ${y(p.height).toFixed(1)}`,
        )
        .join(" ")
    : "";
  const area = curve.length
    ? `${path} L${x(curve.at(-1)!.time).toFixed(1)} ${HEIGHT - PAD_BOTTOM} L${x(curve[0].time).toFixed(1)} ${HEIGHT - PAD_BOTTOM} Z`
    : "";
  const hours = Math.round((end - start) / 3600000);
  const ticks = Array.from(
    { length: Math.floor(hours / 3) + 1 },
    (_, i) => start + i * 3 * 3600000,
  );
  const showNow = now >= start && now < end;
  const hoverHeight = hover === null ? null : tideHeightAt(turns, hover);
  const trend = hover === null ? null : tideTrend(turns, hover);

  return (
    <div ref={ref} className={s.chart()}>
      <svg
        className={s.svg()}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={label}
        data-tide-chart
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const f = (event.clientX - box.left) / box.width;
          setHover(start + Math.min(1, Math.max(0, f)) * (end - start));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {bands.map((band) => (
          <rect
            key={`${band.kind}-${band.from}`}
            className={band.kind === "night" ? s.night() : s.twilight()}
            x={x(band.from)}
            y={0}
            width={Math.max(0, x(band.to) - x(band.from))}
            height={HEIGHT - PAD_BOTTOM}
            data-shade={band.kind}
          />
        ))}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={s.grid()}
              x1={x(tick)}
              x2={x(tick)}
              y1={PAD_TOP - 8}
              y2={HEIGHT - PAD_BOTTOM}
              strokeWidth={1}
            />
            <text
              className={s.tick()}
              x={Math.min(width - 12, Math.max(12, x(tick)))}
              y={HEIGHT - 6}
              textAnchor="middle"
            >
              {clock(tick).slice(0, 2)}
            </text>
          </g>
        ))}
        {area && <path className={s.area()} d={area} data-tide-curve />}
        {path && (
          <path
            className={s.line()}
            d={path}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {dayTurns.map((turn) => {
          const above = turn.tide === "high";
          // Near an edge the label hangs inward rather than off the chart.
          const anchor =
            x(turn.time) < 48
              ? "start"
              : x(turn.time) > width - 48
                ? "end"
                : "middle";
          return (
            <g key={turn.time}>
              <circle
                className={s.turnDot()}
                cx={x(turn.time)}
                cy={y(turn.height)}
                r={4}
                strokeWidth={2}
              />
              <text
                className={s.turnText()}
                x={x(turn.time)}
                y={above ? y(turn.height) - 10 : y(turn.height) + 18}
                textAnchor={anchor}
              >
                {clock(turn.time)} · {turn.height.toFixed(1)} m
              </text>
            </g>
          );
        })}
        {sun.sunrise !== null && sun.sunset !== null && (
          <>
            <text className={s.sunText()} x={x(sun.sunrise) + 4} y={12}>
              ↑ {clock(sun.sunrise)}
            </text>
            <text
              className={s.sunText()}
              x={x(sun.sunset) - 4}
              y={12}
              textAnchor="end"
            >
              {clock(sun.sunset)} ↓
            </text>
          </>
        )}
        {showNow && (
          <g data-now-marker>
            <line
              className={s.now()}
              x1={x(now)}
              x2={x(now)}
              y1={PAD_TOP - 10}
              y2={HEIGHT - PAD_BOTTOM}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              className={s.nowText()}
              x={x(now) + 4}
              y={HEIGHT - PAD_BOTTOM - 6}
            >
              Now
            </text>
          </g>
        )}
        {hover !== null && (
          <g aria-hidden="true">
            <line
              className={s.cursor()}
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_TOP - 10}
              y2={HEIGHT - PAD_BOTTOM}
              strokeWidth={1}
            />
            {hoverHeight !== null && (
              <circle
                className={s.turnDot()}
                cx={x(hover)}
                cy={y(hoverHeight)}
                r={3}
                strokeWidth={2}
              />
            )}
            <text
              className={s.readout()}
              x={x(hover) > width - 120 ? x(hover) - 6 : x(hover) + 6}
              y={HEIGHT - PAD_BOTTOM - 6}
              textAnchor={x(hover) > width - 120 ? "end" : "start"}
            >
              {clock(hover)}
              {hoverHeight !== null && ` · ${hoverHeight.toFixed(1)} m`}
              {trend && ` ${trend}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
