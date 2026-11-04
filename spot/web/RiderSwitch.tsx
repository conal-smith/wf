/**
 * Who the stars are rated for, in one line: whose stars they are (ours, or
 * the rider's own) with the way to Settings, where they are changed; the
 * weight and wings behind a fold that opens in place, which size the wing
 * and never move a star; and the rider's model behind another. The same
 * rider as Settings', read and written through the same
 * preference (force5.prefs.v1) and the same validation, so a change here is
 * the rider the map rates for too.
 *
 * The stars come from one model, the one the rider picks to see (HARMONIE
 * unless they pick another), and ECMWF's past the end of its run, with no
 * setting for it (force5/src/lead.ts).
 */
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import {
  BLEND_MODEL,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  STARS_CHOICES,
  chosenModel,
  modelName,
} from "../../force5/src/lead";
import { parseRider, withRiderModel } from "../../force5/src/prefs";
import { SETTINGS_HREF } from "../../force5/src/siteNav";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  type Rider,
} from "../../force5/src/stars";
import { Button, Segmented, TextInput } from "../../ui";
import { MONO_LABEL, tv } from "../../ui/tv";

const styles = tv({
  slots: {
    base: "flex flex-col gap-2",
    line: "flex flex-wrap items-center gap-x-3 gap-y-2",
    name: ["text-ink-muted max-sm:sr-only", MONO_LABEL],
    whose: "font-body text-body font-medium text-ink",
    more: "tabular-nums",
    fields: "grid max-w-form grid-cols-2 gap-3",
    field: "flex min-w-0 flex-col gap-1",
    label: ["text-ink-muted", MONO_LABEL],
    note: "m-0 max-w-reading font-body text-body text-ink-muted",
    choices: "flex flex-col gap-3",
    // The models' names in one capsule, which scrolls on a phone too narrow for it.
    models: "max-w-full self-start overflow-x-auto",
  },
});

/** The chevron after a fold's name: down shut, up open. */
function Fold({ open }: { open: boolean }) {
  return (
    <ChevronDown
      size={14}
      strokeWidth={1.75}
      aria-hidden="true"
      className={[
        "transition-transform duration-fast motion-reduce:transition-none",
        open ? "rotate-180" : "",
      ].join(" ")}
    />
  );
}

/** "~80 kg" until a weight is given, as the dock's star row says it. */
export const weightText = (rider: Rider) =>
  `${rider.weightKg === null ? "~" : ""}${rider.weightKg ?? ESTIMATE_WEIGHT_KG} kg`;

/** "Ours", or "Your own": whose stars rate the hours, after "Stars". */
export const starsWhose = (rider: Pick<Rider, "custom">) =>
  rider.custom ? "Your own" : "Ours";

/** "Ours · ~80 kg", or "Your own · 80 kg": who the stars are for, after "Stars:". */
export const riderWords = (rider: Rider) =>
  `${starsWhose(rider)} · ${weightText(rider)}`;

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
  // only ever holds what parses, as in Settings.
  const [weight, setWeight] = useState(
    rider.weightKg === null ? "" : String(rider.weightKg),
  );
  const [wings, setWings] = useState(rider.wings.join(", "));
  const set = (change: Partial<Rider>) =>
    onChange(parseRider({ ...rider, ...change }));
  return (
    <div className={s.base()} role="group" aria-labelledby={`${panel}-for`}>
      <div className={s.line()}>
        <span id={`${panel}-for`} className={s.name()}>
          Stars
        </span>
        {/* Whose stars, and the way to change them: Settings, on the map. */}
        <span className={s.whose()} data-stars-whose>
          {starsWhose(rider)}
        </span>
        <Button
          variant="link"
          size="sm"
          href={SETTINGS_HREF}
          data-settings-link
        >
          Settings
        </Button>
        <Button
          variant="link"
          size="sm"
          className={s.more()}
          aria-expanded={open}
          aria-controls={panel}
          data-rider-chip
          onClick={() => setFold((was) => (was === "rider" ? null : "rider"))}
        >
          <span data-rider-summary>{weightText(rider)}</span>
          {rider.wings.length > 0 && <span>· {rider.wings.join(", ")} m²</span>}
          <Fold open={open} />
          <span className="sr-only">
            {open ? ": close the weight and wings" : ": weight and wings"}
          </span>
        </Button>
        <span id={`${starsPanel}-from`} className={s.name()}>
          Model
        </span>
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
          <Fold open={fold === "stars"} />
        </Button>
      </div>
      {fold === "stars" && (
        <div id={starsPanel} className={s.choices()}>
          <Segmented<string>
            aria-label="Model"
            className={s.models()}
            value={model}
            onChange={(id) => onChange(withRiderModel(rider, id))}
            options={STARS_CHOICES.map((id) => ({
              value: id,
              label: modelName(id),
            }))}
          />
          <p className={s.note()}>
            {model === BLEND_MODEL ? (
              <>
                The wind and the stars are the blend of every model, each
                weighted by how good it is that far ahead. The map draws{" "}
                {modelName(DEFAULT_MODEL)}.
              </>
            ) : (
              <>
                The wind and the stars are {modelName(model)}&rsquo;s own
                forecast
                {model === FALLBACK_MODEL
                  ? ", "
                  : `, and ${modelName(FALLBACK_MODEL)}'s past the end of its run, `}
                here and on the map. The other models are shown beside it, and
                never change the stars.
              </>
            )}
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
          <p className={s.note()}>
            They size the wing for each hour and never change the stars. Kept on
            this device, and on the map too.
          </p>
        </div>
      )}
    </div>
  );
}
