/**
 * Left and Right step the dock's hour from anywhere on the map, not only once
 * the hours have been clicked into: after a reload, or back from a page over
 * the map, nothing has the focus, and the keys used to do nothing at all.
 *
 * They are the dock's unless the focus is on something whose own keys they
 * are: a text field, a list, a menu, a slider (the dock's own steps itself),
 * or the chart, whose arrows pan it.
 */

/** Controls that move a caret, a choice or a view with the arrow keys. */
const ARROW_OWNERS = [
  "input:not([type=checkbox]):not([type=button]):not([type=submit]):not([type=reset])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable=false])",
  ...[
    "slider",
    "spinbutton",
    "textbox",
    "searchbox",
    "combobox",
    "listbox",
    "option",
    "menu",
    "menubar",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
    "tablist",
    "tab",
    "radiogroup",
    "radio",
    "grid",
    "tree",
    "treegrid",
  ].map((role) => `[role=${role}]`),
  ".maplibregl-canvas",
].join(",");

/** Whether an arrow key pressed with the focus at `target` is free for the hours. */
export function arrowsFree(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== "function") return true;
  return !el.closest(ARROW_OWNERS);
}

/** The step Left or Right asks for, or 0 for any other key (or a chord). */
export function hourStep(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): -1 | 0 | 1 {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return 0;
  return event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
}
