import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";
import { railGroups, type LayerGroup } from "./layerGroups";
import { railFits, type Box } from "./railFit";
import "./rail.css";

/**
 * What stands below the rail on the chart, which it must not run into: the
 * spot's tools on the dock's edge (src/ForecastDock.tsx), the dock under
 * them, and Gust's button over the dock.
 */
const BELOW = "#dk-tools, .map-footer, .gust-launcher";
/** How clear of them the rail keeps, at the least. */
const CLEAR = 12;

/**
 * Where a box stands at rest: the dock's tools are held under the pointer
 * by a `translate` while the dock grows under a click (src/ForecastDock.tsx),
 * and go back to its edge as the pointer leaves them, with no layout to say
 * so. The rail is judged against where they go back to.
 */
function resting(el: Element): Box {
  const box = el.getBoundingClientRect();
  const [, y = "0"] = getComputedStyle(el).translate.split(" ");
  const by = parseFloat(y) || 0;
  return {
    left: box.left,
    right: box.right,
    top: box.top - by,
    bottom: box.bottom - by,
  };
}

/**
 * The layers' rail: on a desktop, beside the zoom (src/MapControls.tsx), a
 * column of small round buttons, one a layer, with no panel behind them, so
 * the chart stays in view while the layers change. Off is faint and flat; on
 * is a paper disc ruled in ink. A layer's name shows to its left under the
 * pointer and on the keys' focus. The groups and their rules are the Layers
 * panel's own (src/layerGroups.tsx), each set apart by a short rule.
 *
 * It is a toolbar: one stop on Tab, the arrows walk it, Home and End go to
 * its ends. It stays mounted while it is shut, out of sight and inert, so it
 * can say whether it would fit: where it would run into the dock it is not
 * shown, and Layers opens the panel instead (`onFits`).
 */
export default function LayerRail({
  id,
  groups,
  shown,
  onFits,
  layoutKey,
}: {
  id: string;
  groups: LayerGroup[];
  /** Open, and room for it. */
  shown: boolean;
  /** Whether it fits above what is below it, as that changes. */
  onFits: (fits: boolean) => void;
  /** Changes as what is below it moves (the dock opens, grows or goes). */
  layoutKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rail = railGroups(groups);
  const items = rail.flatMap((group) => group.items);
  const count = items.length;
  // The one button Tab stops on: the last one the keys or the pointer were
  // on, else the first.
  const [current, setCurrent] = useState<string | null>(null);
  const stop = items.some((item) => item.id === current)
    ? current
    : (items[0]?.id ?? null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const below = [...document.querySelectorAll(BELOW)].map(resting);
      onFits(
        railFits(el.getBoundingClientRect(), below, window.innerHeight, CLEAR),
      );
    };
    measure();
    // Again as the dock opens, grows, shrinks or goes: the footer it stands
    // in changes its height each time, a frame or more after the render that
    // asked for it.
    const watch = new ResizeObserver(measure);
    document.querySelectorAll(BELOW).forEach((box) => watch.observe(box));
    // And as anything below it comes to rest after gliding (Gust's button
    // rises and falls with the dock), which no size change says.
    const settled = (event: TransitionEvent) => {
      if ((event.target as Element).matches?.(BELOW)) measure();
    };
    window.addEventListener("resize", measure);
    document.addEventListener("transitionend", settled);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionend", settled);
    };
  }, [onFits, layoutKey, count]);

  // The arrows walk the buttons, top to bottom, across the groups' rules.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(".lr-ic") ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      event.key === "ArrowDown"
        ? Math.min(at + 1, buttons.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(at - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    buttons[to].focus();
  };

  return (
    <div
      ref={ref}
      id={id}
      className="lr"
      role="toolbar"
      aria-label="Layers"
      aria-orientation="vertical"
      data-shown={shown}
      inert={!shown}
      onKeyDown={onKeyDown}
    >
      {rail.map((group) => (
        <div
          key={group.id}
          className="lr-grp"
          role="group"
          aria-label={group.name}
        >
          {group.items.map((item) => (
            <Button
              key={item.id}
              variant="quiet"
              size="sm"
              icon
              className="lr-ic"
              aria-label={item.name}
              pressed={item.on ? "worded" : false}
              tabIndex={item.id === stop ? 0 : -1}
              data-rail-layer={item.id}
              onFocus={() => setCurrent(item.id)}
              onClick={item.press}
            >
              {item.glyph}
              <span className="lr-tip" aria-hidden="true">
                {item.name}
                <small> · {item.on ? "on" : "off"}</small>
              </span>
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}
