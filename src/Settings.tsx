/**
 * "Settings": the site menu's third row, one dialog with everything a rider
 * sets about themselves, on one page, in four parts: about them (weight and
 * units), the wind strength that suits them (two handles, too light and too
 * strong, with the stars they make under the slider), the stars each wind
 * direction takes off, and how far up and down the wind they ride (two
 * handles on a circle). Every handle wears the same dashed ring, which says
 * it can be dragged (the owner's ruling of 2026-10-28). It took the place of a six-step
 * wizard (owner's ruling of 2026-10-26: "one modal, so people don't have to
 * keep clicking through"); the controls and pictures are the wizard's.
 *
 * Everyone starts from ours; "Reset to ours" shows once anything the stars
 * or the course are made of differs from it. On a desktop the four parts sit
 * two by two; on a phone it is the whole screen, one column, and scrolls.
 *
 * Its own chunk, fetched when it is opened. It edits a draft, and Save keeps
 * it through src/settingsDraft.ts, into the preferences the stars and every
 * page read: Cancel, the close button, Escape and the backdrop keep nothing.
 */
import "./settings.css";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Prefs } from "../force5/src/prefs";
import { DOWNWIND_MAX, UPWIND_MAX } from "../force5/src/rideWedge";
import { NEVER, type DirectionKey } from "../force5/src/stars";
import { UNITS, beaufort, forceKn, type Units } from "../force5/src/units";
import { BeaufortGlyph } from "../ui/BeaufortGlyph";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Segmented } from "../ui/Segmented";
import {
  WEB_DIRS,
  WEB_R,
  WIND_ENDS,
  WIND_TOP,
  forceTicks,
  knotsOf,
  moveWindEnd,
  offAt,
  polar,
  said,
  shoreLocked,
  shown,
  starRuns,
  stepped,
  unitScale,
  webRadius,
  type UnitScale,
} from "../spot/web/yourStars";
import {
  applyDraft,
  differsFromOurs,
  draftOf,
  inUnits,
  offWords,
  resetToOurs,
  withDownwind,
  withShore,
  withUpwind,
  type Draft,
} from "./settingsDraft";

/** The four parts, in the order they read, each a heading and one line of help. */
const PARTS = {
  you: {
    title: "About you",
    help: "Your weight helps us suggest the right wing size.",
  },
  wind: {
    title: "Wind strength",
    help: "Drag the two ringed handles to where the wind gets too light and too strong for you. The stars underneath show how we will rate each wind speed: best in the middle.",
  },
  shore: {
    title: "Wind direction",
    help: "Some winds are harder or less safe. Drag a ringed dot towards the middle to take stars off for that wind.",
  },
  upwind: {
    title: "Riding upwind",
    help: "This shows where you can ride on the map. It does not change your stars. Drag the ringed handles on the circle.",
  },
} as const;

/** The five wind directions, onshore first, as the list gives them. */
const SHORE_ORDER: readonly DirectionKey[] = [
  "onshore",
  "crossOn",
  "cross",
  "crossOff",
  "offshore",
];
const DIRECTION_NAME: Record<DirectionKey, string> = {
  onshore: "Onshore",
  crossOn: "Cross-onshore",
  cross: "Cross-shore",
  crossOff: "Cross-offshore",
  offshore: "Offshore",
};
const DIRECTION_LINE: Record<DirectionKey, string> = {
  onshore: "Blows straight onto the beach. Choppy, but it brings you back.",
  crossOn: "Blows in at an angle. The easiest wind to learn in.",
  cross: "Blows along the beach. Good for most riders.",
  crossOff: "Blows out at an angle. You drift away from the beach.",
  offshore: "Blows out to sea. We don't recommend going out in it.",
};
/** The picture's names, at the end of each spoke. */
const DIRECTION_SHORT: Record<DirectionKey, string> = {
  onshore: "ONSHORE",
  crossOn: "CROSS-ON",
  cross: "CROSS",
  crossOff: "CROSS-OFF",
  offshore: "OFFSHORE",
};

export interface SettingsProps {
  /** False while it fades out, once shut (ui/Backdrop.tsx `useFadeOut`). */
  open: boolean;
  prefs: Prefs;
  /** Shut, keeping nothing: Cancel, the close button, Escape, the backdrop. */
  onClose: () => void;
  /** Save: the preferences to keep. */
  onSave: (prefs: Prefs) => void;
}

export default function Settings({
  open,
  prefs,
  onClose,
  onSave,
}: SettingsProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(prefs));
  const unit = unitScale(draft.units);
  const id = useId();
  const part = (key: keyof typeof PARTS, children: ReactNode) => (
    <section
      className={`st-part is-${key}`}
      data-part={key}
      aria-labelledby={`${id}${key}`}
    >
      <h3 className="st-h" id={`${id}${key}`}>
        {PARTS[key].title}
      </h3>
      <p className="st-help">{PARTS[key].help}</p>
      {children}
    </section>
  );

  // On a phone the dialog is the screen, and a browser's bars may stand
  // over its foot: Save goes up in the head, by the close (which is
  // Cancel), and "Reset to ours" at the end of the parts.
  const phone = usePhone();
  const reset = differsFromOurs(draft) && (
    <Button
      variant="quiet"
      className="st-reset"
      onClick={() => setDraft(resetToOurs(draft))}
    >
      Reset to ours
    </Button>
  );
  const save = (
    <Button
      variant="primary"
      size={phone ? "sm" : undefined}
      onClick={() => onSave(applyDraft(prefs, draft))}
    >
      Save
    </Button>
  );

  return (
    <Dialog
      open={open}
      size="wide"
      title="Settings"
      className="st"
      onClose={onClose}
      aside={phone ? save : undefined}
      actions={
        phone ? undefined : (
          <div className="st-foot">
            {reset}
            <span className="st-sp" />
            <Button variant="pill" onClick={onClose}>
              Cancel
            </Button>
            {save}
          </div>
        )
      }
    >
      <div className="st-body">
        {part("you", <YouPart draft={draft} setDraft={setDraft} unit={unit} />)}
        {part(
          "wind",
          <WindRange
            wind={draft.custom.wind}
            units={draft.units}
            unit={unit}
            onMove={(key, kn) =>
              setDraft({
                ...draft,
                custom: moveWindEnd(draft.custom, key, kn, draft.units),
              })
            }
          />,
        )}
        {part("shore", <ShorePart draft={draft} setDraft={setDraft} />)}
        {part("upwind", <UpwindPart draft={draft} setDraft={setDraft} />)}
        {phone && reset && <div className="st-end">{reset}</div>}
      </div>
    </Dialog>
  );
}

/** The width under which the dialog is the whole screen (src/settings.css). */
const PHONE_QUERY = "(max-width: 719px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(
    () => window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const change = () => setPhone(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return phone;
}

type PartProps = { draft: Draft; setDraft: (draft: Draft) => void };

/**
 * A picture with handles in it scrolls the page under a finger, as the
 * page's words do (`touch-action: pan-y` on it, src/settings.css): only a
 * touch that lands on a handle is held for the handle, which a touch-action
 * of its own cannot say inside an SVG in every browser. Its pointer events
 * still come, so the drag is the handle's own as with a mouse.
 */
function useHandleTouch(
  host: { current: SVGElement | null },
  handle: string,
): void {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const hold = (event: Event) => {
      if ((event.target as Element | null)?.closest?.(handle))
        event.preventDefault();
    };
    el.addEventListener("touchstart", hold, { passive: false });
    return () => el.removeEventListener("touchstart", hold);
  }, [host, handle]);
}

/**
 * A speed as a figure: the number, or in Force the old charts' glyph beside
 * the force (ui/BeaufortGlyph.tsx), `size` px tall.
 */
function Speed({
  kn,
  unit,
  size = 14,
}: {
  kn: number;
  unit: UnitScale;
  size?: number;
}) {
  return unit.force ? (
    <BeaufortGlyph force={beaufort(kn)} size={size} />
  ) : (
    <>{shown(kn, unit)}</>
  );
}

/* ---- 1. about you ---- */

/** The units' names on their buttons: knots in full, the rest as written. */
const UNIT_NAME: Partial<Record<Units, string>> = { kn: "Knots" };

/**
 * Weight and units, side by side on a desktop, each its name over it.
 * Neither moves a star.
 */
function YouPart({ draft, setDraft, unit }: PartProps & { unit: UnitScale }) {
  const weight = draft.weightKg ?? 80;
  return (
    <div className="st-rows">
      <div className="st-row">
        <span className="st-kick">Weight</span>
        <span className="st-stepper">
          <Button
            variant="pill"
            size="sm"
            icon
            aria-label="Lighter"
            onClick={() =>
              setDraft({ ...draft, weightKg: Math.max(40, weight - 5) })
            }
          >
            −
          </Button>
          <output aria-live="polite">
            {weight}
            <small>kg</small>
          </output>
          <Button
            variant="pill"
            size="sm"
            icon
            aria-label="Heavier"
            onClick={() =>
              setDraft({ ...draft, weightKg: Math.min(140, weight + 5) })
            }
          >
            +
          </Button>
        </span>
      </div>
      <div className="st-row">
        <span className="st-kick">Units</span>
        <Segmented<Units>
          aria-label="Units"
          options={UNITS.map((u) => ({
            value: u.id,
            label: <span title={u.name}>{UNIT_NAME[u.id] ?? u.label}</span>,
          }))}
          value={draft.units}
          onChange={(units) => setDraft(inUnits({ ...draft, units }))}
        />
        {unit.force && (
          // The old charts' notation, with the knots each force runs over.
          <ul className="st-bf-key" aria-label="The forces in knots">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((force) => (
              <li key={force}>
                <BeaufortGlyph force={force} size={16} />
                <small>
                  {forceKn(force, "first")}–{forceKn(force, "last")} kn
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---- 2. the wind ---- */

/** The wind scale's ends, in knots: past the highest top a handle can reach. */
const SCALE_FROM = 0;
const SCALE_TO = 50;
/** A tick every this many of the rider's unit. */
const TICK: Record<Units, number> = {
  kn: 5,
  mph: 5,
  "km/h": 10,
  "m/s": 5,
  bft: 1,
};
const HANDLE_NAMES = {
  min: "Too light below",
  max: "Too strong in gusts above",
} as const;
/** The chart's star, a five-point at radius 5 round the origin. */
const STAR_PATH =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/**
 * One axis: the rider's two ends on a scale in knots, shown in their unit
 * (too light, and too much, which a gust may not pass, hatched in the pen's
 * red past it), and the sweet spot worked out between them; right under the
 * track, read-only, the stars those make by steady wind; then the figures,
 * once. Two handles, dragged or moved a step at a time from the keyboard;
 * where they may go, and the sweet spot, are yourStars.ts's
 * (`moveWindEnd`), on whole figures of the rider's unit.
 */
function WindRange({
  wind,
  units,
  unit,
  onMove,
}: {
  wind: Draft["custom"]["wind"];
  units: Units;
  unit: UnitScale;
  onMove: (key: "min" | "max", kn: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const much = useRef<HTMLSpanElement>(null);
  const none = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [labels, setLabels] = useState({ light: 70, much: 130, none: 110 });
  useLayoutEffect(() => {
    const el = host.current!;
    const seen = new ResizeObserver(() => setWidth(el.clientWidth));
    seen.observe(el);
    setWidth(el.clientWidth);
    return () => seen.disconnect();
  }, []);
  // The labels' widths, to keep them on the scale whatever its width.
  useLayoutEffect(() => {
    const next = {
      light: light.current?.offsetWidth ?? 0,
      much: much.current?.offsetWidth ?? 0,
      none: none.current?.offsetWidth ?? 0,
    };
    if (
      next.light !== labels.light ||
      next.much !== labels.much ||
      next.none !== labels.none
    )
      setLabels(next);
  });
  const pc = (kn: number) =>
    ((Math.min(kn, SCALE_TO) - SCALE_FROM) / (SCALE_TO - SCALE_FROM)) * 100;
  const x = (kn: number) => (pc(kn) / 100) * width;
  const at = (clientX: number) => {
    const box = host.current!.getBoundingClientRect();
    return (
      SCALE_FROM + ((clientX - box.left) / box.width) * (SCALE_TO - SCALE_FROM)
    );
  };
  const ticks = unit.force
    ? forceTicks(SCALE_FROM + 1, SCALE_TO).map(({ kn, force }) => ({
        kn,
        label: String(force),
      }))
    : Array.from(
        {
          length: Math.floor((SCALE_TO * unit.perKn) / TICK[units] + 1e-9),
        },
        (_, i) => {
          const value = (i + 1) * TICK[units];
          return { kn: value / unit.perKn, label: String(value) };
        },
      );
  // Too light ends short of its handle; too much starts past its own, or
  // keeps to the scale's end where there is no room.
  const lightLeft = Math.max(0, x(wind.min) - 24 - labels.light);
  // On a narrow scale, every other tick is labelled, so the figures never touch.
  const sparse = width > 0 && width / ticks.length < 44;
  const muchLeft = Math.min(x(wind.max) + 24, width - labels.much);
  const noneLeft = Math.min(x(wind.max) + 6, width - labels.none);
  // The stars by steady wind, a run of one count at a time, each run from
  // half a knot before its first to half a knot past its last.
  const runs = starRuns(wind, SCALE_TO).filter((r) => r.stars);
  return (
    <div className="st-range" ref={host}>
      <div className="st-track">
        <i
          className="st-zone is-ok"
          style={{
            left: `${pc(wind.min)}%`,
            width: `${pc(wind.sweetLow) - pc(wind.min)}%`,
          }}
        />
        <i
          className="st-zone is-sweet"
          style={{
            left: `${pc(wind.sweetLow)}%`,
            width: `${pc(wind.sweetHigh) - pc(wind.sweetLow)}%`,
          }}
        />
        <i
          className="st-zone is-ok"
          style={{
            left: `${pc(wind.sweetHigh)}%`,
            width: `${pc(wind.max) - pc(wind.sweetHigh)}%`,
          }}
        />
        <i
          className="st-zone is-over"
          style={{ left: `${pc(wind.max)}%`, right: 0 }}
        />
      </div>
      <span className="st-rlab" ref={light} style={{ left: lightLeft }}>
        Too light
      </span>
      <span
        className="st-rlab is-mid"
        style={{ left: (x(wind.sweetLow) + x(wind.sweetHigh)) / 2 }}
      >
        Sweet spot
      </span>
      <span className="st-rlab is-top" ref={much} style={{ left: muchLeft }}>
        Too strong in gusts
      </span>
      {WIND_ENDS.map((key) => {
        const v = wind[key];
        return (
          <span
            key={key}
            role="slider"
            tabIndex={0}
            aria-label={HANDLE_NAMES[key]}
            aria-valuemin={2}
            aria-valuemax={WIND_TOP}
            aria-valuenow={v}
            aria-valuetext={said(v, unit)}
            className={`st-knob st-grab${key === "max" ? " is-top" : ""}`}
            style={{ left: x(v) }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.focus();
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                onMove(key, knotsOf(at(event.clientX) * unit.perKn, unit));
            }}
            onKeyDown={(event) => {
              const by = (
                {
                  ArrowLeft: -1,
                  ArrowDown: -1,
                  ArrowRight: 1,
                  ArrowUp: 1,
                  PageDown: -5,
                  PageUp: 5,
                } as Record<string, number>
              )[event.key];
              if (!by) return;
              event.preventDefault();
              onMove(key, stepped(v, by, unit));
            }}
          >
            <Speed kn={v} unit={unit} size={13} />
          </span>
        );
      })}
      <div
        className="st-strip"
        data-star-strip
        role="img"
        aria-label={`Your stars by steady wind: none below ${said(wind.min, unit)}, five from ${said(wind.sweetLow, unit)} to ${said(wind.sweetHigh, unit)}, none past ${said(wind.max - 3, unit)}.`}
      >
        <svg className="st-strip-star" viewBox="-5.5 -5.5 11 11" aria-hidden>
          <path d={STAR_PATH} />
        </svg>
        {runs.map((r) => {
          const left = pc(Math.max(0, r.from - 0.5));
          const right = pc(Math.min(SCALE_TO, r.to + 0.5));
          return (
            <i
              key={r.from}
              className={`st-strip-run is-s${r.stars}`}
              data-stars={r.stars}
              style={{ left: `${left}%`, width: `${right - left}%` }}
            >
              {((right - left) / 100) * width >= 8 ? r.stars : ""}
            </i>
          );
        })}
        <span className="st-strip-none" ref={none} style={{ left: noneLeft }}>
          no stars past here
        </span>
      </div>
      <div className="st-ticks" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={t.kn} style={{ left: `${pc(t.kn)}%` }}>
            {sparse && (ticks.length - 1 - i) % 2 ? "" : t.label}
            {i === ticks.length - 1 && !unit.force ? ` ${unit.label}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- 3. stars by wind direction ---- */

/** The padlock beside offshore's "No stars": no dot moves it. */
function Lock() {
  return (
    <svg className="st-lock" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

function ShorePart({ draft, setDraft }: PartProps) {
  const off = draft.custom.direction;
  return (
    <div className="st-shore">
      <ShoreWeb
        off={off}
        onChange={(key, value) => setDraft(withShore(draft, key, value))}
      />
      <ul className="st-dirs">
        {SHORE_ORDER.map((key) => {
          const lock = shoreLocked(key);
          return (
            <li
              key={key}
              data-direction={key}
              className={lock ? "is-locked" : undefined}
            >
              <b>{DIRECTION_NAME[key]}</b>
              <span
                className={`st-cost${off[key] >= NEVER ? " is-never" : ""}`}
              >
                {offWords(off[key])}
                {lock && <Lock />}
              </span>
              <small>{DIRECTION_LINE[key]}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The spokes round the web, clockwise from straight out to sea. */
const SPOKES = WEB_DIRS.flatMap((d) => d.at.map((a) => ({ key: d.key, a })));
/** The ring the shape is drawn round, in the spokes' order round the web. */
const RING = [...SPOKES].sort(
  (p, q) => ((p.a + 360) % 360) - ((q.a + 360) % 360),
);
const f1 = (n: number) => n.toFixed(1);

/**
 * The beach from above, sea up and land down (spot/web/yourStars.ts's web),
 * and a spoke for each way of wind, its arrow pointing the way the wind
 * blows: offshore out over the sea, onshore in over the land. The dot on a
 * spoke is what that wind costs, in whole stars: on the rim nothing, a star
 * a ring, in the middle no stars. Offshore sits in the middle, locked. The two
 * sides are one setting, so a dot moves its mirror. Each dot is a slider for
 * the keyboard.
 */
function ShoreWeb({
  off,
  onChange,
}: {
  off: Record<DirectionKey, number>;
  onChange: (key: DirectionKey, off: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  useHandleTouch(svg, "[data-dot]");
  const dragging = useRef<DirectionKey | null>(null);
  const R = WEB_R;
  const at = (event: { clientX: number; clientY: number }) => {
    const el = svg.current!;
    const point = el.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(el.getScreenCTM()!.inverse());
  };
  const grab =
    (key: DirectionKey) => (event: ReactPointerEvent<SVGGElement>) => {
      event.preventDefault();
      (
        event.currentTarget.closest("[data-dot]") as SVGGElement | null
      )?.focus?.();
      if (shoreLocked(key)) return;
      dragging.current = key;
      svg.current!.setPointerCapture(event.pointerId);
    };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const p = at(event);
    onChange(dragging.current, offAt(p.x, p.y));
  };
  const stop = () => {
    dragging.current = null;
  };
  const arrow = (a: number) => {
    const [tx, ty] = polar(a, R + 1);
    const [hx, hy] = polar(a, R + 12);
    const [lx, ly] = polar(a - 3.5, R + 7);
    const [rx, ry] = polar(a + 3.5, R + 7);
    return `M${f1(tx)} ${f1(ty)}L${f1(hx)} ${f1(hy)}M${f1(lx)} ${f1(ly)}L${f1(hx)} ${f1(hy)}L${f1(rx)} ${f1(ry)}`;
  };
  const label = (key: DirectionKey, a: number) => {
    const side = Math.abs(a) === 90;
    // Straight out and straight in: centred past the arrow. On a slant: the
    // name beside the arrow, running away from it, so the longer names clear it.
    const slant = !side && a % 180 !== 0;
    const [x, y] = polar(a, side ? R + 4 : slant ? R + 14 : R + 19);
    const out = a > 0 ? 1 : -1;
    return (
      <text
        key={`l${a}`}
        className={`st-web-name${key === "offshore" || key === "crossOff" ? " is-danger" : ""}`}
        x={f1(slant ? x + out * 8 : x)}
        y={f1(side ? 14 : y + 3)}
        textAnchor={side || slant ? (out > 0 ? "start" : "end") : "middle"}
      >
        {DIRECTION_SHORT[key]}
      </text>
    );
  };
  return (
    <svg
      ref={svg}
      className="st-web"
      viewBox="-158 -140 316 284"
      role="group"
      aria-label="Stars by wind direction"
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      data-direction-web
    >
      <rect className="st-web-sea" x="-158" y="-140" width="316" height="140" />
      <rect className="st-web-land" x="-158" y="0" width="316" height="144" />
      <line className="st-web-beach" x1="-158" x2="158" y1="0" y2="0" />
      <text className="st-web-word" x="-150" y="-128">
        SEA
      </text>
      <text className="st-web-word" x="-150" y="124">
        LAND
      </text>
      <circle className="st-web-rim" r={R} />
      {[1, 2, 3, 4].map((n) => (
        <circle key={n} className="st-web-ring" r={webRadius(n)} />
      ))}
      <text className="st-web-step" x="4" y={-R + 10}>
        0★
      </text>
      <text className="st-web-step" x="4" y={f1(-webRadius(2) + 9)}>
        −2★
      </text>
      {SPOKES.map(({ key, a }) => {
        const [x, y] = polar(a, R);
        const danger = key === "offshore" || key === "crossOff";
        return (
          <g key={`s${a}`}>
            <line className="st-web-spoke" x2={f1(x)} y2={f1(y)} />
            <path
              className={`st-web-arrow${danger ? " is-danger" : ""}`}
              d={arrow(a)}
            />
            {label(key, a)}
          </g>
        );
      })}
      <polygon
        className="st-web-shape"
        points={RING.map(({ key, a }) =>
          polar(a, webRadius(off[key])).map(f1).join(","),
        ).join(" ")}
      />
      <circle className="st-web-never" r="12" />
      {SPOKES.map(({ key, a }) => {
        const [x, y] = polar(a, webRadius(off[key]));
        const first = WEB_DIRS.find((d) => d.key === key)!.at[0] === a;
        const never = off[key] >= NEVER;
        const lock = shoreLocked(key);
        const dot = (
          <>
            <circle className="st-dot-hit" cx={f1(x)} cy={f1(y)} r="14" />
            <circle className="st-dot-ring" cx={f1(x)} cy={f1(y)} r="10" />
            {!lock && (
              <circle className="st-grab-ring" cx={f1(x)} cy={f1(y)} r="12.5" />
            )}
            <circle
              className={`st-dot-face${never ? " is-never" : ""}`}
              cx={f1(x)}
              cy={f1(y)}
              r="6.5"
            />
          </>
        );
        return first ? (
          <g
            key={`d${a}`}
            className={`st-dot${lock ? " is-locked" : ""}`}
            data-dot={key}
            tabIndex={lock ? -1 : 0}
            role="slider"
            aria-label={`${DIRECTION_NAME[key]}: stars taken off`}
            aria-valuemin={0}
            aria-valuemax={NEVER}
            aria-valuenow={off[key]}
            aria-valuetext={offWords(off[key])}
            aria-readonly={lock || undefined}
            onPointerDown={grab(key)}
            onKeyDown={(event) => {
              const to = (
                {
                  ArrowUp: off[key] + 1,
                  ArrowRight: off[key] + 1,
                  ArrowDown: off[key] - 1,
                  ArrowLeft: off[key] - 1,
                  Home: 0,
                  End: NEVER,
                } as Record<string, number>
              )[event.key];
              if (to === undefined) return;
              event.preventDefault();
              onChange(key, to);
            }}
          >
            {dot}
          </g>
        ) : (
          <g
            key={`d${a}`}
            className={`st-dot${lock ? " is-locked" : ""}`}
            data-dot={key}
            aria-hidden="true"
            onPointerDown={grab(key)}
          >
            {dot}
          </g>
        );
      })}
      <text className="st-web-word" x="0" y="138" textAnchor="middle">
        ARROWS SHOW WHICH WAY THE WIND BLOWS
      </text>
    </svg>
  );
}

/* ---- 4. upwind ---- */

/**
 * The three quick answers, in degrees into the wind past straight across it
 * (force5/src/rideWedge.ts `upwindOf`). The picture's handles fine-tune
 * from there.
 */
const UP_ANSWERS = [
  {
    into: 0,
    name: "Not yet",
    line: "I can ride across the wind without losing ground.",
  },
  {
    into: 5,
    name: "A little",
    line: "I can gain a little ground into the wind.",
  },
  { into: 20, name: "Yes", line: "I can ride upwind with no trouble." },
] as const;

/** The upwind picture's frame: the board at the middle, the wind from the top. */
const UP = { cx: 150, cy: 168, r: 118, vx: -36, vw: 372, vh: 310 };

/**
 * "Can you ride upwind?": the three answers across the top, the chosen one's
 * line under them, then the picture, the width of the part, and the two
 * angles said under it. Degrees into the wind (counted from straight across
 * it) and degrees below across that the course runs to, used in every wind
 * and moving no star. The picture draws them as the loupe will: the no-go
 * hatched into the wind (CAN'T RIDE HERE), the two courses (RIDE), and past
 * the course downwind DRIFT, where they lose ground. Each angle is set by
 * its handles on the course's edges, dragged round the circle, or a degree
 * at a time from the keyboard on the right-hand one (the owner's ruling of
 * 2026-10-28 took the two sliders away for them).
 */
function UpwindPart({ draft, setDraft }: PartProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const svg = useRef<SVGSVGElement>(null);
  useHandleTouch(svg, "[data-edge]");
  const into = draft.upwind;
  const down = draft.downwind;
  // The latest draft, for a drag that outlives the render it began in.
  const latest = useRef(draft);
  latest.current = draft;
  const { cx, cy, r } = UP;
  const up = 90 - into;
  const deep = 90 + down;
  /** A point `rr` out on a heading `a` degrees off the wind, clockwise from the top. */
  const p = (a: number, rr: number): [number, number] => [
    cx + rr * Math.sin((a * Math.PI) / 180),
    cy - rr * Math.cos((a * Math.PI) / 180),
  ];
  const xy = (a: number, rr: number) =>
    p(a, rr)
      .map((n) => n.toFixed(1))
      .join(" ");
  const sector = (a1: number, a2: number, rr: number) =>
    `M${cx} ${cy}L${xy(a1, rr)}A${rr} ${rr} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${xy(a2, rr)}Z`;
  /** Dragging an edge: its angle for the pointer, either side. */
  const grab =
    (kind: "into" | "down") => (event: ReactPointerEvent<SVGGElement>) => {
      event.preventDefault();
      const move = (m: PointerEvent) => {
        const box = svg.current?.getBoundingClientRect();
        if (!box) return;
        const k = UP.vw / box.width;
        const x = Math.abs((m.clientX - box.left) * k + UP.vx - cx);
        const y = (m.clientY - box.top) * k - cy;
        // Degrees off the wind, 0 to 180.
        const off = (Math.atan2(x, -y) * 180) / Math.PI;
        setDraft(
          kind === "into"
            ? withUpwind(latest.current, 90 - off)
            : withDownwind(latest.current, off - 90),
        );
      };
      const end = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", end);
        removeEventListener("pointercancel", end);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", end);
      addEventListener("pointercancel", end);
    };
  /** The keys for an angle: a degree, five, or to either end. */
  const keyed = (kind: "into" | "down", event: ReactKeyboardEvent) => {
    const value = kind === "into" ? into : down;
    const max = kind === "into" ? UPWIND_MAX : DOWNWIND_MAX;
    const to = (
      {
        ArrowLeft: value - 1,
        ArrowDown: value - 1,
        ArrowRight: value + 1,
        ArrowUp: value + 1,
        PageDown: value - 5,
        PageUp: value + 5,
        Home: 0,
        End: max,
      } as Record<string, number>
    )[event.key];
    if (to === undefined) return;
    event.preventDefault();
    setDraft(kind === "into" ? withUpwind(draft, to) : withDownwind(draft, to));
  };
  const handle = (side: 1 | -1, kind: "into" | "down") => {
    const [x, y] = p(side * (kind === "into" ? up : deep), r);
    const value = kind === "into" ? into : down;
    // The right-hand handle of each pair is the slider; its mirror is the
    // same angle, for a pointer only.
    const slider =
      side > 0
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label":
              kind === "into"
                ? "How far upwind you can ride"
                : "How far downwind you will ride",
            "aria-valuemin": 0,
            "aria-valuemax": kind === "into" ? UPWIND_MAX : DOWNWIND_MAX,
            "aria-valuenow": value,
            "aria-valuetext": value
              ? `${value}° ${kind === "into" ? "upwind" : "downwind"}`
              : "straight across the wind",
            onKeyDown: (event: ReactKeyboardEvent) => keyed(kind, event),
          }
        : { "aria-hidden": true };
    return (
      <g
        className={`st-up-edge${kind === "down" ? " is-down" : ""}`}
        data-edge={`${kind}-${side > 0 ? "right" : "left"}`}
        onPointerDown={grab(kind)}
        {...slider}
      >
        <circle cx={x} cy={y} r="18" className="st-up-edge-hit" />
        <circle cx={x} cy={y} r="12.5" className="st-grab-ring" />
        <circle cx={x} cy={y} r="7.5" className="st-up-edge-dot" />
      </g>
    );
  };
  const angle = (side: 1 | -1) => {
    const rr = r * 0.82;
    const [x1, y1] = p(side * 90, rr);
    const out: ReactNode[] = [];
    if (into) {
      const [x2, y2] = p(side * up, rr);
      const [lx, ly] = p(side * (up - 9), r + 14);
      out.push(
        <path
          key="ia"
          className="st-up-angle"
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 ${side > 0 ? 0 : 1} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        />,
        <text
          key="id"
          className="st-up-deg"
          x={lx}
          y={ly + 4}
          textAnchor={side > 0 ? "start" : "end"}
        >
          {into}°
        </text>,
      );
    }
    if (down) {
      const [x2, y2] = p(side * deep, rr);
      const [lx, ly] = p(side * (deep + 9), r + 14);
      out.push(
        <path
          key="da"
          className="st-up-angle is-down"
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 ${side > 0 ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        />,
        <text
          key="dd"
          className="st-up-deg is-down"
          x={lx}
          y={ly + 8}
          textAnchor={side > 0 ? "start" : "end"}
        >
          {down}°
        </text>,
      );
    }
    return <g key={side}>{out}</g>;
  };
  /** RIDE in each course: inside it when it is wide, haloed over its edge when not. */
  const rideLabel = (side: 1 | -1) => {
    const wide = deep - up >= 30;
    const [x, y] = p((side * (up + deep)) / 2, wide ? r * 0.6 : r * 0.56);
    return (
      <text
        key={side}
        className={`st-lab is-strong${wide ? "" : " is-halo"}`}
        x={x.toFixed(1)}
        y={(y + (wide ? 3 : -8)).toFixed(1)}
        textAnchor="middle"
      >
        RIDE
      </text>
    );
  };
  const answer = UP_ANSWERS.find((a) => a.into === into);
  return (
    <>
      <span className="st-kick st-ask">Can you ride upwind?</span>
      <Segmented<string>
        aria-label="Can you ride upwind?"
        className="st-up-answers"
        options={UP_ANSWERS.map((a) => ({
          value: String(a.into),
          label: <span title={a.line}>{a.name}</span>,
        }))}
        value={answer ? String(answer.into) : ""}
        onChange={(value) => setDraft(withUpwind(draft, Number(value)))}
      />
      <p className="st-answer" data-answer>
        {answer?.line ?? "Set by the sliders below."}
      </p>
      <div className="st-up">
        <svg
          ref={svg}
          className="st-up-pic"
          viewBox={`${UP.vx} 0 ${UP.vw} ${UP.vh}`}
          role="group"
          aria-label="Your courses across the wind"
        >
          <defs>
            <pattern
              id={`${id}h`}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line className="st-hatch" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>
          <circle className="st-up-face" cx={cx} cy={cy} r={r} />
          <path
            className="st-up-nogo"
            d={sector(-up, up, r)}
            style={{ fill: `url(#${id}h)` }}
          />
          {deep - up > 0.5 ? (
            <>
              <path className="st-up-course" d={sector(up, deep, r)} />
              <path className="st-up-course" d={sector(-deep, -up, r)} />
            </>
          ) : (
            <path
              className="st-up-course"
              d={`M${cx} ${cy}L${xy(up, r)}M${cx} ${cy}L${xy(-up, r)}`}
            />
          )}
          <path className="st-up-drift" d={sector(deep, 360 - deep, r)} />
          <line
            className="st-up-across"
            x1={cx - r - 8}
            x2={cx + r + 8}
            y1={cy}
            y2={cy}
          />
          {/* Clear of the handles' rings, which stand on the line when the
            rider rides straight across. */}
          <text className="st-lab" x={cx + r + 22} y={cy + 3}>
            ACROSS
          </text>
          <text className="st-lab" x={cx - r - 22} y={cy + 3} textAnchor="end">
            ACROSS
          </text>
          <text
            className="st-lab is-strong"
            x={cx}
            y={cy - r * 0.62}
            textAnchor="middle"
          >
            CAN&rsquo;T RIDE HERE
          </text>
          {rideLabel(1)}
          {rideLabel(-1)}
          <text
            className="st-lab is-strong"
            x={cx}
            y={cy + r * 0.55}
            textAnchor="middle"
          >
            DRIFT
          </text>
          <text
            className="st-lab"
            x={cx}
            y={cy + r * 0.55 + 12}
            textAnchor="middle"
          >
            YOU LOSE GROUND
          </text>
          {angle(1)}
          {angle(-1)}
          <path className="st-up-wind" d={`M${cx} 6V${cy - r - 12}`} />
          <path
            className="st-up-wind-head"
            d={`M${cx - 6} ${cy - r - 14}L${cx + 6} ${cy - r - 14}L${cx} ${cy - r - 3}Z`}
          />
          <text className="st-lab is-strong" x={cx + 10} y="18">
            WIND
          </text>
          <path
            className="st-up-board"
            d={`M${cx} ${cy - 12}C${cx + 5} ${cy - 4} ${cx + 5} ${cy + 8} ${cx} ${cy + 12}C${cx - 5} ${cy + 8} ${cx - 5} ${cy - 4} ${cx} ${cy - 12}Z`}
          />
          {handle(1, "down")}
          {handle(-1, "down")}
          {handle(1, "into")}
          {handle(-1, "into")}
        </svg>
        <div className="st-angles">
          <div className="st-into" data-upwind>
            <output>{into}°</output>
            <span>upwind</span>
          </div>
          <div className="st-into is-down" data-downwind>
            <output>{down}°</output>
            <span>downwind</span>
          </div>
        </div>
      </div>
    </>
  );
}
