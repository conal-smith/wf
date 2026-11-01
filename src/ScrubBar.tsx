/**
 * The chart's foot: a slim bar the full width of the map that moves the
 * chart's time (the owner's ruling of 2026-11-01, in place of the dock's
 * table of hours). Two rows: the controls on top (the spot, play and step,
 * what the strip draws, its key and Now), and under them the strip itself,
 * the whole forecast from now on along the full width, with a playhead a
 * finger or a mouse drags smoothly through it. A pill over the playhead reads
 * the moment out.
 *
 * With a spot chosen the strip draws its week: the wind (a fill in the map's
 * own wind colours, the gusts dashed over it), the waves or the tide, as the
 * rider picks, and under it one thin row of the stars as colour, the stars'
 * own shades from one to five. With none chosen it is a plain timeline: the
 * days, the night, now, and the playhead, which still moves the map.
 *
 * The detail the dock's table held (the gust factor, the current, the sky,
 * the rain, every model's own line) is on the spot's page, a link away
 * ("Full forecast →"), opened at the hour in hand.
 *
 * The strip shows a week at a time, the full width of the bar, and slides on
 * through the forecast's fifteen days as the playhead nears its edge: dragged
 * there, played, stepped, or with a wheel or a trackpad across it.
 *
 * The time stays the strip's columns underneath, as the map's frames are: the
 * playhead stops anywhere between two hours, and the column nearest it is the
 * one the map draws. The keys step whole hours (Left and Right) and days
 * (with Shift, or Page Up and Page Down), and snap the playhead to the hour.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers3,
  Pause,
  Play,
  X,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { StarGlyphs } from "../ui/StarGlyphs";
import { WindArrow } from "./glyphs";
import { arrowsFree, hourStep } from "./hourKeys";
import { daylightOn, type PlaceHour } from "./ratings";
import {
  clock,
  dayShort,
  dayStep,
  irishDate,
  nearestColumn,
  openingColumn,
  shownAt,
  shownColumns,
  stripDays,
  timeSpoken,
  type StripColumn,
} from "./strip";
import { useSpotSquares } from "./useSpotSquares";
import { useSpotWaves } from "./useBlend";
import type { ModelAvailability } from "../force5/src/manifests";
import type { NightHours } from "../force5/src/prefs";
import { spotSquare } from "../force5/src/spotData";
import { tideAt, type SpotTide } from "../force5/src/tides";
import { speedShort, unitLabel, type Units } from "../force5/src/units";
import { variableValue } from "../force5/src/variables";
import { compass, windCss, type Spot } from "../force5/src/weather";

/** What the strip draws for a spot. */
export type ScrubMode = "wind" | "waves" | "tide";
const MODES: readonly { value: ScrubMode; label: string }[] = [
  { value: "wind", label: "Wind" },
  { value: "waves", label: "Waves" },
  { value: "tide", label: "Tide" },
];
/** What the strip draws, kept on this device. */
const MODE_KEY = "wingfoil.map.scrub.v1";
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Best effort: the choice still holds for this page.
    }
  },
};
const isMode = (value: unknown): value is ScrubMode =>
  MODES.some((mode) => mode.value === value);

/** The night and the days with no spot chosen: the middle of Ireland's. */
const IRELAND_MIDDLE = { lat: 53.4, lon: -7.9 };

/** How fast play runs through the forecast: six hours a second. */
const PLAY_RATE = (6 * 3600000) / 1000;
const HOUR = 3600000;
/** What the strip shows at once: a week. */
const WINDOW = 7 * 24 * HOUR;
/** How near the edge the playhead comes before the week slides on. */
const EDGE = 0.08;
const NO_MODELS: readonly ModelAvailability[] = [];

/** The strip's drawing, in pixels: the curve, then the row of stars. */
const CURVE_TOP = 8;
const CURVE_BOTTOM = 52;
const STARS_Y = 58;
const STARS_H = 5;
const SPOT_HEIGHT = 64;
/** With no spot: the days and the night alone, in a slimmer strip. */
const BARE_HEIGHT = 34;

/** One stretch of hours with a star or more, and the stars of each. */
interface StarRun {
  from: number;
  to: number;
  stops: { at: number; stars: number }[];
}

export interface ScrubBarProps {
  columns: readonly StripColumn[];
  /** The column in hand, on the strip. */
  selected: number;
  onSelect: (at: number) => void;
  now: number;
  /** The spot or point chosen, or null: then a plain timeline. */
  spot: Spot | null;
  /** The spot is a point tapped on the map: no stars, no page of its own. */
  isPoint: boolean;
  /** The place's hours on the strip's columns, undefined while they are read. */
  hours: readonly (PlaceHour | undefined)[] | undefined;
  /** The tide at the place, where a station reaches it. */
  tide: SpotTide | null;
  /** The wave models, read once the waves are asked for. */
  marine: readonly ModelAvailability[];
  onWantMarine: () => void;
  /** Whose waves a point reads: a riding place near it, or none. */
  lender: Spot | null;
  units: Units;
  nightHours: NightHours;
  /** The spot's page, at the hour in hand; null where there is none. */
  href: string | null;
  onClose: () => void;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  /** A model that reaches the hour the map's own does not, and its chip. */
  reachable: { id: string; name: string } | null;
  onShowOnMap: () => void;
}

export default function ScrubBar({
  columns: strip,
  selected: stripSelected,
  onSelect: onSelectStrip,
  now,
  spot,
  isPoint,
  hours: stripHours,
  tide,
  marine,
  onWantMarine,
  lender,
  units,
  nightHours,
  href,
  onClose,
  playing,
  onPlaying,
  reachable,
  onShowOnMap,
}: ScrubBarProps) {
  const id = useId();
  const [mode, setModeState] = useState<ScrubMode>(() => {
    const saved = store.get(MODE_KEY);
    return isMode(saved) ? saved : "wind";
  });
  const setMode = (next: ScrubMode) => {
    setModeState(next);
    store.set(MODE_KEY, next);
  };
  const place = spot ?? IRELAND_MIDDLE;
  const stripAxis = useMemo(() => strip.map((c) => c.validTime), [strip]);

  // The night's hours, from last light to first, left out where the rider
  // has hidden them (Settings): the time then stops on the lit columns alone,
  // each day from its first light to its last, and the slider counts those.
  // Round the clock, as by default, every column is one to stop on.
  const shown = useMemo(() => {
    if (nightHours !== "hide" || !stripAxis.length) return null;
    // A day past the strip's end, so the night its last hour falls in is not
    // cut short at that hour (`dayNights` clips to the axis).
    const after = new Date(
      Date.parse(stripAxis[stripAxis.length - 1]) + 86400000,
    ).toISOString();
    return shownColumns(
      daylightOn(place, [...stripAxis, after], { boundary: "civil" }).slice(
        0,
        -1,
      ),
    );
  }, [nightHours, place.lat, place.lon, stripAxis]);
  const stops = useMemo(
    () => (shown ? shown.map((at) => strip[at]) : strip),
    [shown, strip],
  );
  const stopDays = useMemo(() => stripDays(stops), [stops]);
  const selected = shown ? shownAt(shown, stripSelected) : stripSelected;
  const onSelect = (at: number) =>
    onSelectStrip(shown ? (shown[at] ?? stripSelected) : at);
  // A time in the hidden night moves on to the next first light, so the
  // playhead and the map's hour agree.
  useEffect(() => {
    if (
      shown &&
      shown[selected] !== undefined &&
      shown[selected] !== stripSelected
    )
      onSelectStrip(shown[selected]);
  }, [shown, selected, stripSelected]);

  const t0 = strip[0]?.time ?? now;
  const t1 = strip[strip.length - 1]?.time ?? now + HOUR;
  const column = strip[stripSelected];
  /** The week in view: where it starts, and how long it is. */
  const span = Math.max(HOUR, Math.min(WINDOW, t1 - t0));
  const [w0, setW0] = useState(t0);
  const view0 = Math.max(t0, Math.min(t1 - span, w0));
  const w0Ref = useRef(view0);
  w0Ref.current = view0;
  /** Slide the week so that `time` is in view, clear of its edges. */
  const reveal = (time: number) => {
    const from = w0Ref.current;
    const margin = span * EDGE;
    let next = from;
    if (time < from + margin) next = time - margin;
    else if (time > from + span - margin) next = time - span + margin;
    next = Math.max(t0, Math.min(t1 - span, next));
    if (next !== from) {
      w0Ref.current = next;
      setW0(next);
    }
  };

  /* ---- the playhead: a time, anywhere between two hours ---- */

  const [pos, setPos] = useState(() => column?.time ?? now);
  const posRef = useRef(pos);
  posRef.current = pos;
  /** The column the playhead last asked for, to tell its own change from another's. */
  const asked = useRef(stripSelected);
  // The time moved by anything but the playhead (a key, Now, a model's
  // hand-over, a tab coming back): the playhead goes to that hour.
  useEffect(() => {
    if (stripSelected === asked.current || !column) return;
    asked.current = stripSelected;
    setPos(column.time);
    reveal(column.time);
  }, [stripSelected, column?.time]);
  /** Move the playhead to a time; the nearest column it may stop on is the map's. */
  const moveTo = (time: number) => {
    const t = Math.max(t0, Math.min(t1, time));
    reveal(t);
    const at = nearestColumn(stops, t);
    const to = shown ? shown[at] : at;
    // In the hidden night the playhead rests on the hour it stops at.
    setPos(shown && Math.abs(strip[to].time - t) > HOUR ? strip[to].time : t);
    if (to !== asked.current) {
      asked.current = to;
      onSelectStrip(to);
    }
  };
  const moveRef = useRef(moveTo);
  moveRef.current = moveTo;

  // Play: the playhead runs on through the forecast, smoothly, and stops at
  // its end. From the end, it starts again from now.
  useEffect(() => {
    if (!playing) return;
    if (posRef.current >= t1)
      moveRef.current(strip[openingColumn(strip, now)]?.time ?? t0);
    let last = performance.now();
    let frame = requestAnimationFrame(function run(at) {
      const next = posRef.current + (at - last) * PLAY_RATE;
      last = at;
      moveRef.current(next);
      if (next >= t1) return onPlaying(false);
      frame = requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, t1]);

  /* ---- the strip's size, and its scale ---- */

  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const x = (time: number) => ((time - view0) / span) * width;
  const timeAt = (px: number) => view0 + (px / Math.max(1, width)) * span;

  // A drag held past either edge of the strip runs on through the forecast,
  // the week sliding with it, until the pointer comes back or lets go.
  const dragging = useRef<number | null>(null);
  const pushing = useRef(0);
  useEffect(() => {
    let frame = 0;
    const run = () => {
      if (pushing.current && dragging.current !== null)
        moveRef.current(posRef.current + pushing.current * span * 0.012);
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [span]);
  const pointerTo = (clientX: number) => {
    if (!track.current) return;
    const box = track.current.getBoundingClientRect();
    const px = clientX - box.left;
    pushing.current = px < 0 ? -1 : px > box.width ? 1 : 0;
    if (!pushing.current) moveTo(timeAt(px));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !track.current) return;
    event.preventDefault();
    dragging.current = event.pointerId;
    try {
      track.current.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer knows: the drag goes on without.
    }
    if (playing) onPlaying(false);
    pointerTo(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== event.pointerId) return;
    pointerTo(event.clientX);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    pushing.current = 0;
  };
  // A wheel or a trackpad across the strip slides the week, the playhead
  // staying on its hour.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (!delta || span >= t1 - t0) return;
      event.preventDefault();
      const next = Math.max(
        t0,
        Math.min(
          t1 - span,
          w0Ref.current + (delta / Math.max(1, el.clientWidth)) * span,
        ),
      );
      w0Ref.current = next;
      setW0(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [span, t0, t1]);

  // Left and Right step the hour wherever the focus is, unless it is in a
  // control whose own keys they are (src/hourKeys.ts); with Shift, a day.
  // A page over the map leaves the bar mounted but inert, and its keys alone.
  const bar = useRef<HTMLDivElement>(null);
  const keyed = useRef({
    selected,
    count: stops.length,
    onSelect,
    stops,
    stopDays,
  });
  keyed.current = { selected, count: stops.length, onSelect, stops, stopDays };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const shift =
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft");
      const step = hourStep(event);
      if ((!step && !shift) || event.defaultPrevented) return;
      if (!arrowsFree(event.target)) return;
      if (bar.current?.closest("[inert]")) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      const { selected, count, onSelect, stops, stopDays } = keyed.current;
      const next = shift
        ? dayStep(
            stops,
            stopDays,
            selected,
            event.key === "ArrowRight" ? 1 : -1,
          )
        : Math.max(0, Math.min(count - 1, selected + step));
      if (next === selected) return;
      keyed.current.selected = next;
      onSelect(next);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  /* ---- what the strip draws ---- */

  const named = !!spot;
  // Tide where no station reaches the place (the switch then disabled):
  // the wind, rather than an empty strip.
  const shows: ScrubMode = mode === "tide" && !tide ? "wind" : mode;
  useEffect(() => {
    if (named && shows === "waves") onWantMarine();
  }, [named, shows]);
  const square = useMemo(
    () => (lender ? [spotSquare(lender.lat, lender.lon)] : null),
    [lender?.lat, lender?.lon],
  );
  const waveModels = useSpotSquares(
    named && shows === "waves" ? marine : NO_MODELS,
    square,
  );
  const waves = useSpotWaves(waveModels, lender?.id, stripAxis);

  const daylight = useMemo(
    () => daylightOn(place, stripAxis),
    [place.lat, place.lon, stripAxis],
  );

  /** Each column's value in the mode, and its gust where it has one. */
  const series = useMemo(() => {
    if (!named) return null;
    if (shows === "wind")
      return strip.map((_, at) => ({
        v: stripHours?.[at]?.windKn ?? null,
        g: stripHours?.[at]?.gustKn ?? null,
      }));
    if (shows === "waves") {
      const height = waves.source?.fields.total.height;
      return strip.map((_, at) => {
        const step = waves.columns[at];
        return {
          v: height && step ? variableValue(step, height) : null,
          g: null,
        };
      });
    }
    return strip.map((c) => ({
      v: tide ? tideAt(tide.curve, c.time) : null,
      g: null,
    }));
  }, [named, shows, strip, stripHours, waves, tide]);

  /** The value scale: from the floor to a round top over the week's highest. */
  const scale = useMemo(() => {
    const values = (series ?? []).flatMap((s) =>
      [s.v, s.g].filter((v): v is number => v !== null),
    );
    if (shows === "tide" && values.length)
      return {
        low: Math.min(...values),
        high: Math.max(Math.max(...values), Math.min(...values) + 1),
      };
    const top = Math.max(shows === "wind" ? 25 : 1.5, ...values) * 1.08;
    return { low: 0, high: top };
  }, [series, shows]);
  const y = (value: number) =>
    CURVE_BOTTOM -
    ((value - scale.low) / Math.max(0.01, scale.high - scale.low)) *
      (CURVE_BOTTOM - CURVE_TOP);

  /** The stars of each column; a warning or a notice that takes them away has none. */
  const starsOf = (hour: PlaceHour | undefined) =>
    hour?.warning?.replacesRating || hour?.water?.replacesRating
      ? 0
      : (hour?.rating?.stars ?? 0);
  const starRuns = useMemo<StarRun[]>(() => {
    if (!named || isPoint || !stripHours) return [];
    const runs: StarRun[] = [];
    let run: StarRun | null = null;
    strip.forEach((c, at) => {
      const stars = starsOf(stripHours[at]);
      if (stars >= 1) {
        // Each column's share of the strip: halfway to its neighbours.
        const before = at > 0 ? (strip[at - 1].time + c.time) / 2 : c.time;
        const after =
          at < strip.length - 1 ? (strip[at + 1].time + c.time) / 2 : c.time;
        if (!run) run = { from: before, to: after, stops: [] };
        run.to = after;
        run.stops.push({ at: c.time, stars });
      } else if (run) {
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    return runs;
  }, [named, isPoint, strip, stripHours]);

  /** The night's stretches, each from its first dark column to its last. */
  const nights = useMemo(() => {
    const out: { from: number; to: number }[] = [];
    strip.forEach((c, at) => {
      if (daylight[at]) return;
      const before = at > 0 ? (strip[at - 1].time + c.time) / 2 : c.time;
      const after =
        at < strip.length - 1 ? (strip[at + 1].time + c.time) / 2 : c.time;
      const last = out[out.length - 1];
      if (last && Math.abs(last.to - before) < 1) last.to = after;
      else out.push({ from: before, to: after });
    });
    return out;
  }, [strip, daylight]);

  const days = useMemo(() => stripDays(strip), [strip]);

  /** The curve through the columns, smoothed, and the area under it. */
  const curve = useMemo(() => {
    if (!series || !width) return null;
    // A stretch with no value (a source that ends, or has a gap) breaks the
    // curve rather than drawing a line across it.
    const runs = (
      pick: (s: { v: number | null; g: number | null }) => number | null,
    ) => {
      const out: (readonly [number, number])[][] = [];
      let run: (readonly [number, number])[] = [];
      series.forEach((s, at) => {
        const v = pick(s);
        if (v === null) {
          if (run.length) out.push(run);
          run = [];
        } else run.push([x(strip[at].time), y(v)] as const);
      });
      if (run.length) out.push(run);
      return out.filter((r) => r.length > 1);
    };
    const lines = runs((s) => s.v);
    if (!lines.length) return null;
    const line = lines.map(smooth).join(" ");
    const area = lines
      .map(
        (points) =>
          `${smooth(points)} L${points[points.length - 1][0].toFixed(1)},${CURVE_BOTTOM} L${points[0][0].toFixed(1)},${CURVE_BOTTOM} Z`,
      )
      .join(" ");
    const gusts = runs((s) => s.g);
    return {
      line,
      area,
      gust: gusts.length ? gusts.map(smooth).join(" ") : null,
    };
  }, [series, width, scale, view0, span]);

  /* ---- the moment the playhead is at ---- */

  const reading = useMemo(() => {
    if (!series) return null;
    const after = strip.findIndex((c) => c.time >= pos);
    const b = after < 0 ? strip.length - 1 : after;
    const a = Math.max(0, b - 1);
    const f =
      strip[b].time === strip[a].time
        ? 0
        : (pos - strip[a].time) / (strip[b].time - strip[a].time);
    const near = f < 0.5 ? a : b;
    const mix = (va: number | null, vb: number | null) =>
      va === null ? vb : vb === null ? va : va + (vb - va) * f;
    const hour = stripHours?.[near];
    return {
      value:
        shows === "tide" && tide
          ? tideAt(tide.curve, pos)
          : mix(series[a].v, series[b].v),
      gust: mix(series[a].g, series[b].g),
      from: hour?.from ?? null,
      hour,
      at: near,
    };
  }, [series, pos, strip, stripHours, shows, tide]);

  /* ---- the bubble over the playhead, kept inside the bar ---- */

  const bubble = useRef<HTMLDivElement>(null);
  const [bubbleWidth, setBubbleWidth] = useState(0);
  useLayoutEffect(() => {
    if (bubble.current) setBubbleWidth(bubble.current.offsetWidth);
  });
  const playX = x(pos);
  const barPad = 14;
  const bubbleX = Math.max(
    bubbleWidth / 2 - barPad + 4,
    Math.min(width - bubbleWidth / 2 + barPad - 4, playX),
  );

  const label = spot
    ? `Forecast for ${spot.name}`
    : "Forecast time, for the whole chart";
  const atNow = column ? Math.abs(column.time - now) <= 90 * 60000 : false;
  const height = named ? SPOT_HEIGHT : BARE_HEIGHT;

  return (
    <div
      ref={bar}
      className={`scrub${named ? "" : " is-bare"}`}
      role="region"
      aria-label={label}
      tabIndex={-1}
      data-spot={spot?.id || undefined}
      // The place's hours are in: the strip draws them.
      data-ready={(named && !!stripHours) || undefined}
    >
      {reachable && (
        <div className="map-reach" role="status">
          <button
            type="button"
            className="map-reach-chip"
            onClick={onShowOnMap}
          >
            <Layers3 size={13} strokeWidth={1.5} aria-hidden="true" />
            <span>Show {reachable.name} on the map</span>
          </button>
        </div>
      )}

      <div
        ref={bubble}
        className="sb-pill"
        aria-hidden="true"
        data-stars={
          reading && !isPoint && reading.hour?.rating
            ? starsOf(reading.hour)
            : undefined
        }
        style={{
          transform: `translateX(${bubbleX + barPad}px) translateX(-50%)`,
        }}
      >
        <span className="sb-pill-time">{momentWords(pos)}</span>
        {reading && (
          <Reading
            reading={reading}
            mode={shows}
            units={units}
            isPoint={isPoint}
            dark={!daylight[reading.at]}
            tide={tide}
            pos={pos}
          />
        )}
      </div>

      <div className="sb-top">
        {spot ? (
          <div className="sb-spot">
            <h2 className="sb-name" title={spot.name}>
              {spot.name}
            </h2>
            {isPoint && spot.county && (
              <span className="sb-coords">{spot.county}</span>
            )}
            {href && (
              <a className="sb-link" href={href} data-spot-page-link>
                Full forecast <span aria-hidden="true">→</span>
              </a>
            )}
            <Button
              variant="quiet"
              size="sm"
              icon
              className="sb-close"
              aria-label={`Close the forecast for ${spot.name}`}
              onClick={onClose}
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
        <div className="sb-transport">
          <Button
            variant="quiet"
            size="sm"
            icon
            aria-label="An hour back"
            onClick={() => onSelect(Math.max(0, selected - 1))}
          >
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon
            className="sb-play"
            aria-label={playing ? "Pause" : "Play through the forecast"}
            pressed={playing}
            onClick={() => onPlaying(!playing)}
          >
            {playing ? (
              <Pause size={15} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Play size={15} strokeWidth={2} aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="quiet"
            size="sm"
            icon
            aria-label="An hour on"
            onClick={() => onSelect(Math.min(stops.length - 1, selected + 1))}
          >
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
        {!spot && <p className="sb-hint">Tap a spot for its forecast</p>}
        <span className="sb-space" />
        {spot && (
          <Segmented<ScrubMode>
            size="sm"
            className="sb-modes"
            aria-label="What the strip shows"
            options={MODES.map((m) => ({
              ...m,
              disabled: m.value === "tide" && !tide,
            }))}
            value={shows}
            onChange={setMode}
          />
        )}
        {spot && <Key mode={shows} units={units} stars={!isPoint} />}
        <Button
          variant="outline"
          size="sm"
          className="sb-now"
          data-at-now={atNow || undefined}
          onClick={() => {
            onPlaying(false);
            onSelectStrip(openingColumn(strip, now));
          }}
        >
          Now
        </Button>
      </div>

      <div
        ref={track}
        className="sb-strip"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true">
            <defs>
              <pattern
                id={`${id}hatch`}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="5" className="sb-hatch" />
              </pattern>
              {curve && shows === "wind" && (
                <linearGradient
                  id={`${id}wind`}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  x2={width}
                  y1={0}
                  y2={0}
                >
                  {series!.map((s, at) =>
                    s.v === null ? null : (
                      <stop
                        key={at}
                        offset={Math.max(
                          0,
                          Math.min(1, x(strip[at].time) / width),
                        )}
                        stopColor={windCss(s.v)}
                      />
                    ),
                  )}
                </linearGradient>
              )}
              <linearGradient id={`${id}fade`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.35" />
              </linearGradient>
              <mask id={`${id}mask`}>
                <rect
                  width={width}
                  height={CURVE_BOTTOM}
                  fill={`url(#${id}fade)`}
                />
              </mask>
              {starRuns.map((run, i) => (
                <linearGradient
                  key={i}
                  id={`${id}stars${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x(run.from)}
                  x2={x(run.to)}
                  y1={0}
                  y2={0}
                >
                  {run.stops.map((stop) => (
                    <stop
                      key={stop.at}
                      offset={
                        (stop.at - run.from) / Math.max(1, run.to - run.from)
                      }
                      style={{
                        stopColor: `var(--color-stars-${Math.min(5, stop.stars)})`,
                      }}
                    />
                  ))}
                </linearGradient>
              ))}
              <clipPath id={`${id}week`}>
                <rect x={0} y={-2} width={width} height={height + 4} />
              </clipPath>
            </defs>

            {/* The week in view: the forecast either side of it is clipped
                at the strip's edges, the playhead's knob alone allowed past. */}
            <g clipPath={`url(#${id}week)`}>
              {nights.map((n) => (
                <rect
                  key={n.from}
                  className="sb-night"
                  x={x(n.from)}
                  y={0}
                  width={Math.max(0, x(n.to) - x(n.from))}
                  height={named ? STARS_Y - 2 : height - 14}
                  fill={`url(#${id}hatch)`}
                />
              ))}
              {days.slice(1).map((d) => {
                const at = x(
                  strip[d.start].time -
                    (strip[d.start].time - strip[d.start - 1].time) / 2,
                );
                return (
                  <line
                    key={d.date}
                    className="sb-day"
                    x1={at}
                    x2={at}
                    y1={0}
                    y2={named ? STARS_Y - 2 : height - 14}
                  />
                );
              })}

              {curve && (
                <g data-curve={shows}>
                  <path
                    className={`sb-area is-${shows}`}
                    d={curve.area}
                    fill={shows === "wind" ? `url(#${id}wind)` : undefined}
                    mask={`url(#${id}mask)`}
                  />
                  <path className={`sb-line is-${shows}`} d={curve.line} />
                  {curve.gust && <path className="sb-gust" d={curve.gust} />}
                </g>
              )}

              {named && !isPoint && (
                <g className="sb-stars" data-stars>
                  <rect
                    className="sb-stars-track"
                    x={0}
                    y={STARS_Y}
                    width={width}
                    height={STARS_H}
                    rx={STARS_H / 2}
                  />
                  {starRuns.map((run, i) => (
                    <rect
                      key={i}
                      x={x(run.from)}
                      y={STARS_Y}
                      width={Math.max(STARS_H, x(run.to) - x(run.from))}
                      height={STARS_H}
                      rx={STARS_H / 2}
                      fill={`url(#${id}stars${i})`}
                    />
                  ))}
                </g>
              )}

              {/* The hours gone, faded, and the line at now. */}
              {now > view0 && (
                <rect
                  className="sb-past"
                  x={0}
                  y={0}
                  width={Math.max(0, Math.min(width, x(now)))}
                  height={height}
                />
              )}
              {now >= view0 && now <= view0 + span && (
                <line
                  className="sb-now-line"
                  data-now
                  x1={x(now)}
                  x2={x(now)}
                  y1={0}
                  y2={named ? STARS_Y + STARS_H : height - 14}
                />
              )}
            </g>

            <g
              className="sb-head"
              transform={`translate(${playX.toFixed(1)} 0)`}
            >
              <line
                x1={0}
                x2={0}
                y1={2}
                y2={named ? STARS_Y + STARS_H + 2 : height - 12}
              />
              {reading?.value != null && curve && (
                <circle
                  className="sb-dot"
                  cx={0}
                  cy={y(reading.value)}
                  r={3.5}
                />
              )}
              <circle className="sb-knob" cx={0} cy={4} r={6.5} />
            </g>
          </svg>
        )}
        <DayLabels
          days={days}
          strip={strip}
          x={x}
          width={width}
          selectedDate={column?.date}
        />
      </div>

      {/* The time, for a keyboard and a screen reader: the strip is the
          slider a finger and a mouse use, and this steps it. Out of sight;
          its focus ring is drawn on the strip. */}
      <input
        type="range"
        className="sr-only sb-time"
        aria-label="Forecast time"
        min={0}
        max={Math.max(0, stops.length - 1)}
        step={1}
        value={selected}
        aria-valuetext={column ? timeSpoken(column.time) : ""}
        onChange={(event) => onSelect(Number(event.target.value))}
        onKeyDown={(event) => {
          // A day at a time with Page Up and Page Down, to the same hour.
          if (event.key !== "PageUp" && event.key !== "PageDown") return;
          event.preventDefault();
          onSelect(
            dayStep(stops, stopDays, selected, event.key === "PageUp" ? 1 : -1),
          );
        }}
      />
    </div>
  );
}

/** "Wed 4 13:40": the playhead's moment, to the nearest ten minutes. */
export function momentWords(time: number): string {
  const rounded = Math.round(time / 600000) * 600000;
  return `${dayShort(rounded)} ${Number(irishDate(rounded).slice(8))} ${clock(rounded)}`;
}

/**
 * The days under the strip, one name each at the middle of its stretch:
 * "Sun 1", or "Sun" where the days are narrow, or every other one where even
 * that will not fit, so no two ever run into each other.
 */
function DayLabels({
  days,
  strip,
  x,
  width,
  selectedDate,
}: {
  days: ReturnType<typeof stripDays>;
  strip: readonly StripColumn[];
  x: (time: number) => number;
  width: number;
  selectedDate: string | undefined;
}) {
  if (!width || !days.length) return <div className="sb-days" />;
  // Each day's name at the middle of the part of it in view; a day mostly
  // out of view goes unnamed.
  const placed = days.flatMap((d) => {
    const first = strip[d.start].time;
    const last = strip[d.start + d.count - 1].time;
    const from = Math.max(0, x(first));
    const to = Math.min(width, x(last));
    return to - from > 24 ? [{ d, at: (from + to) / 2, room: to - from }] : [];
  });
  const each = placed.length ? Math.min(...placed.map((p) => p.room)) : width;
  const words = each >= 48 ? "long" : "short";
  const every = each >= 30 ? 1 : 2;
  return (
    <div className="sb-days" aria-hidden="true">
      {placed.map(({ d, at }, i) =>
        i % every ? null : (
          <span
            key={d.date}
            className={d.date === selectedDate ? "is-on" : undefined}
            style={{ left: `${Math.max(14, Math.min(width - 14, at))}px` }}
          >
            {words === "long"
              ? `${dayShort(strip[d.start].time)} ${Number(d.date.slice(8))}`
              : dayShort(strip[d.start].time)}
          </span>
        ),
      )}
    </div>
  );
}

/** The pill's reading in the strip's mode, with the hour's stars. */
function Reading({
  reading,
  mode,
  units,
  isPoint,
  dark,
  tide,
  pos,
}: {
  reading: {
    value: number | null;
    gust: number | null;
    from: number | null;
    hour: PlaceHour | undefined;
  };
  mode: ScrubMode;
  units: Units;
  isPoint: boolean;
  dark: boolean;
  tide: SpotTide | null;
  pos: number;
}) {
  const { value, gust, from, hour } = reading;
  const stars =
    hour?.warning?.replacesRating || hour?.water?.replacesRating
      ? 0
      : (hour?.rating?.stars ?? null);
  const unit = units === "bft" ? "" : ` ${unitLabel(units)}`;
  let figure = null;
  if (value === null) figure = <span className="sb-pill-none">no data</span>;
  else if (mode === "wind")
    figure = (
      <>
        <i className="sb-pill-dot" style={{ background: windCss(value) }} />
        <b>
          {speedShort(value, units)}
          {unit}
        </b>
        {gust !== null && (
          <span className="sb-pill-soft">
            gusting {speedShort(gust, units)}
          </span>
        )}
        {from !== null && (
          <span className="sb-pill-dir">
            <WindArrow from={from} size={12} />
            {compass(from)}
          </span>
        )}
      </>
    );
  else if (mode === "waves") figure = <b>{value.toFixed(1)} m</b>;
  else {
    const later = tide ? tideAt(tide.curve, pos + 15 * 60000) : null;
    figure = (
      <>
        <b>{value.toFixed(1)} m</b>
        {later !== null && (
          <span className="sb-pill-soft">
            {later >= value ? "rising" : "falling"}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      <i className="sb-pill-sep" />
      {figure}
      {!isPoint &&
        (stars ? (
          <StarGlyphs stars={stars} size={11} slots="potential" coloured />
        ) : (
          <span className="sb-pill-none">{dark ? "dark" : "no stars"}</span>
        ))}
    </>
  );
}

/** The mode's key, and the stars' five shades beside it. */
function Key({
  mode,
  units,
  stars,
}: {
  mode: ScrubMode;
  units: Units;
  stars: boolean;
}) {
  const top = 35;
  return (
    <div className="sb-key" aria-hidden="true">
      {mode === "wind" ? (
        <>
          <span>{speedShort(5, units)}</span>
          <i
            className="sb-key-ramp"
            style={{
              background: `linear-gradient(90deg, ${[5, 10, 15, 20, 25, 30, top]
                .map((kn) => windCss(kn))
                .join(", ")})`,
            }}
          />
          <span>
            {speedShort(top, units)}
            {units === "bft" ? "" : ` ${unitLabel(units)}`}
          </span>
          <i className="sb-key-gust" />
          <span>gusts</span>
        </>
      ) : (
        <>
          <i className={`sb-key-swatch is-${mode}`} />
          <span>{mode === "waves" ? "wave height, m" : "tide height, m"}</span>
        </>
      )}
      {stars && (
        <>
          <span className="sb-key-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} style={{ background: `var(--color-stars-${n})` }} />
            ))}
          </span>
          <span>1–5★</span>
        </>
      )}
    </div>
  );
}

/** A line through points, smoothed (Catmull–Rom, as cubic Béziers). */
function smooth(points: readonly (readonly [number, number])[]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)},${f(Math.min(CURVE_BOTTOM, c1y))} ${f(c2x)},${f(Math.min(CURVE_BOTTOM, c2y))} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
