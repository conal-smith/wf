/**
 * The tour: seven cards, each with the pen's ring round the real thing on
 * the chart it is about (the lights, a spot's hours, sliding them, the loupe,
 * the blend, the menu, the layers), and a last card that offers Settings.
 * Back, Next, Skip tour, and Escape leaves. Its own chunk, fetched when the
 * tour is taken, from the first visit's offer or the site menu.
 *
 * The cards name what they point at and say nothing on the chart itself:
 * the ring is the one mark (the owner's ruling, 23 October 2026: no
 * written commentary on the chart or the dock).
 *
 * It finds its targets by the chart's own classes, so a change to the dock
 * moves a target here with it: `TARGETS` is the one list of them.
 */
import "./tour.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FocusStyle } from "../force5/src/focus";
import { Button } from "../ui/Button";
import { Puffin } from "../ui/Puffin";
import type { DockView } from "./ForecastDock";
import type { MapPanel } from "./MapControls";

/** A box with rounded corners of radius `r`, as one SVG path. */
function roundBox(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  return (
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the tour may do to the chart, and what it was when the tour began. */
export interface TourProps {
  phone: boolean;
  /** The spot open in the dock, if any, and a way to open one or close it. */
  spot: string | null;
  onSpot: (id: string | null) => void;
  view: DockView;
  onView: (view: DockView) => void;
  focusStyle: FocusStyle;
  onFocusStyle: (style: FocusStyle) => void;
  onPanel: (panel: MapPanel) => void;
  /** Skipped, or finished; with Customise asked for at the end. */
  onEnd: (customise: boolean) => void;
}

/** Where each card's ring goes: the chart's own classes, in one place. */
const TARGETS = {
  light: ".spot-marker",
  dock: ".map-footer .dock",
  dockTools: "#dk-tools",
  hours: [".dock tr.tt-day", ".dock tr.tt-hour"],
  hoursWrap: ".dock .tt-wrap",
  // The loupe's sheet is the whole map: its rim and the reading under it are the loupe.
  loupe: [".map-loupe .map-loupe-rim", ".map-loupe .map-loupe-foot-box"],
  blend: [".dock tr.tt-blend", ".dock .blend-chart"],
  menu: '.map-head [aria-label="Site menu"]',
  layers: "dialog[open]",
} as const;

const box = (el: Element | null): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height
    ? { x: r.left, y: r.top, w: r.width, h: r.height }
    : null;
};
const union = (boxes: (Box | null)[]): Box | null => {
  const all = boxes.filter((b): b is Box => !!b);
  if (!all.length) return null;
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...all.map((b) => b.x + b.w)) - x,
    h: Math.max(...all.map((b) => b.y + b.h)) - y,
  };
};
const pad = (b: Box | null, by: number) =>
  b && { x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 };
const clip = (b: Box | null, to: Box | null) => {
  if (!b || !to) return b;
  const x = Math.max(b.x, to.x);
  const w = Math.min(b.x + b.w, to.x + to.w) - x;
  return w > 0 ? { ...b, x, w } : null;
};

/** The best light on the screen, by the stars it shows: the one the first card rings. */
function bestLight(): HTMLElement | null {
  const stars = (el: Element) => {
    for (let n = 5; n >= 0; n--) if (el.classList.contains(`s${n}`)) return n;
    return -1;
  };
  const W = innerWidth;
  const H = innerHeight;
  let best: HTMLElement | null = null;
  for (const el of document.querySelectorAll<HTMLElement>(TARGETS.light)) {
    const b = box(el);
    // Clear of the head and the dock, where a ring can be seen whole.
    if (!b || b.x < 40 || b.x > W - 60 || b.y < 110 || b.y > H * 0.62) continue;
    if (!best || stars(el) > stars(best)) best = el;
  }
  return best;
}

interface Step {
  id: string;
  title: string;
  body: string;
  /** Sets the chart up for the card; the card waits for its target to settle. */
  prep?: (props: TourProps, tour: { light: string | null }) => void;
  target?: (tour: { light: string | null }) => Box | null;
  final?: boolean;
}

const STEPS: Step[] = [
  {
    id: "lights",
    title: "Spots on the map",
    body: "Each circle on the map is a place to ride. The number inside is how good the riding is there, from 0 to 5 stars, and the arrow shows which way the wind is blowing.",
    prep: (p) => p.spot && p.onSpot(null),
    target: (t) => {
      const light =
        (t.light &&
          document.querySelector(
            `${TARGETS.light}[data-spot-id="${t.light}"]`,
          )) ||
        bestLight();
      t.light = (light as HTMLElement | null)?.dataset.spotId ?? null;
      return pad(box(light), 12);
    },
  },
  {
    id: "dock",
    title: "A spot’s forecast",
    body: "Tap any spot to see its forecast hour by hour: the stars, the wind speed and gusts, which way the wind is blowing, and the size of wing to use.",
    prep: (p, t) => {
      const id = p.spot ?? t.light;
      if (id) p.onSpot(id);
    },
    target: () =>
      union([
        box(document.querySelector(TARGETS.dock)),
        box(document.querySelector(TARGETS.dockTools)),
      ]),
  },
  {
    id: "hours",
    title: "Pick a time",
    body: "Tap an hour, or slide the hours sideways, to pick a time. The whole map then shows the wind and stars for that time.",
    target: () =>
      clip(
        pad(union(TARGETS.hours.map((s) => box(document.querySelector(s)))), 2),
        box(document.querySelector(TARGETS.hoursWrap)),
      ),
  },
  {
    id: "loupe",
    title: "Which ways you can ride",
    body: "This compass shows which directions you can ride from the spot at the time you picked. You can’t ride towards the striped part, because it is too close to where the wind comes from. Red on the edge means the wind is blowing out to sea.",
    prep: (p) => p.onFocusStyle("loupe"),
    target: () =>
      pad(union(TARGETS.loupe.map((s) => box(document.querySelector(s)))), 6),
  },
  {
    id: "blend",
    title: "Compare forecasts",
    body: "The Blend button shows the wind from several different weather forecasts on one chart. When the lines are close together, the forecasts agree. When they are far apart, the forecast is less certain.",
    prep: (p) => p.onView("blend"),
    target: () => {
      const chart =
        TARGETS.blend
          .map((s) => box(document.querySelector(s)))
          .find(Boolean) ?? null;
      return clip(chart, box(document.querySelector(TARGETS.hoursWrap)));
    },
  },
  {
    id: "menu",
    title: "The menu",
    body: "The menu has the spot finder, which lists the best places to ride this week. It also has Settings, map layers, a guide to the map, and this tour.",
    target: () => pad(box(document.querySelector(TARGETS.menu)), 4),
  },
  {
    id: "layers",
    title: "Map layers",
    body: "Here you can add more to the map, such as water depth, tidal currents, rain and satellite photos. You can also choose which forecast the map and the stars use. You don’t need any of this to see the wind and stars.",
    prep: (p) => p.onPanel("layers"),
    target: () => pad(box(document.querySelector(TARGETS.layers)), 4),
  },
  {
    id: "end",
    title: "That’s the end of the tour",
    body: "You can make the stars match how you ride. In Settings, set your weight, the units for wind speed, the wind you like, which wind directions work for you, and how far upwind you ride.",
    final: true,
  },
];
/** The cards that count: every one but the last. */
const COUNT = STEPS.length - 1;

export default function Tour(props: TourProps) {
  const [at, setAt] = useState(0);
  const [ring, setRing] = useState<Box | null>(null);
  const [host, setHost] = useState<Element>(document.body);
  const tour = useRef({ light: null as string | null });
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  // The chart as it was, put back as the tour leaves.
  const [was] = useState(() => ({
    spot: props.spot,
    view: props.view,
    focusStyle: props.focusStyle,
  }));
  const live = useRef(props);
  live.current = props;
  const step = STEPS[at];

  const end = (customise: boolean) => {
    const p = live.current;
    p.onPanel(null);
    p.onView(was.view);
    p.onFocusStyle(was.focusStyle);
    p.onSpot(was.spot);
    p.onEnd(customise);
  };
  const endRef = useRef(end);
  endRef.current = end;

  // Each card sets the chart up, then follows its target as the chart
  // settles (the dock slides in, the camera flies) and as the window moves.
  useEffect(() => {
    const p = live.current;
    // Back or on, whatever an earlier card opened that this one does not need is put away.
    if (step.id !== "layers") p.onPanel(null);
    if (step.id !== "blend") p.onView(was.view);
    if (at < 3) p.onFocusStyle(was.focusStyle);
    step.prep?.(p, tour.current);
    setRing(null);
    let stop = false;
    const measure = () => {
      if (stop) return;
      setHost(document.querySelector("dialog[open]") ?? document.body);
      setRing(step.target?.(tour.current) ?? null);
    };
    const timer = window.setInterval(measure, 200);
    const first = window.setTimeout(measure, 60);
    return () => {
      stop = true;
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [at]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Before the map's own Escape, and the layers' dialog's: it leaves the tour.
      event.preventDefault();
      event.stopPropagation();
      endRef.current(false);
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);

  useEffect(() => next.current?.focus({ preventScroll: true }), [at]);

  // The card beside its target, clear of it where there is room.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const W = innerWidth;
    const H = innerHeight;
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;
    const gap = 28;
    let x = (W - cw) / 2;
    let y = (H - ch) / 2;
    const t = ring;
    if (t && props.phone) {
      x = (W - cw) / 2;
      const above = t.y - ch - gap;
      const below = t.y + t.h + gap;
      y =
        t.y + t.h / 2 > H / 2
          ? above >= 60
            ? above
            : 60
          : below + ch <= H - 8
            ? below
            : H - ch - 8;
    } else if (t) {
      const right = t.x + t.w + gap;
      const left = t.x - cw - gap;
      if (t.w < W * 0.55 && right + cw < W - 16) {
        x = right;
        y = t.y + t.h / 2 - ch / 2;
      } else if (t.w < W * 0.55 && left > 16) {
        x = left;
        y = t.y + t.h / 2 - ch / 2;
      } else {
        x = Math.min(W - cw - 24, Math.max(24, t.x + t.w / 2 - cw / 2));
        y =
          t.y - ch - gap > 70
            ? t.y - ch - gap
            : t.y + t.h + gap + ch < H
              ? t.y + t.h + gap
              : 70;
      }
      y = Math.min(H - ch - 10, Math.max(70, y));
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  });

  const W = innerWidth;
  const H = innerHeight;
  // Whole pixels, so the four panes meet without a seam.
  const t = ring && {
    x: Math.floor(ring.x),
    y: Math.floor(ring.y),
    w: Math.ceil(ring.w),
    h: Math.ceil(ring.h),
  };
  return createPortal(
    <div className="tour" data-step={step.id}>
      {/* The site's backdrop round the target (ui/Backdrop.tsx), with a hole cut
          for it: the target itself stays sharp and in reach. */}
      <div
        className="tour-dim scrim"
        style={
          t
            ? {
                clipPath: `path(evenodd, "M0 0H${W}V${H}H0Z M${t.x} ${t.y}h${t.w}v${t.h}h${-t.w}Z")`,
              }
            : undefined
        }
      />
      {t && (
        <svg className="tour-ring" width={W} height={H} aria-hidden="true">
          <path
            key={step.id}
            d={roundBox(t.x - 5, t.y - 5, t.w + 10, t.h + 10, 14)}
          />
        </svg>
      )}
      <div
        ref={card}
        className="tour-card chart-box"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-card-t"
        aria-describedby="tour-card-p"
      >
        <div className="tour-k">
          <span>
            {step.final ? "Tour finished" : `Step ${at + 1} of ${COUNT}`}
          </span>
          <Button
            variant="quiet"
            size="sm"
            className="tour-skip"
            onClick={() => end(false)}
          >
            {step.final ? "Close" : "Skip tour"}
          </Button>
        </div>
        <div className="tour-say">
          <div>
            <h3 id="tour-card-t">{step.title}</h3>
            <p id="tour-card-p">{step.body}</p>
          </div>
          <Puffin size={step.final ? 66 : 46} bob />
        </div>
        <div className="tour-foot">
          {!step.final && (
            <span className="tour-dots" aria-hidden="true">
              {STEPS.slice(0, COUNT).map((s, i) => (
                <i key={s.id} className={i <= at ? "is-on" : undefined} />
              ))}
            </span>
          )}
          <span className="tour-sp" />
          {at > 0 && !step.final && (
            <Button variant="pill" size="sm" onClick={() => setAt(at - 1)}>
              Back
            </Button>
          )}
          {step.final ? (
            <>
              <Button variant="pill" size="sm" onClick={() => end(false)}>
                Done
              </Button>
              <Button
                ref={next}
                variant="primary"
                size="sm"
                onClick={() => end(true)}
              >
                Open Settings
              </Button>
            </>
          ) : (
            <Button
              ref={next}
              variant="primary"
              size="sm"
              onClick={() => setAt(at + 1)}
            >
              {at === COUNT - 1 ? "Finish" : "Next"}
            </Button>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}
