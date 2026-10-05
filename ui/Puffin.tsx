import { useId } from "react";
import { tv } from "./tv";

/*
 * The puffin: the Almanac's own bird, standing on his rock at the foot of the
 * pen's note. He signs the house's word, the way a weather report's cartoon
 * signs its column; he does not talk, and there is one of him on a view at
 * most. Drawn in the chart's inks: ink, paper, the pen's red and a buoy's
 * yellow for his beak and feet, land buff for the rock.
 */
export const puffinStyles = tv({
  slots: {
    base: "inline-block shrink-0 overflow-visible",
    // An SVG group turns about its own box only when told to.
    figure: "origin-bottom transform-fill",
    ink: "fill-ink",
    inkLine: "fill-none stroke-ink",
    paper: "fill-ground stroke-ink",
    paperLine: "fill-none stroke-ground",
    // The wing's hatching: the pattern is its fill, so it names a stroke only.
    hatched: "stroke-ground",
    pen: "fill-pen stroke-ink",
    buoy: "fill-buoy stroke-ink",
    rock: "fill-land stroke-ink",
  },
  variants: {
    // He shifts his weight now and then. Held still for a reader who asks.
    bob: { true: { figure: "animate-bob motion-reduce:animate-none" } },
  },
});

export interface PuffinProps {
  /** Height in px; he is a little narrower than he is tall. */
  size?: number;
  bob?: boolean;
  /** Decoration by default. Name him where he stands for something. */
  title?: string;
  className?: string;
}

export function Puffin({ size = 57, bob = false, title, className }: PuffinProps) {
  const styles = puffinStyles({ bob });
  // An id a `url(#…)` can name: React's own carries punctuation.
  const hatch = `puffin-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={styles.base({ className })}
      width={(size * 120) / 130}
      height={size}
      viewBox="0 0 120 130"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <pattern
          id={hatch}
          width="2.4"
          height="2.4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(38)"
        >
          <line
            className={styles.paperLine()}
            x1="0"
            y1="0"
            x2="0"
            y2="2.4"
            strokeWidth=".55"
          />
        </pattern>
      </defs>
      <path
        className={styles.rock()}
        d="M8 121 C20 112 36 113 48 115 C62 111 84 112 98 116 C106 118 112 120 114 124 L8 124Z"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        className={styles.inkLine()}
        d="M20 118 l6 -2 M34 117 l9 -1 M70 116 l10 0 M88 118 l8 2 M58 120 l9 0"
        strokeWidth=".8"
        strokeLinecap="round"
      />
      <g className={styles.figure()}>
        <path
          className={styles.pen()}
          d="M46 111 L38 116 L52 116 Z M64 110 L60 116 L74 116 Z"
          strokeWidth=".9"
          strokeLinejoin="round"
        />
        <path className={styles.ink()} d="M78 96 L92 106 L80 104 Z" />
        <path
          className={styles.ink()}
          d="M46 44 C34 56 32 88 42 104 C50 114 70 114 78 102 C86 88 84 60 74 46 C66 37 52 38 46 44Z"
        />
        <path
          className={styles.paper()}
          d="M45 54 C38 68 38 92 47 106 C53 110 60 108 60 98 C60 82 56 64 45 54Z"
          strokeWidth=".9"
        />
        <path
          className={styles.inkLine()}
          d="M48 64 q3 2 4 6 M47 74 q3 2 5 7 M48 86 q3 2 5 6 M51 97 q2 2 3 5"
          strokeWidth=".6"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="M62 54 C76 60 82 80 76 100 C70 92 64 76 62 54Z"
          fill={`url(#${hatch})`}
          className={styles.hatched()}
          strokeWidth=".6"
        />
        <circle className={styles.ink()} cx="56" cy="33" r="16.5" />
        <path
          className={styles.paper()}
          d="M41 31 C42 21 52 18 59 24 C62 33 58 44 48 45 C43 43 40 37 41 31Z"
          strokeWidth=".9"
        />
        <path
          className={styles.inkLine()}
          d="M44 38 q4 3 9 2"
          strokeWidth=".55"
          opacity=".5"
        />
        <path
          className={styles.inkLine()}
          d="M46.5 26.5 L49 24 L51.5 26.5"
          strokeWidth=".8"
          strokeLinecap="round"
        />
        <circle className={styles.ink()} cx="49" cy="29" r="2" />
        <circle className={styles.paper()} cx="49.6" cy="28.4" r=".55" strokeWidth="0" />
        <path
          className={styles.inkLine()}
          d="M51 30.5 L55 32"
          strokeWidth=".7"
          strokeLinecap="round"
        />
        <path
          className={styles.pen()}
          d="M42.5 27 C34 25 26 29 20 37 C27 42 36 42 43.5 38 C44.5 34 44 30 42.5 27Z"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path
          className={styles.buoy()}
          d="M42.5 27 C40 30 40 35 43.5 38 C45 35 45 30 42.5 27Z"
          strokeWidth=".8"
        />
        <path
          className={styles.paperLine()}
          d="M35 28.4 C33 31.5 33 36 35 39.8 M29 31 C27.6 33.5 27.6 36.5 29 39.2"
          strokeWidth=".9"
          strokeLinecap="round"
        />
        <path
          className={styles.inkLine()}
          d="M21 37 C28 37.5 36 37 43 34.5"
          strokeWidth=".7"
        />
      </g>
    </svg>
  );
}
