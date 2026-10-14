/**
 * An hour's wind against the rider's own range. The frame is the range: its
 * left edge the rider's floor, its right edge the most they can hold, the
 * sweet spot tinted inside. The models' spread is an ink line across it, the
 * blend a dot on that line and the gust a tick above it; a blend outside the
 * range is an arrowhead pinned beyond the edge it missed. Every row draws the
 * same frame, so down a column it reads where each hour sits.
 *
 * Tapped, it opens `RangeDetail`: the same frame drawn large and labelled, and
 * every model's wind, HARMONIE's first while it reaches the hour.
 */
import type { ReactNode } from "react";
import { SHORE_LABEL, type ShoreAngle } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { HourWind } from "../../mcp/api/forecast";
import { MONO_LABEL, tv } from "../../ui/tv";
import { WindArrow } from "./glyphs";
import { clock, compass, windIn } from "./spot";

const styles = tv({
  slots: {
    svg: "block shrink-0 overflow-visible",
    sweet: "fill-chart-magenta/10",
    frame: "fill-none stroke-ink",
    models: "stroke-ink",
    cap: "stroke-ink",
    mean: "fill-ink",
    out: "fill-ink",
    gust: "fill-gust",
    label: "fill-ink-muted font-mono text-eyebrow normal-case",
    labelStrong: "fill-ink font-mono text-eyebrow font-semibold normal-case",
    detail: "flex flex-col gap-2.5",
    when: ["text-ink-muted", MONO_LABEL],
    headline:
      "flex items-baseline gap-2 font-mono text-caption text-ink-muted tabular-nums",
    big: "text-lead font-semibold text-ink",
    gustSup: "align-super text-caption text-gust",
    facts: "m-0 flex flex-col gap-1 font-mono text-caption",
    fact: "flex gap-3",
    term: ["w-12 shrink-0 pt-px text-ink-muted", MONO_LABEL],
    value: "m-0 text-ink-2",
    strong: "font-semibold text-ink",
    warn: "m-0 text-pen-ink",
    table: "w-full border-collapse font-mono text-caption tabular-nums",
    th: [
      "border-0 border-b border-ink pb-0.5 text-left text-ink-muted",
      MONO_LABEL,
    ],
    num: "text-right",
    td: "border-0 border-b border-line py-0.5 text-left font-normal text-ink-2",
    lead: "font-semibold text-ink",
    tag: "ml-1 text-eyebrow text-ink-muted",
    note: "m-0 font-body text-caption text-ink-muted italic",
  },
});

export const RANGE_WIDTH = 112;
/** Room either side of the frame for an arrowhead that missed it. */
const STUB = 10;

export interface Band {
  min: number;
  sweetLow: number;
  sweetHigh: number;
  max: number;
}

/** The frame's scale: the rider's floor to their most, across `width`. */
function scale(band: Band, width: number) {
  const left = STUB;
  const right = width - STUB;
  const x = (knots: number) =>
    left + ((knots - band.min) / (band.max - band.min)) * (right - left);
  /** As `x`, but never past the stubs. */
  const held = (knots: number) => Math.min(width - 2, Math.max(2, x(knots)));
  return { left, right, x, held };
}

export type RangeZone = "under" | "light" | "best" | "strong" | "over";

export function rangeZone(knots: number, band: Band): RangeZone {
  if (knots < band.min) return "under";
  if (knots < band.sweetLow) return "light";
  if (knots <= band.sweetHigh) return "best";
  if (knots <= band.max) return "strong";
  return "over";
}

/** "2 under your minimum, 13": where a wind sits in the rider's range, in words. */
export function rangeText(knots: number, band: Band, units: Units): string {
  const say = (k: number) => windIn(k, units);
  switch (rangeZone(knots, band)) {
    case "under":
      return `${say(band.min) - say(knots)} under your minimum, ${say(band.min)}`;
    case "light":
      return `between your minimum, ${say(band.min)}, and your best, ${say(band.sweetLow)}–${say(band.sweetHigh)}`;
    case "best":
      return `in your best, ${say(band.sweetLow)}–${say(band.sweetHigh)}`;
    case "strong":
      return `between your best, ${say(band.sweetLow)}–${say(band.sweetHigh)}, and your most, ${say(band.max)}`;
    case "over":
      return `${say(knots) - say(band.max)} over your most, ${say(band.max)}`;
  }
}

/** What the frame draws, for a screen reader and the trigger's label. */
export function rangeWords(wind: HourWind, band: Band, units: Units): string {
  const say = (k: number) => windIn(k, units);
  return [
    `blend ${say(wind.wind_kn)}${wind.gust_kn !== null ? ` gusting ${say(wind.gust_kn)}` : ""}`,
    wind.models > 1
      ? `${wind.models} models ${say(wind.min_kn)}–${say(wind.max_kn)}`
      : null,
    rangeText(wind.wind_kn, band, units),
  ]
    .filter(Boolean)
    .join(", ");
}

/** The frame and the hour's wind in it. `height` is the row's; 18 in a row. */
function Frame({
  wind,
  band,
  width,
  height,
  mid,
}: {
  wind: HourWind;
  band: Band;
  width: number;
  height: number;
  mid: number;
}) {
  const s = styles();
  const { left, right, x, held } = scale(band, width);
  const half = Math.min(8, height / 2 - 1);
  const lo = held(wind.min_kn);
  const hi = held(wind.max_kn);
  return (
    <>
      <rect
        className={s.sweet()}
        x={x(band.sweetLow)}
        y={mid - half}
        width={x(band.sweetHigh) - x(band.sweetLow)}
        height={half * 2}
      />
      <rect
        className={s.frame()}
        x={left + 0.5}
        y={mid - half + 0.5}
        width={right - left - 1}
        height={half * 2 - 1}
      />
      {wind.models > 1 && (
        <>
          <line
            className={s.models()}
            x1={lo}
            x2={hi}
            y1={mid}
            y2={mid}
            strokeWidth={2}
          />
          <line className={s.cap()} x1={lo} x2={lo} y1={mid - 3} y2={mid + 3} />
          <line className={s.cap()} x1={hi} x2={hi} y1={mid - 3} y2={mid + 3} />
        </>
      )}
      {wind.gust_kn !== null && (
        <path
          className={s.gust()}
          d={`M${held(wind.gust_kn) - 3.5} ${mid - half - 5}h7l-3.5 5z`}
        />
      )}
      {wind.wind_kn < band.min ? (
        <path className={s.out()} d={`M1 ${mid}l7-4.5v9z`} />
      ) : wind.wind_kn > band.max ? (
        <path className={s.out()} d={`M${width - 1} ${mid}l-7-4.5v9z`} />
      ) : (
        <circle className={s.mean()} cx={x(wind.wind_kn)} cy={mid} r={3.4} />
      )}
    </>
  );
}

export function RangeBar({ wind, band }: { wind: HourWind; band: Band }) {
  const s = styles();
  return (
    <svg
      className={s.svg()}
      width={RANGE_WIDTH}
      height={22}
      aria-hidden="true"
      data-range-bar
    >
      <Frame wind={wind} band={band} width={RANGE_WIDTH} height={22} mid={12} />
    </svg>
  );
}

/** The frame's labels, for its column's head: the floor, the best, the most. */
export function RangeAxis({ band, units }: { band: Band; units: Units }) {
  const s = styles();
  const say = (knots: number) => windIn(knots, units);
  const { left, right, x } = scale(band, RANGE_WIDTH);
  return (
    <svg className={s.svg()} width={RANGE_WIDTH} height={20} aria-hidden="true">
      <rect
        className={s.sweet()}
        x={x(band.sweetLow)}
        y={13}
        width={x(band.sweetHigh) - x(band.sweetLow)}
        height={6}
      />
      <rect
        className={s.frame()}
        x={left + 0.5}
        y={13.5}
        width={right - left - 1}
        height={5}
      />
      <text className={s.label()} x={left} y={9} textAnchor="middle">
        {say(band.min)}
      </text>
      <text
        className={s.labelStrong()}
        x={(x(band.sweetLow) + x(band.sweetHigh)) / 2}
        y={9}
        textAnchor="middle"
      >
        {say(band.sweetLow)}–{say(band.sweetHigh)}
      </text>
      <text className={s.label()} x={right} y={9} textAnchor="middle">
        {say(band.max)}
      </text>
    </svg>
  );
}

/** The model the blend leans on most while it reaches the hour (force5/src/weights.ts). */
export const LEAD_MODEL = "harmonie";

const DETAIL_WIDTH = 284;

/** The frame, large and labelled: the card's chart. */
function DetailChart({
  wind,
  band,
  units,
}: {
  wind: HourWind;
  band: Band;
  units: Units;
}) {
  const s = styles();
  const say = (knots: number) => windIn(knots, units);
  const { left, right, x } = scale(band, DETAIL_WIDTH);
  const mid = 30;
  return (
    <svg
      className={s.svg()}
      width={DETAIL_WIDTH}
      height={58}
      aria-hidden="true"
      data-range-chart
    >
      <text className={s.label()} x={left} y={9} textAnchor="start">
        min {say(band.min)}
      </text>
      <text
        className={s.labelStrong()}
        x={(x(band.sweetLow) + x(band.sweetHigh)) / 2}
        y={9}
        textAnchor="middle"
      >
        best {say(band.sweetLow)}–{say(band.sweetHigh)}
      </text>
      <text className={s.label()} x={right} y={9} textAnchor="end">
        max {say(band.max)}
      </text>
      <Frame
        wind={wind}
        band={band}
        width={DETAIL_WIDTH}
        height={22}
        mid={mid}
      />
      {wind.models > 1 && (
        <>
          <text
            className={s.label()}
            x={scale(band, DETAIL_WIDTH).held(wind.min_kn)}
            y={54}
            textAnchor="middle"
          >
            {say(wind.min_kn)}
          </text>
          {say(wind.max_kn) !== say(wind.min_kn) && (
            <text
              className={s.label()}
              x={scale(band, DETAIL_WIDTH).held(wind.max_kn)}
              y={54}
              textAnchor="middle"
            >
              {say(wind.max_kn)}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

/** One line of the card's facts: a term and what it is. */
function Fact({
  term,
  warn = false,
  children,
}: {
  term: string;
  warn?: boolean;
  children: ReactNode;
}) {
  const s = styles();
  return (
    <div className={s.fact()}>
      <dt className={s.term()}>{term}</dt>
      <dd className={warn ? s.warn() : s.value()}>{children}</dd>
    </div>
  );
}

const WARN_SHORE: ReadonlySet<ShoreAngle> = new Set(["offshore", "cross-off"]);

/** The card the frame opens: the hour's wind, broken down. Figures, not advice. */
export function RangeDetail({
  time,
  date,
  wind,
  band,
  units,
  unitText,
  shore,
  rainMm,
  models,
  riderText,
}: {
  time: number;
  /** "Wed 14 Oct" */
  date: string;
  wind: HourWind;
  band: Band;
  units: Units;
  unitText: string;
  shore: ShoreAngle | null;
  rainMm: number | null | undefined;
  /** The live wind models, in the order the sources list them. */
  models: readonly { id: string; name: string }[];
  riderText: string;
}) {
  const s = styles();
  const say = (knots: number) => windIn(knots, units);
  const byModel = wind.by_model ?? {};
  const rows = [
    ...models.filter((m) => m.id === LEAD_MODEL),
    ...models.filter((m) => m.id !== LEAD_MODEL),
  ].filter((m) => byModel[m.id]);
  const leadLive = models.some((m) => m.id === LEAD_MODEL);
  const leadHere = Boolean(byModel[LEAD_MODEL]);
  return (
    <div className={s.detail()} data-range-detail>
      <span className={s.when()}>
        {date} · {clock(time)}
      </span>
      <span className={s.headline()}>
        <span className={s.big()}>
          {say(wind.wind_kn)}
          {wind.gust_kn !== null && (
            <span className={s.gustSup()}>{say(wind.gust_kn)}</span>
          )}
        </span>
        {unitText}
        <WindArrow from={wind.direction_deg} size={14} />
        {wind.direction}
      </span>
      <DetailChart wind={wind} band={band} units={units} />
      <dl className={s.facts()}>
        <Fact term="Blend">
          <b className={s.strong()}>{say(wind.wind_kn)}</b>
          {wind.models > 1 && (
            <>
              {" "}
              · lowest <b className={s.strong()}>{say(wind.min_kn)}</b> ·
              highest <b className={s.strong()}>{say(wind.max_kn)}</b>
            </>
          )}
        </Fact>
        {wind.gust_kn !== null && (
          <Fact term="Gusts">
            <b className={s.strong()}>{say(wind.gust_kn)}</b>
            {wind.gust_max_kn !== null &&
              say(wind.gust_max_kn) !== say(wind.gust_kn) && (
                <> · highest {say(wind.gust_max_kn)}</>
              )}
          </Fact>
        )}
        {wind.agreement && (
          <Fact term="Agree">
            <b className={s.strong()}>{wind.agreement}</b> · {wind.models}{" "}
            models
          </Fact>
        )}
        <Fact term="You">
          <span data-range-text>{rangeText(wind.wind_kn, band, units)}</span>
        </Fact>
        {shore && (
          <Fact term="Shore" warn={WARN_SHORE.has(shore)}>
            {SHORE_LABEL[shore]}
            {WARN_SHORE.has(shore) && " · blows from the land out to sea"}
          </Fact>
        )}
        {rainMm ? <Fact term="Rain">{rainMm} mm</Fact> : null}
      </dl>
      {rows.length > 0 && (
        <table className={s.table()} data-range-models>
          <thead>
            <tr>
              <th scope="col" className={s.th()}>
                Model
              </th>
              <th scope="col" className={s.th({ className: s.num() })}>
                Wind
              </th>
              <th scope="col" className={s.th({ className: s.num() })}>
                Gust
              </th>
              <th scope="col" className={s.th({ className: s.num() })}>
                From
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => {
              const line = byModel[model.id];
              const lead = model.id === LEAD_MODEL;
              const weight = lead ? s.lead() : "";
              const num = s.td({ className: [weight, s.num()] });
              return (
                <tr key={model.id} data-model={model.id}>
                  <th scope="row" className={s.td({ className: weight })}>
                    {model.name}
                    {lead && <span className={s.tag()}>lead</span>}
                  </th>
                  <td className={num}>{say(line.wind_kn)}</td>
                  <td className={num}>
                    {line.gust_kn === null ? "–" : say(line.gust_kn)}
                  </td>
                  <td className={num}>{compass(line.direction_deg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {leadLive && !leadHere && (
        <p className={s.note()}>HARMONIE does not reach this hour.</p>
      )}
      <p className={s.note()}>Rated for {riderText}.</p>
    </div>
  );
}
