/**
 * The finder's question, in the middle of its head: where (the rider's
 * favourites, or every place round them) and when (the hour on the timeline).
 * Where is a small menu of the two; When says the hour, and takes the keys to
 * the timeline.
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { MONO_LABEL, tv } from "../../ui/tv";
import type { Scope } from "./finder";

const styles = tv({
  slots: {
    root: "relative min-w-0",
    // A capsule floating on the page: the ink rule, its hairline and a
    // float's shadow, lit faintly from above.
    pill: "flex items-stretch overflow-hidden rounded-full border border-ink bg-card paper-float shadow-float inset-shadow-frame",
    part: [
      "h-auto min-w-0 flex-col items-start justify-center gap-0 rounded-none px-4 py-1.5 text-left",
      "font-body tracking-normal text-ink normal-case",
      "not-first:border-l not-first:border-line first:pl-4.5",
      "max-wide:flex-1 max-wide:px-2.5",
    ],
    kicker: [MONO_LABEL, "block text-ink-muted"],
    value: "flex items-center gap-1 text-prose font-semibold whitespace-nowrap",
    menu: [
      "absolute top-full left-0 z-panel mt-2 flex w-60 flex-col gap-0.5 rounded-dialog border border-ink bg-card p-1.5 shadow-sheet inset-shadow-frame paper-grain",
      "animate-menu-in motion-reduce:animate-none",
    ],
    choice: [
      "h-auto w-full flex-col items-start gap-0 rounded-control px-3 py-2 text-left",
      "font-body tracking-normal text-ink normal-case",
      "aria-checked:bg-ground aria-checked:inset-ring-2 aria-checked:inset-ring-ink",
    ],
    name: "block text-prose font-semibold",
    note: "block text-body text-ink-muted whitespace-normal",
  },
});

export const SCOPES: readonly { id: Scope; name: string; note: string }[] = [
  { id: "favourites", name: "Favourites", note: "The spots you've starred" },
  { id: "near", name: "Near you", note: "Every spot around you" },
];

export function WhereWhen({
  scope,
  onScope,
  when,
  onWhen,
  className,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
  /** "Now", or "Tue 27, 14:00". */
  when: string;
  /** When is pressed: the timeline takes the keys. */
  onWhen: () => void;
  className?: string;
}) {
  const s = styles();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const where = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const at = SCOPES.findIndex((c) => c.id === scope);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) where.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items.current[Math.max(0, at)]?.focus();
    const away = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  return (
    <div className={s.root({ className })} ref={root} data-where-when>
      <div className={s.pill()}>
        <Button
          ref={where}
          variant="quiet"
          className={s.part()}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          data-where
        >
          <small className={s.kicker()}>Where</small>
          <span className={s.value()}>
            {SCOPES[at]?.name}
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </Button>
        <Button variant="quiet" className={s.part()} onClick={onWhen} data-when>
          <small className={s.kicker()}>When</small>
          <span className={s.value()}>{when}</span>
        </Button>
      </div>
      {open && (
        <div
          id={menuId}
          className={s.menu()}
          role="menu"
          aria-label="Where"
          onKeyDown={(event) => {
            const i = items.current.findIndex(
              (el) => el === document.activeElement,
            );
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              items.current[
                (i + step + SCOPES.length) % SCOPES.length
              ]?.focus();
            } else if (event.key === "Tab") close(false);
          }}
        >
          {SCOPES.map((choice, i) => (
            <Button
              key={choice.id}
              ref={(el: HTMLButtonElement | null) => {
                items.current[i] = el;
              }}
              variant="quiet"
              className={s.choice()}
              role="menuitemradio"
              aria-checked={choice.id === scope}
              onClick={() => {
                onScope(choice.id);
                close();
              }}
            >
              <span className={s.name()}>{choice.name}</span>
              <span className={s.note()}>{choice.note}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
