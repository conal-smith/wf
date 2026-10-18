/**
 * A wheel turned up or down over the dock's hours moves them sideways, as
 * Shift and the wheel do, and as smoothly.
 *
 * The strip snaps to its hours (dock.css `scroll-snap-type: x mandatory`), and
 * a mandatory snap answers every scroll it is handed with a snap: a trackpad's
 * few pixels at a time were pulled back to the hour they left, and a mouse
 * wheel's hundred jumped from hour to hour. So while the wheel moves it the
 * snapping is off, and once the wheel stops the strip eases to the nearest
 * hour itself and the snapping comes back.
 *
 * A trackpad's stream of small steps is followed as it comes, so nothing lags
 * the fingers; a mouse wheel's notches, a hundred pixels or a few lines at a
 * time, are eased into. A sideways swipe, Shift and the wheel, a pinch and a
 * finger are the browser's own, and so is a wheel turned towards an end the
 * hours have already reached.
 */

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  /** The old wheel delta browsers still give, in 120ths of a notch. */
  wheelDeltaY?: number;
}

/** Pixels a line of wheel is worth, where a browser counts in lines. */
const LINE_PX = 16;

/** How far a vertical wheel turn would move the hours, in pixels. */
export function wheelPixels(event: WheelLike, pageWidth: number): number {
  const unit =
    event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageWidth : 1;
  return event.deltaY * unit;
}

/**
 * Whether a wheel event is a mouse wheel's notch rather than a trackpad's
 * step: counted in lines or pages, or a whole notch of the old delta (120), or
 * else a large whole number of pixels, which a trackpad's stream never starts
 * with.
 */
export function isNotch(event: WheelLike): boolean {
  if (event.deltaMode !== 0) return true;
  const legacy = event.wheelDeltaY;
  if (legacy && legacy % 120 === 0 && Math.abs(event.deltaY) >= 30) return true;
  return Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY);
}

/** Whether the event is a vertical turn this strip should take sideways. */
export function takesWheel(
  event: WheelLike & { ctrlKey?: boolean },
  left: number,
  max: number,
): boolean {
  if (event.ctrlKey || !event.deltaY) return false;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return false;
  return event.deltaY > 0 ? left < max - 0.5 : left > 0.5;
}

/** Milliseconds for a notch's ease to close most of its distance (1/e left). */
const EASE_MS = 55;
/** Quiet after the last wheel event before the strip settles on an hour. */
const SETTLE_MS = 140;

export interface WheelHoursOptions {
  /** Where the strip should come to rest from a scroll: the nearest hour's. */
  snap: (left: number) => number;
  reducedMotion: () => boolean;
}

export interface WheelHours {
  /** Let go of the strip now, for something else about to move it. */
  letGo: () => void;
  /** Stop listening, for good. */
  detach: () => void;
}

/** Hand `el`'s vertical wheel to its sideways scroll. */
export function wheelHours(
  el: HTMLElement,
  { snap, reducedMotion }: WheelHoursOptions,
): WheelHours {
  /** Where the wheel has asked the strip to go, while it is being wheeled. */
  let target: number | null = null;
  /** Where the wheel last put the strip: anywhere else, something else moved it. */
  let wrote = 0;
  let frame = 0;
  let last = 0;
  let quiet = 0;
  let settling = false;

  const max = () => Math.max(0, el.scrollWidth - el.clientWidth);
  const stopEase = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const release = () => {
    target = null;
    settling = false;
    el.style.scrollSnapType = "";
  };
  const put = (left: number) => {
    el.scrollLeft = left;
    wrote = el.scrollLeft;
  };
  /**
   * Whether the strip has been moved by something else since the wheel last
   * moved it: the time changed from the keys, or a finger. Then the wheel
   * lets go, and does not drag the strip back.
   */
  const overtaken = () => Math.abs(el.scrollLeft - wrote) > 2;
  const ease = (time: number) => {
    if (target === null) return;
    if (overtaken()) {
      frame = 0;
      clearTimeout(quiet);
      release();
      return;
    }
    const dt = Math.min(64, time - (last || time - 16));
    last = time;
    const left = el.scrollLeft;
    const gap = target - left;
    if (Math.abs(gap) < 0.5) {
      put(target);
      frame = 0;
      if (settling) release();
      return;
    }
    put(left + gap * (1 - Math.exp(-dt / EASE_MS)));
    frame = requestAnimationFrame(ease);
  };
  const easeTo = (left: number) => {
    target = left;
    if (reducedMotion()) {
      stopEase();
      put(left);
      if (settling) release();
      return;
    }
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(ease);
    }
  };
  const settle = () => {
    if (target === null) return;
    if (overtaken()) {
      stopEase();
      release();
      return;
    }
    settling = true;
    easeTo(Math.max(0, Math.min(max(), snap(target))));
  };

  const onWheel = (event: WheelEvent) => {
    if (target !== null && overtaken()) {
      stopEase();
      release();
    }
    if (target === null) wrote = el.scrollLeft;
    const from = target ?? el.scrollLeft;
    if (!takesWheel(event, from, max())) return;
    event.preventDefault();
    settling = false;
    el.style.scrollSnapType = "none";
    const next = Math.max(
      0,
      Math.min(max(), from + wheelPixels(event, el.clientWidth)),
    );
    if (isNotch(event)) easeTo(next);
    else {
      // A trackpad's own step, at once: it is already smooth.
      stopEase();
      target = next;
      put(next);
    }
    clearTimeout(quiet);
    quiet = window.setTimeout(settle, SETTLE_MS);
  };
  // Another hand on the strip (a finger, the keys, a scroll to the time)
  // takes over from the wheel at once.
  const interrupt = () => {
    if (target === null) return;
    stopEase();
    clearTimeout(quiet);
    release();
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", interrupt);
  el.addEventListener("touchstart", interrupt, { passive: true });
  el.addEventListener("keydown", interrupt);
  return {
    letGo: interrupt,
    detach: () => {
      stopEase();
      clearTimeout(quiet);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", interrupt);
      el.removeEventListener("touchstart", interrupt);
      el.removeEventListener("keydown", interrupt);
      el.style.scrollSnapType = "";
    },
  };
}
