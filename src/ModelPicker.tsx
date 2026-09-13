import { useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODELS, type ModelId } from "../force5/src/models";

export default function ModelPicker({
  model,
  disabled,
  onSelect,
}: {
  model?: string;
  disabled: boolean;
  onSelect: (model: ModelId) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const active = MODELS.find((entry) => entry.id === model) || MODELS[0];
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node) && picker.current)
        picker.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && picker.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        picker.current.open = false;
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="map-model-picker" ref={picker}>
      <summary
        ref={trigger}
        aria-label="Choose forecast model"
        title="Choose forecast model"
      >
        <span>{active.name}</span>
        <small>{active.detail}</small>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="model-options" role="group" aria-label="Weather model">
        {MODELS.map((entry) => (
          <button
            key={entry.id}
            data-model={entry.id}
            aria-label={`Use ${entry.name} model`}
            aria-pressed={model === entry.id}
            disabled={disabled}
            onClick={() => {
              if (picker.current) picker.current.open = false;
              trigger.current?.focus();
              onSelect(entry.id);
            }}
          >
            <span>{entry.name}</span>
            <small>{entry.detail}</small>
            {model === entry.id && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  );
}
