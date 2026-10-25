/**
 * Five days on a card side by side: the six it covers but the one drawn hour
 * by hour over them (tomorrow on; today among them when another day is
 * chosen). Each day's name with its best stars as a row of five, its sky and
 * its air, then its wind from first light to last as a band in the chart's
 * colours for knots, the gusts paler over it and the windiest hour written
 * over it ("15 g22"). A short line in the best stars' colour runs under the
 * hours worth riding, the wind's arrow stands under it every few hours (as
 * far apart as the room allows) and the sea's height under that. Daylight only: each day stops at
 * last light, and a long June day is drawn in the same room as October's.
 *
 * Pressing a day (its name, or its drawing) shows it hour by hour, on every
 * card at once. A mouse over a day's drawing draws a dotted line at its time
 * on that day on every card (src/finder/hover.ts), with the time beside it
 * on this one.
 */
import { useEffect, useId, useRef, type MouseEvent } from "react";
import type { Units } from "../../force5/src/units";
import { speedShort } from "../../force5/src/units";
import { Button } from "../../ui/Button";
import { StarGlyphs } from "../../ui/StarGlyphs";
import { tv } from "../../ui/tv";
import type { PlaceHour } from "../ratings";
import {
  clock,
  dayLong,
  dayShort,
  irishDate,
  type StripColumn,
} from "../strip";
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
import { hovers, useHover, useHoverLine } from "./hover";
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
/** The hovered time's label: "14:20" in the mono face's 6px advance, and room. */
const TAG = 34;
/**
 * How far a day's first and last readings are held out to its light: a step
 * of a three-hourly run.
 */
const HELD = 3 * HOUR;

const styles = tv({
  slots: {
    root: "flex flex-col gap-1",
    heads: "grid grid-cols-5 gap-1.5",
    head: "flex min-w-0 flex-col gap-0.5",
    // A day is a press: it shows the day hour by hour above.
    pick: [
      "relative h-auto min-w-0 flex-col items-stretch justify-start gap-0.5 rounded-control border-0 px-0.5 py-0.5 -mx-0.5",
      "tracking-normal normal-case pointer-coarse:min-h-0",
    ],
    name: "flex items-center gap-1 font-mono text-eyebrow font-semibold whitespace-nowrap text-ink uppercase",
    sky: "flex h-4 items-center gap-1 font-mono text-caption whitespace-nowrap text-ink-2",
    drawing: "block cursor-pointer overflow-visible",
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
  onChoose,
  hoverKey,
}: {
  row: readonly PlaceHour[] | undefined;
  strip: readonly StripColumn[];
  /** The five days, in order; null for a day with no light. */
  plans: readonly (DayPlan | null)[];
  readings: Readings;
  facing: number | null;
  units: Units;
  now: number;
  /** The room across, measured; nothing is drawn until it is. */
  width: number | null;
  /** Show a day hour by hour, on every card. */
  onChoose: (date: string) => void;
  /** The card's own key for the time hovered. */
  hoverKey: string;
}) {
  const s = styles();
  const id = useId().replace(/[^\w-]/g, "");
  const dw = width ? (width - GAP * (plans.length - 1)) / plans.length : 0;
  const today = irishDate(now);
  // Which day a point across the drawing is in, and the time there: null in
  // the room between two days.
  const at = (px: number) => {
    const k = Math.floor(px / (dw + GAP));
    const plan = plans[k];
    const into = px - k * (dw + GAP);
    if (!plan || into < 0 || into > dw) return null;
    return {
      plan,
      time: plan.firstLight + (into / dw) * (plan.lastLight - plan.firstLight),
    };
  };
  const across = (event: MouseEvent<SVGSVGElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;

  /* ---- the time under a mouse ---- */
  const hover = useHover();
  const line = useRef<SVGGElement>(null);
  const tag = useRef<SVGGElement>(null);
  const tagText = useRef<SVGTextElement>(null);
  /* ---- the keys ---- */
  // A day pressed leaves the five for the row above, and the day it takes
  // the place of comes in: the focus goes to that one, not to the page.
  const root = useRef<HTMLDivElement>(null);
  const dateKey = plans.map((plan) => plan?.date ?? "").join(",");
  const before = useRef(dateKey);
  const refocus = useRef(false);
  useEffect(() => {
    const was = before.current.split(",");
    before.current = dateKey;
    if (!refocus.current) return;
    refocus.current = false;
    const fresh = plans.find((plan) => plan && !was.includes(plan.date));
    if (fresh)
      root.current
        ?.querySelector<HTMLElement>(`[data-day="${fresh.date}"]`)
        ?.focus();
  }, [dateKey]);

  useHoverLine((hovered) => {
    const el = line.current;
    if (!el || !tag.current || !tagText.current) return;
    const k = hovered
      ? plans.findIndex(
          (plan) =>
            plan &&
            plan.date === irishDate(hovered.time) &&
            hovered.time >= plan.firstLight &&
            hovered.time <= plan.lastLight,
        )
      : -1;
    if (!hovered || k < 0 || !dw) {
      el.setAttribute("visibility", "hidden");
      return;
    }
    const plan = plans[k]!;
    const x0 = k * (dw + GAP);
    const x =
      x0 +
      ((hovered.time - plan.firstLight) / (plan.lastLight - plan.firstLight)) *
        dw;
    el.setAttribute("visibility", "visible");
    el.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
    tag.current.setAttribute(
      "visibility",
      hovered.over === hoverKey ? "inherit" : "hidden",
    );
    tagText.current.textContent = clock(hovered.time);
    // Beside the line, inside the day's own room where it can be.
    tag.current.setAttribute(
      "transform",
      `translate(${x + TAG + 2 > x0 + dw ? -TAG - 2 : 2} 0)`,
    );
  });
  // Five stars and a day's name in a fifth of the card: on a phone the
  // stars come down in size to fit beside it, and under a name too long to
  // keep them beside it at all ("Today", among the five on a phone).
  const starRow = (name: string) => {
    const beside = (dw - name.length * 6 - 10) / 5.6;
    return beside >= 5
      ? { size: Math.min(9, beside), under: false }
      : { size: Math.max(5, Math.min(9, (dw - 6) / 5.6)), under: true };
  };
  const days = plans.map((plan) => {
    if (!plan) return null;
    const noon = Date.parse(`${plan.date}T12:00:00Z`);
    const mid = middayColumn(strip, plan.columns, now);
    return {
      plan,
      noon,
      // Today, among the five when another day is chosen, by name.
      name: plan.date === today ? "Today" : dayShort(noon),
      said: plan.date === today ? "Today" : dayLong(noon),
      best: bestStars(row, plan.columns),
      sky: mid === null ? null : (readings.sky[mid] ?? null),
      air: mid === null ? null : (readings.air[mid] ?? null),
      sea: mid === null ? null : (readings.sea[mid] ?? null),
      run: rideableRun(row, plan.columns),
      peak: windiest(row, plan.columns),
    };
  });

  return (
    <div className={s.root()} ref={root} data-next-days>
      <div className={s.heads()}>
        {days.map((day, k) =>
          day ? (
            <Button
              key={day.plan.date}
              variant="quiet"
              className={s.pick()}
              aria-label={`${day.said}, at best ${day.best} of 5 stars`}
              title={`${day.said}, hour by hour`}
              data-day={day.plan.date}
              data-stars={day.best}
              onClick={(event) => {
                event.stopPropagation();
                refocus.current =
                  event.currentTarget === document.activeElement;
                onChoose(day.plan.date);
              }}
            >
              <span
                className={s.name({
                  className: starRow(day.name).under && "flex-wrap",
                })}
              >
                {day.name}
                <StarGlyphs
                  stars={day.best}
                  coloured
                  size={starRow(day.name).size}
                  label=""
                />
              </span>
              <span className={s.sky()}>
                {day.sky && <WeatherGlyph weather={day.sky} size={15} />}
                {day.air !== null && `${Math.round(day.air)}°`}
              </span>
            </Button>
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
        onPointerMove={(event) => {
          if (!hover || !hovers(event)) return;
          const point = at(across(event));
          hover.set(point && { time: point.time, over: hoverKey });
        }}
        onPointerLeave={() => hover?.set(null)}
        onClick={(event) => {
          event.stopPropagation();
          const point = at(across(event));
          if (point) onChoose(point.plan.date);
        }}
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
            // The wind fills the day's room, held out from its first and
            // last readings to the light, but not across hours it has no
            // forecast for (today's morning, before the run began, when
            // today is among the five): from half an hour before its first.
            const firstAt = columns.length ? strip[columns[0]].time : 0;
            const lastAt = columns.length ? strip[columns.at(-1)!].time : 0;
            const band = windBand(
              columns.map((at) => ({
                x: x(strip[at].time),
                mean: row![at]!.windKn!,
                gust: row![at]!.gustKn,
              })),
              {
                x0:
                  firstAt - plan.firstLight > HELD
                    ? x(firstAt) - perHour / 2
                    : x0,
                x1:
                  plan.lastLight - lastAt > HELD
                    ? x(lastAt) + perHour / 2
                    : x0 + dw,
                top: TOP,
                base: BASE,
              },
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
                        x1={band.x0}
                        x2={band.x1}
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
                        x1={band.x0}
                        x2={band.x1}
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
        <g
          ref={line}
          className="pointer-events-none"
          visibility="hidden"
          data-hover-line
        >
          <line
            className="stroke-ink"
            x1={0.5}
            x2={0.5}
            y1={2}
            y2={BASE}
            strokeDasharray="1 2"
          />
          <g ref={tag} data-hover-time>
            <rect className="fill-inverse" width={TAG} height={13} rx={3} />
            <text
              ref={tagText}
              className="fill-ink-inverse font-mono text-eyebrow tracking-normal"
              x={TAG / 2}
              y={10}
              textAnchor="middle"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
