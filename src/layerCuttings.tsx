/**
 * The Layers panel's pictures (src/LayersPanel.tsx): for each layer a small
 * square cut from the chart, a bit of coast drawn the way that layer draws
 * it. The ink streaks, the coloured wind, the tidal depth's bands, the
 * currents' arrows, a satellite photograph, the LiDAR's shaded ground.
 *
 * Each picture is a few dozen SVG shapes, coloured with the theme's own
 * tokens (ui/theme.css), so the same colours the chart uses appear here. No
 * map is drawn and nothing is fetched. They load with the panel, which
 * loads when Layers is first opened.
 *
 * Every cutting shares one coast, land on the left, and is a picture beside
 * its name: hidden from a screen reader.
 */
import type { CSSProperties, ReactNode } from "react";

/** Which picture: a wind style, a chart part, a satellite tide, a focus. */
export type CuttingId =
  | "ink"
  | "wash"
  | "arrows"
  | "foil"
  | "currents"
  | "tints"
  | "soundings"
  | "relief"
  | "names"
  | "sat-high"
  | "sat-low"
  | "lidar"
  | "loupe"
  | "ring"
  | "focus-off";

/** The shared coast: land on the left, its edge wandering down the square. */
const COAST = "M0 0H36C29 16 42 30 33 48C27 60 39 74 31 100H0Z";
/** The coast's edge alone, for bands drawn along it. */
const SHORE = "M36 0C29 16 42 30 33 48C27 60 39 74 31 100";

const token = (name: string) => `var(--${name})`;
const fill = (name: string): { style: CSSProperties } => ({
  style: { fill: token(name) },
});

function Sea({ colour = "color-sea-3" }: { colour?: string }) {
  return <rect width="100" height="100" {...fill(colour)} />;
}

function Land({ colour = "color-land" }: { colour?: string }) {
  return (
    <path
      d={COAST}
      style={{ fill: token(colour), stroke: token("color-ink") }}
      strokeWidth="1"
    />
  );
}

/** A band of colour along the shore, `width` wide (half of it under the land). */
function Band({ width, colour }: { width: number; colour: string }) {
  return (
    <path
      d={SHORE}
      fill="none"
      style={{ stroke: token(colour) }}
      strokeWidth={width}
    />
  );
}

/** The wind's ink streaks, as the particles leave them. */
function Streaks({ opacity }: { opacity: number }) {
  const at = [
    [46, 18],
    [64, 30],
    [50, 46],
    [74, 58],
    [56, 72],
    [80, 86],
    [44, 90],
    [84, 12],
  ];
  return (
    <g
      fill="none"
      strokeLinecap="round"
      strokeWidth="1.3"
      opacity={opacity}
      style={{ stroke: token("color-ink") }}
    >
      {at.map(([x, y]) => (
        <path key={`${x} ${y}`} d={`M${x} ${y}q8 -5 16 -2`} />
      ))}
    </g>
  );
}

/** The chosen spot's light, as the map marks it. */
function Light() {
  return <circle cx="36" cy="50" r="6" {...fill("color-chart-magenta")} />;
}

/**
 * The loupe on a spot at (36, 50): the rose of what can be ridden there in a
 * south-easterly. Hatched where it is too close to the wind, the tack out to
 * sea washed, the tack home dashed, the offshore winds red on the rim, and the
 * wind's needle in its colour.
 */
function Loupe() {
  const [cx, cy, R] = [36, 50, 32];
  const from = 135;
  const upwind = 70;
  const deep = 105;
  const at = (d: number, r: number) => {
    const t = ((d - 90) * Math.PI) / 180;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  };
  const xy = ([x, y]: number[]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const large = (a0: number, a1: number) =>
    (a1 - a0 + 360) % 360 > 180 ? 1 : 0;
  const sector = (a0: number, a1: number, r: number) =>
    `M${cx} ${cy}L${xy(at(a0, r))}A${r} ${r} 0 ${large(a0, a1)} 1 ${xy(at(a1, r))}Z`;
  const arc = (a0: number, a1: number, r: number) =>
    `M${xy(at(a0, r))}A${r} ${r} 0 ${large(a0, a1)} 1 ${xy(at(a1, r))}`;
  const ink = { stroke: token("color-ink") };
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30)
    .map((d) => `M${xy(at(d, R))}L${xy(at(d, R - (d % 90 ? 4 : 7)))}`)
    .join("");
  const needle = [
    at(from, R - 16),
    at(from - 4, R + 7),
    at(from, R + 2),
    at(from + 4, R + 7),
  ];
  return (
    <>
      <path
        d={sector(from - upwind, from + upwind, R)}
        fill="url(#lp-hatch)"
        strokeWidth="0.8"
        style={ink}
      />
      <path
        d={sector(from - deep, from - upwind, R * 0.92)}
        strokeWidth="1.2"
        style={{
          ...ink,
          fill: "color-mix(in srgb, var(--color-ground) 55%, transparent)",
        }}
      />
      <path
        d={sector(from + upwind, from + deep, R * 0.92)}
        fill="none"
        strokeWidth="1.1"
        strokeDasharray="4 3"
        style={ink}
      />
      <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth="1.2" style={ink} />
      <path
        d={arc(235, 295, R + 3.5)}
        fill="none"
        strokeWidth="3"
        style={{ stroke: token("color-pen") }}
      />
      <path d={ticks} strokeWidth="1" style={ink} />
      <path
        d={`M${cx} ${cy}L${xy(at(from + 180, R * 0.62))}`}
        fill="none"
        strokeWidth="1"
        strokeDasharray="1.5 3"
        style={ink}
      />
      <path
        d={`M${needle.map(xy).join("L")}Z`}
        strokeWidth="1"
        strokeLinejoin="round"
        style={{ ...ink, fill: token("color-wind-k15") }}
      />
      <Light />
    </>
  );
}

/** A figure in the chart's lettering: a sounding, a rate, a height. */
function Figure({
  x,
  y,
  children,
  colour = "color-ink",
  italic = false,
}: {
  x: number;
  y: number;
  children: ReactNode;
  colour?: string;
  italic?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      className={italic ? "lp-fig lp-fig-italic" : "lp-fig"}
      style={{ fill: token(colour) }}
    >
      {children}
    </text>
  );
}

/** An arrow pointing up and to the right, `size` long, in the given colour. */
function Arrow({
  x,
  y,
  size,
  colour,
  turn = -45,
}: {
  x: number;
  y: number;
  size: number;
  colour: string;
  turn?: number;
}) {
  const s = size / 16;
  return (
    <path
      transform={`translate(${x} ${y}) rotate(${turn}) scale(${s})`}
      d="M0 -8L5 -2H2V8H-2V-2H-5Z"
      style={{ fill: token(colour), stroke: token("color-ink") }}
      strokeWidth={0.8 / s}
      strokeLinejoin="round"
    />
  );
}

function cutting(id: CuttingId): ReactNode {
  switch (id) {
    case "ink":
      return (
        <>
          <Sea />
          <Land />
          <Streaks opacity={0.7} />
        </>
      );
    case "wash":
      return (
        <>
          <Sea />
          <rect width="100" height="100" fill="url(#lp-wash)" opacity="0.8" />
          <Land />
          <Streaks opacity={0.3} />
        </>
      );
    case "arrows":
      return (
        <>
          <Sea />
          <Land />
          <Arrow x={52} y={18} size={13} colour="color-wind-k10" />
          <Arrow x={78} y={22} size={16} colour="color-wind-k15" />
          <Arrow x={58} y={48} size={18} colour="color-wind-k20" />
          <Arrow x={84} y={52} size={21} colour="color-wind-k25" />
          <Arrow x={54} y={78} size={22} colour="color-wind-k30" />
          <Arrow x={82} y={84} size={25} colour="color-wind-k35" />
        </>
      );
    case "foil":
      // As the layer bands the water at the tide shown: deep enough in the
      // strong blue, too shallow in the light, the sand bared at the edge.
      return (
        <>
          <Sea colour="color-sea-4" />
          <Band width={54} colour="map-foil-deep" />
          <Band width={36} colour="map-foil-enough" />
          <Band width={20} colour="map-foil-shallow" />
          <Band width={9} colour="map-foil-edge" />
          <Land />
          <Figure x={70} y={90}>
            1 m
          </Figure>
        </>
      );
    case "currents":
      // A feathered stream arrow with its rate, as the chart sets a flood,
      // and a tidal diamond: the streams the model cannot resolve.
      return (
        <>
          <Sea />
          <Land />
          <g
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: token("color-ink") }}
          >
            <path d="M52 84L80 30" strokeWidth="2" />
            <path d="M73 33L80 30L81 38" strokeWidth="1.6" />
            <path d="M57 74l-6 -1M60 68l-6 -1M63 62l-6 -1" strokeWidth="1.3" />
            <path d="M84 92L92 70" strokeWidth="1.4" />
          </g>
          <Figure x={83} y={54}>
            2.1
          </Figure>
          <path
            d="M60 14L66.5 22L60 30L53.5 22Z"
            strokeWidth="1"
            style={{ fill: token("color-ground"), stroke: token("color-ink") }}
          />
          <text x="60" y="25" textAnchor="middle" className="lp-fig">
            A
          </text>
        </>
      );
    case "tints":
      return (
        <>
          <Sea colour="map-d50" />
          <Band width={86} colour="map-d20" />
          <Band width={58} colour="map-d10" />
          <Band width={34} colour="map-d3" />
          <Band width={14} colour="map-d0" />
          <Land />
        </>
      );
    case "soundings":
      // The chart's lines alone, on its paper: dotted contours, soundings.
      return (
        <>
          <Sea colour="color-ground" />
          <g
            fill="none"
            strokeWidth="1.3"
            strokeDasharray="1.5 2.5"
            style={{ stroke: token("color-depth") }}
          >
            <path d={SHORE} transform="translate(14 0)" />
            <path d={SHORE} transform="translate(34 0)" />
          </g>
          <Land colour="color-ground" />
          <Figure x={60} y={30} colour="color-depth" italic>
            4
            <tspan dy="2" fontSize="7">
              5
            </tspan>
          </Figure>
          <Figure x={76} y={62} colour="color-depth" italic>
            12
          </Figure>
          <Figure x={58} y={86} colour="color-depth" italic>
            8
          </Figure>
          <Figure x={86} y={20} colour="color-depth" italic>
            21
          </Figure>
        </>
      );
    case "relief": {
      // A hill in its hachures, the coast far over on the right.
      const hachures = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const at = (r: number) =>
          `${(32 + Math.cos(a) * r).toFixed(1)} ${(46 + Math.sin(a) * r * 0.75).toFixed(1)}`;
        return `M${at(10)}L${at(19)}`;
      }).join("");
      return (
        <>
          <Sea />
          <path
            d="M0 0H72C64 20 78 40 66 60C58 76 70 88 62 100H0Z"
            style={{ fill: token("color-land"), stroke: token("color-ink") }}
            strokeWidth="1"
          />
          <path
            d={hachures}
            strokeWidth="1.2"
            strokeLinecap="round"
            style={{ stroke: token("color-relief") }}
          />
          <ellipse
            cx="32"
            cy="46"
            rx="7"
            ry="5"
            fill="none"
            strokeWidth="1.2"
            style={{ stroke: token("color-relief") }}
          />
        </>
      );
    }
    case "names":
      return (
        <>
          <Sea />
          <Land />
          <circle cx="34" cy="30" r="5" {...fill("color-ink")} />
          <text x="43" y="29" className="lp-name-fig">
            Portmarnock
          </text>
          <Figure x={43} y={39} colour="color-chart-magenta">
            17 g23
          </Figure>
          <circle
            cx="31"
            cy="70"
            r="5"
            strokeWidth="1.2"
            style={{ fill: token("color-ground"), stroke: token("color-ink") }}
          />
          <text x="40" y="68" className="lp-name-fig">
            Low Rock
          </text>
        </>
      );
    case "sat-high":
    case "sat-low":
      // A photograph, not a chart: the colours are the image's own, mottled.
      return (
        <>
          <rect width="100" height="100" fill="#5f8794" filter="url(#lp-sea)" />
          {id === "sat-low" && (
            <path d={SHORE} fill="none" stroke="#cdb48a" strokeWidth="34" />
          )}
          <path d={COAST} fill="#8d9466" filter="url(#lp-land)" />
        </>
      );
    case "lidar":
      // The survey's ground heights in its own ramp (force5/src/lidar.ts),
      // shaded from the north-west: the channels below datum blue, the sand
      // above it in the yellows, the dunes pale.
      return (
        <>
          <rect width="100" height="100" fill="#48739a" />
          <path d={SHORE} fill="none" stroke="#a6c7d6" strokeWidth="110" />
          <path d={SHORE} fill="none" stroke="#b4d8d0" strokeWidth="76" />
          <path d={SHORE} fill="none" stroke="#c6e0b8" strokeWidth="56" />
          <path d={SHORE} fill="none" stroke="#efdc9e" strokeWidth="38" />
          <path d={SHORE} fill="none" stroke="#ebc88c" strokeWidth="20" />
          <path d={COAST} fill="#e8e2cc" />
          <rect
            width="100"
            height="100"
            filter="url(#lp-shade)"
            opacity="0.55"
            style={{ mixBlendMode: "multiply" }}
          />
        </>
      );
    case "loupe":
      return (
        <>
          <Sea />
          <Land />
          <Loupe />
        </>
      );
    case "ring":
      return (
        <>
          <Sea />
          <Land />
          <circle
            cx="36"
            cy="50"
            r="32"
            fill="none"
            strokeWidth="1.3"
            strokeDasharray="5 4"
            style={{ stroke: token("color-ink") }}
          />
          <Light />
        </>
      );
    case "focus-off":
      return (
        <>
          <Sea />
          <Land />
          <Light />
        </>
      );
  }
}

/** One layer's picture, filling the square it is set in. */
export function Cutting({ id }: { id: CuttingId }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {cutting(id)}
    </svg>
  );
}

/**
 * What several cuttings share, drawn once in the panel: the coloured wind's
 * gradient, the photograph's mottle and the LiDAR's shading.
 */
export function CuttingDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      className="lp-defs"
    >
      <defs>
        <linearGradient id="lp-wash" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: token("color-wind-k10") }} />
          <stop offset="0.4" style={{ stopColor: token("color-wind-k15") }} />
          <stop offset="0.75" style={{ stopColor: token("color-wind-k20") }} />
          <stop offset="1" style={{ stopColor: token("color-wind-k30") }} />
        </linearGradient>
        <pattern
          id="lp-hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path
            d="M0 0V4"
            strokeWidth="1"
            style={{ stroke: token("color-ink") }}
          />
        </pattern>
        <filter id="lp-sea" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03 0.08"
            numOctaves="3"
            seed="4"
          />
          <feColorMatrix values="0 0 0 0 .15  0 0 0 0 .3  0 0 0 0 .36  0 0 0 .6 0" />
          <feComposite in2="SourceGraphic" operator="in" />
          <feBlend in2="SourceGraphic" mode="multiply" />
        </filter>
        <filter id="lp-land" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.12"
            numOctaves="4"
            seed="9"
          />
          <feColorMatrix values="0 0 0 0 .3  0 0 0 0 .38  0 0 0 0 .2  0 0 0 1.1 -.1" />
          <feComposite in2="SourceGraphic" operator="in" />
          <feBlend in2="SourceGraphic" mode="multiply" />
        </filter>
        <filter id="lp-shade" x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves="4"
            seed="2"
          />
          <feDiffuseLighting surfaceScale="4" lightingColor="#ffffff">
            <feDistantLight azimuth="315" elevation="38" />
          </feDiffuseLighting>
        </filter>
      </defs>
    </svg>
  );
}
