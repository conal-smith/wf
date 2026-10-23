/**
 * Who the stars are rated for, in one line: the level as three choices, a
 * fourth for the rider's own stars once they have them,
 * the weight and wings behind a fold that opens in place, and the rider's
 * model behind another. The same rider as
 * the dock's Display options, read and written through the same preference
 * (force5.prefs.v1) and the same validation, so a change here is the rider the
 * map rates for too.
 *
 * The stars come from one model, the one the rider picks to see (HARMONIE
 * unless they pick another), and ECMWF's past the end of its run, with no
 * setting for it (force5/src/lead.ts).
 */
import { useId, useState } from "react";
import {
  FALLBACK_MODEL,
  STARS_MODELS,
  chosenModel,
  modelName,
} from "../../force5/src/lead";
import {
  loadPrefs,
  parseRider,
  savePrefs,
  withRiderModel,
  withStarsOn,
} from "../../force5/src/prefs";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  SKILLS,
  SKILL_LABEL,
  savedCustom,
  starsOn,
  type Rider,
  type StarsOn,
} from "../../force5/src/stars";
import { announcePrefs } from "../../shared/web/riderSync";
import { Button, Kicker, Segmented, TextInput } from "../../ui";
import { MONO_LABEL, RING, tv } from "../../ui/tv";

export { SKILL_LABEL };

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
    choices: "flex flex-col gap-3",
    // The models' names in one capsule, which scrolls on a phone too narrow for it.
    models: "max-w-full self-start overflow-x-auto",
  },
});

/** "~80 kg" until a weight is given, as the dock's star row says it. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/** "Riding · ~80 kg", or "Custom stars · ~80 kg": who the stars are for, in the page's words. */
export const riderWords = (rider: Rider) =>
  `${rider.custom ? "Custom stars" : SKILL_LABEL[rider.skill]} · ${weightText(rider)}`;

export function RiderSwitch({
  rider,
  onChange,
}: {
  rider: Rider;
  onChange: (rider: Rider) => void;
}) {
  const s = styles();
  const panel = useId();
  const starsPanel = useId();
  // One fold open at a time: the weight and wings, or the model.
  const [fold, setFold] = useState<"rider" | "stars" | null>(null);
  const open = fold === "rider";
  const model = chosenModel(rider.starsFrom);
  // The fields keep what is being typed ("5." on the way to "5.5"); the rider
  // only ever holds what parses, as in Display options.
  const [weight, setWeight] = useState(
    rider.weightKg === null ? "" : String(rider.weightKg),
  );
  const [wings, setWings] = useState(rider.wings.join(", "));
  const set = (change: Partial<Rider>) =>
    onChange(parseRider({ ...rider, ...change }));
  // A level, or the rider's own stars: kept as Display options keep it, and
  // told to the account when it goes on or off their own.
  const choose = (on: StarsOn) => {
    const before = loadPrefs();
    const next = withStarsOn(before, on);
    savePrefs(next);
    if (next.starsUpdatedAt !== before.starsUpdatedAt) announcePrefs("device");
    onChange(next.rider);
  };
  return (
    <div className={s.base()} role="group" aria-labelledby={`${panel}-for`}>
      <div className={s.line()}>
        <Kicker as="span" id={`${panel}-for`} className={s.kicker()}>
          Rated for
        </Kicker>
        <Segmented<StarsOn>
          aria-label="Riding level"
          value={starsOn(rider)}
          onChange={choose}
          options={[
            ...SKILLS.map((skill) => ({
              value: skill as StarsOn,
              label: SKILL_LABEL[skill],
            })),
            ...(savedCustom(rider)
              ? [{ value: "custom" as StarsOn, label: "Custom" }]
              : []),
          ]}
        />
        <button
          type="button"
          className={s.more()}
          aria-expanded={open}
          aria-controls={panel}
          data-rider-chip
          onClick={() => setFold((was) => (was === "rider" ? null : "rider"))}
        >
          <span data-rider-summary>{weightText(rider)}</span>
          {rider.wings.length > 0 && <span>· {rider.wings.join(", ")} m²</span>}
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          <span className="sr-only">
            {open ? ": close the weight and wings" : ": weight and wings"}
          </span>
        </button>
        <Kicker as="span" id={`${starsPanel}-from`} className={s.kicker()}>
          Model
        </Kicker>
        <Button
          variant="link"
          size="sm"
          aria-expanded={fold === "stars"}
          aria-controls={starsPanel}
          aria-describedby={`${starsPanel}-from`}
          data-stars-from-chip
          onClick={() => setFold((was) => (was === "stars" ? null : "stars"))}
        >
          <span data-stars-from-summary>{modelName(model)}</span>
          <span aria-hidden="true">{fold === "stars" ? "▴" : "▾"}</span>
        </Button>
      </div>
      {fold === "stars" && (
        <div id={starsPanel} className={s.choices()}>
          <Segmented<string>
            aria-label="Model"
            className={s.models()}
            value={model}
            onChange={(id) => onChange(withRiderModel(rider, id))}
            options={STARS_MODELS.map((id) => ({
              value: id,
              label: modelName(id),
            }))}
          />
          <p className={s.note()}>
            The wind and the stars are {modelName(model)}&rsquo;s own forecast
            {model === FALLBACK_MODEL
              ? ", "
              : `, and ${modelName(FALLBACK_MODEL)}'s past the end of its run, `}
            here and on the map. The other models are shown beside it, and
            never change the stars.
          </p>
        </div>
      )}
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
