import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "../ui/Button";
import { railGroups, type LayerGroup } from "./layerGroups";
import { railRoom, type Box } from "./railFit";
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
 * It is the one way to the layers, on a phone as on a desktop: there is no
 * panel behind it. Where it would run into the dock it scrolls, in the room
 * left above it. A finger has no pointer to rest on a button, so a tap says
 * the layer's name and whether it is now on, for a moment, where the pointer
 * shows it.
 *
 * It is a toolbar: one stop on Tab, the arrows walk it, Home and End go to
 * its ends. It stays mounted while it is shut, out of sight and inert.
 */
export default function LayerRail({
  id,
  groups,
  shown,
  layoutKey,
}: {
  id: string;
  groups: LayerGroup[];
  /** Open. */
  shown: boolean;
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
  // The layer a tap just switched, named beside it for a moment.
  const [told, setTold] = useState<string | null>(null);
  useEffect(() => {
    if (!told) return;
    const quiet = window.setTimeout(() => setTold(null), 1400);
    return () => window.clearTimeout(quiet);
  }, [told]);
  const stop = items.some((item) => item.id === current)
    ? current
    : (items[0]?.id ?? null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const below = [...document.querySelectorAll(BELOW)].map(resting);
      el.style.maxHeight = `${railRoom(el.getBoundingClientRect(), below, window.innerHeight, CLEAR)}px`;
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
  }, [layoutKey, count]);

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
              aria-description={item.note ?? undefined}
              pressed={item.on ? "worded" : false}
              tabIndex={item.id === stop ? 0 : -1}
              data-rail-layer={item.id}
              data-told={item.id === told || undefined}
              data-noted={!!item.note || undefined}
              onFocus={() => setCurrent(item.id)}
              onClick={(event) => {
                item.press();
                // A tap, not the keys or a mouse, which show the name already.
                if (event.detail && !matchMedia("(hover: hover)").matches)
                  setTold(item.id);
              }}
            >
              {item.glyph}
              <span className="lr-tip" aria-hidden="true">
                {item.name}
                <small> · {item.on ? "on" : "off"}</small>
                {item.note && (
                  <span className="lr-note" data-layer-note={item.id}>
                    {item.note}
                  </span>
                )}
              </span>
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}
