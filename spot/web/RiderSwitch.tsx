/**
 * Who the stars are rated for: level, weight and the wings in the bag. The
 * same rider as the dock's Display options, read and written through the same
 * preference (force5.prefs.v1) and the same validation, so a change here is the
 * rider the map rates for too.
 */
import { useState } from "react";
import { parseRider } from "../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  type Rider,
  type Skill,
} from "../../force5/src/stars";
import { Segmented, TextInput } from "../../ui";
import { tv } from "../../ui/tv";

export const SKILL_LABEL: Record<Skill, string> = {
  beginner: "Learning",
  intermediate: "Riding",
  advanced: "Advanced",
};

const styles = tv({
  slots: {
    base: "flex flex-col gap-3",
    head: "flex items-baseline justify-between gap-3",
    title: "m-0 text-label text-ink-2",
    estimate: "text-body text-ink-muted tabular-nums",
    fields: "grid grid-cols-2 gap-3",
    field: "flex min-w-0 flex-col gap-1",
    label: "text-caption font-semibold text-ink-muted",
    unit: "font-normal",
    note: "m-0 text-caption text-ink-muted",
  },
});

/** "~80 kg" until a weight is given, as the dock's star row says it. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

export function RiderSwitch({
  rider,
  onChange,
}: {
  rider: Rider;
  onChange: (rider: Rider) => void;
}) {
  const s = styles();
  // The fields keep what is being typed ("5." on the way to "5.5"); the rider
  // only ever holds what parses, as in Display options.
  const [weight, setWeight] = useState(
    rider.weightKg === null ? "" : String(rider.weightKg),
  );
  const [wings, setWings] = useState(rider.wings.join(", "));
  const set = (change: Partial<Rider>) =>
    onChange(parseRider({ ...rider, ...change }));
  return (
    <div className={s.base()} role="group" aria-labelledby="rate-for">
      <div className={s.head()}>
        <h2 id="rate-for" className={s.title()}>
          Rate for
        </h2>
        <span className={s.estimate()} data-rider-summary>
          {weightText(rider)}
          {rider.wings.length ? ` · ${rider.wings.join(", ")} m²` : ""}
        </span>
      </div>
      <Segmented
        aria-label="Riding level"
        value={rider.skill}
        onChange={(skill) => set({ skill })}
        options={(Object.keys(SKILL_LABEL) as Skill[]).map((skill) => ({
          value: skill,
          label: SKILL_LABEL[skill],
        }))}
      />
      <div className={s.fields()}>
        <label className={s.field()}>
          <span className={s.label()}>
            Weight <span className={s.unit()}>kg</span>
          </span>
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
          <span className={s.label()}>
            Wings you own <span className={s.unit()}>m²</span>
          </span>
          <TextInput
            type="text"
            inputMode="decimal"
            data-rider="wings"
            placeholder="e.g. 4, 5.5"
            value={wings}
            onChange={(event) => {
              setWings(event.target.value);
              set({
                wings: (event.target.value.match(/\d+(?:\.\d+)?/g) ?? []).map(
                  Number,
                ),
              });
            }}
          />
        </label>
      </div>
      <p className={s.note()}>
        {rider.weightKg === null
          ? `Until you give a weight the stars assume ${ESTIMATE_WEIGHT_KG} kg. `
          : ""}
        Saved on this device, and used on the map too.
      </p>
    </div>
  );
}
