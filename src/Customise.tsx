/**
 * "Customise": the site menu's first row, a wizard that walks a rider through
 * the settings the stars are rated on, as the owner saw it in the mockup
 * (wingfoil-mockups/customise-wizard): their level, their wind and gusts on a
 * real day re-rated as they drag, the winds they will ride each way round the
 * beach, how high they point, their units, their spots, and the lot together.
 *
 * Its own chunk, fetched when it is opened. It edits a draft and saves it on
 * the last step through src/customiseDraft.ts, into the preferences Display
 * options and "Your star rating" write: closing it any other way keeps
 * nothing.
 */
import "./customise.css";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Prefs } from "../force5/src/prefs";
import { upwindAngle } from "../force5/src/rideWedge";
import {
  DIRECTION_KEYS,
  POINTINGS,
  POINTING_LABEL,
  SKILLS,
  SKILL_LABEL,
  rateHour,
  shoreAngle,
  type DirectionKey,
  type Pointing,
  type Skill,
} from "../force5/src/stars";
import { UNITS, type Units } from "../force5/src/units";
import { compass, type Spot } from "../force5/src/weather";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Puffin } from "../ui/Puffin";
import { SearchField } from "../ui/SearchField";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import { framePath, hand } from "../ui/penPaths";
import {
  GUST_TOP,
  WIND_KEYS,
  WIND_TOP,
  knotsOf,
  moveGust,
  moveWind,
  shown,
  stepped,
  unitScale,
  type UnitScale,
} from "../spot/web/yourStars";
import {
  NEXT_SHORE,
  applyDraft,
  draftOf,
  draftRider,
  lessOff,
  levelRating,
  rateSample,
  sampleBest,
  sampleDay,
  shoreChoice,
  shoreLocked,
  spotChanges,
  starsOff,
  withLevel,
  withShore,
  type Draft,
  type SampleDay,
  type ShoreChoice,
} from "./customiseDraft";
import { StarToggle } from "./glyphs";
import type { PlaceHour } from "./ratings";
import { clock, dayLong } from "./strip";

const STEPS = [
  {
    id: "level",
    short: "Level",
    title: "How do you ride?",
    say: "Be honest. The stars are only as good as this; everything else follows from it.",
  },
  {
    id: "wind",
    short: "Wind",
    title: "Your wind",
    say: "Drag the handles. Watch {day}'s stars move.",
  },
  {
    id: "shore",
    short: "Shore",
    title: "Which winds will you ride?",
    say: "Tap the wedges. Red is the wind that carries you out.",
  },
  {
    id: "pointing",
    short: "Pointing",
    title: "How high do you point?",
    say: "This only moves the loupe. It never moves a star.",
  },
  {
    id: "units",
    short: "Units",
    title: "Your units",
    say: "Knots, unless you're told otherwise.",
  },
  {
    id: "spots",
    short: "Spots",
    title: "Your home spots",
    say: "Star the beaches you ride. They're kept in Your spots.",
  },
  {
    id: "summary",
    short: "Done",
    title: "Here’s what we’ll show you",
    say: "",
  },
] as const;
export type CustomiseStep = (typeof STEPS)[number]["id"];

const LEVEL_LINE: Record<Skill, string> = {
  beginner: "Still finding the foil. You want the wind bringing you home.",
  intermediate: "Up, riding both ways, starting to gybe.",
  advanced: "Pumping light days, holding down the big ones.",
};
const DIRECTION_NAME: Record<DirectionKey, string> = {
  onshore: "Onshore",
  crossOn: "Cross-onshore",
  cross: "Cross-shore",
  crossOff: "Cross-offshore",
  offshore: "Offshore",
};
const DIRECTION_SHORT: Record<DirectionKey, string> = {
  onshore: "On",
  crossOn: "X-on",
  cross: "Cross",
  crossOff: "X-off",
  offshore: "Off",
};
const DIRECTION_LINE: Record<DirectionKey, string> = {
  onshore: "Slow to get out through the chop.",
  crossOn: "Brings you home. The kind one.",
  cross: "Runs along the beach.",
  crossOff: "A drift takes you out, not in.",
  offshore: "Carries you out to sea if you fall.",
};
const OF_ANGLE = {
  onshore: "onshore",
  "cross-on": "crossOn",
  cross: "cross",
  "cross-off": "crossOff",
  offshore: "offshore",
} as const;

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
  /** The chart's centre, which "Your spots" lists the nearest places to. */
  centre: { lat: number; lng: number } | null;
  onClose: () => void;
  /** The preferences to save, and the spots to star or unstar. */
  onSave: (prefs: Prefs, toggle: string[]) => void;
}

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
  const byId = useMemo(
    () => new Map(spots.map((s) => [s.id, s] as const)),
    [spots],
  );
  // The day is chosen once, as the wizard opens: the hours it shows stay put while the rider drags.
  const [day] = useState(() => sampleDay(hours, times, byId, prefer));
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  const go = (to: number) => {
    setAt(to);
    body.current?.scrollTo({ top: 0 });
  };
  const body = useRef<HTMLDivElement>(null);
  const rider = draftRider(draft, prefs.rider);
  const unit = unitScale(draft.units);
  const dayName = day ? dayLong(day.hours[0].time) : "";
  const save = () => {
    onSave(applyDraft(prefs, draft), spotChanges(starred, draft.starred));
  };

  return (
    <Dialog
      open={open}
      size="wide"
      title="Customise your chart"
      className="cw"
      onClose={onClose}
      actions={
        <div className="cw-foot">
          {last ? (
            <span className="cw-kick">All set</span>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Skip for now
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
      <div className="cw-head">
        <div className="cw-kick">
          <span>Step</span>{" "}
          <b>
            {at + 1} of {STEPS.length}
          </b>
        </div>
        <ol
          className="cw-scale"
          aria-label={`Step ${at + 1} of ${STEPS.length}`}
        >
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={i < at ? "is-done" : i === at ? "is-here" : ""}
            >
              <Button
                variant="quiet"
                className="cw-tick"
                aria-current={i === at ? "step" : undefined}
                onClick={() => go(i)}
              >
                <i aria-hidden="true" />
                {s.short}
              </Button>
            </li>
          ))}
        </ol>
      </div>
      <div className="cw-body" ref={body} data-step={step.id}>
        <h3 className="cw-title">{step.title}</h3>
        {step.say && (
          <div className="cw-alm">
            <Puffin size={48} bob />
            <p>
              <b>The Almanac</b>
              {step.say.replace("{day}", dayName || "the day")}
            </p>
          </div>
        )}
        {step.id === "level" && (
          <LevelStep draft={draft} setDraft={setDraft} unit={unit} />
        )}
        {step.id === "wind" && (
          <WindStep
            draft={draft}
            setDraft={setDraft}
            unit={unit}
            day={day}
            rider={rider}
          />
        )}
        {step.id === "shore" && (
          <ShoreStep draft={draft} setDraft={setDraft} unit={unit} day={day} />
        )}
        {step.id === "pointing" && (
          <PointingStep draft={draft} setDraft={setDraft} />
        )}
        {step.id === "units" && (
          <UnitsStep draft={draft} setDraft={setDraft} day={day} />
        )}
        {step.id === "spots" && (
          <SpotsStep
            draft={draft}
            setDraft={setDraft}
            spots={spots}
            hours={hours}
            times={times}
            day={day}
            centre={centre}
            rider={rider}
          />
        )}
        {step.id === "summary" && (
          <Summary
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
const band = (draft: Draft, unit: UnitScale) => {
  const w = draft.custom.wind;
  return `${shown(w.min, unit)}–${shown(w.max, unit)} ${unit.label} · sweet ${shown(w.sweetLow, unit)}–${shown(w.sweetHigh, unit)}`;
};

/* ---- 1. the level ---- */

function LevelStep({ draft, setDraft, unit }: StepProps & { unit: UnitScale }) {
  const weight = draft.weightKg ?? 80;
  return (
    <>
      <div className="cw-levels" role="group" aria-label="Riding level">
        {SKILLS.map((skill) => {
          const w = levelRating(skill, draft.weightKg).wind;
          return (
            <Button
              key={skill}
              variant="quiet"
              className="cw-level"
              pressed={draft.skill === skill}
              onClick={() => setDraft(withLevel(draft, skill, draft.weightKg))}
            >
              <MiniRose
                upwind={upwindAngle({ weightKg: null, wings: [], skill })}
              />
              <span className="cw-level-words">
                <b>{SKILL_LABEL[skill]}</b>
                <span>{LEVEL_LINE[skill]}</span>
              </span>
              <span className="cw-level-band">
                {shown(w.min, unit)}–{shown(w.max, unit)}
                <small>
                  {unit.label} · sweet {shown(w.sweetLow, unit)}–
                  {shown(w.sweetHigh, unit)}
                </small>
              </span>
            </Button>
          );
        })}
      </div>
      <div className="cw-weight">
        <span className="cw-kick">Your weight</span>
        <span className="cw-stepper">
          <Button
            variant="pill"
            size="sm"
            icon
            aria-label="Lighter"
            onClick={() =>
              setDraft(withLevel(draft, draft.skill, Math.max(40, weight - 5)))
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
              setDraft(withLevel(draft, draft.skill, Math.min(140, weight + 5)))
            }
          >
            +
          </Button>
        </span>
        <span className="cw-small">
          {draft.weightKg === null ? "A guess until you set it. " : ""}Heavier
          needs more wind.
        </span>
      </div>
    </>
  );
}

/** A rose with the level's no-go hatched: how high it points, at a glance. */
function MiniRose({ upwind }: { upwind: number }) {
  const c = 22;
  const R = 18;
  const p = (a: number, r: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(c + Math.cos(t) * r).toFixed(1)} ${(c + Math.sin(t) * r).toFixed(1)}`;
  };
  return (
    <svg
      className="cw-minirose"
      width="44"
      height="44"
      viewBox="0 0 44 44"
      aria-hidden="true"
    >
      <path
        className="cw-nogo"
        d={`M${c} ${c}L${p(-upwind, R)}A${R} ${R} 0 0 1 ${p(upwind, R)}Z`}
      />
      <path
        className="cw-tack"
        d={`M${c} ${c}L${p(upwind, R * 0.9)}A${R * 0.9} ${R * 0.9} 0 0 1 ${p(105, R * 0.9)}Z`}
      />
      <path
        className="cw-tack is-home"
        d={`M${c} ${c}L${p(-105, R * 0.9)}A${R * 0.9} ${R * 0.9} 0 0 1 ${p(-upwind, R * 0.9)}Z`}
      />
      <circle className="cw-rim" cx={c} cy={c} r={R} />
    </svg>
  );
}

/* ---- 2. the wind and the gusts ---- */

/** A real day at a real spot, rated for the draft: the stars move as the rider drags. */
function Preview({
  day,
  rider,
  unit,
}: {
  day: SampleDay | null;
  rider: ReturnType<typeof draftRider>;
  unit: UnitScale;
}) {
  const before = useRef<number[]>([]);
  const ratings = day ? rateSample(day, rider) : [];
  const stars = ratings.map((r) => r.stars);
  const was = before.current;
  // Nine hours across a phone leave each one a finger's width: smaller stars.
  const small = window.matchMedia("(max-width: 719px)").matches;
  useEffect(() => {
    before.current = stars;
  });
  if (!day)
    return <p className="cw-small">No forecast in hand yet to try it on.</p>;
  const best = Math.max(...stars);
  return (
    <div className="cw-preview" data-preview>
      <div className="cw-preview-h">
        <span className="cw-kick">
          ★ {dayLong(day.hours[0].time)} at {day.spot.name}, for you
        </span>
        <span className="cw-kick" data-best>
          {best ? `best ${best}★` : "no stars"}
        </span>
      </div>
      <div className="cw-preview-hours">
        {day.hours.map((hour, i) => (
          <div
            // Keyed on the stars too, so each change draws in again.
            key={`${hour.time}-${stars[i]}`}
            className={
              was.length && was[i] !== stars[i] ? "is-changed" : undefined
            }
          >
            <span className="cw-t">{clock(hour.time).slice(0, 2)}</span>
            <span className="cw-w">
              {shown(hour.windKn, unit)}
              {hour.gustKn !== null && <sup>{shown(hour.gustKn, unit)}</sup>}
            </span>
            <StarGlyphs
              stars={stars[i]}
              potential={ratings[i].potential}
              size={small ? 5 : 8}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function WindStep({
  draft,
  setDraft,
  unit,
  day,
  rider,
}: StepProps & {
  unit: UnitScale;
  day: SampleDay | null;
  rider: ReturnType<typeof draftRider>;
}) {
  const w = draft.custom.wind;
  const g = draft.custom.gust;
  const id = useId().replace(/[^\w-]/g, "");
  const set = (custom: Draft["custom"]) => setDraft({ ...draft, custom });
  const most = [1, 2, 3].includes(g.most)
    ? [1, 2, 3]
    : [1, 2, 3, g.most].sort();
  return (
    <>
      <Preview day={day} rider={rider} unit={unit} />
      <section className="cw-tool">
        <div className="cw-tool-h">
          <h4>Your wind band</h4>
          <span className="cw-fig">{band(draft, unit)}</span>
        </div>
        <Range
          min={0}
          max={WIND_TOP}
          values={WIND_KEYS.map((k) => w[k])}
          names={[
            "Too light below",
            "Sweet spot from",
            "Sweet spot to",
            "Too much above",
          ]}
          dark={[1, 2]}
          unit={unit}
          onMove={(i, kn) => set(moveWind(draft.custom, WIND_KEYS[i], kn))}
          paint={(x, width) => (
            <>
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
                <linearGradient id={`${id}r`}>
                  {[0, 5, 9, 10, 15, 20, 25, 30, 35, 40].map((k) => (
                    <stop
                      key={k}
                      offset={k / 40}
                      style={{
                        stopColor: `var(--color-wind-k${String(k).padStart(2, "0")})`,
                      }}
                    />
                  ))}
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="40"
                width={width}
                height="10"
                fill={`url(#${id}h)`}
                className="cw-bar"
              />
              <rect
                x={x(w.min)}
                y="40"
                width={x(w.max) - x(w.min)}
                height="10"
                className="cw-bar-on"
              />
              <rect
                x={x(w.sweetLow)}
                y="40"
                width={x(w.sweetHigh) - x(w.sweetLow)}
                height="10"
                className="cw-bar-sweet"
              />
              <rect
                x="0"
                y="40"
                width={width}
                height="10"
                className="cw-bar-edge"
              />
              <rect
                x="0"
                y="60"
                width={width}
                height="6"
                fill={`url(#${id}r)`}
                className="cw-ramp"
              />
              <text
                className="cw-lab is-strong"
                x={(x(w.sweetLow) + x(w.sweetHigh)) / 2}
                y="28"
                textAnchor="middle"
              >
                SWEET
              </text>
              {x(w.min) > 60 && (
                <text
                  className="cw-lab"
                  x={x(w.min) - 6}
                  y="28"
                  textAnchor="end"
                >
                  FOILING
                </text>
              )}
              {width - x(w.max) > 70 && (
                <text className="cw-lab" x={x(w.max) + 6} y="28">
                  TOO MUCH
                </text>
              )}
              <Ticks x={x} from={0} to={WIND_TOP} unit={unit} />
            </>
          )}
        />
        <div className="cw-zones">
          <span>
            <i className="is-light" />
            Too light
          </span>
          <span>
            <i className="is-on" />
            Building · overpowered
          </span>
          <span>
            <i className="is-sweet" />
            <b>Sweet spot</b>
          </span>
        </div>
      </section>
      <section className="cw-tool">
        <div className="cw-tool-h">
          <h4>Gusts</h4>
          <span className="cw-fig">
            fine to {shown(g.fine, unit)} · −{g.most}★ by {shown(g.worst, unit)}{" "}
            {unit.label}
          </span>
        </div>
        <div className="cw-gust">
          <GustTrace day={day} fine={g.fine} unit={unit} />
          <div>
            <Range
              min={10}
              max={GUST_TOP}
              values={[g.fine, g.worst]}
              names={["Gusts cost nothing to", "Gusts take off the most from"]}
              unit={unit}
              onMove={(i, kn) =>
                set(moveGust(draft.custom, i ? "worst" : "fine", kn))
              }
              paint={(x, width) => (
                <>
                  <defs>
                    <linearGradient id={`${id}g`}>
                      <stop
                        offset="0"
                        style={{ stopColor: "var(--color-ground)" }}
                      />
                      <stop
                        offset="1"
                        style={{ stopColor: "var(--color-gust)" }}
                      />
                    </linearGradient>
                  </defs>
                  <rect
                    x="0"
                    y="40"
                    width={x(g.fine)}
                    height="10"
                    className="cw-bar-calm"
                  />
                  <rect
                    x={x(g.fine)}
                    y="40"
                    width={Math.max(0, x(g.worst) - x(g.fine))}
                    height="10"
                    fill={`url(#${id}g)`}
                  />
                  <rect
                    x={x(g.worst)}
                    y="40"
                    width={Math.max(0, width - x(g.worst))}
                    height="10"
                    className="cw-bar-gust"
                  />
                  <rect
                    x="0"
                    y="40"
                    width={width}
                    height="10"
                    className="cw-bar-edge"
                  />
                  {x(g.fine) > 90 && (
                    <text
                      className="cw-lab is-strong"
                      x={x(g.fine) / 2}
                      y="28"
                      textAnchor="middle"
                    >
                      COSTS NOTHING
                    </text>
                  )}
                  <text
                    className="cw-lab"
                    x={(x(g.worst) + width) / 2}
                    y="28"
                    textAnchor="middle"
                  >
                    −{g.most}★
                  </text>
                  <Ticks x={x} from={10} to={GUST_TOP} unit={unit} />
                </>
              )}
            />
            <div className="cw-most">
              <span className="cw-kick">At their worst they cost</span>
              <Segmented<string>
                aria-label="At their worst the gusts cost"
                options={most.map((m) => ({
                  value: String(m),
                  label: `${m} ★`,
                }))}
                value={String(g.most)}
                onChange={(m) =>
                  set({ ...draft.custom, gust: { ...g, most: Number(m) } })
                }
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The scale's figures: every five knots, in the rider's unit. */
function Ticks({
  x,
  from,
  to,
  unit,
}: {
  x: (kn: number) => number;
  from: number;
  to: number;
  unit: UnitScale;
}) {
  const out: ReactNode[] = [];
  for (let kn = from; kn <= to; kn += 5)
    out.push(
      <g key={kn}>
        <line
          className="cw-tick-line"
          x1={x(kn)}
          x2={x(kn)}
          y1="74"
          y2={kn % 10 ? 78 : 80}
        />
        <text
          className="cw-tick-fig"
          x={x(kn)}
          y="91"
          textAnchor={kn === to ? "end" : "middle"}
        >
          {Math.round(Number(shown(kn, unit)))}
          {kn === to ? ` ${unit.label}` : ""}
        </text>
      </g>,
    );
  return <>{out}</>;
}

/**
 * Handles on a scale in knots, shown in the rider's unit: dragged, or moved
 * a step at a time from the keyboard. Where they may go is the caller's
 * (yourStars.ts `moveWind`, `moveGust`), which keeps them a knot apart.
 */
function Range({
  min,
  max,
  values,
  names,
  dark = [],
  unit,
  onMove,
  paint,
}: {
  min: number;
  max: number;
  values: number[];
  names: string[];
  dark?: number[];
  unit: UnitScale;
  onMove: (i: number, kn: number) => void;
  paint: (x: (kn: number) => number, width: number) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = host.current!;
    const seen = new ResizeObserver(() => setWidth(el.clientWidth));
    seen.observe(el);
    setWidth(el.clientWidth);
    return () => seen.disconnect();
  }, []);
  const x = (kn: number) => ((kn - min) / (max - min)) * width;
  const at = (clientX: number) => {
    const box = host.current!.getBoundingClientRect();
    return min + ((clientX - box.left) / box.width) * (max - min);
  };
  return (
    <div className="cw-range" ref={host}>
      <svg width={width} height="96" aria-hidden="true">
        {width > 0 && paint(x, width)}
      </svg>
      {values.map((v, i) => (
        <span
          key={i}
          role="slider"
          tabIndex={0}
          aria-label={names[i]}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={v}
          aria-valuetext={`${shown(v, unit)} ${unit.label}`}
          className={`cw-knob${dark.includes(i) ? " is-dark" : ""}`}
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
          {shown(v, unit)}
        </span>
      ))}
    </div>
  );
}

/**
 * The gustiest hour of the day, drawn as a minute-by-minute trace over its
 * mean: what rises past the rider's line is in the gust's own orange.
 */
function GustTrace({
  day,
  fine,
  unit,
}: {
  day: SampleDay | null;
  fine: number;
  unit: UnitScale;
}) {
  const id = useId().replace(/[^\w-]/g, "");
  const hour = day
    ? day.hours.reduce((a, b) => ((b.gustKn ?? 0) > (a.gustKn ?? 0) ? b : a))
    : { time: 0, windKn: 16, gustKn: 25, from: null };
  const gust = hour.gustKn ?? hour.windKn;
  const top = Math.max(34, gust + 6, fine + 6);
  const y = (kn: number) => 112 - (kn / top) * 100;
  const rnd = hand(21);
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const spike =
      rnd() > 0.8 ? (gust - hour.windKn) * (0.75 + rnd() * 0.3) : rnd() * 3;
    d += `${i ? "L" : "M"}${(12 + (i / 60) * 220).toFixed(1)} ${y(hour.windKn - 2 + rnd() * 2 + spike).toFixed(1)}`;
  }
  return (
    <svg className="cw-gust-trace" viewBox="0 0 240 130" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <rect x="0" y="0" width="240" height={Math.max(0, y(fine))} />
        </clipPath>
      </defs>
      <path
        className="cw-over"
        clipPath={`url(#${id}c)`}
        d={`${d}L232 112L12 112Z`}
      />
      <line
        className="cw-mean"
        x1="12"
        x2="232"
        y1={y(hour.windKn)}
        y2={y(hour.windKn)}
      />
      <line className="cw-line" x1="12" x2="232" y1={y(fine)} y2={y(fine)} />
      <path className="cw-trace" d={d} />
      <line className="cw-base" x1="12" x2="232" y1="112" y2="112" />
      <text x="14" y={y(hour.windKn) + 11}>
        MEAN {shown(hour.windKn, unit)}
      </text>
      <text x="230" y={y(fine) - 4} textAnchor="end">
        YOUR LINE {shown(fine, unit)}
      </text>
      {day && (
        <text x="14" y="125">
          {clock(hour.time)} ·{" "}
          {hour.gustKn === null
            ? "NO GUST IN THIS FORECAST"
            : `GUSTS ${shown(gust, unit)} ${unit.label.toUpperCase()}`}
        </text>
      )}
    </svg>
  );
}

/* ---- 3. the shore ---- */

/** The wedges the wind comes from, in degrees round from straight out to sea. */
const WEDGES: [number, number, DirectionKey][] = [
  [-30, 30, "onshore"],
  [30, 70, "crossOn"],
  [70, 110, "cross"],
  [110, 150, "crossOff"],
  [150, 210, "offshore"],
  [-70, -30, "crossOn"],
  [-110, -70, "cross"],
  [-150, -110, "crossOff"],
];

function ShoreStep({
  draft,
  setDraft,
  unit,
  day,
}: StepProps & { unit: UnitScale; day: SampleDay | null }) {
  const id = useId().replace(/[^\w-]/g, "");
  const choice = (key: DirectionKey) =>
    shoreChoice(draft.custom.direction[key]);
  const cx = 150;
  const cy = 165;
  const R0 = 40;
  const R1 = 118;
  const pt = (a: number, r: number): [number, number] => {
    const t = ((a - 90) * Math.PI) / 180;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  };
  const wedge = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0, R1);
    const [x1, y1] = pt(a1, R1);
    const [x2, y2] = pt(a1, R0);
    const [x3, y3] = pt(a0, R0);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R1} ${R1} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}A${R0} ${R0} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)}Z`;
  };
  // Midday on the day the wizard shows: how this shore takes it.
  const noon = day?.hours[Math.floor(day.hours.length / 2)];
  const today =
    noon && noon.from !== null && day!.spot.facing !== null
      ? OF_ANGLE[shoreAngle(noon.from, day!.spot.facing)]
      : null;
  return (
    <div className="cw-shore">
      <svg
        className="cw-beach"
        viewBox="0 0 300 300"
        role="group"
        aria-label="Wind directions round the beach"
      >
        <defs>
          <marker
            id={`${id}m`}
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0L8 4L0 8Z" fill="context-stroke" />
          </marker>
          <pattern
            id={`${id}h`}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line className="cw-hatch" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>
        <rect className="cw-land" x="0" y={cy} width="300" height={300 - cy} />
        <rect className="cw-sea" x="0" y="0" width="300" height={cy} />
        <path
          className="cw-shoreline"
          d={`M0 ${cy}C60 ${cy - 4} 110 ${cy + 3} 150 ${cy}S250 ${cy - 3} 300 ${cy + 2}`}
        />
        <text className="cw-lab" x="8" y="16">
          SEA
        </text>
        <text className="cw-lab" x="8" y="292">
          LAND
        </text>
        {WEDGES.map(([a0, a1, key]) => {
          const mid = (a0 + a1) / 2;
          const state = choice(key);
          const [ax, ay] = pt(mid, R1 + 14);
          const [bx, by] = pt(mid, R1 - 4);
          const [lx, ly] = pt(mid, (R0 + R1) / 2);
          const locked = shoreLocked(draft.skill, key);
          return (
            <g key={a0}>
              <path
                className={`cw-wedge is-${state}${key === "offshore" || key === "crossOff" ? " is-danger" : ""}`}
                style={state === "less" ? { fill: `url(#${id}h)` } : undefined}
                d={wedge(a0, a1)}
                data-wedge={key}
                onClick={() =>
                  !locked && setDraft(withShore(draft, key, NEXT_SHORE[state]))
                }
              >
                <title>{DIRECTION_NAME[key]}</title>
              </path>
              <path
                className={`cw-arrow${key === "offshore" ? " is-off" : ""}`}
                d={`M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`}
                markerEnd={`url(#${id}m)`}
              />
              <text
                className={`cw-lab${key === "offshore" ? " is-warn" : ""}`}
                x={lx}
                y={ly + 3}
                textAnchor="middle"
              >
                {DIRECTION_SHORT[key]}
                {state === "never" ? " ✕" : state === "ride" ? " ✓" : ""}
              </text>
            </g>
          );
        })}
        <text className="cw-beach-name" x={cx} y={cy + 24} textAnchor="middle">
          your beach
        </text>
      </svg>
      <div>
        <div className="cw-angles">
          {DIRECTION_KEYS.map((key) => {
            const locked = shoreLocked(draft.skill, key);
            const danger =
              key === "offshore" ||
              (draft.skill === "beginner" && key === "crossOff");
            const less = lessOff(draft, key);
            return (
              <div className="cw-angle" key={key} data-direction={key}>
                <span className="cw-angle-words">
                  <b>{DIRECTION_NAME[key]}</b>
                  <span className={danger ? "is-warn" : undefined}>
                    {DIRECTION_LINE[key]}
                    {locked ? " Never for a learner." : ""}
                  </span>
                </span>
                {locked ? (
                  <span className="cw-lock">Never</span>
                ) : (
                  <Segmented<ShoreChoice>
                    aria-label={DIRECTION_NAME[key]}
                    className={
                      key === "offshore" || key === "crossOff"
                        ? "cw-seg-danger"
                        : undefined
                    }
                    options={[
                      { value: "ride", label: "Ride" },
                      { value: "less", label: `${starsOff(less)}★` },
                      { value: "never", label: "Never" },
                    ]}
                    value={choice(key)}
                    onChange={(next) => setDraft(withShore(draft, key, next))}
                  />
                )}
              </div>
            );
          })}
        </div>
        {noon && today && (
          <p className="cw-today">
            {dayLong(noon.time)} at {day!.spot.name}:{" "}
            <b>
              {compass(noon.from!)} {shown(noon.windKn, unit)}
            </b>
            , {DIRECTION_NAME[today].toLowerCase()}.{" "}
            {choice(today) === "ride"
              ? "You'll ride it."
              : choice(today) === "never"
                ? "Not for you."
                : `It costs ${starsOff(draft.custom.direction[today]).slice(1)} star${draft.custom.direction[today] > 1 ? "s" : ""}.`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- 4. pointing ---- */

function PointingStep({ draft, setDraft }: StepProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const target = upwindAngle({
    weightKg: null,
    wings: [],
    skill: draft.skill,
    pointing: draft.pointing,
  });
  const [a, setA] = useState(target);
  const from = useRef(target);
  // Swung to the new angle, as a needle does; at once for a reader who asks for less motion.
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return setA(target);
    const start = performance.now();
    const was = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const v = was + (target - was) * (1 - (1 - k) ** 3);
      from.current = v;
      setA(v);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  const wind = 300;
  const c = 140;
  const p = (deg: number, r: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return `${(c + Math.cos(t) * r).toFixed(1)} ${(c + Math.sin(t) * r).toFixed(1)}`;
  };
  const arc = (d0: number, d1: number, r: number) =>
    `M${c} ${c}L${p(d0, r)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${p(d1, r)}Z`;
  return (
    <div className="cw-point">
      <svg className="cw-rose" viewBox="0 0 280 280" aria-hidden="true">
        <defs>
          <pattern
            id={`${id}h`}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line className="cw-hatch" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
        </defs>
        <rect className="cw-land" x="0" y="220" width="280" height="60" />
        <path className="cw-shoreline" d="M0 220H280" />
        <text className="cw-lab" x="10" y="272">
          BEACH
        </text>
        <text className="cw-lab" x="10" y="18">
          SEA
        </text>
        <circle className="cw-rose-face" cx={c} cy={c} r="100" />
        <path
          d={arc(wind - a, wind + a, 100)}
          style={{ fill: `url(#${id}h)` }}
          className="cw-rose-nogo"
        />
        <path d={arc(wind + a, wind + 180 - 15, 92)} className="cw-rose-out" />
        <path d={arc(wind - 180 + 15, wind - a, 92)} className="cw-rose-home" />
        <path
          d={`M${p(wind, 66)}A66 66 0 0 1 ${p(wind + a, 66)}`}
          className="cw-rose-angle"
        />
        <text
          className="cw-rose-deg"
          x={p(wind + a / 2, 82).split(" ")[0]}
          y={Number(p(wind + a / 2, 82).split(" ")[1]) + 4}
          textAnchor="middle"
        >
          {Math.round(a)}°
        </text>
        <path d={`M${p(wind, 128)}L${p(wind, 104)}`} className="cw-rose-wind" />
        <circle cx={c} cy={c} r="5" className="cw-rose-dot" />
      </svg>
      <div>
        <div className="cw-kick">Upwind, powered up</div>
        <div className="cw-big" data-upwind>
          {Math.round(target)}°<small> off the wind</small>
        </div>
        <Segmented<Pointing>
          aria-label="Pointing upwind"
          options={POINTINGS.map((value) => ({
            value,
            label: POINTING_LABEL[value],
          }))}
          value={draft.pointing}
          onChange={(pointing) => setDraft({ ...draft, pointing })}
        />
        <ul className="cw-legend">
          <li>
            <i className="is-nogo" />
            No-go, into the wind
          </li>
          <li>
            <i className="is-out" />
            Your tack out
          </li>
          <li>
            <i className="is-home" />
            Your tack home
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ---- 5. units ---- */

function UnitsStep({
  draft,
  setDraft,
  day,
}: StepProps & { day: SampleDay | null }) {
  const hour = day?.hours[Math.floor(day.hours.length / 2)] ?? {
    windKn: 16,
    gustKn: 23,
  };
  const unit = unitScale(draft.units);
  return (
    <div className="cw-units">
      <div className="cw-unit-row">
        <b>Wind</b>
        <Segmented<Units>
          aria-label="Wind units"
          options={UNITS.map((u) => ({ value: u.id, label: u.label }))}
          value={draft.units}
          onChange={(units) => setDraft({ ...draft, units })}
        />
        <span className="cw-eg">
          {shown(hour.windKn, unit)}
          {hour.gustKn !== null && <sup>g{shown(hour.gustKn, unit)}</sup>}
          <small>{unit.label}</small>
        </span>
      </div>
      <p className="cw-small">
        Every wind on the chart, the dock and the stars’ figures.
      </p>
    </div>
  );
}

/* ---- 6. the rider's spots ---- */

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function SpotsStep({
  draft,
  setDraft,
  spots,
  hours,
  times,
  day,
  centre,
  rider,
}: StepProps & {
  spots: readonly Spot[];
  hours: ReadonlyMap<string, readonly PlaceHour[]>;
  times: readonly number[];
  day: SampleDay | null;
  centre: { lat: number; lng: number } | null;
  rider: ReturnType<typeof draftRider>;
}) {
  const [query, setQuery] = useState("");
  const km = (s: Spot) =>
    centre
      ? Math.round(
          Math.hypot(
            (s.lat - centre.lat) * 111.2,
            (s.lon - centre.lng) *
              111.2 *
              Math.cos((centre.lat * Math.PI) / 180),
          ),
        )
      : null;
  const q = fold(query.trim());
  const list = q
    ? spots
        .filter(
          (s) => fold(s.name).includes(q) || fold(s.county ?? "").startsWith(q),
        )
        .slice(0, 9)
    : [
        ...draft.starred
          .map((id) => spots.find((s) => s.id === id))
          .filter((s): s is Spot => !!s),
        ...[...spots]
          .filter((s) => !draft.starred.includes(s.id))
          .sort((a, b) => (km(a) ?? 0) - (km(b) ?? 0))
          .slice(0, 8),
      ];
  // Each place's best on the wizard's day, where its hours are in hand.
  const date = day
    ? new Date(day.hours[0].time).toISOString().slice(0, 10)
    : null;
  const best = (id: string) => {
    const rows = hours.get(id);
    if (!rows || !date) return null;
    let top: { stars: number; potential: number } | null = null;
    rows.forEach((h, i) => {
      if (
        !h.daylight ||
        h.windKn === null ||
        new Date(times[i]).toISOString().slice(0, 10) !== date
      )
        return;
      const facing = spots.find((s) => s.id === id)?.facing ?? null;
      const r = rateHour({ ...h, daylight: true }, { facing }, rider);
      if (r && (!top || r.stars > top.stars)) top = r;
    });
    return top as { stars: number; potential: number } | null;
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
        aria-label="Find a spot"
        placeholder="Find a spot…"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="cw-kick cw-spots-k">
        {q
          ? "Found"
          : draft.starred.length
            ? "Yours, then near the chart"
            : "Near the chart’s centre"}
        {day && !q ? ` · best on ${dayLong(day.hours[0].time)}` : ""}
      </div>
      <ul className="cw-spot-list">
        {list.map((spot) => {
          const top = best(spot.id);
          const distance = km(spot);
          return (
            <li key={spot.id}>
              <StarToggle
                on={draft.starred.includes(spot.id)}
                name={spot.name}
                onToggle={() => toggle(spot.id)}
                size={18}
              />
              <span className="cw-spot-name">
                <b>{spot.name}</b>
                <small>{spot.county}</small>
              </span>
              <span>
                {top && (
                  <StarGlyphs
                    stars={top.stars}
                    potential={top.potential}
                    size={9}
                  />
                )}
              </span>
              <span className="cw-km">
                {distance !== null && !q ? `${distance} km` : ""}
              </span>
            </li>
          );
        })}
        {!list.length && <li className="cw-small">No spot by that name.</li>}
      </ul>
    </div>
  );
}

/* ---- 7. all together ---- */

function Summary({
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
  rider: ReturnType<typeof draftRider>;
  byId: ReadonlyMap<string, Spot>;
  onChange: (step: CustomiseStep) => void;
}) {
  const r = draft.custom;
  const changed =
    JSON.stringify(r) !==
    JSON.stringify(levelRating(draft.skill, draft.weightKg));
  const mark = (key: DirectionKey) => {
    const c = shoreChoice(r.direction[key]);
    return (
      <span key={key} className={`cw-mark is-${c}`}>
        {c === "ride" ? "✓" : c === "never" ? "✕" : starsOff(r.direction[key])}{" "}
        {DIRECTION_SHORT[key].toLowerCase()}
      </span>
    );
  };
  const row = (name: string, value: ReactNode, step: CustomiseStep) => (
    <tr>
      <th>{name}</th>
      <td>{value}</td>
      <td className="cw-chg">
        <Button
          variant="link"
          size="sm"
          aria-label={`Change ${name.toLowerCase()}`}
          onClick={() => onChange(step)}
        >
          Change
        </Button>
      </td>
    </tr>
  );
  const ratings = day ? rateSample(day, rider) : [];
  const win = sampleBest(ratings);
  const cell = 26;
  return (
    <div className="cw-sum">
      <table className="cw-sum-t">
        <tbody>
          {row(
            "You",
            <>
              <b>{SKILL_LABEL[draft.skill]}</b> · {draft.weightKg ?? 80} kg
              {draft.weightKg === null ? " (a guess)" : ""}
            </>,
            "level",
          )}
          {row(
            "Wind",
            <>
              <b>
                {shown(r.wind.min, unit)}–{shown(r.wind.max, unit)}
              </b>{" "}
              {unit.label} · sweet {shown(r.wind.sweetLow, unit)}–
              {shown(r.wind.sweetHigh, unit)}
              {changed ? " · your own" : ""}
            </>,
            "wind",
          )}
          {row(
            "Gusts",
            <>
              fine to <b>{shown(r.gust.fine, unit)}</b> · −{r.gust.most}★ by{" "}
              {shown(r.gust.worst, unit)}
            </>,
            "wind",
          )}
          {row("Shores", DIRECTION_KEYS.map(mark), "shore")}
          {row(
            "Pointing",
            <>
              <b>{POINTING_LABEL[draft.pointing]}</b> · about{" "}
              {upwindAngle({
                weightKg: null,
                wings: [],
                skill: draft.skill,
                pointing: draft.pointing,
              })}
              °
            </>,
            "pointing",
          )}
          {row("Units", <b>{unit.label}</b>, "units")}
          {row(
            "Spots",
            draft.starred
              .map((id) => byId.get(id)?.name)
              .filter(Boolean)
              .join(", ") || "none yet",
            "spots",
          )}
        </tbody>
      </table>
      <div>
        {day && (
          <div className="cw-sample" data-sample>
            <div className="cw-kick">{dayLong(day.hours[0].time)}, for you</div>
            <h4>{day.spot.name}</h4>
            <svg
              viewBox={`-4 0 ${day.hours.length * cell + 8} 64`}
              aria-label={`Stars, hour by hour: ${ratings.map((x) => x.stars).join(", ")}`}
            >
              {day.hours.map((hour, i) => {
                const n = ratings[i].stars;
                const x = i * cell + cell / 2;
                return (
                  <g key={hour.time}>
                    <text
                      className="cw-sum-hour"
                      x={x}
                      y="11"
                      textAnchor="middle"
                    >
                      {clock(hour.time).slice(0, 2)}
                    </text>
                    <circle
                      className={`cw-sum-dot is-${n === 5 ? "five" : n >= 3 ? "good" : n ? "some" : "none"}`}
                      cx={x}
                      cy="28"
                      r="8.5"
                    />
                    <text
                      className={`cw-sum-n${n >= 3 ? " is-on" : ""}`}
                      x={x}
                      y="31.5"
                      textAnchor="middle"
                    >
                      {n}
                    </text>
                    <text
                      className="cw-sum-kn"
                      x={x}
                      y="54"
                      textAnchor="middle"
                    >
                      {shown(hour.windKn, unit)}
                    </text>
                  </g>
                );
              })}
              {win && win.stars > 0 && (
                // The pen frames the best hours, and says nothing of them.
                <path
                  className="cw-pen"
                  d={framePath(
                    win.from * cell + 1,
                    16,
                    (win.to - win.from + 1) * cell - 2,
                    44,
                    6,
                    3,
                  )}
                />
              )}
            </svg>
          </div>
        )}
        <div className="cw-sign">
          <Puffin size={64} bob />
          <p>
            Your chart is set. The stars are yours now.
            <b>— The Almanac</b>
          </p>
        </div>
      </div>
    </div>
  );
}
