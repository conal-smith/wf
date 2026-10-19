/**
 * An hour's wind against the rider's own range. The frame is the range: its
 * left edge the rider's floor, its right edge the most they can hold, the
 * sweet spot tinted inside. On it, one model's own forecast, the one the
 * stars come from (`HourWind.lead`): a dot at its mean and an orange tail to
 * its gust, "13, gusting 19"; a mean outside the range is an arrowhead pinned
 * beyond the edge it missed. Every row draws the same frame, so down a column
 * it reads where each hour sits.
 *
 * Tapped, it opens `RangeDetail`: the same frame drawn large and labelled,
 * with the other models as faint ticks, and every model's wind, the one the
 * stars come from first. Any of them can be picked there to rate the stars.
 */
import { useState, type ReactNode } from "react";
import { modelName, type StarsFrom } from "../../force5/src/lead";
import { SHORE_LABEL, type ShoreAngle } from "../../force5/src/stars";
import type { Units } from "../../force5/src/units";
import type { HourWind } from "../../mcp/api/forecast";
import { Button } from "../../ui";
import { MONO_LABEL, tv } from "../../ui/tv";
import { WindArrow } from "./glyphs";
import { clock, compass, windIn } from "./spot";

const styles = tv({
  slots: {
    svg: "block shrink-0 overflow-visible",
    sweet: "fill-chart-magenta/10",
    frame: "fill-none stroke-ink",
    tick: "stroke-ink/40",
    mean: "fill-ink",
    out: "fill-ink",
    tail: "fill-none stroke-gust",
    gust: "fill-gust",
    label: "fill-ink-muted font-mono text-eyebrow normal-case",
    labelStrong: "fill-ink font-mono text-eyebrow font-semibold normal-case",
    labelGust: "fill-gust font-mono text-eyebrow font-semibold normal-case",
    detail: "flex flex-col gap-2.5",
    when: ["text-ink-muted", MONO_LABEL],
    headline:
      "flex items-baseline gap-2 font-mono text-caption text-ink-muted tabular-nums",
    big: "text-lead font-semibold text-ink",
    gustSup: "align-super text-caption text-gust",
    facts: "m-0 flex flex-col gap-1 font-mono text-caption",
    fact: "flex gap-3",
    // Wide enough for "Stars from", the longest term.
    term: ["w-18 shrink-0 pt-px text-ink-muted", MONO_LABEL],
    value: "m-0 text-ink-2",
    strong: "font-semibold text-ink",
    context: "font-body text-caption text-ink-muted italic",
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
    pickCell: "w-6 border-0 border-b border-line p-0",
    pick: "h-5 w-5 text-ink",
    ring: "fill-none stroke-ink",
    dot: "fill-ink",
    note: "m-0 font-body text-caption text-ink-muted italic",
    ask: "flex flex-col gap-2 border-0 border-t border-line pt-2",
    askTitle: ["m-0 text-ink", MONO_LABEL],
    askButtons: "flex flex-wrap items-center gap-2",
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

/** The headline's name: the model the hour's stars come from, "HARMONIE", "ECMWF". */
export const headlineName = (wind: Pick<HourWind, "lead">) =>
  modelName(wind.lead);

/** What the frame draws, for a screen reader and the trigger's label. */
export function rangeWords(wind: HourWind, band: Band, units: Units): string {
  const say = (k: number) => windIn(k, units);
  return [
    `${headlineName(wind)} ${say(wind.wind_kn)}${wind.gust_kn !== null ? ` gusting ${say(wind.gust_kn)}` : ""}`,
    wind.models > 1
      ? `${wind.models} models ${say(wind.min_kn)}–${say(wind.max_kn)}`
      : null,
    rangeText(wind.wind_kn, band, units),
  ]
    .filter(Boolean)
    .join(", ");
}

/** Every other model's mean, for the card's faint ticks. */
export function otherWinds(wind: HourWind): { id: string; knots: number }[] {
  return Object.entries(wind.by_model ?? {})
    .filter(([id]) => id !== wind.lead)
    .map(([id, line]) => ({ id, knots: line.wind_kn }));
}

/**
 * The frame and the hour's wind in it: the mean as a dot, the tail to the
 * gust, and in the card (`ticks`) the other models faint. `height` is the
 * row's; 22 in a row.
 */
function Frame({
  wind,
  band,
  width,
  height,
  mid,
  ticks = false,
}: {
  wind: HourWind;
  band: Band;
  width: number;
  height: number;
  mid: number;
  ticks?: boolean;
}) {
  const s = styles();
  const { left, right, x, held } = scale(band, width);
  const half = Math.min(8, height / 2 - 1);
  // The tail starts where the mean is drawn: on the frame's edge for a mean
  // pinned beyond it.
  const meanX =
    wind.wind_kn < band.min
      ? left
      : wind.wind_kn > band.max
        ? right
        : x(wind.wind_kn);
  const gustX = wind.gust_kn === null ? null : held(wind.gust_kn);
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
      {ticks &&
        otherWinds(wind).map(({ id, knots }) => (
          <line
            key={id}
            className={s.tick()}
            x1={held(knots)}
            x2={held(knots)}
            y1={mid - 5}
            y2={mid + 5}
            strokeWidth={1.2}
            data-model-tick={id}
          />
        ))}
      {gustX !== null && (
        <>
          <line
            className={s.tail()}
            x1={meanX}
            x2={gustX}
            y1={mid}
            y2={mid}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <circle className={s.gust()} cx={gustX} cy={mid} r={2.6} />
        </>
      )}
      {wind.wind_kn < band.min ? (
        <path className={s.out()} d={`M1 ${mid}l7-4.5v9z`} />
      ) : wind.wind_kn > band.max ? (
        <path className={s.out()} d={`M${width - 1} ${mid}l-7-4.5v9z`} />
      ) : (
        <circle className={s.mean()} cx={meanX} cy={mid} r={3.4} />
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

const DETAIL_WIDTH = 284;

/**
 * Where the mean's and the gust's figures go under the card's chart: under
 * their marks, or pushed apart, the mean to the left and the gust to the
 * right, where they would run into each other.
 */
export function figurePlaces(
  meanX: number,
  gustX: number | null,
  width: number,
): {
  mean: { x: number; anchor: "middle" | "end" };
  gust: { x: number; anchor: "middle" | "start" } | null;
} {
  const room = 26;
  if (gustX === null || Math.abs(gustX - meanX) >= room)
    return {
      mean: { x: meanX, anchor: "middle" },
      gust: gustX === null ? null : { x: gustX, anchor: "middle" },
    };
  const at = Math.min(Math.max((meanX + gustX) / 2, room), width - room);
  return {
    mean: { x: at - 2, anchor: "end" },
    gust: { x: at + 2, anchor: "start" },
  };
}

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
  const { left, right, x, held } = scale(band, DETAIL_WIDTH);
  const mid = 30;
  const meanX =
    wind.wind_kn < band.min
      ? 6
      : wind.wind_kn > band.max
        ? DETAIL_WIDTH - 6
        : x(wind.wind_kn);
  const places = figurePlaces(
    meanX,
    wind.gust_kn === null ? null : held(wind.gust_kn),
    DETAIL_WIDTH,
  );
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
        ticks
      />
      <text
        className={s.labelStrong()}
        x={places.mean.x}
        y={54}
        textAnchor={places.mean.anchor}
        data-chart-mean
      >
        {say(wind.wind_kn)}
      </text>
      {places.gust && wind.gust_kn !== null && (
        <text
          className={s.labelGust()}
          x={places.gust.x}
          y={54}
          textAnchor={places.gust.anchor}
          data-chart-gust
        >
          g{say(wind.gust_kn)}
        </text>
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

/** Where a model picked in the card should rate from: every spot, or this one. */
export type StarsWhere = "everywhere" | "spot";

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
  starsFrom,
  spotName,
  onStarsFrom,
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
  /** The model the rider takes this spot's stars from, and the one after it. */
  starsFrom: StarsFrom;
  spotName: string;
  /** Rate the stars from another model, everywhere or at this spot. */
  onStarsFrom?: (model: string, where: StarsWhere) => void;
}) {
  const s = styles();
  const say = (knots: number) => windIn(knots, units);
  const byModel = wind.by_model ?? {};
  const rows = [
    ...models.filter((m) => m.id === wind.lead),
    ...models.filter((m) => m.id !== wind.lead),
  ].filter((m) => byModel[m.id]);
  const [asking, setAsking] = useState<string | null>(null);
  const pick = (where: StarsWhere) => {
    if (asking) onStarsFrom?.(asking, where);
    setAsking(null);
  };
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
        <Fact term="Stars from">
          <b className={s.strong()} data-stars-from>
            {headlineName(wind)}
          </b>
          {wind.lead !== starsFrom.model && (
            <>
              {" "}
              <span className={s.context()}>
                {modelName(starsFrom.model)} does not reach this hour
              </span>
            </>
          )}
        </Fact>
        <Fact term="Wind">
          <b className={s.strong()}>{say(wind.wind_kn)}</b>
          {wind.gust_kn !== null && (
            <>
              {" "}
              · gusts <b className={s.strong()}>{say(wind.gust_kn)}</b>
            </>
          )}
        </Fact>
        {wind.agreement && (
          <Fact term="Agree">
            <b className={s.strong()}>{wind.agreement}</b> · {wind.models}{" "}
            models, {say(wind.min_kn)}–{say(wind.max_kn)}
            {wind.gust_max_kn !== null &&
              (wind.gust_kn === null ||
                say(wind.gust_max_kn) !== say(wind.gust_kn)) && (
                <>, gusts to {say(wind.gust_max_kn)}</>
              )}{" "}
            <span className={s.context()}>shown, takes nothing off</span>
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
              {onStarsFrom && (
                <th scope="col" className={s.th()}>
                  <span className="sr-only">Stars from</span>
                </th>
              )}
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
              const lead = model.id === wind.lead;
              const chosen = model.id === starsFrom.model;
              const weight = lead ? s.lead() : "";
              const num = s.td({ className: [weight, s.num()] });
              return (
                <tr key={model.id} data-model={model.id}>
                  {onStarsFrom && (
                    <td className={s.pickCell()}>
                      <Button
                        icon
                        size="sm"
                        className={s.pick()}
                        aria-label={`Stars from ${model.name}`}
                        pressed={chosen ? "worded" : false}
                        data-stars-pick={model.id}
                        onMouseDown={keepFocus}
                        onClick={() => setAsking(chosen ? null : model.id)}
                      >
                        <PickMark on={asking ? asking === model.id : chosen} />
                      </Button>
                    </td>
                  )}
                  <th scope="row" className={s.td({ className: weight })}>
                    {model.name}
                    {lead && <span className={s.tag()}>stars</span>}
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
      {asking && (
        <div
          className={s.ask()}
          role="group"
          aria-label={`Stars from ${modelName(asking)}`}
          data-stars-ask
        >
          <p className={s.askTitle()}>Stars from {modelName(asking)}:</p>
          <div className={s.askButtons()}>
            <Button
              variant="pill"
              size="sm"
              onMouseDown={keepFocus}
              onClick={() => pick("everywhere")}
            >
              Every spot
            </Button>
            <Button
              variant="pill"
              size="sm"
              onMouseDown={keepFocus}
              onClick={() => pick("spot")}
            >
              Just {spotName}
            </Button>
            <Button
              variant="link"
              size="sm"
              onMouseDown={keepFocus}
              onClick={() => setAsking(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {onStarsFrom && !asking && rows.length > 1 && (
        <p className={s.note()}>
          Pick a model to rate every hour from it. The others never change the
          stars.
        </p>
      )}
      <p className={s.note()}>Rated for {riderText}.</p>
    </div>
  );
}

/**
 * A press in the card leaves the focus where it was. The card closes when the
 * control that opened it loses the focus (ui/RatingTip), so a button in it
 * that took the focus would close it under the press.
 */
const keepFocus = (event: { preventDefault: () => void }) =>
  event.preventDefault();

/** The model chosen for the stars, as a radio's ring and dot. */
function PickMark({ on }: { on: boolean }) {
  const s = styles();
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <circle className={s.ring()} cx={7} cy={7} r={5.75} strokeWidth={1.5} />
      {on && <circle className={s.dot()} cx={7} cy={7} r={3} />}
    </svg>
  );
}
