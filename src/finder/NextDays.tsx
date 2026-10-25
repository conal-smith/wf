/**
 * The next five days on a card, tomorrow on, side by side: each day's name
 * with its best stars as a row of five, its sky and its air, then its wind
 * from first light to last as a band in the chart's colours for knots, the
 * gusts paler over it and the windiest hour written over it ("15 g22"). A
 * short line in the best stars' colour runs under the hours worth riding,
 * the wind's arrow stands under it every few hours (as far apart as the room
 * allows) and the sea's height under that. Daylight only: each day stops at
 * last light, and a long June day is drawn in the same room as October's.
 */
import { useId } from "react";
import type { Units } from "../../force5/src/units";
import { speedShort } from "../../force5/src/units";
import { StarGlyphs } from "../../ui/StarGlyphs";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import { dayLong, dayShort, type StripColumn } from "../strip";
import WeatherGlyph from "../WeatherGlyph";
import { bandY, windBand } from "./band";
import {
  HOUR,
  bestStars,
  middayColumn,
  rideableRun,
  starColour,
  windiest,
  type DayPlan,
} from "./finder";
import { ARROW_PATH, gustShown, offshore } from "./marks";
import type { Readings } from "./useReadings";

/** Room between two days. */
const GAP = 6;
/** The drawing's height, and where its parts stand down it. */
const H = 86;
const TOP = 16;
const BASE = 54;
/** The fewest pixels between two of a day's arrows. */
const ARROW_ROOM = 16;

const styles = tv({
  slots: {
    root: "flex flex-col gap-1",
    heads: "grid grid-cols-5 gap-1.5",
    head: "flex min-w-0 flex-col gap-0.5",
    name: "flex items-center gap-1 font-mono text-eyebrow font-semibold whitespace-nowrap text-ink uppercase",
    sky: "flex h-4 items-center gap-1 font-mono text-caption whitespace-nowrap text-ink-2",
    drawing: "block overflow-visible",
  },
});

export function NextDays({
  row,
  strip,
  plans,
  readings,
  facing,
  units,
  now,
  width,
}: {
  row: readonly PlaceHour[] | undefined;
  strip: readonly StripColumn[];
  /** Tomorrow and the four days after it; null for a day with no light. */
  plans: readonly (DayPlan | null)[];
  readings: Readings;
  facing: number | null;
  units: Units;
  now: number;
  /** The room across, measured; nothing is drawn until it is. */
  width: number | null;
}) {
  const s = styles();
  const id = useId().replace(/[^\w-]/g, "");
  const dw = width ? (width - GAP * (plans.length - 1)) / plans.length : 0;
  // Five stars and a day's name in a fifth of the card: on a phone the
  // stars come down in size to fit beside it.
  const starSize = Math.max(5, Math.min(9, (dw - 28) / 5.6));
  const days = plans.map((plan) => {
    if (!plan) return null;
    const noon = Date.parse(`${plan.date}T12:00:00Z`);
    const mid = middayColumn(strip, plan.columns, now);
    return {
      plan,
      noon,
      best: bestStars(row, plan.columns),
      sky: mid === null ? null : (readings.sky[mid] ?? null),
      air: mid === null ? null : (readings.air[mid] ?? null),
      sea: mid === null ? null : (readings.sea[mid] ?? null),
      run: rideableRun(row, plan.columns),
      peak: windiest(row, plan.columns),
    };
  });

  return (
    <div className={s.root()} data-next-days>
      <div className={s.heads()}>
        {days.map((day, k) =>
          day ? (
            <div
              key={day.plan.date}
              className={s.head()}
              data-day={day.plan.date}
              data-stars={day.best}
            >
              <span className={s.name()} title={dayLong(day.noon)}>
                {dayShort(day.noon)}
                <StarGlyphs
                  stars={day.best}
                  coloured
                  size={starSize}
                  label={`${dayLong(day.noon)}: at best ${day.best} of 5 stars`}
                />
              </span>
              <span className={s.sky()}>
                {day.sky && <WeatherGlyph weather={day.sky} size={15} />}
                {day.air !== null && `${Math.round(day.air)}°`}
              </span>
            </div>
          ) : (
            <div key={k} className={s.head()} />
          ),
        )}
      </div>
      <svg
        className={s.drawing()}
        width={width ?? "100%"}
        height={H}
        viewBox={width ? `0 0 ${width} ${H}` : undefined}
        aria-hidden="true"
        data-days-band
      >
        {width &&
          days.map((day, k) => {
            if (!day) return null;
            const { plan } = day;
            const x0 = k * (dw + GAP);
            const span = plan.lastLight - plan.firstLight;
            const x = (time: number) =>
              x0 + ((time - plan.firstLight) / span) * dw;
            const perHour = (dw * HOUR) / span;
            const columns = plan.columns.filter(
              (at) => row?.[at]?.windKn != null,
            );
            const band = windBand(
              columns.map((at) => ({
                x: x(strip[at].time),
                mean: row![at]!.windKn!,
                gust: row![at]!.gustKn,
              })),
              { x0, x1: x0 + dw, top: TOP, base: BASE },
            );
            const gradient = `${id}-${k}`;
            // How long a column stands for: to the next one, an hour at the end.
            const half = (at: number) => {
              const i = plan.columns.indexOf(at);
              const next = plan.columns[i + 1];
              return (
                ((next === undefined
                  ? HOUR
                  : strip[next].time - strip[at].time) /
                  2 /
                  HOUR) *
                perHour
              );
            };
            // The arrows, as far apart as the room says.
            const room = Math.max(ARROW_ROOM, 3 * perHour);
            const arrows: number[] = [];
            let last = -Infinity;
            for (const at of columns) {
              const ax = x(strip[at].time);
              if (ax < x0 + room / 3 || ax > x0 + dw - room / 3) continue;
              if (ax - last < room) continue;
              if (row?.[at]?.from == null) continue;
              arrows.push(at);
              last = ax;
            }
            const peak = day.peak === null ? null : row?.[day.peak];
            const peakGust =
              peak?.windKn != null
                ? gustShown(peak.windKn, peak.gustKn, units)
                : null;
            const lineColour = day.run ? starColour(day.run.stars) : null;
            // "15 g22" where a day has the room for it, "15" where not (a
            // phone's fifth of a card): set untracked, the mono face's
            // advance is 0.6 of its 10px, and 2px is kept clear either side.
            const mean =
              peak?.windKn != null ? speedShort(peak.windKn, units) : "";
            const both = `${mean} g${peakGust === null ? "" : speedShort(peakGust, units)}`;
            const gustFits = peakGust !== null && both.length * 6 + 4 <= dw;
            const label = {
              gust: gustFits,
              width: (gustFits ? both.length : mean.length) * 6 + 4,
            };
            return (
              <g key={plan.date} data-day-band={plan.date}>
                {band && (
                  <>
                    <defs>
                      <linearGradient
                        id={`${gradient}m`}
                        x1={x0}
                        x2={x0 + dw}
                        gradientUnits="userSpaceOnUse"
                      >
                        {band.stops.map((stop, i) => (
                          <stop
                            key={i}
                            offset={stop.offset}
                            stopColor={stop.mean}
                          />
                        ))}
                      </linearGradient>
                      <linearGradient
                        id={`${gradient}g`}
                        x1={x0}
                        x2={x0 + dw}
                        gradientUnits="userSpaceOnUse"
                      >
                        {band.stops.map((stop, i) => (
                          <stop
                            key={i}
                            offset={stop.offset}
                            stopColor={stop.gust}
                            stopOpacity={0.5}
                          />
                        ))}
                      </linearGradient>
                    </defs>
                    {band.gusts && (
                      <path d={band.gusts} fill={`url(#${gradient}g)`} />
                    )}
                    <path d={band.area} fill={`url(#${gradient}m)`} />
                    {band.gustLine && (
                      <path
                        className="fill-none stroke-ink"
                        d={band.gustLine}
                        strokeOpacity={0.28}
                        strokeDasharray="2 2"
                      />
                    )}
                    <path
                      className="fill-none stroke-ink"
                      d={band.line}
                      strokeOpacity={0.75}
                      strokeWidth={1.2}
                      strokeLinejoin="round"
                    />
                  </>
                )}
                <line
                  className="stroke-ink"
                  x1={x0}
                  x2={x0 + dw}
                  y1={BASE + 0.5}
                  y2={BASE + 0.5}
                  strokeOpacity={0.4}
                />
                {peak?.windKn != null && (
                  <text
                    className="fill-ink font-mono text-eyebrow tracking-normal"
                    x={Math.min(
                      x0 + dw - label.width / 2,
                      Math.max(x0 + label.width / 2, x(strip[day.peak!].time)),
                    )}
                    y={Math.max(
                      10,
                      bandY(Math.max(peak.windKn, peakGust ?? 0), TOP, BASE) -
                        4,
                    )}
                    textAnchor="middle"
                    data-peak
                  >
                    <tspan className="font-semibold">
                      {speedShort(peak.windKn, units)}
                    </tspan>
                    {label.gust && peakGust !== null && (
                      <tspan className="fill-ink-muted">
                        {` g${speedShort(peakGust, units)}`}
                      </tspan>
                    )}
                  </text>
                )}
                {day.run && lineColour && (
                  <line
                    x1={Math.max(
                      x0 + 1,
                      x(strip[day.run.from].time) - half(day.run.from),
                    )}
                    x2={Math.min(
                      x0 + dw - 1,
                      x(strip[day.run.to].time) + half(day.run.to),
                    )}
                    y1={BASE + 3.5}
                    y2={BASE + 3.5}
                    stroke={lineColour}
                    strokeWidth={3}
                    strokeLinecap="round"
                    data-rideable={day.run.stars}
                  />
                )}
                {arrows.map((at) => {
                  const from = row![at]!.from!;
                  return (
                    <g
                      key={at}
                      transform={`translate(${x(strip[at].time).toFixed(1)} ${BASE + 13}) scale(${11 / 14}) rotate(${Math.round(from + 180)})`}
                    >
                      <path
                        className={
                          offshore(from, facing)
                            ? "fill-none stroke-pen"
                            : "fill-none stroke-ink"
                        }
                        d={ARROW_PATH}
                        strokeWidth={1.7}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
                {day.sea && (
                  <text
                    className="fill-ink-2 font-mono text-eyebrow tracking-normal"
                    x={x0 + dw / 2}
                    y={H - 3}
                    textAnchor="middle"
                  >
                    {day.sea.height.toFixed(1)} m
                  </text>
                )}
                {k < days.length - 1 && (
                  <line
                    className="stroke-ink"
                    x1={x0 + dw + GAP / 2}
                    x2={x0 + dw + GAP / 2}
                    y1={TOP}
                    y2={BASE}
                    strokeOpacity={0.15}
                    strokeDasharray="1 3"
                  />
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}
