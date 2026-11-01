/**
 * The chart's loupe over a spot's satellite picture, in the modern hand of the
 * mock-ups (backlog/mockups/2026-10-31-spot-page.html): every part of the
 * chart's loupe, drawn from its own geometry (force5/src/focus.ts), on a fine
 * white rim with the world outside the glass dimmed. The rim is to scale,
 * half a nautical mile or a kilometre (roseScale), with the ring at half; the
 * compass is ticked round it; offshore is red on the rim, cross-offshore
 * lighter beside it; the wind's needle is in the wind's colour; inside, the
 * ride rose: the no-go hatched, the tack out filled, the tack home dashed, the
 * slow water dotted, the drift. Its words show on hover, or a tap; OFFSHORE
 * always. Its colours are its own (`photo-*`), the same in either theme.
 *
 * `card` is the small one on the Spot finder's cards: shapes, no words, the
 * rim drawn smaller than to scale so a 104 px picture is not all loupe.
 */
import { useId, useState } from "react";
import {
  LOUPE_BAND,
  dialDrawing,
  polar,
  roseDrawing,
  type LoupeRose,
  type RoseScale,
} from "../../../force5/src/focus";
import { tv } from "../../../ui/tv";
import { lift, type PictureTide, type SpotPicture } from "../satellite";

const styles = tv({
  slots: {
    root: "relative m-0 overflow-hidden bg-photo-shade",
    img: "absolute inset-0 size-full object-cover transition-opacity duration-base",
    svg: "absolute inset-0 size-full",
    words: "transition-opacity duration-fast",
    word: "fill-photo-line font-mono font-semibold",
    pill: "fill-photo-pill",
  },
  variants: {
    card: {
      true: { root: "rounded-control" },
      false: { root: "rounded-surface" },
    },
    shown: { true: { words: "opacity-100" }, false: { words: "opacity-0" } },
  },
});

const f1 = (n: number) => Number(n.toFixed(1));

export function PhotoLoupe({
  picture,
  tide,
  loupe,
  facing,
  scale,
  card = false,
  className,
  children,
}: {
  picture: SpotPicture;
  tide: PictureTide;
  loupe: LoupeRose | null;
  facing: number | null;
  scale: RoseScale;
  card?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const id = `lp-${useId().replace(/[^\w-]/g, "")}`;
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const s = styles({ card, shown: !card && (pinned || hovered) });
  const W = picture.width;
  const H = picture.height;
  const cx = picture.at.x * W;
  const cy = picture.at.y * H;
  const R = (scale.metres / picture.metresPerPixel) * (card ? 0.62 : 1);
  const rose = loupe ? roseDrawing(loupe.rose, R, card ? null : scale) : null;
  const dial = dialDrawing(loupe?.rose.windFrom ?? 0, facing, R);
  const line = card ? 1.8 : 1.5;
  const ticks = card
    ? ""
    : Array.from({ length: 36 }, (_, i) => {
        const b = i * 10;
        const long = b % 90 === 0 ? 20 : b % 30 === 0 ? 13 : 7;
        const [x0, y0] = polar(b, R);
        const [x1, y1] = polar(b, R - long);
        return `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`;
      }).join("");
  const needle = loupe
    ? (() => {
        const k = card ? 1.5 : 1;
        const [tx, ty] = polar(loupe.rose.windFrom, R - 30 * k);
        const [ax, ay] = polar(loupe.rose.windFrom - 7, R + 30 * k);
        const [bx, by] = polar(loupe.rose.windFrom + 7, R + 30 * k);
        const [nx, ny] = polar(loupe.rose.windFrom, R + 20 * k);
        return `M${f1(tx)} ${f1(ty)}L${f1(ax)} ${f1(ay)}L${f1(nx)} ${f1(ny)}L${f1(bx)} ${f1(by)}Z`;
      })()
    : null;
  const offshoreMid =
    facing === null ? null : polar(facing + 180, R + LOUPE_BAND + 26);
  return (
    <figure
      className={s.root({ className })}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) setPinned((p) => !p);
      }}
      data-photo-loupe
      data-tide={tide}
    >
      {(["high", "low"] as const).map((t) => (
        <img
          key={t}
          className={s.img({
            className: [
              t === tide ? "opacity-100" : "opacity-0",
              lift(picture),
            ],
          })}
          src={picture.urls[t]}
          alt={
            t === tide
              ? `From above at ${t} tide, north up, with the wind drawn over it.`
              : ""
          }
          loading="lazy"
          decoding="async"
        />
      ))}
      <svg
        className={s.svg()}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <mask id={`${id}-m`}>
            <rect width={W} height={H} className="fill-photo-line" />
            <circle cx={cx} cy={cy} r={R} className="fill-photo-shade" />
          </mask>
          <pattern
            id={`${id}-h`}
            width={9}
            height={9}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect
              width={2.4}
              height={9}
              className="fill-photo-line"
              fillOpacity={0.34}
            />
          </pattern>
          <radialGradient
            id={`${id}-f`}
            cx={0}
            cy={0}
            r={R}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset={0.15}
              stopColor="var(--color-photo-line)"
              stopOpacity={0.05}
            />
            <stop
              offset={1}
              stopColor="var(--color-photo-line)"
              stopOpacity={0.34}
            />
          </radialGradient>
          <filter id={`${id}-s`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx={0}
              dy={1}
              stdDeviation={card ? 3 : 2.5}
              floodOpacity={0.55}
            />
          </filter>
        </defs>
        {/* The world outside the glass, dimmed. */}
        <rect
          width={W}
          height={H}
          className="fill-photo-shade"
          fillOpacity={card ? 0.34 : 0.42}
          mask={`url(#${id}-m)`}
        />
        <g transform={`translate(${f1(cx)} ${f1(cy)})`}>
          {rose?.nogo && (
            <g data-rose-nogo>
              <path
                d={rose.nogo.fill}
                className="fill-photo-shade"
                fillOpacity={0.3}
              />
              <path d={rose.nogo.fill} fill={`url(#${id}-h)`} />
              {rose.nogo.edges.map((e, i) => (
                <line
                  key={i}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  className="stroke-photo-line"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}
          {rose?.fans.map((fan, i) => (
            <g key={i} data-rose-fan={fan.kind}>
              {fan.fill && <path d={fan.fill} fill={`url(#${id}-f)`} />}
              {fan.edges.map((e, j) => (
                <line
                  key={j}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  className="stroke-photo-line"
                  strokeOpacity={0.9}
                  strokeWidth={line}
                  strokeDasharray={fan.kind === "home" ? "6 5" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {fan.kind === "home" && (
                <path
                  d={fan.arc}
                  className="fill-none stroke-photo-line"
                  strokeOpacity={0.85}
                  strokeWidth={line}
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {fan.head && <path d={fan.head} className="fill-photo-line" />}
            </g>
          ))}
          {rose?.slow && (
            <path
              d={rose.slow}
              className="fill-none stroke-photo-line"
              strokeOpacity={0.7}
              strokeWidth={line}
              strokeDasharray="1 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {rose?.drift && (
            <g
              className={
                rose.drift.out
                  ? "fill-photo-red stroke-photo-red"
                  : "fill-photo-line stroke-photo-line"
              }
            >
              <line
                {...rose.drift.line}
                strokeWidth={line + 0.4}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path d={rose.drift.head} strokeWidth={0} />
            </g>
          )}
          {rose?.rings.map((ring, i) => (
            <circle
              key={i}
              r={ring.r}
              className="fill-none stroke-photo-line"
              strokeOpacity={0.45}
              strokeWidth={1}
              strokeDasharray="3 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <g filter={`url(#${id}-s)`}>
            <circle
              r={R}
              className="fill-none stroke-photo-line"
              strokeOpacity={0.96}
              strokeWidth={card ? 1.8 : 2.2}
              vectorEffect="non-scaling-stroke"
            />
            {ticks && (
              <path
                d={ticks}
                className="stroke-photo-line"
                strokeOpacity={0.85}
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {dial.crossOff.map((d, i) => (
              <path
                key={i}
                d={d}
                className="fill-photo-red"
                fillOpacity={0.42}
              />
            ))}
            {dial.offshore && (
              <path
                d={dial.offshore.arc}
                className="fill-none stroke-photo-red"
                strokeWidth={card ? 5 : 9}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                data-rose-offshore
              />
            )}
            {needle && loupe && (
              <path
                d={needle}
                fill={loupe.colour}
                className="stroke-photo-line"
                strokeWidth={card ? 1.4 : 1.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              r={card ? 9 : 7}
              className="fill-photo-line stroke-photo-shade"
              strokeWidth={card ? 2 : 2.2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {!card && (
            <>
              {[
                [0, "N"],
                [90, "E"],
                [180, "S"],
                [270, "W"],
              ].map(([b, n]) => {
                const [x, y] = polar(b as number, R - 40);
                return (
                  <text
                    key={n}
                    x={f1(x)}
                    y={f1(y + 7)}
                    textAnchor="middle"
                    className={s.word()}
                    fontSize={18}
                  >
                    {n}
                  </text>
                );
              })}
              {offshoreMid && dial.offshore && (
                <g>
                  <rect
                    x={offshoreMid[0] - 56}
                    y={offshoreMid[1] - 15}
                    width={112}
                    height={30}
                    rx={15}
                    className="fill-photo-red"
                  />
                  <text
                    x={offshoreMid[0]}
                    y={offshoreMid[1] + 6}
                    textAnchor="middle"
                    className={s.word()}
                    fontSize={15}
                  >
                    OFFSHORE
                  </text>
                </g>
              )}
              <g className={s.words()} data-loupe-words>
                {rose?.labels.map((label, i) => (
                  <text
                    key={i}
                    x={label.x}
                    y={label.y}
                    textAnchor="middle"
                    className={s.word()}
                    fontSize={label.kind === "figure" ? 14 : 15}
                  >
                    {label.text}
                  </text>
                ))}
                {rose?.rings.map((ring, i) => (
                  <text
                    key={i}
                    x={ring.label.x}
                    y={ring.label.y}
                    textAnchor="middle"
                    className={s.word()}
                    fontSize={14}
                  >
                    {ring.label.text}
                  </text>
                ))}
              </g>
            </>
          )}
        </g>
      </svg>
      {children}
    </figure>
  );
}
