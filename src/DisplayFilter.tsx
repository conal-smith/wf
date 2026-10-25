import {
  MODEL_CATALOG,
  modelHue,
  type ModelAvailability,
} from "../force5/src/manifests";
import {
  withRiderModel,
  type NightHours,
  type Prefs,
} from "../force5/src/prefs";
import {
  FALLBACK_MODEL,
  STARS_MODELS,
  chosenModel,
  modelName,
} from "../force5/src/lead";
import { modelEntry } from "../force5/src/catalog";
import { UNITS, type Units } from "../force5/src/units";
import { Segmented } from "../ui/Segmented";

interface Props {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  /** Live wind models and whether their manifest answered. */
  models: readonly ModelAvailability[];
}

/**
 * The display options: the units, the dock's hours, the model and the
 * blend's models. The
 * rider's weight, level, wings and own star rating are set in Customise,
 * from the site menu, and nowhere else on the map. In a dialog over the
 * map, as the layers are, and shut the same ways (src/MapControls.tsx): its
 * X, Escape or a tap on the backdrop.
 */
export default function DisplayFilter({ prefs, onChange, models }: Props) {
  const setUnits = (units: Units) => onChange({ ...prefs, units });
  const toggleModel = (id: string, on: boolean) =>
    onChange({
      ...prefs,
      blendModels: on
        ? [...new Set([...prefs.blendModels, id])]
        : prefs.blendModels.filter((entry) => entry !== id),
    });
  // The one model the rider sees and the stars rate (force5/src/lead.ts):
  // the map moves to it as it changes (src/App.tsx).
  const model = chosenModel(prefs.rider.starsFrom);
  const setModel = (id: string) =>
    onChange({ ...prefs, rider: withRiderModel(prefs.rider, id) });
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
      <h2>Hours</h2>
      <div className="filter-model-choice">
        <Segmented<NightHours>
          aria-label="Hours in the forecast"
          options={[
            { value: "show", label: "Day and night" },
            { value: "hide", label: "First to last light" },
          ]}
          value={prefs.nightHours}
          onChange={(nightHours) => onChange({ ...prefs, nightHours })}
        />
      </div>
      <p className="filter-note">
        {prefs.nightHours === "hide"
          ? "The forecast's hours run from first light to last light, when the sun is 6° below the horizon. The twilight either side of the night stays, hatched as dark."
          : "The forecast's hours run round the clock, the night's hatched as dark."}
      </p>
      <h2>Model</h2>
      <div className="filter-model-choice">
        <Segmented<string>
          aria-label="Model"
          options={STARS_MODELS.map((id) => ({
            value: id,
            label: modelName(id),
          }))}
          value={model}
          onChange={setModel}
        />
        <small className="filter-sub" data-model-detail>
          {modelEntry(model)?.detail}
        </small>
      </div>
      <p className="filter-note">
        The map, the wind and the stars are {modelName(model)}&rsquo;s own
        forecast
        {model === FALLBACK_MODEL
          ? "."
          : `, and ${modelName(FALLBACK_MODEL)}'s past the end of its run, which goes on to fifteen days.`}
      </p>
      <h2>Models in the blend</h2>
      <p className="filter-note">
        The blend chart draws every model ticked here, and they say how far
        the forecast agrees. The stars stay {modelName(model)}&rsquo;s whatever
        you tick.
      </p>
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
