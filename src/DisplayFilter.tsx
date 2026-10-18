import { useState } from "react";
import {
  MODEL_CATALOG,
  modelHue,
  type ModelAvailability,
} from "../force5/src/manifests";
import { parseRider, type Prefs } from "../force5/src/prefs";
import { UNITS, type Units } from "../force5/src/units";
import {
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  SKILLS,
  SKILL_LABEL,
  type Rider,
} from "../force5/src/stars";
import { Button } from "../ui/Button";

interface Props {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  onClose: () => void;
  /** Live wind models and whether their manifest answered. */
  models: readonly ModelAvailability[];
  /** Open "Your star rating", to make one or to change the rider's own. */
  onCustomiseStars: () => void;
  /** Back to the level's own stars. */
  onResetStars: () => void;
}

/**
 * The display options: the units, the rider and the blend's models. A panel
 * beside the map's controls, as the layers and your spots are, and shut the
 * same ways (src/MapControls.tsx): its button, Escape, a tap away, or Done.
 */
export default function DisplayFilter({
  prefs,
  onChange,
  onClose,
  models,
  onCustomiseStars,
  onResetStars,
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
  const planned = MODEL_CATALOG.filter(
    (entry) => entry.planned && entry.kind === "wind",
  );

  return (
    <div
      id="map-options"
      className="display-filter chart-box"
      role="group"
      aria-label="Forecast display options"
    >
      <div className="filter-head">
        <h2>Units</h2>
        <button
          className="filter-close"
          aria-label="Close display options"
          onClick={onClose}
        >
          Done
        </button>
      </div>
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
        <div className="filter-units" role="group" aria-label="Riding level">
          {SKILLS.map((skill) => (
            <button
              key={skill}
              data-skill={skill}
              aria-pressed={prefs.rider.skill === skill}
              onClick={() => setRider({ skill })}
            >
              {SKILL_LABEL[skill]}
            </button>
          ))}
        </div>
        <div className="rider-stars" data-star-rating>
          <span className="rider-stars-name">Star rating</span>
          <span className="rider-stars-what">
            <span className="rider-stars-value">
              {prefs.rider.custom
                ? "Custom"
                : `Standard for ${SKILL_LABEL[prefs.rider.skill]}`}
            </span>
            <span className="rider-stars-acts">
              {prefs.rider.custom ? (
                <>
                  <Button variant="link" size="sm" onClick={onCustomiseStars}>
                    Edit
                  </Button>
                  <Button variant="link" size="sm" onClick={onResetStars}>
                    Reset
                  </Button>
                </>
              ) : (
                <Button variant="link" size="sm" onClick={onCustomiseStars}>
                  Customise
                </Button>
              )}
            </span>
          </span>
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
        The stars, the lights and the wing are rated for this rider.{" "}
        {prefs.rider.weightKg === null
          ? `Until you give a weight they assume ${ESTIMATE_WEIGHT_KG} kg.`
          : ""}
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
