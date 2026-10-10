/**
 * The chart's small glyphs, drawn as the mockup draws them and coloured from
 * the theme through src/map.css: which way a beach faces, the wind against
 * it, an arrow blowing downwind, and the red star a rider keeps a spot
 * with.
 */
import { useContext, useId, type ReactNode } from "react";
import { SHORE_LABEL, shoreAngle } from "../force5/src/stars";
import { compass } from "../force5/src/weather";
import { InfoButton } from "./InfoPop";
import { MapInfoOpen } from "./mapInfoContext";

const FACE8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const face8 = (d: number) =>
  FACE8[Math.round((((d % 360) + 360) % 360) / 45) % 8];

/** Which way the beach faces: a compass, the beach, and the sea beyond it. */
export function FacingCompass({
  facing,
  size = 18,
}: {
  facing: number | null | undefined;
  size?: number;
}) {
  if (facing === null || facing === undefined) return null;
  const label = `Beach faces ${face8(facing)}, ${Math.round(facing)}°`;
  return (
    <svg
      className="g-facing"
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle className="g-paper g-stroke" r="8.8" strokeWidth=".9" />
      <path className="g-stroke" d="M0 -8.8V-6.4" strokeWidth="1.3" />
      <g transform={`rotate(${Math.round(facing)})`}>
        <path className="g-sea" d="M0 -7.6L3.1 .2H-3.1Z" />
        <path
          className="g-stroke"
          d="M-5.2 3H5.2"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** An arrow blowing downwind for a wind from `from` degrees. */
export function WindArrow({ from, size = 13 }: { from: number; size?: number }) {
  return (
    <svg
      className="g-arrow"
      width={size}
      height={size}
      viewBox="-7 -7 14 14"
      aria-hidden="true"
    >
      <g transform={`rotate(${Math.round(from + 180)})`}>
        <path
          d="M0 5.5V-5.2M-3 -1.8L0 -5.6L3 -1.8"
          fill="none"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * The wind against this beach: the sea above, the beach hatched below, the
 * arrow blowing downwind, red when it blows off the beach.
 */
export function ShoreGlyph({
  from,
  facing,
  size = 15,
}: {
  from: number;
  facing: number | null | undefined;
  size?: number;
}) {
  const id = useId();
  if (facing === null || facing === undefined) return null;
  const angle = shoreAngle(from, facing);
  const off = angle === "offshore" || angle === "cross-off";
  return (
    <svg
      className={`g-shore${off ? " is-off" : ""}`}
      width={size}
      height={size}
      viewBox="-9 -9 18 18"
      role="img"
      aria-label={SHORE_LABEL[angle]}
    >
      <title>{SHORE_LABEL[angle]}</title>
      <defs>
        <pattern
          id={id}
          width="3"
          height="3"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect className="g-land" width="3" height="3" />
          <line className="g-hatch" x1="0" y1="0" x2="0" y2="3" />
        </pattern>
      </defs>
      <rect x="-8.5" y="4.2" width="17" height="4.6" fill={`url(#${id})`} />
      <path className="g-stroke" d="M-8.5 4.2H8.5" strokeWidth="1.1" />
      <g transform={`translate(0 -2.2) rotate(${Math.round(from - facing + 180)})`}>
        <path
          className="g-shore-arrow"
          d="M0 5V-5.2M-2.6 -2.3L0 -5.5L2.6 -2.3"
          fill="none"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** The red star a rider keeps a spot with, filled once it is kept. */
export function StarToggle({
  on,
  name,
  onToggle,
  size = 17,
  children,
}: {
  on: boolean;
  name: string;
  onToggle: () => void;
  size?: number;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="star-toggle"
      aria-pressed={on}
      aria-label={`${on ? "Unstar" : "Star"} ${name}`}
      title={on ? "Starred: on your spots" : "Star: keep it on your spots"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 1.3 L10 6.1 L15.1 6.5 L11.2 9.8 L12.5 14.8 L8 12.1 L3.6 14.9 L4.8 9.9 L0.9 6.6 L6 6.1 Z"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}

/**
 * The "?" by the stars: how they work, in the map's information dialog, which
 * links on to the page that works them through. Anywhere the dialog is not,
 * the page itself.
 */
export function StarsHelp() {
  const openInfo = useContext(MapInfoOpen);
  if (!openInfo)
    return (
      <a
        className="help-q"
        href="/stars"
        aria-label="How the stars work"
        title="How the stars work"
      >
        ?
      </a>
    );
  return (
    <InfoButton
      className="help-q"
      label="How the stars work"
      onOpen={() => openInfo("stars")}
    >
      ?
    </InfoButton>
  );
}

/** "WSW 14": where it blows from and how hard. */
export const windWords = (from: number | null, kn: number | null) =>
  from === null || kn === null ? "" : `${compass(from)} ${Math.round(kn)}`;
