/**
 * The chart's small glyphs, drawn as the mockup draws them and coloured from
 * the theme through src/map.css: an arrow blowing downwind, and the red star
 * a rider keeps a spot with.
 */
import { useContext } from "react";
import { compass } from "../force5/src/weather";
import { InfoButton } from "./InfoPop";
import { MapInfoOpen } from "./mapInfoContext";

/** An arrow blowing downwind for a wind from `from` degrees. */
export function WindArrow({
  from,
  size = 13,
}: {
  from: number;
  size?: number;
}) {
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
