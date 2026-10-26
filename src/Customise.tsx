/**
 * "Customise": the site menu's first row, a wizard that walks a rider through
 * the settings the stars are rated on, as the owner approved it in the mockup
 * backlog/mockups/2026-10-25-own-star-rating.html: about them (weight and
 * units), the wind that suits them (four numbers, with the stars they make
 * under the slider), the stars each way of wind takes off, how far up and
 * down the wind they ride, their spots, and the lot together.
 *
 * Everyone starts from ours; "Reset to ours" shows once anything the stars
 * or the course are made of differs from it. Every step is the same: a
 * title, one short line saying what to do, the content (a picture left and
 * its controls right on a desktop, stacked on a phone), and the foot.
 *
 * Its own chunk, fetched when it is opened. It edits a draft and saves it on
 * the last step through src/customiseDraft.ts, into the preferences the
 * stars and every page read: closing it any other way keeps nothing.
 */
import "./customise.css";
import {
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Prefs } from "../force5/src/prefs";
import { DOWNWIND_MAX, UPWIND_MAX } from "../force5/src/rideWedge";
import { NEVER, type DirectionKey } from "../force5/src/stars";
import { UNITS, beaufort, forceKn, type Units } from "../force5/src/units";
import type { Spot } from "../force5/src/weather";
import { BeaufortGlyph } from "../ui/BeaufortGlyph";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SearchField } from "../ui/SearchField";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import {
  WEB_DIRS,
  WEB_R,
  WIND_KEYS,
  WIND_TOP,
  costLabel,
  forceTicks,
  knotsOf,
  moveWind,
  moveWindForce,
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
  draftRider,
  inUnits,
  nearest,
  rateSample,
  resetToOurs,
  sampleDay,
  spotChanges,
  withDownwind,
  withShore,
  withUpwind,
  type Draft,
  type Origin,
  type SampleDay,
} from "./customiseDraft";
import { StarToggle } from "./glyphs";
import type { PlaceHour } from "./ratings";
import { clock, dayLong } from "./strip";

const STEPS = [
  {
    id: "you",
    title: "About you",
    sub: "Your weight, and the units you read the wind in.",
  },
  {
    id: "wind",
    title: "What wind suits you?",
    sub: "Drag the handles to the wind you like. The stars under them follow.",
  },
  {
    id: "shore",
    title: "Configure stars based on wind direction",
    sub: "Drag a dot in to take stars off for that wind.",
  },
  {
    id: "upwind",
    title: "Can you ride upwind?",
    sub: "Pick the nearest answer, then set the two angles.",
  },
  { id: "spots", title: "Your spots" },
  { id: "done", title: "All set" },
] as const;
export type CustomiseStep = (typeof STEPS)[number]["id"];

/** The five ways of wind, onshore first, as the shore step lists them. */
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
  onshore: "Blows straight in. Choppy out, but it brings you back.",
  crossOn: "In at an angle. The easiest wind to learn in.",
  cross: "Along the beach. Ideal for most riders.",
  crossOff: "Out at an angle. You drift away from the beach.",
  offshore: "We don't recommend going out in an offshore wind.",
};
/** The web's short names, at the end of each spoke. */
const DIRECTION_SHORT: Record<DirectionKey, string> = {
  onshore: "ON",
  crossOn: "X-ON",
  cross: "CROSS",
  crossOff: "X-OFF",
  offshore: "OFF",
};

export interface CustomiseProps {
  /** False while it fades out, once shut (ui/Backdrop.tsx `useFadeOut`). */
  open: boolean;
  prefs: Prefs;
  starred: readonly string[];
  spots: readonly Spot[];
  /** Every place's rated hours in hand (src/useRatings.ts), and the strip's times. */
  hours: ReadonlyMap<string, readonly PlaceHour[]>;
  times: readonly number[];
  /** The places to show a day at first: the open spot, then the rider's own. */
  prefer: readonly string[];
  /** The chart's centre, which the spots step lists the nearest places to. */
  centre: { lat: number; lng: number } | null;
  onClose: () => void;
  /** The preferences to save, and the spots to star or unstar. */
  onSave: (prefs: Prefs, toggle: string[]) => void;
}

/** Where the rider is, once the browser has said: asked for once a visit. */
type Here = Origin | "asking" | "refused" | null;

export default function Customise({
  open,
  prefs,
  starred,
  spots,
  hours,
  times,
  prefer,
  centre,
  onClose,
  onSave,
}: CustomiseProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(prefs, starred));
  const [at, setAt] = useState(0);
  const [here, setHere] = useState<Here>(null);
  const byId = useMemo(
    () => new Map(spots.map((s) => [s.id, s] as const)),
    [spots],
  );
  // The day "All set" shows is chosen once, as the wizard opens.
  const [day] = useState(() => sampleDay(hours, times, byId, prefer));
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  const body = useRef<HTMLDivElement>(null);
  const go = (to: number) => {
    setAt(to);
    body.current?.scrollTo({ top: 0 });
  };
  const rider = draftRider(draft, prefs.rider);
  const unit = unitScale(draft.units);
  const save = () => {
    onSave(applyDraft(prefs, draft), spotChanges(starred, draft.starred));
  };

  return (
    <Dialog
      open={open}
      size="wide"
      label="Customise"
      title={step.title}
      aside={
        <span className="cw-count">
          {at + 1} / {STEPS.length}
        </span>
      }
      className="cw"
      onClose={onClose}
      actions={
        <div className="cw-foot">
          {!last && (
            <Button
              variant="quiet"
              className="cw-skip"
              onClick={() => go(STEPS.length - 1)}
            >
              Skip
            </Button>
          )}
          {differsFromOurs(draft) && (
            <Button
              variant="quiet"
              className="cw-skip"
              data-reset
              onClick={() => setDraft(resetToOurs(draft))}
            >
              Reset to ours
            </Button>
          )}
          <span className="cw-sp" />
          {at > 0 && (
            <Button variant="pill" onClick={() => go(at - 1)}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => (last ? save() : go(at + 1))}
          >
            {last ? "Show me the chart" : "Next"}
          </Button>
        </div>
      }
    >
      <div
        className="cw-prog"
        role="progressbar"
        aria-label="Customise"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={at + 1}
        aria-valuetext={`Step ${at + 1} of ${STEPS.length}`}
      >
        {STEPS.map((s, i) => (
          <i key={s.id} className={i <= at ? "is-done" : undefined} />
        ))}
      </div>
      <div className="cw-body" ref={body} data-step={step.id}>
        {"sub" in step && <p className="cw-sub">{step.sub}</p>}
        {step.id === "you" && (
          <YouStep draft={draft} setDraft={setDraft} unit={unit} />
        )}
        {step.id === "wind" && (
          <WindRange
            wind={draft.custom.wind}
            units={draft.units}
            unit={unit}
            onMove={(i, kn) =>
              setDraft({
                ...draft,
                custom: (unit.force ? moveWindForce : moveWind)(
                  draft.custom,
                  WIND_KEYS[i],
                  kn,
                ),
              })
            }
          />
        )}
        {step.id === "shore" && <ShoreStep draft={draft} setDraft={setDraft} />}
        {step.id === "upwind" && (
          <UpwindStep draft={draft} setDraft={setDraft} />
        )}
        {step.id === "spots" && (
          <SpotsStep
            draft={draft}
            setDraft={setDraft}
            spots={spots}
            centre={centre}
            here={here}
            setHere={setHere}
          />
        )}
        {step.id === "done" && (
          <Done
            draft={draft}
            unit={unit}
            day={day}
            rider={rider}
            byId={byId}
            onChange={(id) => go(STEPS.findIndex((s) => s.id === id))}
          />
        )}
      </div>
    </Dialog>
  );
}

type StepProps = { draft: Draft; setDraft: (draft: Draft) => void };
type DraftRider = ReturnType<typeof draftRider>;

/** A speed in a line of text: "15", or "F5" in Force. */
const written = (kn: number, unit: UnitScale) =>
  unit.force ? `F${beaufort(kn)}` : shown(kn, unit);

/** Two speeds as a range: "14–24", or "F5–F6", or "F5" where it is one force. */
const span = (low: number, high: number, unit: UnitScale) => {
  const a = written(low, unit);
  const b = written(high, unit);
  return a === b ? a : `${a}–${b}`;
};

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

/** Weight and units, each centred, its name over it. Neither moves a star. */
function YouStep({ draft, setDraft, unit }: StepProps & { unit: UnitScale }) {
  const weight = draft.weightKg ?? 80;
  return (
    <div className="cw-rows">
      <div className="cw-row">
        <span className="cw-kick">Weight</span>
        <span className="cw-stepper">
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
      <div className="cw-row">
        <span className="cw-kick">Units</span>
        <Segmented<Units>
          aria-label="Units"
          options={UNITS.map((u) => ({ value: u.id, label: u.label }))}
          value={draft.units}
          onChange={(units) => setDraft(inUnits({ ...draft, units }))}
        />
        {unit.force && (
          // The old charts' notation, with the knots each force runs over.
          <ul className="cw-bf-key" aria-label="The forces in knots">
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
const HANDLE_NAMES = [
  "Too light below",
  "Sweet spot from",
  "Sweet spot to",
  "Too much, in gusts",
];
/** The chart's star, a five-point at radius 5 round the origin. */
const STAR_PATH =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/**
 * One axis: the rider's four numbers on a scale in knots, shown in their
 * unit (too light, the sweet spot, and too much, which a gust may not pass,
 * hatched in the pen's red past it); right under the track, read-only, the
 * stars those numbers make by steady wind; then the figures, once. Four
 * handles, dragged or moved a step at a time from the keyboard; where they
 * may go is yourStars.ts's (`moveWind`), which keeps them a knot apart.
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
  onMove: (i: number, kn: number) => void;
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
  const values = WIND_KEYS.map((k) => wind[k]);
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
    <div className="cw-range" ref={host}>
      <div className="cw-track">
        <i
          className="cw-zone is-ok"
          style={{
            left: `${pc(wind.min)}%`,
            width: `${pc(wind.sweetLow) - pc(wind.min)}%`,
          }}
        />
        <i
          className="cw-zone is-sweet"
          style={{
            left: `${pc(wind.sweetLow)}%`,
            width: `${pc(wind.sweetHigh) - pc(wind.sweetLow)}%`,
          }}
        />
        <i
          className="cw-zone is-ok"
          style={{
            left: `${pc(wind.sweetHigh)}%`,
            width: `${pc(wind.max) - pc(wind.sweetHigh)}%`,
          }}
        />
        <i
          className="cw-zone is-over"
          style={{ left: `${pc(wind.max)}%`, right: 0 }}
        />
      </div>
      <span className="cw-rlab" ref={light} style={{ left: lightLeft }}>
        Too light
      </span>
      <span
        className="cw-rlab is-mid"
        style={{ left: (x(wind.sweetLow) + x(wind.sweetHigh)) / 2 }}
      >
        Sweet spot
      </span>
      <span className="cw-rlab is-top" ref={much} style={{ left: muchLeft }}>
        Too much, in gusts
      </span>
      {values.map((v, i) => (
        <span
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={HANDLE_NAMES[i]}
          aria-valuemin={2}
          aria-valuemax={WIND_TOP}
          aria-valuenow={v}
          aria-valuetext={said(v, unit)}
          className={`cw-knob${i === 3 ? " is-top" : ""}`}
          style={{ left: x(v) }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              onMove(i, knotsOf(at(event.clientX) * unit.perKn, unit));
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
            onMove(i, stepped(v, by, unit));
          }}
        >
          <Speed kn={v} unit={unit} size={13} />
        </span>
      ))}
      <div
        className="cw-strip"
        data-star-strip
        role="img"
        aria-label={`Your stars by steady wind: none below ${said(wind.min, unit)}, five from ${said(wind.sweetLow, unit)} to ${said(wind.sweetHigh, unit)}, none past ${said(wind.max - 3, unit)}.`}
      >
        <svg className="cw-strip-star" viewBox="-5.5 -5.5 11 11" aria-hidden>
          <path d={STAR_PATH} />
        </svg>
        {runs.map((r) => {
          const left = pc(Math.max(0, r.from - 0.5));
          const right = pc(Math.min(SCALE_TO, r.to + 0.5));
          return (
            <i
              key={r.from}
              className={`cw-strip-run is-s${r.stars}`}
              data-stars={r.stars}
              style={{ left: `${left}%`, width: `${right - left}%` }}
            >
              {((right - left) / 100) * width >= 10 ? r.stars : ""}
            </i>
          );
        })}
        <span className="cw-strip-none" ref={none} style={{ left: noneLeft }}>
          no stars past here
        </span>
      </div>
      <div className="cw-ticks" aria-hidden="true">
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

/**
 * A real day at a real spot, rated for the draft, on "All set": the hours,
 * the wind and the stars alone.
 */
function SampleDayCard({
  day,
  rider,
  unit,
}: {
  day: SampleDay | null;
  rider: DraftRider;
  unit: UnitScale;
}) {
  if (!day)
    return <p className="cw-note">No forecast in hand yet to try it on.</p>;
  const ratings = rateSample(day, rider);
  // Nine hours across a phone leave each one a finger's width: smaller stars.
  const small = window.matchMedia("(max-width: 719px)").matches;
  return (
    <div className="cw-day" data-sample>
      <div className="cw-day-h">
        <b>
          {dayLong(day.hours[0].time)} at {day.spot.name}, for you
        </b>
      </div>
      <div className="cw-hours">
        {day.hours.map((hour, i) => {
          const rating = ratings[i];
          return (
            <div key={hour.time}>
              <span className="cw-t">{clock(hour.time)}</span>
              <span className="cw-w">
                <Speed kn={hour.windKn} unit={unit} size={small ? 13 : 16} />
              </span>
              <span className="cw-s">
                {rating.potential ? (
                  <StarGlyphs
                    stars={rating.stars}
                    potential={rating.potential}
                    slots="potential"
                    size={small ? 6 : 9}
                  />
                ) : (
                  <span aria-label="No stars">–</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- 3. stars by wind direction ---- */

/** The padlock beside offshore's "never": no dot moves it. */
function Lock() {
  return (
    <svg className="cw-lock" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
      <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />
    </svg>
  );
}

function ShoreStep({ draft, setDraft }: StepProps) {
  const off = draft.custom.direction;
  return (
    <div className="cw-shore">
      <ShoreWeb
        off={off}
        onChange={(key, value) => setDraft(withShore(draft, key, value))}
      />
      <ul className="cw-dirs">
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
                className={`cw-cost${off[key] >= NEVER ? " is-never" : ""}`}
              >
                {costLabel(off[key])}
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
 * a ring, in the middle never. Offshore sits in the middle, locked. The two
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
    const [x, y] = polar(a, side ? R + 4 : R + 19);
    return (
      <text
        key={`l${a}`}
        className={`cw-web-name${key === "offshore" || key === "crossOff" ? " is-danger" : ""}`}
        x={f1(x)}
        y={f1(side ? 14 : y + 3)}
        textAnchor={a === 90 ? "start" : a === -90 ? "end" : "middle"}
      >
        {DIRECTION_SHORT[key]}
      </text>
    );
  };
  return (
    <svg
      ref={svg}
      className="cw-web"
      viewBox="-158 -140 316 284"
      role="group"
      aria-label="Stars by wind direction"
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      data-direction-web
    >
      <rect className="cw-web-sea" x="-158" y="-140" width="316" height="140" />
      <rect className="cw-web-land" x="-158" y="0" width="316" height="144" />
      <line className="cw-web-beach" x1="-158" x2="158" y1="0" y2="0" />
      <text className="cw-web-word" x="-150" y="-128">
        SEA
      </text>
      <text className="cw-web-word" x="-150" y="138">
        LAND
      </text>
      <circle className="cw-web-rim" r={R} />
      {[1, 2, 3, 4].map((n) => (
        <circle key={n} className="cw-web-ring" r={webRadius(n)} />
      ))}
      <text className="cw-web-step" x="4" y={-R + 10}>
        0★
      </text>
      <text className="cw-web-step" x="4" y={f1(-webRadius(2) + 9)}>
        −2★
      </text>
      {SPOKES.map(({ key, a }) => {
        const [x, y] = polar(a, R);
        const danger = key === "offshore" || key === "crossOff";
        return (
          <g key={`s${a}`}>
            <line className="cw-web-spoke" x2={f1(x)} y2={f1(y)} />
            <path
              className={`cw-web-arrow${danger ? " is-danger" : ""}`}
              d={arrow(a)}
            />
            {label(key, a)}
          </g>
        );
      })}
      <polygon
        className="cw-web-shape"
        points={RING.map(({ key, a }) =>
          polar(a, webRadius(off[key])).map(f1).join(","),
        ).join(" ")}
      />
      <circle className="cw-web-never" r="9" />
      <text className="cw-web-never-word" y="2.2" textAnchor="middle">
        NEVER
      </text>
      {SPOKES.map(({ key, a }) => {
        const [x, y] = polar(a, webRadius(off[key]));
        const first = WEB_DIRS.find((d) => d.key === key)!.at[0] === a;
        const never = off[key] >= NEVER;
        const lock = shoreLocked(key);
        const dot = (
          <>
            <circle className="cw-dot-hit" cx={f1(x)} cy={f1(y)} r="14" />
            <circle className="cw-dot-ring" cx={f1(x)} cy={f1(y)} r="10" />
            <circle
              className={`cw-dot-face${never ? " is-never" : ""}`}
              cx={f1(x)}
              cy={f1(y)}
              r="6.5"
            />
          </>
        );
        return first ? (
          <g
            key={`d${a}`}
            className={`cw-dot${lock ? " is-locked" : ""}`}
            data-dot={key}
            tabIndex={lock ? -1 : 0}
            role="slider"
            aria-label={`${DIRECTION_NAME[key]}: stars taken off`}
            aria-valuemin={0}
            aria-valuemax={NEVER}
            aria-valuenow={off[key]}
            aria-valuetext={costLabel(off[key])}
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
            className={`cw-dot${lock ? " is-locked" : ""}`}
            data-dot={key}
            aria-hidden="true"
            onPointerDown={grab(key)}
          >
            {dot}
          </g>
        );
      })}
      <text className="cw-web-word" x="0" y="138" textAnchor="middle">
        ARROWS: THE WAY THE WIND BLOWS
      </text>
    </svg>
  );
}

/* ---- 4. upwind ---- */

/**
 * The three quick answers, in degrees into the wind past straight across it
 * (force5/src/rideWedge.ts `upwindOf`). The sliders and the picture's handles
 * fine-tune from there.
 */
const UP_ANSWERS = [
  {
    into: 0,
    name: "Not yet",
    line: "I can ride straight across the wind and hold my ground.",
  },
  { into: 5, name: "A little", line: "I gain a bit of ground on each tack." },
  { into: 20, name: "Yes", line: "I can work my way upwind." },
] as const;

/** How the summary says the two angles. */
const courseWords = (into: number, down: number) =>
  `${into ? `${into}° into the wind` : "straight across the wind"} · course to ${down ? `${down}° below across` : "straight across"}`;

/** The upwind picture's frame: the board at the middle, the wind from the top. */
const UP = { cx: 150, cy: 168, r: 118, vx: -36, vw: 372, vh: 310 };

/**
 * "Can you ride upwind?": the three answers across the top, then the picture
 * left and the two angles right. Degrees into the wind (counted from
 * straight across it) and degrees below across that the course runs to,
 * used in every wind and moving no star. The picture draws them as the
 * loupe will: the no-go hatched into the wind (CAN'T GO), the two courses
 * (RIDE), and past the course downwind DRIFT, where they lose ground; each
 * angle has a handle on the course's edge as well as its slider.
 */
function UpwindStep({ draft, setDraft }: StepProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const svg = useRef<SVGSVGElement>(null);
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
  const handle = (side: 1 | -1, kind: "into" | "down") => {
    const [x, y] = p(side * (kind === "into" ? up : deep), r);
    return (
      <g
        className={`cw-up-edge${kind === "down" ? " is-down" : ""}`}
        data-edge={`${kind}-${side > 0 ? "right" : "left"}`}
        onPointerDown={grab(kind)}
      >
        <circle cx={x} cy={y} r="16" className="cw-up-edge-hit" />
        <circle cx={x} cy={y} r="7" className="cw-up-edge-dot" />
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
          className="cw-up-angle"
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 ${side > 0 ? 0 : 1} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        />,
        <text
          key="id"
          className="cw-up-deg"
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
          className="cw-up-angle is-down"
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 ${side > 0 ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        />,
        <text
          key="dd"
          className="cw-up-deg is-down"
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
        className={`cw-lab is-strong${wide ? "" : " is-halo"}`}
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
      <Segmented<string>
        aria-label="Can you ride upwind?"
        className="cw-up-answers"
        options={UP_ANSWERS.map((a) => ({
          value: String(a.into),
          label: <span title={a.line}>{a.name}</span>,
        }))}
        value={answer ? String(answer.into) : ""}
        onChange={(value) => setDraft(withUpwind(draft, Number(value)))}
      />
      <div className="cw-up">
        <svg
          ref={svg}
          className="cw-up-pic"
          viewBox={`${UP.vx} 0 ${UP.vw} ${UP.vh}`}
          aria-hidden="true"
        >
          <defs>
            <pattern
              id={`${id}h`}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line className="cw-hatch" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>
          <circle className="cw-up-face" cx={cx} cy={cy} r={r} />
          <path
            className="cw-up-nogo"
            d={sector(-up, up, r)}
            style={{ fill: `url(#${id}h)` }}
          />
          {deep - up > 0.5 ? (
            <>
              <path className="cw-up-course" d={sector(up, deep, r)} />
              <path className="cw-up-course" d={sector(-deep, -up, r)} />
            </>
          ) : (
            <path
              className="cw-up-course"
              d={`M${cx} ${cy}L${xy(up, r)}M${cx} ${cy}L${xy(-up, r)}`}
            />
          )}
          <path className="cw-up-drift" d={sector(deep, 360 - deep, r)} />
          <line
            className="cw-up-across"
            x1={cx - r - 8}
            x2={cx + r + 8}
            y1={cy}
            y2={cy}
          />
          <text className="cw-lab" x={cx + r + 10} y={cy + 3}>
            ACROSS
          </text>
          <text className="cw-lab" x={cx - r - 10} y={cy + 3} textAnchor="end">
            ACROSS
          </text>
          <text
            className="cw-lab is-strong"
            x={cx}
            y={cy - r * 0.5}
            textAnchor="middle"
          >
            CAN&rsquo;T GO
          </text>
          {rideLabel(1)}
          {rideLabel(-1)}
          <text
            className="cw-lab is-strong"
            x={cx}
            y={cy + r * 0.55}
            textAnchor="middle"
          >
            DRIFT
          </text>
          <text
            className="cw-lab"
            x={cx}
            y={cy + r * 0.55 + 12}
            textAnchor="middle"
          >
            YOU LOSE GROUND
          </text>
          {angle(1)}
          {angle(-1)}
          <path className="cw-up-wind" d={`M${cx} 6V${cy - r - 12}`} />
          <path
            className="cw-up-wind-head"
            d={`M${cx - 6} ${cy - r - 14}L${cx + 6} ${cy - r - 14}L${cx} ${cy - r - 3}Z`}
          />
          <text className="cw-lab is-strong" x={cx + 10} y="18">
            WIND
          </text>
          <path
            className="cw-up-board"
            d={`M${cx} ${cy - 12}C${cx + 5} ${cy - 4} ${cx + 5} ${cy + 8} ${cx} ${cy + 12}C${cx - 5} ${cy + 8} ${cx - 5} ${cy - 4} ${cx} ${cy - 12}Z`}
          />
          {handle(1, "down")}
          {handle(-1, "down")}
          {handle(1, "into")}
          {handle(-1, "into")}
        </svg>
        <div className="cw-angles">
          <div>
            <div className="cw-into" data-upwind>
              <output>{into}°</output>
              <span>into the wind</span>
            </div>
            <AngleSlider
              value={into}
              max={UPWIND_MAX}
              label="Degrees into the wind"
              words={(v) =>
                v ? `${v}° into the wind` : "straight across the wind"
              }
              from="Straight across"
              to={`${UPWIND_MAX}° into it`}
              onChange={(deg) => setDraft(withUpwind(draft, deg))}
            />
          </div>
          <div>
            <div className="cw-into" data-downwind>
              <output>{down}°</output>
              <span>below across</span>
            </div>
            <AngleSlider
              value={down}
              max={DOWNWIND_MAX}
              second
              label="Degrees below straight across"
              words={(v) =>
                v ? `${v}° below straight across` : "straight across"
              }
              from="Straight across"
              to={`${DOWNWIND_MAX}° downwind`}
              onChange={(deg) => setDraft(withDownwind(draft, deg))}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** Degrees, 0 to `max`: dragged, or a degree at a time from the keyboard. */
function AngleSlider({
  value,
  max,
  label,
  words,
  from,
  to,
  second = false,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  words: (value: number) => string;
  from: string;
  to: string;
  /** The course's downwind edge: a hollow knob, as its handle in the picture. */
  second?: boolean;
  onChange: (deg: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return ((clientX - box.left) / box.width) * max;
  };
  const left = `${(value / max) * 100}%`;
  return (
    <div className={`cw-slide${second ? " is-second" : ""}`}>
      <div
        className="cw-slide-track"
        ref={track}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onChange(at(event.clientX));
          (
            event.currentTarget.querySelector("[role=slider]") as HTMLElement
          ).focus();
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            onChange(at(event.clientX));
        }}
      >
        <i className="cw-slide-fill" style={{ width: left }} />
        <span
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={words(value)}
          className="cw-slide-knob"
          style={{ left }}
          onKeyDown={(event) => {
            const by = (
              {
                ArrowLeft: -1,
                ArrowDown: -1,
                ArrowRight: 1,
                ArrowUp: 1,
                PageDown: -5,
                PageUp: 5,
                Home: -max,
                End: max,
              } as Record<string, number>
            )[event.key];
            if (!by) return;
            event.preventDefault();
            onChange(value + by);
          }}
        />
      </div>
      <div className="cw-slide-ends">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

/* ---- 5. the rider's spots ---- */

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** How many places the list shows. */
const LISTED = 9;

/**
 * The places nearest where the map is (or, once asked, the rider), with a
 * star each. The list keeps its order as they are starred: nothing jumps
 * under a finger, and the red star in the row says it all. "Use my location"
 * asks the browser, once.
 */
function SpotsStep({
  draft,
  setDraft,
  spots,
  centre,
  here,
  setHere,
}: StepProps & {
  spots: readonly Spot[];
  centre: Origin | null;
  here: Here;
  setHere: (here: Here) => void;
}) {
  const [query, setQuery] = useState("");
  const [nearMe, setNearMe] = useState(typeof here === "object" && !!here);
  const me = here && typeof here === "object" ? here : null;
  const origin = nearMe && me ? me : centre;
  const q = fold(query.trim());
  const list: { place: Spot; km: number | null }[] = q
    ? spots
        .filter(
          (s) => fold(s.name).includes(q) || fold(s.county ?? "").startsWith(q),
        )
        .slice(0, LISTED)
        .map((place) => ({ place, km: null }))
    : origin
      ? nearest(spots, origin, LISTED)
      : [...spots]
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, LISTED)
          .map((place) => ({ place, km: null }));
  const centreName =
    centre && !nearMe ? nearest(spots, centre, 1)[0]?.place.name : null;
  const canAsk = typeof navigator !== "undefined" && "geolocation" in navigator;
  const useMine = () => {
    if (me) return setNearMe(true);
    setHere("asking");
    navigator.geolocation.getCurrentPosition(
      (at) => {
        setHere({ lat: at.coords.latitude, lng: at.coords.longitude });
        setNearMe(true);
      },
      () => setHere("refused"),
      { maximumAge: 600000, timeout: 20000 },
    );
  };
  const toggle = (id: string) =>
    setDraft({
      ...draft,
      starred: draft.starred.includes(id)
        ? draft.starred.filter((s) => s !== id)
        : [id, ...draft.starred],
    });
  return (
    <div className="cw-spots">
      <SearchField
        size="md"
        shape="pill"
        aria-label="Find a spot"
        placeholder="Find a spot by name or county"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="cw-near">
        <span className="cw-kick" data-near>
          {q
            ? "Matches"
            : nearMe && me
              ? "Nearest to you"
              : centreName
                ? `Nearest to where the map is · ${centreName}`
                : "Spots"}
        </span>
        {!q &&
          (nearMe ? (
            <Button
              variant="link"
              size="sm"
              className="cw-link"
              onClick={() => setNearMe(false)}
            >
              Use the map instead
            </Button>
          ) : canAsk && here !== "refused" ? (
            <Button
              variant="link"
              size="sm"
              className="cw-link"
              disabled={here === "asking"}
              onClick={useMine}
            >
              {here === "asking" ? "Finding you…" : "Use my location"}
            </Button>
          ) : null)}
      </div>
      {here === "refused" && !q && (
        <p className="cw-note">
          Your browser didn&rsquo;t share your location.
        </p>
      )}
      <ul className="cw-spot-list">
        {list.map(({ place, km }) => (
          <li key={place.id}>
            <StarToggle
              on={draft.starred.includes(place.id)}
              name={place.name}
              onToggle={() => toggle(place.id)}
              size={20}
            />
            <span className="cw-spot-name">
              <b>{place.name}</b>
              {place.county && <small>{place.county}</small>}
            </span>
            <span className="cw-km">
              {km === null ? "" : `${Math.round(km)} km`}
            </span>
          </li>
        ))}
        {!list.length && <li className="cw-note">No spot by that name.</li>}
      </ul>
    </div>
  );
}

/* ---- 6. all set ---- */

function Done({
  draft,
  unit,
  day,
  rider,
  byId,
  onChange,
}: {
  draft: Draft;
  unit: UnitScale;
  day: SampleDay | null;
  rider: DraftRider;
  byId: ReadonlyMap<string, Spot>;
  onChange: (step: CustomiseStep) => void;
}) {
  const w = draft.custom.wind;
  const off = draft.custom.direction;
  const costs = SHORE_ORDER.filter((key) => off[key] > 0);
  const rows: [string, CustomiseStep, ReactNode][] = [
    [
      "You",
      "you",
      <>
        {draft.weightKg ?? 80} kg · {unit.label.toLowerCase()}
      </>,
    ],
    [
      "Wind",
      "wind",
      <>
        {span(w.min, w.max, unit)}
        {unit.force ? "" : ` ${unit.label}`} · best{" "}
        {span(w.sweetLow, w.sweetHigh, unit)}
        {differsFromOurs({ ...draft, upwind: 0, downwind: 10 })
          ? ""
          : " · ours"}
      </>,
    ],
    [
      "Shore",
      "shore",
      costs.map((key, i) => (
        <span key={key}>
          {i ? " · " : ""}
          <span className={off[key] >= NEVER ? "is-never" : undefined}>
            {DIRECTION_NAME[key].toLowerCase()} {costLabel(off[key])}
          </span>
        </span>
      )),
    ],
    ["Upwind", "upwind", courseWords(draft.upwind, draft.downwind)],
    [
      "Spots",
      "spots",
      draft.starred
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(", ") || "none yet",
    ],
  ];
  return (
    <>
      <ul className="cw-sum">
        {rows.map(([name, step, value]) => (
          <li key={name} data-sum={step}>
            <span className="cw-kick">{name}</span>
            <span className="cw-val">{value}</span>
            <Button
              variant="link"
              size="sm"
              className="cw-link"
              aria-label={`Change ${name.toLowerCase()}`}
              onClick={() => onChange(step)}
            >
              Change
            </Button>
          </li>
        ))}
      </ul>
      <SampleDayCard day={day} rider={rider} unit={unit} />
    </>
  );
}
