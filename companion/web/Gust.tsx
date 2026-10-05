import "./gust.css";
import { COMPANION_NAME } from "../shared/protocol";
import { MOOD_LABEL, type GustMood } from "./mood";

/**
 * Gust: a soft ink blob with two capsule eyes that do the talking, holding up
 * a little inflatable wing — the wing-foil kind, a leading-edge tube with the
 * canopy stretched behind it. The eyes carry the mood; the motion (breathing,
 * blinking, the wing fluttering, tilting and pumping) is all in gust.css, and
 * stops for a reader who has asked for less motion.
 *
 * Decorative by default; `labelled` where the character itself is announced.
 */

/** Squishy: a little wider than tall, a flatter base, not quite symmetrical. */
const BODY =
  "M40.5 71C22.4 71.4 8.6 64.6 8.6 47.2 8.6 28.4 21.6 13.8 39.6 13.8c19 0 31.8 13.6 31.8 31.6 0 17.8-12.4 25.2-30.9 25.6Z";

/** Eyes glance up and toward the wing; the nearer one a touch bigger. */
const EYE_AT = [
  { x: 39.4, y: 36, scale: 1.06 },
  { x: 53, y: 33.4, scale: 1 },
] as const;

type Pill = {
  kind: "pill";
  w: number;
  h: number;
  tilt: readonly [number, number];
};
type Arc = { kind: "arc" | "shut"; tilt: readonly [number, number] };

const FACE: Record<
  GustMood,
  { look: { x: number; y: number }; eye: Pill | Arc }
> = {
  idle: {
    look: { x: 0, y: 0 },
    eye: { kind: "pill", w: 5.4, h: 12.6, tilt: [-16, -16] },
  },
  listening: {
    look: { x: -8, y: 6 },
    eye: { kind: "pill", w: 5.6, h: 14.2, tilt: [-6, -6] },
  },
  thinking: {
    look: { x: 3, y: -4.6 },
    eye: { kind: "pill", w: 5.4, h: 11.6, tilt: [-24, -24] },
  },
  success: { look: { x: -2, y: 0 }, eye: { kind: "arc", tilt: [-6, -6] } },
  error: {
    look: { x: -5, y: 6 },
    eye: { kind: "pill", w: 7.6, h: 3.8, tilt: [-18, 18] },
  },
  stoked: { look: { x: 1, y: -1.5 }, eye: { kind: "arc", tilt: [-10, -4] } },
  asleep: { look: { x: -3, y: 5 }, eye: { kind: "shut", tilt: [0, 0] } },
};

/** Where the hand holds the wing's strut, and the wing's resting lean. */
const GRIP = { x: 74, y: 28, lean: 14, scale: 0.92 };

export interface GustProps {
  mood?: GustMood;
  size?: number;
  labelled?: boolean;
  className?: string;
}

export function Gust({
  mood = "idle",
  size = 48,
  labelled = false,
  className,
}: GustProps) {
  const { look, eye } = FACE[mood];
  return (
    <svg
      viewBox="0 0 98 80"
      width={size}
      height={(size * 80) / 98}
      className={["gust", className].filter(Boolean).join(" ")}
      data-mood={mood}
      role={labelled ? "img" : undefined}
      aria-label={
        labelled ? `${COMPANION_NAME}, ${MOOD_LABEL[mood]}` : undefined
      }
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <ellipse className="gust-shadow" cx="40" cy="72.6" rx="22" ry="2.4" />

      {/*
        The wing, held up beside him by its strut: the inflated leading edge
        arching over the canopy, the wingtips swept back, two little windows
        either side of the strut. Drawn first, so it sits behind his head.
      */}
      <g
        transform={`translate(${GRIP.x} ${GRIP.y}) rotate(${GRIP.lean}) scale(${GRIP.scale})`}
      >
        <g className="gust-wing">
          <path
            className="gust-canopy"
            d="M-23 -3Q0 -46 23 -3Q15 -2.5 9 2Q0 -3.5-9 2Q-15 -2.5-23 -3Z"
          />
          <path
            className="gust-window"
            d="M-3.2 -17L-11.5 -12.5-9.6 -5.6-3.2 -7.4Z"
          />
          <path
            className="gust-window"
            d="M3.2 -17L11.5 -12.5 9.6 -5.6 3.2 -7.4Z"
          />
          <path className="gust-tube" d="M-23 -3Q0 -46 23 -3" />
          <path className="gust-tube gust-strut" d="M0 -23.5L0 -1.5" />
          <path className="gust-handle" d="M-2.6 -9.5L2.6 -9.5" />
        </g>
      </g>

      <g className="gust-body">
        <path className="gust-fill" d={BODY} />
        {/* A stubby arm reaching up to the handle. */}
        <path
          className="gust-arm"
          d={`M63.5 41.5Q71.5 40 ${GRIP.x - 1.8} ${GRIP.y - 7}`}
        />
        <g
          className="gust-look"
          style={{ transform: `translate(${look.x}px, ${look.y}px)` }}
        >
          {EYE_AT.map((at, i) => (
            <g
              key={i}
              transform={`translate(${at.x} ${at.y}) rotate(${eye.tilt[i]}) scale(${at.scale})`}
            >
              {eye.kind === "pill" ? (
                <rect
                  className="gust-eye"
                  x={-eye.w / 2}
                  y={-eye.h / 2}
                  width={eye.w}
                  height={eye.h}
                  rx={Math.min(eye.w, eye.h) / 2}
                />
              ) : (
                <path
                  className="gust-lid"
                  d={
                    eye.kind === "arc"
                      ? "M-3.9 2.5Q0-5.4 3.9 2.5"
                      : "M-4.2 0Q0 3.6 4.2 0"
                  }
                />
              )}
            </g>
          ))}
        </g>
      </g>

      {mood === "thinking" && (
        <g className="gust-dots">
          <circle className="gust-dot" cx="22" cy="10" r="1.8" />
          <circle className="gust-dot" cx="15.5" cy="5.5" r="2.3" />
          <circle className="gust-dot" cx="8" cy="1.5" r="2.8" />
        </g>
      )}
      {mood === "asleep" && (
        <g className="gust-zs">
          <text className="gust-z" x="14" y="16">
            z
          </text>
          <text className="gust-z" x="6" y="7">
            z
          </text>
        </g>
      )}
    </svg>
  );
}
