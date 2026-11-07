/**
 * A small card laid over the map beside a mark on it: a reading's
 * (./readingPills.ts) or a muted dot's (./lights.ts). One card for its layer,
 * moved to whichever mark it is about. It opens under the pointer or the keys
 * and goes as they leave; a tap pins it, until a tap elsewhere or Escape.
 * What it says is the caller's (`fill`); this is the shell: where it stands,
 * and when it shows.
 */
import type * as maplibregl from "maplibre-gl";

const SVG = "http://www.w3.org/2000/svg";
/** The arrow, pointing up (downwind once turned), in a 12-unit box. */
const ARROW = "M0 4.6V-4.4M-2.7 -1.6L0 -4.8L2.7 -1.6";

/** The mark a card is about: its button, and the box that takes `is-open`. */
export interface CardMark {
  button: HTMLElement;
  el: HTMLElement;
}

export interface MapCard<Mark extends CardMark> {
  readonly el: HTMLElement;
  /** The mark the card is about, or null with it shut. */
  readonly open: Mark | null;
  /** Whether a tap, not a hover, opened it. */
  readonly pinned: boolean;
  show(mark: Mark, pin: boolean): void;
  hide(): void;
  /** Beside its mark again: the mark has moved, or the card's words have. */
  place(): void;
  destroy(): void;
}

/** A piece of a card: an element with its class and its words. */
export function part(tag: string, className: string, text = "") {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/** A small arrow blowing downwind, turned from `from` (none for null). */
export function arrowSvg(from: number | null) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "-6 -6 12 12");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "map-arrow");
  const turn = document.createElementNS(SVG, "g");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ARROW);
  turn.append(path);
  svg.append(turn);
  if (from === null) svg.style.display = "none";
  else turn.setAttribute("transform", `rotate(${Math.round(from + 180)})`);
  return { svg, turn };
}

export function createMapCard<Mark extends CardMark>(
  map: maplibregl.Map,
  /** Its own class, beside the shell's `map-card`. */
  kind: string,
  /** Writes what the card says about a mark. */
  fill: (mark: Mark, card: HTMLElement) => void,
): MapCard<Mark> {
  const card = document.createElement("div");
  card.className = `map-card ${kind}`;
  card.setAttribute("role", "tooltip");
  card.id = `map-card-${Math.random().toString(36).slice(2, 8)}`;
  card.hidden = true;
  map.getContainer().append(card);
  let open: Mark | null = null;
  let pinned = false;

  /** Beside its mark: above it, or below where there is no room. */
  const place = () => {
    if (!open || card.hidden) return;
    const frame = map.getContainer().getBoundingClientRect();
    const r = open.button.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const cx = r.left + r.width / 2 - frame.left;
    const left = Math.max(8, Math.min(frame.width - w - 8, cx - w / 2));
    const above = r.top - frame.top - h - 8;
    const top = above >= 8 ? above : r.bottom - frame.top + 8;
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };

  const shut = () => {
    if (!open) return;
    open.button.removeAttribute("aria-describedby");
    open.el.classList.remove("is-open");
    open = null;
  };
  const show = (mark: Mark, pin: boolean) => {
    if (open !== mark) shut();
    open = mark;
    pinned = pin;
    fill(mark, card);
    card.hidden = false;
    mark.button.setAttribute("aria-describedby", card.id);
    mark.el.classList.add("is-open");
    place();
  };
  const hide = () => {
    shut();
    pinned = false;
    card.hidden = true;
  };

  // A tap anywhere else lets go of a card a tap opened; so does a move.
  const away = (event: PointerEvent) => {
    if (!pinned || !open) return;
    const at = event.target as Node;
    if (open.el.contains(at) || card.contains(at)) return;
    hide();
  };
  window.addEventListener("pointerdown", away, true);
  // First, on its way down: the lights keep Escape from the page.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) hide();
  };
  window.addEventListener("keydown", onKey, true);
  map.on("move", place);

  return {
    el: card,
    get open() {
      return open;
    },
    get pinned() {
      return pinned;
    },
    show,
    hide,
    place,
    destroy() {
      hide();
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", onKey, true);
      map.off("move", place);
      card.remove();
    },
  };
}
