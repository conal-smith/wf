import { useEffect, useRef } from "react";
import {
  MODEL_CATALOG,
  modelHue,
  type ModelAvailability,
} from "../force5/src/manifests";
import {
  ROW_KEYS,
  rowOn,
  setRow as setRowPref,
  type Prefs,
  type RowKey,
} from "../force5/src/prefs";
import { UNITS, type Units } from "../force5/src/units";

export interface RowOffer {
  label: string;
  /** Why the row cannot be shown yet; the toggle is then disabled. */
  unavailable?: string;
  /**
   * Whether the row is on until the reader says otherwise, for the rows whose
   * default depends on whether this spot has the data at all. Undefined for a
   * row whose default is simply its stored boolean.
   */
  defaultOn?: boolean;
}

interface Props {
  prefs: Prefs;
  onChange: (prefs: Prefs) => void;
  onClose: () => void;
  /** One entry per row key, in `ROW_KEYS` order. */
  rows: Record<RowKey, RowOffer>;
  /** Live wind models and whether their manifest answered. */
  models: readonly ModelAvailability[];
}

/**
 * The dock's display filter. A modal dialog rather than a second glass panel:
 * the design system forbids glass on glass, and a modal dialog already traps
 * focus and closes on Escape without a hand-written key handler.
 */
export default function DisplayFilter({
  prefs,
  onChange,
  onClose,
  rows,
  models,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Open on mount, close on unmount. The parent owns whether the popover
  // exists, so dismissal is reported from `cancel` (Escape) and from the two
  // explicit gestures - never from the `close` event, which also fires when
  // React remounts the effect and would dismiss the popover as it opened.
  useEffect(() => {
    const element = dialog.current;
    if (!element?.open) element?.showModal();
    return () => element?.close();
  }, []);

  // Switching a row by hand also takes it out of availability's hands: from
  // here on this row is the reader's choice at every spot.
  const setRow = (key: RowKey, value: boolean) =>
    onChange(setRowPref(prefs, key, value));
  const setUnits = (units: Units) => onChange({ ...prefs, units });
  const toggleModel = (id: string, on: boolean) =>
    onChange({
      ...prefs,
      blendModels: on
        ? [...new Set([...prefs.blendModels, id])]
        : prefs.blendModels.filter((entry) => entry !== id),
    });
  const planned = MODEL_CATALOG.filter(
    (entry) => entry.planned && entry.kind === "wind",
  );

  return (
    <dialog
      ref={dialog}
      className="display-filter"
      aria-label="Forecast display options"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="filter-head">
        <h2>Show</h2>
        <button
          className="filter-close"
          aria-label="Close display options"
          onClick={onClose}
        >
          Done
        </button>
      </div>
      <div className="filter-switches">
        {ROW_KEYS.map((key) => {
          const row = rows[key];
          return (
            <label
              key={key}
              className={`filter-switch${row.unavailable ? " is-unavailable" : ""}`}
            >
              <input
                type="checkbox"
                role="switch"
                data-row={key}
                checked={rowOn(prefs, key, row.defaultOn) && !row.unavailable}
                disabled={!!row.unavailable}
                onChange={(event) => setRow(key, event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
              <span className="switch-text">
                {row.label}
                {row.unavailable && <small>{row.unavailable}</small>}
              </span>
            </label>
          );
        })}
      </div>
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
      <p className="filter-note">
        Model colours identify a line on the chart. Wind speed is always
        coloured by the wind scale, never by model.
      </p>
    </dialog>
  );
}
