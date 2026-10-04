/**
 * Whether the opening film plays on this page load.
 *
 * It is a first impression, so it plays once: on the wind map's own address,
 * for a reader who has not seen it, on a machine that can draw it well. It
 * stays out of the way of everyone else:
 *
 * - a phone or tablet (a coarse pointer, or a narrow window): the film is a
 *   heavy WebGL scene, and a phone reader wants the forecast;
 * - a reader who asked for reduced motion;
 * - a browser without WebGL 2;
 * - automation (`navigator.webdriver`), so the e2e suite and the map's
 *   screenshot baselines see the map, as they always have.
 *
 * `?intro` plays it regardless of all but WebGL, for review; `?intro=17`
 * starts it 17 seconds in.
 */

export const SEEN_KEY = "wingfoil:intro-seen";

export interface IntroEnvironment {
  pathname: string;
  search: string;
  seen: boolean;
  webdriver: boolean;
  coarsePointer: boolean;
  narrow: boolean;
  reducedMotion: boolean;
  webgl2: boolean;
}

export interface IntroDecision {
  play: boolean;
  /** Seconds into the film to start from. */
  startAt: number;
}

const NO = { play: false, startAt: 0 } as const;

export function decideIntro(env: IntroEnvironment): IntroDecision {
  if (!env.webgl2) return NO;
  const forced = new URLSearchParams(env.search).get("intro");
  if (forced !== null) {
    if (forced === "off" || forced === "0") return NO;
    const at = Number(forced);
    return { play: true, startAt: Number.isFinite(at) && at > 0 ? at : 0 };
  }
  if (env.pathname !== "/") return NO;
  if (env.seen || env.webdriver || env.coarsePointer || env.narrow || env.reducedMotion)
    return NO;
  return { play: true, startAt: 0 };
}

/** Reads the environment from the browser. */
export function browserEnvironment(): IntroEnvironment {
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Storage refused (a private window, a policy): treat as seen rather
    // than replay the film on every load.
    seen = true;
  }
  const media = (q: string) => window.matchMedia?.(q).matches ?? false;
  let webgl2 = false;
  try {
    webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    webgl2 = false;
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    seen,
    webdriver: Boolean(navigator.webdriver),
    coarsePointer: media("(pointer: coarse)"),
    narrow: media("(max-width: 899px)"),
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    webgl2,
  };
}

export function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // Nothing to do: the next load will simply decide again.
  }
}
