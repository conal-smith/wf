import { useState } from "react";
import {
  MODEL_CATALOG,
  modelHue,
  type ModelAvailability,
} from "../force5/src/manifests";
import {
  parseRider,
  withRiderStarsFrom,
  withStarsOn,
  type Prefs,
} from "../force5/src/prefs";
import {
  STARS_MODELS,
  modelName,
  spotOverride,
  starsFromAt,
} from "../force5/src/lead";
import { upwindAngle } from "../force5/src/rideWedge";
import { UNITS, type Units } from "../force5/src/units";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  POINTINGS,
  POINTING_LABEL,
  SKILLS,
  SKILL_LABEL,
  savedCustom,
  starsOn,
  type Pointing,
  type Rider,
  type StarsOn,
} from "../force5/src/stars";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";

interface Props {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  /** Live wind models and whether their manifest answered. */
  models: readonly ModelAvailability[];
  /** Open "Your star rating", to make one or to change the rider's own. */
  onCustomiseStars: () => void;
  /**
   * A level picked, or the rider's own rating: a change to the preferences
   * the account may keep (force5/src/prefs.ts `withStarsOn`).
   */
  onStarsOn: (prefs: Prefs) => void;
  /** The riding place open in the dock, which may take its stars from a model of its own. */
  spot?: { id: string; name: string } | null;
}

/**
 * The display options: the units, the rider and the blend's models. In a
 * dialog over the map, as the layers and your spots are, and shut the same
 * ways (src/MapControls.tsx): its X, Escape or a tap on the backdrop.
 */
export default function DisplayFilter({
  prefs,
  onChange,
  models,
  onCustomiseStars,
  onStarsOn,
  spot = null,
}: Props) {
  const setUnits = (units: Units) => onChange({ ...prefs, units });
  const toggleModel = (id: string, on: boolean) =>
    onChange({
      ...prefs,
      blendModels: on
        ? [...new Set([...prefs.blendModels, id])]
        : prefs.blendModels.filter((entry) => entry !== id),
    });
  // Both fields keep what the reader is typing ("5." on the way to "5.5"); the
  // stored rider only ever holds what parses, through the same validation a
  // stored value gets on load.
  const [weightText, setWeightText] = useState(
    prefs.rider.weightKg === null ? "" : String(prefs.rider.weightKg),
  );
  const [wingsText, setWingsText] = useState(prefs.rider.wings.join(", "));
  const setRider = (rider: Partial<Rider>) =>
    onChange({ ...prefs, rider: parseRider({ ...prefs.rider, ...rider }) });
  const saved = savedCustom(prefs.rider);
  const on = starsOn(prefs.rider);
  const choices: StarsOn[] = saved ? [...SKILLS, "custom"] : [...SKILLS];
  // The one model the stars come from, the one that takes over where its run
  // ends, and the open spot's own (force5/src/lead.ts).
  const from = starsFromAt(prefs.rider.starsFrom);
  const own = spot ? spotOverride(prefs.rider.starsFrom, spot.id) : null;
  const setStarsFrom = (change: Parameters<typeof withRiderStarsFrom>[1]) =>
    onChange({ ...prefs, rider: withRiderStarsFrom(prefs.rider, change) });
  const planned = MODEL_CATALOG.filter(
    (entry) => entry.planned && entry.kind === "wind",
  );

  return (
    <div
      id="map-options"
      className="display-filter"
      role="group"
      aria-label="Forecast display options"
    >
      <h2>Units</h2>
      <div className="filter-units" role="group" aria-label="Wind units">
        {UNITS.map((unit) => (
          <button
            key={unit.id}
            data-units={unit.id}
            aria-pressed={prefs.units === unit.id}
            title={unit.name}
            onClick={() => setUnits(unit.id)}
          >
            {unit.label}
          </button>
        ))}
      </div>
      <h2>Your riding</h2>
      <div className="filter-rider">
        <label className="rider-field">
          <span>Weight</span>
          <input
            type="number"
            inputMode="numeric"
            data-rider="weight"
            min={MIN_WEIGHT_KG}
            max={MAX_WEIGHT_KG}
            placeholder={String(ESTIMATE_WEIGHT_KG)}
            value={weightText}
            onChange={(event) => {
              setWeightText(event.target.value);
              const value = event.target.valueAsNumber;
              setRider({ weightKg: Number.isFinite(value) ? value : null });
            }}
          />
          <small>kg</small>
        </label>
        <div className="rider-level">
          <div className="filter-units" role="group" aria-label="Riding level">
            {choices.map((choice) => (
              <button
                key={choice}
                data-skill={choice}
                aria-pressed={on === choice}
                onClick={() => onStarsOn(withStarsOn(prefs, choice))}
              >
                {choice === "custom" ? "Custom" : SKILL_LABEL[choice]}
              </button>
            ))}
          </div>
          <Button
            variant="link"
            size="sm"
            className="rider-customise"
            onClick={onCustomiseStars}
            data-customise-stars
          >
            {saved ? "Edit custom" : "Customise"}
          </Button>
        </div>
        {/* How high they point: the loupe's no-go and the light's wedge,
            never the stars (force5/src/rideWedge.ts). */}
        <div className="rider-pointing">
          <span className="filter-sub">Pointing upwind</span>
          <Segmented<Pointing>
            aria-label="Pointing upwind"
            options={POINTINGS.map((pointing) => ({
              value: pointing,
              label: POINTING_LABEL[pointing],
            }))}
            value={prefs.rider.pointing ?? "typical"}
            onChange={(pointing) => setRider({ pointing })}
          />
          <small className="rider-pointing-angle" data-upwind-angle>
            About {upwindAngle(prefs.rider)}° off the wind, powered up
          </small>
        </div>
        <label className="rider-field">
          <span>Wings you own</span>
          <input
            type="text"
            inputMode="decimal"
            data-rider="wings"
            placeholder="e.g. 4, 5.5"
            value={wingsText}
            onChange={(event) => {
              setWingsText(event.target.value);
              setRider({
                wings: (event.target.value.match(/\d+(?:\.\d+)?/g) ?? []).map(
                  Number,
                ),
              });
            }}
          />
          <small>m²</small>
        </label>
      </div>
      <p className="filter-note">
        The stars, the lights and the wing are rated for this rider. How high
        they point moves the loupe&rsquo;s no-go and the light&rsquo;s wedge,
        never a star.{" "}
        {prefs.rider.weightKg === null
          ? `Until you give a weight they assume ${ESTIMATE_WEIGHT_KG} kg.`
          : ""}
      </p>
      <h2>Stars from</h2>
      <div className="filter-stars-from">
        <Segmented<string>
          aria-label="Stars from"
          options={STARS_MODELS.map((id) => ({
            value: id,
            label: modelName(id),
          }))}
          value={from.model}
          onChange={(id) =>
            // The model that took over becomes the one that leads: the one
            // it took over from takes over in its place.
            setStarsFrom({
              everywhere:
                id === from.then
                  ? { model: id, then: from.model }
                  : { model: id },
            })
          }
        />
        {/* Past the end of the model's run, one other model: never a blend. */}
        <span className="filter-sub">When {modelName(from.model)} ends</span>
        <Segmented<string>
          aria-label={`When ${modelName(from.model)} ends`}
          options={STARS_MODELS.filter((id) => id !== from.model).map((id) => ({
            value: id,
            label: modelName(id),
          }))}
          value={from.then}
          onChange={(id) => setStarsFrom({ everywhere: { then: id } })}
        />
        {spot && (
          <>
            <span className="filter-sub">At {spot.name}</span>
            <Segmented<string>
              aria-label={`Stars at ${spot.name}`}
              className="filter-spot-stars"
              options={[
                { value: "same", label: "Same" },
                ...STARS_MODELS.filter((id) => id !== from.model).map((id) => ({
                  value: id,
                  label: modelName(id),
                })),
              ]}
              value={own ?? "same"}
              onChange={(id) =>
                setStarsFrom({
                  spot: spot.id,
                  model: id === "same" ? null : id,
                })
              }
            />
          </>
        )}
      </div>
      <p className="filter-note">
        Every hour&rsquo;s stars are one model&rsquo;s own forecast:{" "}
        {modelName(from.model)}, then {modelName(from.then)} where its run ends.
        The models in the blend give the agreement beside them and never change
        a star.
      </p>
      <h2>Models in the blend</h2>
      <div className="filter-models">
        {models.map((model) => (
          <label
            key={model.id}
            className={`filter-model${model.available ? "" : " is-unavailable"}`}
          >
            <input
              type="checkbox"
              data-model-toggle={model.id}
              checked={prefs.blendModels.includes(model.id)}
              disabled={!model.available}
              onChange={(event) => toggleModel(model.id, event.target.checked)}
            />
            <i
              className="model-swatch"
              aria-hidden="true"
              style={{ background: modelHue(model.id).wind }}
            />
            <span>
              {model.entry.name}
              <small>{model.available ? model.entry.detail : "no data"}</small>
            </span>
          </label>
        ))}
        {planned.map((entry) => (
          <label key={entry.id} className="filter-model is-planned">
            <input type="checkbox" disabled checked={false} />
            <i
              className="model-swatch"
              aria-hidden="true"
              style={{ background: modelHue(entry.id).wind }}
            />
            <span>
              {entry.name}
              <small>coming</small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
