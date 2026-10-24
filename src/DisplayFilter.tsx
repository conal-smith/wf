import { useState } from "react";
import {
  MODEL_CATALOG,
  modelHue,
  type ModelAvailability,
} from "../force5/src/manifests";
import { parseRider, withRiderModel, type Prefs } from "../force5/src/prefs";
import {
  FALLBACK_MODEL,
  STARS_MODELS,
  chosenModel,
  modelName,
} from "../force5/src/lead";
import { modelEntry } from "../force5/src/catalog";
import { upwindAngle } from "../force5/src/rideWedge";
import { UNITS, type Units } from "../force5/src/units";
import {
  POINTINGS,
  POINTING_LABEL,
  type Pointing,
  type Rider,
} from "../force5/src/stars";
import { Segmented } from "../ui/Segmented";

interface Props {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  /** Live wind models and whether their manifest answered. */
  models: readonly ModelAvailability[];
}

/**
 * The display options: the units, the model and the blend's models. The
 * rider's weight, level and own star rating are set in Customise, from the
 * site menu, and nowhere else on the map. In a dialog over the map, as the
 * layers and your spots are, and shut the same ways (src/MapControls.tsx):
 * its X, Escape or a tap on the backdrop.
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
  // The field keeps what the reader is typing ("5." on the way to "5.5"); the
  // stored rider only ever holds what parses, through the same validation a
  // stored value gets on load.
  const [wingsText, setWingsText] = useState(prefs.rider.wings.join(", "));
  const setRider = (rider: Partial<Rider>) =>
    onChange({ ...prefs, rider: parseRider({ ...prefs.rider, ...rider }) });
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
      <h2>Your riding</h2>
      <div className="filter-rider">
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
