/**
 * Who the stars are rated for, in one line: the level as three choices, and
 * the weight and wings behind a fold that opens in place. The same rider as
 * the dock's Display options, read and written through the same preference
 * (force5.prefs.v1) and the same validation, so a change here is the rider the
 * map rates for too.
 */
import { useId, useState } from "react";
import { parseRider } from "../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  type Rider,
  type Skill,
} from "../../force5/src/stars";
import { Kicker, Segmented, TextInput } from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";

export const SKILL_LABEL: Record<Skill, string> = {
  beginner: "Learning",
  intermediate: "Riding",
  advanced: "Advanced",
};

const styles = tv({
  slots: {
    base: "flex flex-col gap-2",
    line: "flex flex-wrap items-center gap-x-3 gap-y-2",
    kicker: "max-sm:sr-only",
    more: [
      "inline-flex min-h-control-sm cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-1 text-ink tabular-nums",
      "underline decoration-line-strong underline-offset-4 pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-transparent not-disabled:hover:text-chart-magenta",
      MONO_LABEL,
      RING,
    ],
    fields: "grid max-w-form grid-cols-2 gap-3",
    field: "flex min-w-0 flex-col gap-1",
    label: ["text-ink-muted", MONO_LABEL],
    note: "m-0 font-body text-body text-ink-muted italic",
  },
});

/** "~80 kg" until a weight is given, as the dock's star row says it. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/** "Riding · ~80 kg": who the stars are for, in the page's words. */
export const riderWords = (rider: Rider) =>
  `${SKILL_LABEL[rider.skill]} · ${weightText(rider)}`;

export function RiderSwitch({
  rider,
  onChange,
}: {
  rider: Rider;
  onChange: (rider: Rider) => void;
}) {
  const s = styles();
  const panel = useId();
  const [open, setOpen] = useState(false);
  // The fields keep what is being typed ("5." on the way to "5.5"); the rider
  // only ever holds what parses, as in Display options.
  const [weight, setWeight] = useState(
    rider.weightKg === null ? "" : String(rider.weightKg),
  );
  const [wings, setWings] = useState(rider.wings.join(", "));
  const set = (change: Partial<Rider>) =>
    onChange(parseRider({ ...rider, ...change }));
  return (
    <div className={s.base()} role="group" aria-labelledby={`${panel}-for`}>
      <div className={s.line()}>
        <Kicker as="span" id={`${panel}-for`} className={s.kicker()}>
          Rated for
        </Kicker>
        <Segmented
          aria-label="Riding level"
          value={rider.skill}
          onChange={(skill) => set({ skill })}
          options={(Object.keys(SKILL_LABEL) as Skill[]).map((skill) => ({
            value: skill,
            label: SKILL_LABEL[skill],
          }))}
        />
        <button
          type="button"
          className={s.more()}
          aria-expanded={open}
          aria-controls={panel}
          data-rider-chip
          onClick={() => setOpen((was) => !was)}
        >
          <span data-rider-summary>{weightText(rider)}</span>
          {rider.wings.length > 0 && <span>· {rider.wings.join(", ")} m²</span>}
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          <span className="sr-only">
            {open ? ": close the weight and wings" : ": weight and wings"}
          </span>
        </button>
      </div>
      {open && (
        <div id={panel} className={s.base()}>
          <div className={s.fields()}>
            <label className={s.field()}>
              <span className={s.label()}>Weight kg</span>
              <TextInput
                type="number"
                inputMode="numeric"
                data-rider="weight"
                min={MIN_WEIGHT_KG}
                max={MAX_WEIGHT_KG}
                placeholder={`~${ESTIMATE_WEIGHT_KG}`}
                value={weight}
                onChange={(event) => {
                  setWeight(event.target.value);
                  const value = event.target.valueAsNumber;
                  set({ weightKg: Number.isFinite(value) ? value : null });
                }}
              />
            </label>
            <label className={s.field()}>
              <span className={s.label()}>Your wings m²</span>
              <TextInput
                type="text"
                inputMode="decimal"
                data-rider="wings"
                placeholder="e.g. 4, 5.5"
                value={wings}
                onChange={(event) => {
                  setWings(event.target.value);
                  set({
                    wings: (
                      event.target.value.match(/\d+(?:\.\d+)?/g) ?? []
                    ).map(Number),
                  });
                }}
              />
            </label>
          </div>
          <p className={s.note()}>Kept on this device, and on the map too.</p>
        </div>
      )}
    </div>
  );
}
