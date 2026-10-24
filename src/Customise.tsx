/**
 * "Customise": the site menu's first row, a wizard that walks a rider through
 * the settings the stars are rated on, as the owner approved it in the mockup
 * backlog/mockups/2026-10-24-customise-wizard.html: how they ride (level,
 * weight, wings and units), the wind that suits them and how much gusty wind
 * bothers them, on a real day re-rated as they change them, the stars each way
 * of wind takes off, how far into the wind they ride, their spots, and the lot
 * together.
 *
 * One title per step, in the dialog's head, with how far through it is and a
 * thin bar under it. The words say what each thing is, plainly.
 *
 * Its own chunk, fetched when it is opened. It edits a draft and saves it on
 * the last step through src/customiseDraft.ts, into the preferences the
 * stars, Display options and the spot page read: closing it any other way
 * keeps nothing.
 */
import "./customise.css";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Prefs } from "../force5/src/prefs";
import {
  COURSE_DEEP,
  UPWIND_MAX,
  clampUpwind,
  upwindAngle,
} from "../force5/src/rideWedge";
import {
  GUSTIES,
  GUSTY_LABEL,
  SKILLS,
  SKILL_LABEL,
  type DirectionKey,
  type Gusty,
  type Skill,
} from "../force5/src/stars";
import { UNITS, beaufort, forceKn, type Units } from "../force5/src/units";
import type { Spot } from "../force5/src/weather";
import { BeaufortGlyph } from "../ui/BeaufortGlyph";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SearchField } from "../ui/SearchField";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import { TextInput } from "../ui/TextInput";
import {
  WEB_DIRS,
  WEB_R,
  WIND_KEYS,
  WIND_TOP,
  forceTicks,
  knotsOf,
  moveWind,
  moveWindForce,
  offAt,
  polar,
  said,
  shown,
  stepped,
  unitScale,
  webRadius,
  type UnitScale,
} from "../spot/web/yourStars";
import {
  NEVER,
  applyDraft,
  costLabel,
  draftOf,
  draftRider,
  hourWhy,
  inUnits,
  levelRating,
  nearest,
  parseWings,
  rateSample,
  sampleDay,
  shoreLocked,
  spotChanges,
  withLevel,
  withShore,
  type Draft,
  type Origin,
  type SampleDay,
} from "./customiseDraft";
import { StarToggle } from "./glyphs";
import type { PlaceHour } from "./ratings";
import { clock, dayLong } from "./strip";

const STEPS = [
  { id: "you", title: "How do you ride?" },
  { id: "wind", title: "What wind suits you?" },
  {
    id: "shore",
    title: "Stars by wind direction",
    sub: "How many stars should a spot lose when the wind blows offshore, onshore or along the beach? Drag a dot in to take stars off. A dot in the middle means no stars for that wind.",
  },
  { id: "upwind", title: "Can you ride upwind?" },
  { id: "spots", title: "Your spots" },
  { id: "done", title: "All set" },
] as const;
export type CustomiseStep = (typeof STEPS)[number]["id"];

const LEVEL_LINE: Record<Skill, string> = {
  beginner: "Still getting up on the foil.",
  intermediate: "Riding both ways, starting to gybe.",
  advanced: "Light-wind pumping, happy in strong wind too.",
};
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
  onshore: "Blows straight in. Choppy getting out, but it brings you back.",
  crossOn: "Blows in at an angle. The easiest wind to learn in.",
  cross: "Blows along the beach. Ideal for most riders.",
  crossOff: "Blows out at an angle. You drift away from the beach.",
  offshore: "Blows straight out to sea. If you fall, you drift away.",
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
  // The day is chosen once, as the wizard opens: the hours it shows stay put while the rider drags.
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
          <WindStep
            draft={draft}
            setDraft={setDraft}
            unit={unit}
            day={day}
            rider={rider}
          />
        )}
        {step.id === "shore" && <ShoreStep draft={draft} setDraft={setDraft} />}
        {step.id === "upwind" && (
          <PointingStep draft={draft} setDraft={setDraft} />
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

/* ---- 1. how they ride ---- */

function YouStep({ draft, setDraft, unit }: StepProps & { unit: UnitScale }) {
  const weight = draft.weightKg ?? 80;
  const wingsId = useId();
  // The field keeps what is being typed ("5." on the way to "5.5"); the
  // draft holds only what parses.
  const [wingsText, setWingsText] = useState(draft.wings.join(", "));
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
              <b>{SKILL_LABEL[skill]}</b>
              <span>{LEVEL_LINE[skill]}</span>
              <small>
                <Speed kn={w.min} unit={unit} size={15} />–
                <Speed kn={w.max} unit={unit} size={15} />
                {unit.force ? "" : ` ${unit.label}`}
              </small>
            </Button>
          );
        })}
      </div>
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
                setDraft(
                  withLevel(draft, draft.skill, Math.max(40, weight - 5)),
                )
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
                setDraft(
                  withLevel(draft, draft.skill, Math.min(140, weight + 5)),
                )
              }
            >
              +
            </Button>
          </span>
          <span className="cw-note">Heavier riders need more wind.</span>
        </div>
        <div className="cw-row">
          <label className="cw-kick" htmlFor={wingsId}>
            Wings you own
          </label>
          <span className="cw-wings">
            <TextInput
              id={wingsId}
              inputMode="decimal"
              data-rider="wings"
              placeholder="e.g. 4, 5.5"
              value={wingsText}
              onChange={(event) => {
                setWingsText(event.target.value);
                setDraft({ ...draft, wings: parseWings(event.target.value) });
              }}
            />
            <small>m²</small>
          </span>
          <span className="cw-note">
            Optional. A star comes off when none suits the wind.
          </span>
        </div>
        <div className="cw-row">
          <span className="cw-kick">Wind in</span>
          <Segmented<Units>
            aria-label="Wind units"
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
    </>
  );
}

/* ---- 2. the wind and gusty wind ---- */

function WindStep({
  draft,
  setDraft,
  unit,
  day,
  rider,
}: StepProps & {
  unit: UnitScale;
  day: SampleDay | null;
  rider: DraftRider;
}) {
  return (
    <>
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
      <div className="cw-zones">
        <span>
          <i className="is-ok" />
          rideable
        </span>
        <span>
          <i className="is-sweet" />
          best
        </span>
        <span>
          <i className="is-over" />a gust past here: no stars
        </span>
      </div>
      <div className="cw-gusty">
        <h3>Gusty wind</h3>
        <p>
          How much does uneven wind bother you? Stars it costs are shown hollow.
        </p>
        <Segmented<Gusty>
          aria-label="Gusty wind"
          options={GUSTIES.map((gusty) => ({
            value: gusty,
            label: GUSTY_LABEL[gusty],
          }))}
          value={draft.gusty}
          onChange={(gusty) => setDraft({ ...draft, gusty })}
        />
      </div>
      <SampleDayCard day={day} rider={rider} unit={unit} />
    </>
  );
}

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

/**
 * The rider's band on a scale in knots, shown in their unit: too light, the
 * sweet spot, and the top, which a gust may not pass (hatched in the pen's
 * red past it). Four handles, dragged or moved a step at a time from the
 * keyboard; where they may go is yourStars.ts's (`moveWind`), which keeps
 * them a knot apart.
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
  const [width, setWidth] = useState(0);
  const [labels, setLabels] = useState({ light: 70, much: 130 });
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
    };
    if (next.light !== labels.light || next.much !== labels.much)
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
 * A real day at a real spot, rated for the draft: the stars move as the rider
 * drags. Under each hour, the gust (red over the rider's top, orange where it
 * is gusty) and, where something took stars off, the word for it. On the
 * last step, the hours, the wind and the stars alone.
 */
function SampleDayCard({
  day,
  rider,
  unit,
  forYou = false,
}: {
  day: SampleDay | null;
  rider: DraftRider;
  unit: UnitScale;
  forYou?: boolean;
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
    return <p className="cw-note">No forecast in hand yet to try it on.</p>;
  return (
    <div className="cw-day" data-sample>
      <div className="cw-day-h">
        <b>
          {dayLong(day.hours[0].time)} at {day.spot.name}
          {forYou ? ", for you" : ""}
        </b>
        {!forYou && <span className="cw-kick">wind · gust · stars</span>}
      </div>
      <div className="cw-hours">
        {day.hours.map((hour, i) => {
          const rating = ratings[i];
          const why = hourWhy(hour, rating, rider);
          return (
            <div
              // Keyed on the stars too, so each change draws in again.
              key={`${hour.time}-${stars[i]}`}
              className={
                !forYou && was.length && was[i] !== stars[i]
                  ? "is-changed"
                  : undefined
              }
            >
              <span className="cw-t">{clock(hour.time)}</span>
              <span className="cw-w">
                <Speed kn={hour.windKn} unit={unit} size={small ? 13 : 16} />
              </span>
              {!forYou && (
                <span
                  className={`cw-g${why.gust ? ` is-${why.gust}` : ""}`}
                  data-gust={why.gust ?? undefined}
                >
                  {hour.gustKn === null ? (
                    ""
                  ) : unit.force ? (
                    <>
                      g{" "}
                      <BeaufortGlyph force={beaufort(hour.gustKn)} size={10} />
                    </>
                  ) : (
                    `g${shown(hour.gustKn, unit)}`
                  )}
                </span>
              )}
              <span className="cw-s">
                {rating.potential ? (
                  <StarGlyphs
                    stars={stars[i]}
                    potential={rating.potential}
                    slots="potential"
                    size={small ? 6 : 9}
                  />
                ) : (
                  <span aria-label="No stars">–</span>
                )}
              </span>
              {!forYou && <span className="cw-why">{why.word}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- 3. stars by wind direction ---- */

function ShoreStep({ draft, setDraft }: StepProps) {
  const off = draft.custom.direction;
  return (
    <div className="cw-shore">
      <ShoreWeb
        off={off}
        locked={(key) => shoreLocked(draft.skill, key)}
        onChange={(key, value) => setDraft(withShore(draft, key, value))}
      />
      <ul className="cw-dirs">
        {SHORE_ORDER.map((key) => (
          <li key={key} data-direction={key}>
            <b>{DIRECTION_NAME[key]}</b>
            <span className={`cw-cost${off[key] >= NEVER ? " is-never" : ""}`}>
              {costLabel(off[key])}
            </span>
            <small>
              {DIRECTION_LINE[key]}
              {shoreLocked(draft.skill, key) ? " Never for a learner." : ""}
            </small>
          </li>
        ))}
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
 * spoke is what that wind costs: on the rim nothing, a star a ring, in the
 * middle never. The two sides are one setting, so a dot moves its mirror.
 * Each dot is a slider for the keyboard.
 */
function ShoreWeb({
  off,
  locked,
  onChange,
}: {
  off: Record<DirectionKey, number>;
  locked: (key: DirectionKey) => boolean;
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
      if (locked(key)) return;
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
        const lock = locked(key);
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
            tabIndex={0}
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
                  ArrowUp: off[key] + 0.5,
                  ArrowRight: off[key] + 0.5,
                  ArrowDown: off[key] - 0.5,
                  ArrowLeft: off[key] - 0.5,
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
 * (force5/src/rideWedge.ts `upwindOf`). The slider and the picture's handles
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

/** How the summary and the slider say a number of degrees into the wind. */
const intoWords = (into: number) =>
  into ? `${into}° into the wind` : "straight across the wind";

/** The upwind picture's frame: the board at the middle, the wind from the top. */
const UP = { cx: 150, cy: 168, r: 118, vx: -36, vw: 372, vh: 310 };

/**
 * "Can you ride upwind?": one number, degrees into the wind counted from
 * straight across it, used in every wind. The picture draws it as the loupe
 * will: the no-go hatched into the wind, the two courses to about 120° off
 * it, the slow water downwind faint, and the angle in magenta. Answered with
 * a quick answer, the slider, or a handle on the course's edge.
 */
function PointingStep({ draft, setDraft }: StepProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const into = draft.upwind;
  const set = (deg: number) => {
    const next = clampUpwind(deg);
    if (next !== draft.upwind) setDraft({ ...draft, upwind: next });
  };
  const { cx, cy, r } = UP;
  const up = upwindAngle({ skill: draft.skill, upwind: into });
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
  // The latest `set`, for a drag that outlives the render it began in.
  const setLatest = useRef(set);
  setLatest.current = set;
  /** Dragging an edge: the degrees into the wind for the pointer, either side. */
  const grab = (event: ReactPointerEvent<SVGGElement>) => {
    event.preventDefault();
    const move = (m: PointerEvent) => {
      const box = svg.current?.getBoundingClientRect();
      if (!box) return;
      const k = UP.vw / box.width;
      const x = Math.abs((m.clientX - box.left) * k + UP.vx - cx);
      const y = (m.clientY - box.top) * k - cy;
      setLatest.current(90 - (Math.atan2(x, -y) * 180) / Math.PI);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };
  const handle = (side: 1 | -1) => {
    const [x, y] = p(side * up, r);
    return (
      <g
        className="cw-up-edge"
        data-edge={side > 0 ? "right" : "left"}
        onPointerDown={grab}
      >
        <circle cx={x} cy={y} r="16" className="cw-up-edge-hit" />
        <circle cx={x} cy={y} r="7" className="cw-up-edge-dot" />
      </g>
    );
  };
  const angle = (side: 1 | -1) => {
    if (!into) return null;
    const rr = r * 0.82;
    const [x1, y1] = p(side * 90, rr);
    const [x2, y2] = p(side * up, rr);
    const [lx, ly] = p(side * (up - 9), r + 14);
    return (
      <g>
        <path
          className="cw-up-angle"
          d={`M${x1.toFixed(1)} ${y1.toFixed(1)}A${rr} ${rr} 0 0 ${side > 0 ? 0 : 1} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        />
        <text
          className="cw-up-deg"
          x={lx}
          y={ly + 4}
          textAnchor={side > 0 ? "start" : "end"}
        >
          {into}°
        </text>
      </g>
    );
  };
  return (
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
        <path className="cw-up-course" d={sector(up, COURSE_DEEP, r)} />
        <path className="cw-up-course" d={sector(-COURSE_DEEP, -up, r)} />
        <path
          className="cw-up-slow"
          d={sector(COURSE_DEEP, 360 - COURSE_DEEP, r)}
        />
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
        {([-1, 1] as const).map((side) => {
          const [x, y] = p((side * (up + COURSE_DEEP)) / 2, r * 0.6);
          return (
            <text
              key={side}
              className="cw-lab is-strong"
              x={x}
              y={y + 3}
              textAnchor="middle"
            >
              RIDE
            </text>
          );
        })}
        <text className="cw-lab" x={cx} y={cy + r * 0.62} textAnchor="middle">
          SLOW
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
        {handle(1)}
        {handle(-1)}
      </svg>
      <div>
        <div
          className="cw-up-answers"
          role="group"
          aria-label="Can you ride upwind?"
        >
          {UP_ANSWERS.map((a) => (
            <Button
              key={a.into}
              variant="quiet"
              className="cw-up-answer"
              pressed={into === a.into}
              onClick={() => set(a.into)}
            >
              <b>{a.name}</b>
              <span>{a.line}</span>
            </Button>
          ))}
        </div>
        <div className="cw-into" data-upwind>
          <output>{into}°</output>
          <span>into the wind</span>
        </div>
        <IntoSlider value={into} onChange={set} />
        <ul className="cw-legend">
          <li>
            <i className="is-nogo" />
            Can&rsquo;t go: too close to the wind
          </li>
          <li>
            <i className="is-out" />
            Your course
          </li>
          <li>
            <i className="is-slow" />
            Downwind: possible, but slow
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Degrees into the wind, 0 to UPWIND_MAX: dragged, or a degree at a time from the keyboard. */
function IntoSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (deg: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return ((clientX - box.left) / box.width) * UPWIND_MAX;
  };
  const left = `${(value / UPWIND_MAX) * 100}%`;
  return (
    <div className="cw-slide">
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
          aria-label="Degrees into the wind"
          aria-valuemin={0}
          aria-valuemax={UPWIND_MAX}
          aria-valuenow={value}
          aria-valuetext={intoWords(value)}
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
                Home: -UPWIND_MAX,
                End: UPWIND_MAX,
              } as Record<string, number>
            )[event.key];
            if (!by) return;
            event.preventDefault();
            onChange(value + by);
          }}
        />
      </div>
      <div className="cw-slide-ends">
        <span>Straight across</span>
        <span>{UPWIND_MAX}° into it</span>
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
        {SKILL_LABEL[draft.skill]} · {draft.weightKg ?? 80} kg
        {draft.wings.length
          ? ` · wings ${draft.wings.join(", ")} m²`
          : ""} · {unit.label.toLowerCase()}
      </>,
    ],
    [
      "Wind",
      "wind",
      <>
        {span(w.min, w.max, unit)}
        {unit.force ? "" : ` ${unit.label}`} · best{" "}
        {span(w.sweetLow, w.sweetHigh, unit)} · gusty:{" "}
        {GUSTY_LABEL[draft.gusty].toLowerCase()}
      </>,
    ],
    [
      "Shore",
      "shore",
      costs.length
        ? costs.map((key, i) => (
            <span key={key}>
              {i ? " · " : ""}
              <span className={off[key] >= NEVER ? "is-never" : undefined}>
                {DIRECTION_NAME[key].toLowerCase()}{" "}
                {off[key] >= NEVER ? "never" : `−${off[key]}★`}
              </span>
            </span>
          ))
        : "any direction",
    ],
    ["Upwind", "upwind", intoWords(draft.upwind)],
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
      <SampleDayCard day={day} rider={rider} unit={unit} forYou />
    </>
  );
}
