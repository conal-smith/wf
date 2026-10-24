/**
 * "Your star rating": a rider sets their own stars, as the owner signed them
 * off in design-system/patterns/your-stars.html. Start from a level; drag the
 * four wind handles, the top one the most you can hold, gusts included; drag
 * each direction's dot in and out on the beach, offshore up over the sea and
 * onshore down over the land; and see it all together, and against the
 * level, before saving. The gust curve the pattern draws went with v6 of the
 * stars (24 October 2026).
 *
 * Everything is kept in knots, as the rating is, and drawn in the rider's
 * unit. The arithmetic is yourStars.ts and force5/src/stars.ts; nothing here
 * rates an hour of its own.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  SKILLS,
  SKILL_LABEL,
  savedCustom,
  standardRating,
  windScore,
  type CustomRating,
  type DirectionKey,
  type Rider,
  type Skill,
} from "../../force5/src/stars";
import { beaufort, type Units } from "../../force5/src/units";
import {
  BeaufortGlyph,
  Button,
  Dialog,
  Kicker,
  Segmented,
  Select,
  StarGlyphs,
} from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import {
  DIRECTION_KEYS,
  DIRECTION_NAME,
  DIRECTION_WORD,
  EXAMPLES,
  GRID_STEP,
  GUST_TOP,
  SHADE,
  WEB_DIRS,
  WEB_R,
  WIND_KEYS,
  WIND_TOP,
  breakdown,
  forceBand,
  forceTicks,
  gridStars,
  halfStars,
  knotsOf,
  moveWind,
  moveWindForce,
  offAt,
  onLevel,
  polar,
  rateExample,
  said,
  setDirection,
  shown,
  stepped,
  unitScale,
  webRadius,
  withRating,
  type UnitScale,
} from "./yourStars";

const styles = tv({
  slots: {
    // The pattern's 496px on a desktop; the dialog's own 11/12 on a phone.
    dialog: "max-w-124",
    block: "grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0",
    // On a phone the scale's figures need the room the dialog's padding
    // gives them on a desktop: the curve and its handles step in together.
    curve: "mt-1 block h-auto overflow-visible max-wide:mr-6",
    grid: "stroke-line",
    base: "fill-none stroke-line-strong",
    yours: "fill-none stroke-ink",
    under: "fill-sunken",
    axis: "fill-ink-muted font-mono text-eyebrow tracking-normal tabular-nums",
    legend: ["mt-1 flex gap-4 text-ink-muted", MONO_LABEL],
    legendKey:
      "mr-1 inline-block w-5 border-0 border-t-2 border-ink align-middle",
    legendBase:
      "mr-1 inline-block w-5 border-0 border-t border-dashed border-line-strong align-middle",
    band: "relative mt-1 h-touch touch-none select-none max-wide:mr-6",
    scale: "absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 opacity-35",
    fill: "absolute top-1/2 h-1 -translate-y-1/2 bg-ink",
    edge: "absolute top-1/2 h-1 -translate-y-1/2 bg-ink opacity-35",
    thumb: [
      "absolute top-1/2 h-5 w-2.5 -translate-1/2 cursor-ew-resize rounded-full border border-ink bg-card shadow-raised",
      RING,
    ],
    figs: "mt-1 grid grid-cols-4 gap-2 max-wide:grid-cols-2",
    fig: "flex flex-col gap-0.5",
    figName: ["text-ink-muted", MONO_LABEL],
    figValue: "font-mono text-figure text-ink tabular-nums",
    figUnit: "font-mono text-label text-ink-muted",
    // A finger scrolls the page over the web; only one that lands on a dot
    // drags it (the touchstart below holds the page still for that one).
    web: "mx-auto mt-1 block h-auto w-full max-w-96 touch-pan-y select-none",
    sea: "pointer-events-none fill-depth opacity-22",
    land: "pointer-events-none fill-land opacity-70",
    slice: "cursor-pointer fill-transparent",
    sliceOn: "cursor-pointer fill-ink/8",
    ringLine: "pointer-events-none fill-none stroke-ink opacity-18",
    spoke: "pointer-events-none stroke-ink opacity-12",
    rim: "pointer-events-none fill-none stroke-ink",
    shoreLine: "pointer-events-none stroke-ink",
    shape: "pointer-events-none fill-ink/7 stroke-ink",
    dot: "cursor-grab fill-card stroke-ink focus-visible:stroke-focus focus-visible:outline-hidden",
    dotOn:
      "cursor-grab fill-ink stroke-ink focus-visible:stroke-focus focus-visible:outline-hidden",
    dotTop: "pointer-events-none fill-ink stroke-ink",
    webWord: "pointer-events-none fill-ink-muted font-mono uppercase",
    webName: "pointer-events-none fill-ink-2 font-mono uppercase",
    picked:
      "mt-1 flex flex-wrap items-center justify-center gap-2 font-mono text-label",
    pickedName: "uppercase",
    pickedValue: "min-w-10 text-center font-mono text-figure tabular-nums",
    together: "mt-1 flex flex-wrap items-center gap-2 text-body",
    gridSvg:
      "mt-1 block h-auto w-full cursor-crosshair touch-pan-y overflow-visible select-none",
    cell: "fill-ink",
    none: "fill-sunken",
    pick: "fill-none stroke-focus",
    key: ["mt-1 flex items-center gap-1 text-ink-muted", MONO_LABEL],
    swatch: "inline-block h-3 w-4 bg-ink",
    readout:
      "mt-1 flex min-h-control-sm flex-wrap items-center gap-2 font-mono text-label tabular-nums",
    why: "font-body text-caption text-ink-muted",
    table: "mt-1 w-full border-collapse font-mono text-label tabular-nums",
    th: ["border-b border-ink py-1 text-left text-ink-muted", MONO_LABEL],
    td: "border-b border-line py-1 pr-2 align-middle whitespace-nowrap",
    forecast: "max-wide:whitespace-normal",
    moved: "font-semibold",
  },
});

export interface YourStarsDialogProps {
  open: boolean;
  /**
   * The rider as they are: their own rating, rating or kept, is where the
   * dialog starts, else their level's.
   */
  rider: Rider;
  units: Units;
  onSave: (custom: CustomRating) => void;
  /** Delete the rider's own rating, offered only when they have one. */
  onDelete?: () => void;
  onClose: () => void;
}

export default function YourStarsDialog({
  open,
  rider,
  units,
  onSave,
  onDelete,
  onClose,
}: YourStarsDialogProps) {
  const s = styles();
  const unit = unitScale(units);
  // In Force, the handles stand on whole forces from the start.
  const fit = (rating: CustomRating) =>
    unit.force ? forceBand(rating) : rating;
  const [draft, setDraft] = useState<CustomRating>(() =>
    fit(savedCustom(rider) ?? standardRating(rider)),
  );
  const saved = !!savedCustom(rider);
  // Each opening starts again from what is saved: Cancel keeps nothing.
  useEffect(() => {
    if (open) setDraft(fit(savedCustom(rider) ?? standardRating(rider)));
    // The rider is read as it was when the dialog opened.
  }, [open]);

  const level = standardRating(rider, draft.base);
  const yours = withRating(rider, draft);
  const theirs = onLevel(rider, draft);
  const baseName = SKILL_LABEL[draft.base];

  return (
    <Dialog
      open={open}
      title="Your star rating"
      size="wide"
      className={s.dialog()}
      onClose={onClose}
      actions={
        <>
          {saved && onDelete && (
            <Button
              variant="link"
              size="sm"
              className="mr-auto"
              onClick={onDelete}
              data-stars-delete
            >
              Delete
            </Button>
          )}
          <Button variant="pill" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(draft)}
            data-stars-save
          >
            Save
          </Button>
        </>
      }
    >
      <div className={s.block()} data-your-stars>
        <Kicker as="span">Start from</Kicker>
        <Segmented<Skill>
          aria-label="Start from"
          className="mt-1 self-start justify-self-start"
          options={SKILLS.map((skill) => ({
            value: skill,
            label: SKILL_LABEL[skill],
          }))}
          value={draft.base}
          onChange={(skill) => setDraft(fit(standardRating(rider, skill)))}
        />
      </div>

      <div className={s.block()}>
        <Kicker as="span" tone="ink">
          Wind speed: stars
        </Kicker>
        <WindCurve yours={draft} level={level} unit={unit} />
        <Legend name={baseName} />
        <Handles
          keys={WIND_KEYS}
          values={draft.wind}
          top={WIND_TOP}
          unit={unit}
          scale="wind"
          labels={{
            min: "Minimum wind speed",
            sweetLow: "Ideal wind speed from",
            sweetHigh: "Ideal wind speed to",
            max: "Maximum wind speed",
          }}
          spans={[
            ["min", "sweetLow", "edge"],
            ["sweetLow", "sweetHigh", "fill"],
            ["sweetHigh", "max", "edge"],
          ]}
          onMove={(key, kn) =>
            setDraft((d) =>
              unit.force ? moveWindForce(d, key, kn) : moveWind(d, key, kn),
            )
          }
        />
        <div className={s.figs()}>
          <Fig name="Minimum" kn={draft.wind.min} unit={unit} />
          <Fig name="Ideal from" kn={draft.wind.sweetLow} unit={unit} />
          <Fig name="Ideal to" kn={draft.wind.sweetHigh} unit={unit} />
          <Fig name="Maximum" kn={draft.wind.max} unit={unit} />
        </div>
      </div>

      <div className={s.block()}>
        <Kicker as="span" tone="ink">
          Wind direction: stars taken off
        </Kicker>
        <DirectionWeb
          rating={draft}
          onChange={(key, off) => setDraft((d) => setDirection(d, key, off))}
        />
      </div>

      <div className={s.block()}>
        <Kicker as="span" tone="ink">
          Together: wind speed, gusts and direction
        </Kicker>
        <Together rider={yours} unit={unit} />
      </div>

      <div className={s.block()}>
        <Kicker as="span" tone="ink">
          Examples
        </Kicker>
        <table className={s.table()} data-stars-examples>
          <thead>
            <tr>
              <th
                scope="col"
                className={s.th({ className: "w-1/3 max-wide:w-auto" })}
              >
                Forecast, {unit.label}
              </th>
              <th
                scope="col"
                className={s.th({ className: "w-3/10 max-wide:w-20" })}
              >
                {baseName}
              </th>
              <th scope="col" className={s.th({ className: "max-wide:w-20" })}>
                Yours
              </th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map(([wind, gust, dir]) => {
              const o = rateExample(theirs, wind, gust, dir);
              const y = rateExample(yours, wind, gust, dir);
              return (
                <tr key={`${wind}-${gust}-${dir}`}>
                  <td
                    className={s.td({
                      className: [
                        s.forecast(),
                        o.stars !== y.stars ? s.moved() : "",
                      ],
                    })}
                  >
                    <Speed kn={wind} unit={unit} /> gusting{" "}
                    <Speed kn={gust} unit={unit} />
                    {dir === "crossOn" ? "" : `, ${DIRECTION_WORD[dir]}`}
                  </td>
                  <td className={s.td()}>
                    <StarGlyphs
                      stars={o.stars}
                      potential={o.potential}
                      size={12}
                    />
                  </td>
                  <td className={s.td()}>
                    <StarGlyphs
                      stars={y.stars}
                      potential={y.potential}
                      size={12}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function Legend({ name }: { name: string }) {
  const s = styles();
  return (
    <div className={s.legend()} aria-hidden="true">
      <span>
        <span className={s.legendKey()} />
        Yours
      </span>
      <span>
        <span className={s.legendBase()} />
        {name}
      </span>
    </div>
  );
}

function Fig({
  name,
  kn,
  unit,
}: {
  name: string;
  kn: number;
  unit: UnitScale;
}) {
  const s = styles();
  return (
    <div className={s.fig()}>
      <span className={s.figName()}>{name}</span>
      <span className={s.figValue()}>
        {unit.force ? (
          <BeaufortGlyph force={beaufort(kn)} size={17} />
        ) : (
          <>
            {shown(kn, unit)}{" "}
            <small className={s.figUnit()}>{unit.label}</small>
          </>
        )}
      </span>
    </div>
  );
}

/** An axis along the bottom in the rider's unit, every tick of it. */
function XAxis({
  topKn,
  y,
  unit,
}: {
  topKn: number;
  y: number;
  unit: UnitScale;
}) {
  const s = styles();
  const top = topKn * unit.perKn;
  const labels = [];
  // In Force, a tick where each force starts, named by it.
  if (unit.force)
    for (const tick of forceTicks(1, topKn))
      labels.push(
        <text
          key={tick.kn}
          className={s.axis()}
          x={(tick.kn / topKn) * 400}
          y={y}
          textAnchor="middle"
        >
          {tick.force}
        </text>,
      );
  else
    for (let v = 0; v <= top + 1e-6; v += unit.tick) {
      const x = (v / top) * 400;
      const end = x > 380;
      labels.push(
        <text
          key={v}
          className={s.axis()}
          x={end ? 400 : x}
          y={y}
          textAnchor={v ? (end ? "end" : "middle") : "start"}
        >
          {v}
          {end ? ` ${unit.label}` : ""}
        </text>,
      );
    }
  return <>{labels}</>;
}

const line = (
  top: number,
  X: (kn: number) => number,
  Y: (kn: number) => number,
) => {
  const points: string[] = [];
  for (let kn = 0; kn <= top; kn += 0.25)
    points.push(`${X(kn).toFixed(1)},${Y(kn).toFixed(1)}`);
  return points.join(" ");
};

/** Stars for each wind speed, 0 to 40 kn: theirs solid, the level's dashed. */
function WindCurve({
  yours,
  level,
  unit,
}: {
  yours: CustomRating;
  level: CustomRating;
  unit: UnitScale;
}) {
  const s = styles();
  const X = (kn: number) => (kn / WIND_TOP) * 400;
  const Y = (stars: number) => 74 - (stars / 5) * 64;
  const of = (r: CustomRating) =>
    line(WIND_TOP, X, (kn) => Y(windScore(kn, r.wind)));
  const mine = of(yours);
  return (
    <svg
      className={s.curve()}
      viewBox="0 0 400 92"
      role="img"
      aria-label="Stars for each wind speed, yours against the level you started from"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <g key={n}>
          <line
            className={s.grid()}
            x1={0}
            x2={400}
            y1={Y(n)}
            y2={Y(n)}
            strokeWidth={1}
          />
          <text className={s.axis()} x={404} y={Y(n) + 3}>
            {n}★
          </text>
        </g>
      ))}
      <polygon className={s.under()} points={`0,74 ${mine} 400,74`} />
      <polyline
        className={s.base()}
        points={of(level)}
        strokeWidth={1.25}
        strokeDasharray="3 3"
      />
      <polyline
        className={s.yours()}
        points={mine}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <XAxis topKn={WIND_TOP} y={90} unit={unit} />
    </svg>
  );
}

/** The wind's own colours along the knots, as the map's wind layer draws them. */
const SCALE: Record<"wind", string> = {
  wind: "linear-gradient(to right, var(--color-wind-k00) 0%, var(--color-wind-k05) 12.5%, var(--color-wind-k10) 25%, var(--color-wind-k15) 37.5%, var(--color-wind-k20) 50%, var(--color-wind-k25) 62.5%, var(--color-wind-k30) 75%, var(--color-wind-k35) 87.5%, var(--color-wind-k40) 100%)",
};

/**
 * A scale of handles, each a slider of its own: dragged anywhere along the
 * scale, the nearest handle comes; the arrow keys move the focused one a step
 * of the rider's unit, Page Up and Down ten.
 */
function Handles<K extends string>({
  keys,
  values,
  top,
  unit,
  scale,
  labels,
  spans,
  onMove,
}: {
  keys: readonly K[];
  values: Record<K, number>;
  top: number;
  unit: UnitScale;
  scale: "wind";
  labels: Record<K, string>;
  spans: [K, K, "fill" | "edge"][];
  onMove: (key: K, kn: number) => void;
}) {
  const s = styles();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<K | null>(null);
  const pct = (kn: number) => `${(kn / top) * 100}%`;
  const knAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return knotsOf(x * top * unit.perKn, unit);
  };
  const nearest = (kn: number) =>
    keys.reduce((best, key) => {
      const d = Math.abs(values[key] - kn);
      const b = Math.abs(values[best] - kn);
      // Two handles at one place: the one the pointer is moving towards.
      return d < b || (d === b && kn > values[key]) ? key : best;
    }, keys[0]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const kn = knAt(event.clientX);
    const key =
      ((event.target as HTMLElement).dataset.handle as K | undefined) ??
      nearest(kn);
    dragging.current = key;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.getElementById(`${scale}-${key}`)?.focus();
    onMove(key, kn);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onMove(dragging.current, knAt(event.clientX));
  };
  const stop = () => {
    dragging.current = null;
  };
  const key = (k: K) => (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 10,
      PageDown: -10,
    };
    let kn: number | null = null;
    if (event.key in steps) kn = stepped(values[k], steps[event.key], unit);
    else if (event.key === "Home") kn = 0;
    else if (event.key === "End") kn = top;
    if (kn === null) return;
    event.preventDefault();
    onMove(k, kn);
  };
  return (
    <div
      ref={track}
      className={s.band()}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      data-handles={scale}
    >
      <div className={s.scale()} style={{ background: SCALE[scale] }} />
      {spans.map(([from, to, kind]) => (
        <div
          key={`${from}-${to}`}
          className={kind === "fill" ? s.fill() : s.edge()}
          style={{
            left: pct(values[from]),
            width: pct(values[to] - values[from]),
          }}
        />
      ))}
      {keys.map((k) => (
        <div
          key={k}
          id={`${scale}-${k}`}
          role="slider"
          tabIndex={0}
          data-handle={k}
          aria-label={labels[k]}
          aria-valuemin={0}
          aria-valuemax={
            unit.force
              ? beaufort(top)
              : Number((top * unit.perKn).toFixed(unit.dp))
          }
          aria-valuenow={Number(shown(values[k], unit))}
          aria-valuetext={said(values[k], unit)}
          className={s.thumb()}
          style={{ left: pct(values[k]) }}
          onKeyDown={key(k)}
        />
      ))}
    </div>
  );
}

// The web's geometry is yourStars.ts's, shared with the app's.
const DIRS = WEB_DIRS;
const R = WEB_R;
const radius = webRadius;
const f = (n: number) => n.toFixed(1);

/**
 * The beach from above, sea up and land down, and a dot for each way the wind
 * can blow, drawn where it blows to: on the rim it takes nothing off, at the
 * middle all five stars, in half stars. Drag a dot; tap a slice to bring its
 * dot to the top; the picked one has − and + under the web, and the arrow keys.
 */
function DirectionWeb({
  rating,
  onChange,
}: {
  rating: CustomRating;
  onChange: (key: DirectionKey, off: number) => void;
}) {
  const s = styles();
  const svg = useRef<SVGSVGElement>(null);
  const [picked, setPicked] = useState<DirectionKey>("crossOff");
  const dragging = useRef<DirectionKey | null>(null);
  const off = rating.direction;

  const at = (event: { clientX: number; clientY: number }) => {
    const el = svg.current!;
    const point = el.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(el.getScreenCTM()!.inverse());
  };
  const wedge = (a1: number, a2: number) => {
    const [x1, y1] = polar(a1, R);
    const [x2, y2] = polar(a2, R);
    return `M0,0 L${f(x1)},${f(y1)} A${R},${R} 0 0 1 ${f(x2)},${f(y2)}Z`;
  };
  const arcs = (d: (typeof DIRS)[number]) =>
    d.from === 0
      ? [[-30, 30]]
      : d.to === 180
        ? [[150, 210]]
        : [
            [d.from, d.to],
            [-d.to, -d.from],
          ];
  const ring = [0, 50, 90, 130, 180, -130, -90, -50].map((a) => {
    const d = DIRS.find((x) => x.at.includes(a))!;
    return polar(a, radius(off[d.key]));
  });
  // The dots keep one order, so the keyboard's focus is never moved; the
  // picked direction's are drawn again over the others.
  const picks = DIRS.find((d) => d.key === picked)!;

  // The dot under a pointer, the picked direction's first since it is drawn
  // on top; a finger is given a wider reach than a mouse.
  const dotAt = (p: { x: number; y: number }, reach: number) =>
    DIRS.flatMap((d) =>
      d.at.map((a) => {
        const [x, y] = polar(a, radius(off[d.key]));
        return { key: d.key, dist: Math.hypot(p.x - x, p.y - y) };
      }),
    )
      .filter((h) => h.dist < reach)
      .sort(
        (x, y) =>
          Number(y.key === picked) - Number(x.key === picked) ||
          x.dist - y.dist,
      )[0]?.key ?? null;
  const TOUCH_REACH = 18;

  // The page scrolls under a finger (touch-pan-y) unless it lands on a dot:
  // then the touch is the drag's, and the page holds still. A listener of its
  // own, since React's touch handlers are passive and cannot prevent it.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const hold = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length === 1 && dotAt(at(touch), TOUCH_REACH))
        event.preventDefault();
    };
    el.addEventListener("touchstart", hold, { passive: false });
    return () => el.removeEventListener("touchstart", hold);
  });

  const down = (event: PointerEvent<SVGSVGElement>) => {
    const p = at(event);
    const hit = dotAt(p, event.pointerType === "touch" ? TOUCH_REACH : 12);
    if (hit) {
      setPicked(hit);
      dragging.current = hit;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    // Otherwise a slice: tapping it brings its dot to the top, and changes nothing.
    const slice = (event.target as Element).closest("[data-slice]");
    if (slice) setPicked((slice as SVGElement).dataset.slice as DirectionKey);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const p = at(event);
    onChange(dragging.current, offAt(p.x, p.y));
  };
  const stop = () => {
    dragging.current = null;
  };
  const keyDown =
    (key: DirectionKey) => (event: KeyboardEvent<SVGCircleElement>) => {
      const step = (
        {
          ArrowDown: 0.5,
          ArrowLeft: 0.5,
          ArrowUp: -0.5,
          ArrowRight: -0.5,
        } as Record<string, number>
      )[event.key];
      if (step === undefined) return;
      event.preventDefault();
      setPicked(key);
      onChange(key, off[key] + step);
    };

  return (
    <>
      <svg
        ref={svg}
        className={s.web()}
        viewBox="-180 -128 360 256"
        role="group"
        aria-label="Stars taken off for each wind direction"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        data-direction-web
      >
        <path className={s.sea()} d={`M${-R},0 A${R},${R} 0 0 1 ${R},0Z`} />
        <path className={s.land()} d={`M${R},0 A${R},${R} 0 0 1 ${-R},0Z`} />
        {DIRS.flatMap((d) =>
          arcs(d).map(([a1, a2]) => (
            <path
              key={`${d.key}${a1}`}
              className={d.key === picked ? s.sliceOn() : s.slice()}
              d={wedge(a1, a2)}
              data-slice={d.key}
            >
              <title>{DIRECTION_NAME[d.key]}</title>
            </path>
          )),
        )}
        {[1, 2, 3, 4].map((n) => (
          <circle
            key={n}
            className={s.ringLine()}
            r={radius(n)}
            strokeWidth={0.5}
          />
        ))}
        {[30, 70, 110, 150].flatMap((a) =>
          [a, -a].map((aa) => {
            const [x, y] = polar(aa, R);
            return (
              <line
                key={aa}
                className={s.spoke()}
                x1={0}
                y1={0}
                x2={f(x)}
                y2={f(y)}
                strokeWidth={0.5}
              />
            );
          }),
        )}
        {[1, 2, 3, 4].map((n) => {
          const [x, y] = polar(-30, radius(n));
          return (
            <text
              key={n}
              className={s.webWord()}
              x={f(x - 2)}
              y={f(y - 2)}
              textAnchor="end"
              fontSize={6.5}
            >
              −{n}
            </text>
          );
        })}
        <circle className={s.rim()} r={R} strokeWidth={1} />
        <line
          className={s.shoreLine()}
          x1={-R - 8}
          x2={R + 8}
          y1={0}
          y2={0}
          strokeWidth={2}
        />
        <text
          className={s.webWord()}
          x={-R + 14}
          y={-8}
          fontSize={7.5}
          letterSpacing="0.08em"
        >
          sea
        </text>
        <text
          className={s.webWord()}
          x={-R + 14}
          y={15}
          fontSize={7.5}
          letterSpacing="0.08em"
        >
          land
        </text>
        <polygon
          className={s.shape()}
          points={ring.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
        {/* Names round the outside: once, on the right, for the four that come from either side. */}
        {DIRS.map((d) => {
          const a = d.at[0];
          const [x, y] = polar(a, R + 12);
          const name = DIRECTION_NAME[d.key];
          if (a === 0 || a === 180)
            return (
              <text
                key={d.key}
                className={s.webName()}
                x={0}
                y={f(a === 0 ? y - 2 : y + 9)}
                textAnchor="middle"
                fontSize={8}
                letterSpacing="0.06em"
              >
                {name}
              </text>
            );
          return (
            <text
              key={d.key}
              className={s.webName()}
              x={f(x)}
              y={f(a === 90 ? y - 5 : y + 3)}
              fontSize={8}
              letterSpacing="0.06em"
            >
              {name}
            </text>
          );
        })}
        {DIRS.flatMap((d) =>
          d.at.map((a, n) => {
            const [x, y] = polar(a, radius(off[d.key]));
            const on = d.key === picked;
            return n === 0 ? (
              <circle
                key={`${d.key}${a}`}
                className={on ? s.dotOn() : s.dot()}
                cx={f(x)}
                cy={f(y)}
                r={on ? 5 : 4}
                strokeWidth={1.5}
                tabIndex={0}
                role="slider"
                aria-label={`${DIRECTION_NAME[d.key]}: stars taken off`}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={off[d.key]}
                aria-valuetext={`${halfStars(off[d.key])} stars`}
                data-dot={d.key}
                onKeyDown={keyDown(d.key)}
                onFocus={() => setPicked(d.key)}
              />
            ) : (
              <circle
                key={`${d.key}${a}`}
                className={on ? s.dotOn() : s.dot()}
                cx={f(x)}
                cy={f(y)}
                r={on ? 5 : 4}
                strokeWidth={1.5}
                aria-hidden="true"
                data-dot={d.key}
              />
            );
          }),
        )}
        {picks.at.map((a) => {
          const [x, y] = polar(a, radius(off[picked]));
          return (
            <circle
              key={`top${a}`}
              className={s.dotTop()}
              cx={f(x)}
              cy={f(y)}
              r={5}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          );
        })}
      </svg>
      <div className={s.picked()} data-picked={picked}>
        <span className={s.pickedName()}>{DIRECTION_NAME[picked]}</span>
        <Button
          size="sm"
          icon
          aria-label="Take off half a star more"
          disabled={off[picked] >= 5}
          onClick={() => onChange(picked, off[picked] + 0.5)}
        >
          −
        </Button>
        <span className={s.pickedValue()} data-picked-value>
          {halfStars(off[picked])}★
        </span>
        <Button
          size="sm"
          icon
          aria-label="Take off half a star less"
          disabled={off[picked] <= 0}
          onClick={() => onChange(picked, off[picked] - 0.5)}
        >
          +
        </Button>
      </div>
    </>
  );
}

/** Every wind and gust for one direction, shaded by the stars, with a readout. */
function Together({ rider, unit }: { rider: Rider; unit: UnitScale }) {
  const s = styles();
  const [dir, setDir] = useState<DirectionKey>("crossOn");
  const [pick, setPick] = useState<[number, number]>([18, 27]);
  const svg = useRef<SVGSVGElement>(null);
  const cells = useMemo(() => gridStars(rider, dir), [rider, dir]);
  const left = 30;
  const w = 360;
  const h = 230;
  const X = (kn: number) => left + (kn / WIND_TOP) * w;
  const Y = (kn: number) => h - (kn / GUST_TOP) * h;
  const [pw, pg] = pick;
  const { rating, wind, over, gusts, direction } = breakdown(
    rider,
    pw,
    pg,
    dir,
  );
  const topW = WIND_TOP * unit.perKn;
  const topG = GUST_TOP * unit.perKn;

  const pickAt = (event: PointerEvent<SVGSVGElement>) => {
    const el = svg.current!;
    const point = el.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(el.getScreenCTM()!.inverse());
    const windKn = Math.min(
      WIND_TOP - 0.01,
      Math.max(0, ((p.x - left) / w) * WIND_TOP),
    );
    const gustKn = Math.min(
      GUST_TOP - 0.01,
      Math.max(0, ((h - p.y) / h) * GUST_TOP),
    );
    setPick([
      Math.round(windKn),
      Math.max(Math.round(gustKn), Math.round(windKn)),
    ]);
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const m = moves[event.key];
    if (!m) return;
    event.preventDefault();
    const nw = Math.min(WIND_TOP - 1, Math.max(0, pw + m[0]));
    setPick([nw, Math.min(GUST_TOP - 1, Math.max(nw, pg + m[1]))]);
  };

  const sx = left + ((Math.floor(pw / GRID_STEP) * GRID_STEP) / WIND_TOP) * w;
  const sy =
    h - (((Math.floor(pg / GRID_STEP) + 1) * GRID_STEP) / GUST_TOP) * h;
  const why = over
    ? ", gusts over your limit"
    : [
        gusts ? `, gusty ${halfStars(gusts)}` : "",
        direction ? `, direction ${halfStars(direction)}` : "",
      ].join("");
  const axes = [];
  // In Force, a tick where each force starts, named by it.
  if (unit.force) {
    for (const tick of forceTicks(1, WIND_TOP))
      axes.push(
        <text
          key={`w${tick.kn}`}
          className={s.axis()}
          x={X(tick.kn)}
          y={h + 14}
          textAnchor="middle"
        >
          {tick.force}
        </text>,
      );
    for (const tick of forceTicks(1, GUST_TOP))
      axes.push(
        <text
          key={`g${tick.kn}`}
          className={s.axis()}
          x={left - 4}
          y={Y(tick.kn) + 3}
          textAnchor="end"
        >
          {tick.force}
        </text>,
      );
  } else {
    for (let v = 0; v <= topW + 1e-6; v += unit.tick)
      axes.push(
        <text
          key={`w${v}`}
          className={s.axis()}
          x={left + (v / topW) * w}
          y={h + 14}
          textAnchor="middle"
        >
          {v}
        </text>,
      );
    for (let v = unit.tick; v <= topG + 1e-6; v += unit.tick)
      axes.push(
        <text
          key={`g${v}`}
          className={s.axis()}
          x={left - 4}
          y={h - (v / topG) * h + 3}
          textAnchor="end"
        >
          {v}
        </text>,
      );
  }

  return (
    <>
      <div className={s.together()}>
        <span>For wind that is</span>
        <Select
          aria-label="Show the stars for wind that is"
          value={dir}
          onChange={(event) => setDir(event.target.value as DirectionKey)}
        >
          {DIRECTION_KEYS.map((key) => (
            <option key={key} value={key}>
              {DIRECTION_NAME[key].toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <svg
        ref={svg}
        className={s.gridSvg()}
        viewBox="0 -18 400 278"
        role="img"
        aria-label="Stars for every wind speed and gust: darker is more stars"
        tabIndex={0}
        onPointerMove={pickAt}
        onPointerDown={pickAt}
        onKeyDown={keyDown}
        data-stars-grid
      >
        {cells.map((column, i) =>
          column.map((stars, j) => {
            const wind = i * GRID_STEP;
            const gust = j * GRID_STEP;
            const x = X(wind);
            const y = Y(gust + GRID_STEP);
            const cw = X(wind + GRID_STEP) - x;
            const ch = Y(gust) - y;
            return stars === null ? (
              <rect
                key={`${i}-${j}`}
                className={s.none()}
                x={x}
                y={y}
                width={cw}
                height={ch}
              />
            ) : (
              <rect
                key={`${i}-${j}`}
                className={s.cell()}
                x={x}
                y={y}
                width={cw + 0.3}
                height={ch + 0.3}
                opacity={SHADE[stars]}
              />
            );
          }),
        )}
        {axes}
        <text className={s.axis()} x={left + w} y={h + 28} textAnchor="end">
          wind speed, {unit.label} →
        </text>
        <text className={s.axis()} x={0} y={-8} textAnchor="start">
          gusts, {unit.label} ↑
        </text>
        <rect
          className={s.pick()}
          x={sx}
          y={sy}
          width={(GRID_STEP / WIND_TOP) * w}
          height={(GRID_STEP / GUST_TOP) * h}
          strokeWidth={2}
        />
      </svg>
      <div className={s.key()} aria-hidden="true">
        <span>Blank: no stars ·</span>
        <span>1★</span>
        {SHADE.slice(1).map((o) => (
          <span key={o} className={s.swatch()} style={{ opacity: o }} />
        ))}
        <span>5★</span>
      </div>
      <div className={s.readout()} aria-live="polite" data-stars-readout>
        <span>
          <Speed kn={pw} unit={unit} /> gusting <Speed kn={pg} unit={unit} />
          {unit.force ? "" : ` ${unit.label}`}
        </span>
        <StarGlyphs
          stars={rating.stars}
          potential={rating.potential}
          size={12}
        />
        <span className={s.why()}>
          wind {Number(wind.toFixed(1))}★{why}
        </span>
      </div>
    </>
  );
}

/** A speed in the rider's unit, in a line: the figure, or the force's glyph. */
function Speed({ kn, unit }: { kn: number; unit: UnitScale }) {
  return unit.force ? (
    <BeaufortGlyph force={beaufort(kn)} size={14} />
  ) : (
    <>{shown(kn, unit)}</>
  );
}
