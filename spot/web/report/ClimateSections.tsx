/**
 * The spot's wind and waves through the year, below everything else on the
 * spot page: how often it blows and from where, how big the waves are and
 * from where, and how often each period of swell comes, at what size and in
 * which months. Static numbers from Copernicus Marine's records of the past
 * (spot/web/report/climate.ts); every chart answers a hover or a tap with its
 * figures in a small floating card.
 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { unitLabel, type Units } from "../../../force5/src/units";
import { windCss } from "../../../force5/src/windCss";
import { Segmented } from "../../../ui";
import { tv } from "../../../ui/tv";
import { windSay } from "../spot";
import { useWidth } from "../useWidth";
import {
  COMPASS16,
  MONTHS,
  ROSE_PERIODS,
  SWELL_PERIODS,
  SWELL_SIZES,
  WIND_EDGES,
  climatePath,
  daysFigure,
  daysWords,
  metresWords,
  niceScale,
  parseClimate,
  percent,
  type Candle,
  type Climate,
  type SwellSize,
} from "./climate";

const styles = tv({
  slots: {
    section: "pt-9",
    head: "mb-3.5 flex flex-wrap items-center justify-between gap-2.5",
    h2: "m-0 font-body text-lead font-semibold text-ink",
    pair: "grid gap-3 rail:grid-cols-detail",
    card: "min-w-0 rounded-surface bg-sunken on-card p-4 wide:px-5",
    cardTop: "mb-3 flex flex-wrap items-center justify-between gap-2.5",
    h3: "m-0 font-body text-prose font-semibold text-ink",
    note: "m-0 mt-0.5 font-body text-body text-ink-muted",
    chart: "block w-full",
    legend:
      "flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-2 font-body text-caption text-ink-2",
    key: "mr-1.5 inline-block size-2.5 rounded-control align-middle",
    panels: "grid gap-4 wide:grid-cols-3",
    panelHead: "flex items-center gap-1.5 font-body text-body font-semibold text-ink",
    stack: "grid gap-3",
    credit: "m-0 pt-3 font-body text-caption text-ink-muted",
    // The floating card: the rating card's look (ui/RatingTip.tsx).
    tip: "pointer-events-none fixed z-dialog min-w-48 rounded-surface bg-ground px-3.5 py-3 text-left text-ink shadow-float dark:ring-1 dark:ring-line",
    tipHead: "m-0 mb-1.5 font-body text-body font-semibold",
    tipRow: "flex items-center gap-2 font-body text-body leading-relaxed",
    tipLabel: "flex-1 text-ink-2",
    tipValue: "font-semibold tabular-nums",
  },
});
const s = styles();

// Chart text and lines, as the spot page's graph draws them.
const TICK = "fill-ink-muted font-body text-caption";
const FIGURE = "fill-ink-2 font-body text-caption font-semibold";
const GRID = "stroke-line";
const HIT = "fill-transparent hover:fill-ink/5";

/** The wave periods' colours, shortest to longest: the sea's, then the accent for the long swell. */
const PERIOD_FILL = ["fill-sea-2", "fill-sea-1", "fill-depth", "fill-chart-magenta"];
const PERIOD_STROKE = ["stroke-sea-2", "stroke-sea-1", "stroke-depth", "stroke-chart-magenta"];
const PERIOD_KEY = ["bg-sea-2", "bg-sea-1", "bg-depth", "bg-chart-magenta"];
/** The wind bands' colours: the wind palette at each band's middle. */
const WIND_MID = [14, 19, 26, 34];

/* ------------------------------------------------------------------ data */

const cache = new Map<string, Promise<Climate | null>>();

function loadClimate(id: string): Promise<Climate | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}${climatePath(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const c = parseClimate(json);
        return c && c.id === id ? c : null;
      })
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

function useClimate(id: string) {
  const [climate, setClimate] = useState<Climate | null>(null);
  useEffect(() => {
    let live = true;
    setClimate(null);
    void loadClimate(id).then((c) => live && setClimate(c));
    return () => {
      live = false;
    };
  }, [id]);
  return climate;
}

/* ------------------------------------------------------------- the card */

interface TipRow {
  label: string;
  value: string;
  /** A swatch: a class (bg-…) or a colour for the wind palette. */
  key?: { className?: string; color?: string };
}
interface Tip {
  title: string;
  rows: TipRow[];
  x: number;
  y: number;
}
type ShowTip = (tip: Tip | null) => void;
const TipContext = createContext<ShowTip>(() => {});

const TIP_GAP = 14;
const TIP_MARGIN = 12;

function TipCard({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let left = tip.x + TIP_GAP;
    let top = tip.y + TIP_GAP;
    if (left + w > window.innerWidth - TIP_MARGIN) left = tip.x - w - TIP_GAP;
    if (top + h > window.innerHeight - TIP_MARGIN) top = tip.y - h - TIP_GAP;
    setPlace({
      left: Math.max(TIP_MARGIN, left),
      top: Math.max(TIP_MARGIN, top),
    });
  }, [tip]);
  return createPortal(
    <div
      ref={ref}
      className={s.tip()}
      role="status"
      data-climate-tip
      style={place ?? { left: -9999, top: 0 }}
    >
      <p className={s.tipHead()}>{tip.title}</p>
      {tip.rows.map((r, i) => (
        <div key={i} className={s.tipRow()}>
          <span
            className={`${s.key({ className: "mr-0" })} ${r.key?.className ?? ""}`}
            style={r.key?.color ? { background: r.key.color } : r.key ? undefined : { visibility: "hidden" }}
          />
          <span className={s.tipLabel()}>{r.label}</span>
          <span className={s.tipValue()}>{r.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * A chart's hover and tap target: a column, a wedge. A pointer opens the
 * card and leaving closes it; a screen reader reads the same figures from
 * its label, so the page's tab order is not a hundred columns long.
 */
function useTarget(title: string, rows: TipRow[]) {
  const show = useContext(TipContext);
  const at = (e: { clientX: number; clientY: number }) =>
    show({ title, rows, x: e.clientX, y: e.clientY });
  return {
    className: HIT,
    "data-tip-target": "",
    role: "img",
    "aria-label": `${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`,
    onPointerEnter: at,
    onPointerMove: at,
    onPointerDown: at,
    onPointerLeave: () => show(null),
  };
}

function Target({
  title,
  rows,
  children,
}: {
  title: string;
  rows: TipRow[];
  children: (props: ReturnType<typeof useTarget>) => ReactNode;
}) {
  return <>{children(useTarget(title, rows))}</>;
}

function Legend({ items }: { items: { label: string; className?: string; color?: string }[] }) {
  return (
    <div className={s.legend()}>
      {items.map((it) => (
        <span key={it.label}>
          <span
            className={`${s.key()} ${it.className ?? ""}`}
            style={it.color ? { background: it.color } : undefined}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- charts */

const PLOT_H = 236;
const AXIS_L = 44;
const AXIS_B = 22;

function monthLabel(i: number, column: number) {
  return column >= 44 ? MONTHS[i].slice(0, 3) : MONTHS[i][0];
}

/** How often it blows each band of wind, month by month. */
function WindMonths({ months, bands, least }: { months: number[][]; bands: string[]; least: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  // Room above the tallest month for its figure, and no more.
  const top = Math.max(0.3, ...months.map((m) => m.reduce((a, b) => a + b, 0) / 1000 + 0.08));
  const plot = PLOT_H - AXIS_B - 16;
  const y = (v: number) => 16 + plot * (1 - v / top);
  const col = (width - AXIS_L) / 12;
  const bar = Math.min(34, col * 0.66);
  return (
    <div ref={ref}>
      <svg className={s.chart()} width={width} height={PLOT_H} aria-label="How often it blows each band of wind, month by month">
        {[0.25, 0.5, 0.75].filter((v) => v < top).map((v) => (
          <g key={v}>
            <line x1={AXIS_L} x2={width} y1={y(v)} y2={y(v)} className={GRID} />
            <text x={AXIS_L - 8} y={y(v) + 4} textAnchor="end" className={TICK}>
              {v * 100}%
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = AXIS_L + col * i + (col - bar) / 2;
          let acc = 0;
          const total = m.reduce((a, b) => a + b, 0) / 1000;
          return (
            <g key={i}>
              {m.map((v, b) => {
                const lo = acc;
                acc += v / 1000;
                const h = y(lo) - y(acc);
                return h > 0 ? (
                  <rect
                    key={b}
                    x={x}
                    width={bar}
                    y={y(acc)}
                    height={h}
                    style={{ fill: windCss(WIND_MID[b]) }}
                  />
                ) : null;
              })}
              <text x={x + bar / 2} y={y(total) - 6} textAnchor="middle" className={FIGURE}>
                {Math.round(total * 100)}%
              </text>
              <text x={x + bar / 2} y={PLOT_H - 6} textAnchor="middle" className={TICK}>
                {monthLabel(i, col)}
              </text>
              <Target
                title={MONTHS[i]}
                rows={[
                  { label: `${least} or more`, value: percent(total) },
                  ...m.map((v, b) => ({
                    label: bands[b],
                    value: percent(v / 1000),
                    key: { color: windCss(WIND_MID[b]) },
                  })),
                ]}
              >
                {(t) => <rect {...t} x={AXIS_L + col * i} width={col} y={0} height={PLOT_H - AXIS_B} />}
              </Target>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function wedge(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const pt = (r: number, a: number) => {
    const t = (a * Math.PI) / 180;
    return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
  };
  const [x1, y1] = pt(r1, a0);
  const [x2, y2] = pt(r1, a1);
  if (r0 <= 0) return `M${cx},${cy}L${x1},${y1}A${r1},${r1} 0 0 1 ${x2},${y2}Z`;
  const [x3, y3] = pt(r0, a1);
  const [x4, y4] = pt(r0, a0);
  return `M${x1},${y1}A${r1},${r1} 0 0 1 ${x2},${y2}L${x3},${y3}A${r0},${r0} 0 0 0 ${x4},${y4}Z`;
}

/** Where it comes from: a bar for each sixteenth of the compass, split into its parts. */
function Rose({
  rose,
  label,
  what,
  parts,
}: {
  rose: number[][];
  label: string;
  /** "Wind" or "Waves", for the card: "Wind from the SW". */
  what: string;
  parts: { label: string; className?: string; color?: string }[];
}) {
  const size = PLOT_H;
  const c = size / 2;
  const R = c - 18;
  const most = Math.max(...rose.map((r) => r.reduce((a, b) => a + b, 0)), 1);
  return (
    <svg className="mx-auto block" width={size} height={size} aria-label={label}>
      {[1 / 3, 2 / 3, 1].map((f) => (
        <circle key={f} cx={c} cy={c} r={R * f} className={`fill-none ${GRID}`} />
      ))}
      {rose.map((r, i) => {
        let acc = 0;
        const total = r.reduce((a, b) => a + b, 0);
        return (
          <g key={i}>
            {r.map((v, b) => {
              const r0 = (acc / most) * R;
              acc += v;
              const r1 = (acc / most) * R;
              return r1 - r0 > 0.3 ? (
                <path
                  key={b}
                  d={wedge(c, c, r0, r1, i * 22.5 - 9.5, i * 22.5 + 9.5)}
                  className={parts[b].className}
                  style={parts[b].color ? { fill: parts[b].color } : undefined}
                />
              ) : null;
            })}
            <Target
              title={`${what} from the ${COMPASS16[i]}`}
              rows={[
                { label: "All of it", value: percent(total / 1000) },
                ...r.map((v, b) => ({
                  label: parts[b].label,
                  value: percent(v / 1000),
                  key: { className: parts[b].className?.replace("fill-", "bg-"), color: parts[b].color },
                })),
              ]}
            >
              {(t) => <path {...t} d={wedge(c, c, 0, R + 6, i * 22.5 - 11.25, i * 22.5 + 11.25)} />}
            </Target>
          </g>
        );
      })}
      {(["N", "E", "S", "W"] as const).map((n, k) => {
        const a = (k * Math.PI) / 2;
        return (
          <text
            key={n}
            x={c + (R + 11) * Math.sin(a)}
            y={c - (R + 11) * Math.cos(a) + 4}
            textAnchor="middle"
            className="pointer-events-none fill-ink font-body text-caption font-semibold"
          >
            {n}
          </text>
        );
      })}
    </svg>
  );
}

/** A candle per month: a bar over the usual range, a line at the typical value. */
function Candles({
  rows,
  top,
  fill,
  title,
  label,
  height = PLOT_H,
  days,
}: {
  /** Per month: [low, typical, high] in metres, or nulls. */
  rows: (readonly [number | null, number | null, number | null])[];
  top: number;
  fill: string;
  title: (i: number) => string;
  label: string;
  height?: number;
  /** Days a month, written above each candle (the swell's panels). */
  days?: number[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const { step } = niceScale(top, 4);
  const plot = height - AXIS_B - 18;
  const y = (v: number) => 18 + plot * (1 - v / top);
  const col = (width - AXIS_L) / 12;
  const bar = Math.min(30, col * 0.6);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return (
    <div ref={ref}>
      <svg className={s.chart()} width={width} height={height} aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={AXIS_L} x2={width} y1={y(v)} y2={y(v)} className={GRID} />
            <text x={AXIS_L - 8} y={y(v) + 4} textAnchor="end" className={TICK}>
              {v} m
            </text>
          </g>
        ))}
        {rows.map(([lo, mid, hi], i) => {
          const x = AXIS_L + col * i + (col - bar) / 2;
          const d = days?.[i];
          const rowsTip: TipRow[] = [];
          if (d !== undefined) rowsTip.push({ label: "Days a month", value: daysWords(d) });
          if (mid !== null && lo !== null && hi !== null) {
            rowsTip.push({ label: "Typical", value: metresWords(mid) });
            rowsTip.push({ label: "Usual range", value: `${lo.toFixed(1)} to ${hi.toFixed(1)} m` });
          }
          return (
            <g key={i}>
              {mid !== null && lo !== null && hi !== null && (
                <>
                  <rect
                    x={x}
                    width={bar}
                    y={y(hi)}
                    height={Math.max(2, y(lo) - y(hi))}
                    rx={3}
                    className={fill}
                    fillOpacity={d === undefined ? 1 : 0.4 + 0.6 * Math.min(1, d / 8)}
                  />
                  <line x1={x - 2} x2={x + bar + 2} y1={y(mid)} y2={y(mid)} className="stroke-ink" strokeWidth={2} />
                </>
              )}
              {d !== undefined && (
                <text
                  x={x + bar / 2}
                  y={(hi !== null ? y(hi) : y(0)) - 6}
                  textAnchor="middle"
                  className={FIGURE}
                >
                  {daysFigure(d)}
                </text>
              )}
              <text x={x + bar / 2} y={height - 6} textAnchor="middle" className={TICK}>
                {monthLabel(i, col)}
              </text>
              <Target title={title(i)} rows={rowsTip.length ? rowsTip : [{ label: "Days a month", value: "none" }]}>
                {(t) => <rect {...t} x={AXIS_L + col * i} width={col} y={0} height={height - AXIS_B} />}
              </Target>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Days a month with each period of swell: a line for each. */
function SwellLines({ series, sizeWords }: { series: number[][]; sizeWords: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const max = Math.max(4, ...series.flat());
  const { step, top } = niceScale(max, 4);
  const plot = PLOT_H - AXIS_B - 14;
  const y = (v: number) => 14 + plot * (1 - v / top);
  const col = (width - AXIS_L) / 12;
  const x = (i: number) => AXIS_L + col * i + col / 2;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return (
    <div ref={ref}>
      <svg className={s.chart()} width={width} height={PLOT_H} aria-label={`Days a month with each period of swell, ${sizeWords}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={AXIS_L} x2={width} y1={y(v)} y2={y(v)} className={GRID} />
            <text x={AXIS_L - 8} y={y(v) + 4} textAnchor="end" className={TICK}>
              {v}
            </text>
          </g>
        ))}
        {series.map((row, p) => (
          <g key={p}>
            <polyline
              points={row.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              className={`fill-none ${PERIOD_STROKE[p + 1]}`}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {row.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3.5} className={PERIOD_FILL[p + 1]} />
            ))}
          </g>
        ))}
        {MONTHS.map((m, i) => (
          <g key={m}>
            <text x={x(i)} y={PLOT_H - 6} textAnchor="middle" className={TICK}>
              {monthLabel(i, col)}
            </text>
            <Target
              title={`${m}, ${sizeWords}`}
              rows={SWELL_PERIODS.map((label, p) => ({
                label,
                value: daysWords(series[p][i]),
                key: { className: PERIOD_KEY[p + 1] },
              }))}
            >
              {(t) => <rect {...t} x={AXIS_L + col * i} width={col} y={0} height={PLOT_H - AXIS_B} />}
            </Target>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------------- sections */

function windBands(units: Units) {
  // Force's figures are bands of their own; there the knots are clearer.
  const u: Units = units === "bft" ? "kn" : units;
  const say = (kn: number) => windSay(kn, u);
  const unit = unitLabel(u);
  return {
    least: `${say(WIND_EDGES[0])} ${unit}`,
    bands: [
      `${say(12)} to ${say(16)} ${unit}`,
      `${say(16)} to ${say(22)} ${unit}`,
      `${say(22)} to ${say(30)} ${unit}`,
      `Over ${say(30)} ${unit}`,
    ],
  };
}

function WindSection({ climate, units }: { climate: Climate; units: Units }) {
  const { least, bands } = windBands(units);
  const parts = bands.map((label, b) => ({ label, color: windCss(WIND_MID[b]) }));
  return (
    <section className={s.section()} aria-labelledby="wind-year" data-climate-wind>
      <div className={s.head()}>
        <h2 className={s.h2()} id="wind-year">
          The wind through the year
        </h2>
      </div>
      <div className={s.pair()}>
        <div className={s.card()}>
          <div className={s.cardTop()}>
            <h3 className={s.h3()}>How often it blows {least} or more</h3>
          </div>
          <WindMonths months={climate.wind.months} bands={bands} least={least} />
          <Legend items={parts} />
        </div>
        <div className={s.card()}>
          <div className={s.cardTop()}>
            <h3 className={s.h3()}>Where the wind comes from</h3>
          </div>
          <Rose rose={climate.wind.rose} label="Where the wind comes from" what="Wind" parts={parts} />
        </div>
      </div>
    </section>
  );
}

function WavesSection({ climate }: { climate: Climate }) {
  const waves = climate.waves!;
  const [size, setSize] = useState<SwellSize>("all");
  const sizeIndex = SWELL_SIZES.findIndex((z) => z.value === size);
  const heightTop = niceScale(Math.max(...waves.height.map((h) => h[2])), 4).top;
  // Room above the tallest candle for its day count.
  const candleTop = niceScale(
    Math.max(0.5, ...waves.candles.flat().map((c: Candle) => c[3] ?? 0)) * 1.12,
    4,
  ).top;
  const roseParts = ROSE_PERIODS.map((label, b) => ({ label, className: PERIOD_FILL[b] }));
  return (
    <section className={s.section()} aria-labelledby="waves-year" data-climate-waves>
      <div className={s.head()}>
        <h2 className={s.h2()} id="waves-year">
          The waves through the year
        </h2>
      </div>
      <div className={s.stack()}>
        <div className={s.pair()}>
          <div className={s.card()}>
            <div className={s.cardTop()}>
              <div>
                <h3 className={s.h3()}>Wave height</h3>
                <p className={s.note()}>Line: a typical day. Bar: most days.</p>
              </div>
            </div>
            <Candles
              rows={waves.height}
              top={heightTop}
              fill="fill-sea-1"
              title={(i) => MONTHS[i]}
              label="Wave height, month by month"
            />
          </div>
          <div className={s.card()}>
            <div className={s.cardTop()}>
              <h3 className={s.h3()}>Where the waves come from</h3>
            </div>
            <Rose rose={waves.rose} label="Where the waves come from" what="Waves" parts={roseParts} />
            <Legend items={roseParts.map((p) => ({ label: p.label, className: p.className.replace("fill-", "bg-") }))} />
          </div>
        </div>
        <div className={s.card()} data-climate-swell>
          <div className={s.cardTop()}>
            <div>
              <h3 className={s.h3()}>Days a month with each swell</h3>
              <p className={s.note()}>Period: the time between waves. The longer it is, the more power they carry.</p>
            </div>
            <Segmented
              aria-label="Size of swell"
              size="sm"
              value={size}
              onChange={setSize}
              options={SWELL_SIZES.map((z) => ({ value: z.value, label: z.label }))}
            />
          </div>
          <SwellLines series={waves.swell[sizeIndex]} sizeWords={SWELL_SIZES[sizeIndex].words} />
          <Legend items={SWELL_PERIODS.map((label, p) => ({ label, className: PERIOD_KEY[p + 1] }))} />
        </div>
        <div className={s.card()} data-climate-candles>
          <div className={s.cardTop()}>
            <div>
              <h3 className={s.h3()}>How big each swell is</h3>
              <p className={s.note()}>Bar: the usual size. Line: a typical day. Number: days a month.</p>
            </div>
          </div>
          <div className={s.panels()}>
            {SWELL_PERIODS.map((label, p) => (
              <div key={label}>
                <div className={s.panelHead()}>
                  <span className={`${s.key({ className: "mr-0" })} ${PERIOD_KEY[p + 1]}`} />
                  {label}
                </div>
                <Candles
                  rows={waves.candles[p].map((c) => [c[1], c[2], c[3]] as const)}
                  days={waves.candles[p].map((c) => c[0])}
                  top={candleTop}
                  fill={PERIOD_FILL[p + 1]}
                  height={210}
                  title={(i) => `${MONTHS[i]}, swell ${label.toLowerCase()}`}
                  label={`How big swell of ${label.toLowerCase()} is, month by month`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className={s.credit()}>
        Waves {waves.km.toFixed(1)} km off the beach, {waves.years[0]} to {waves.years[1]}; wind {climate.wind.years[0]} to{" "}
        {climate.wind.years[1]}. {climate.credit}.
      </p>
    </section>
  );
}

/**
 * The spot's year, or nothing until (and unless) its file has come: the
 * page above never waits for it.
 */
export function ClimateSections({ spotId, units }: { spotId: string; units: Units }) {
  const climate = useClimate(spotId);
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [tip]);
  if (!climate) return null;
  return (
    <TipContext.Provider value={setTip}>
      <div data-climate>
        <WindSection climate={climate} units={units} />
        {climate.waves ? (
          <WavesSection climate={climate} />
        ) : (
          <p className={s.credit()}>
            Wind {climate.wind.years[0]} to {climate.wind.years[1]}. {climate.credit}.
          </p>
        )}
      </div>
      {tip && <TipCard tip={tip} />}
    </TipContext.Provider>
  );
}
