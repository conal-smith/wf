/**
 * The loupe (shared/web/Loupe.tsx) over a spot's satellite picture, at high or
 * low tide. Its words show on hover, or a tap.
 */
import { useState } from "react";
import type { LoupeRose, RoseScale } from "../../../force5/src/focus";
import type { Rose } from "../../../force5/src/rideWedge";
import { Loupe } from "../../../shared/web/Loupe";
import { tv } from "../../../ui/tv";
import { lift, type PictureTide, type SpotPicture } from "../satellite";

const styles = tv({
  slots: {
    root: "relative m-0 overflow-hidden rounded-surface bg-photo-shade",
    img: "absolute inset-0 size-full object-cover transition-opacity duration-base",
  },
});

export function PhotoLoupe({
  picture,
  tide,
  loupe,
  faint,
  facing,
  scale,
  className,
  children,
}: {
  picture: SpotPicture;
  tide: PictureTide;
  loupe: LoupeRose | null;
  /** Under the rider's floor: where they could sail, drawn faintly. */
  faint?: Rose | null;
  facing: number | null;
  scale: RoseScale;
  className?: string;
  children?: React.ReactNode;
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const s = styles();
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
      <Loupe
        width={picture.width}
        height={picture.height}
        cx={picture.at.x * picture.width}
        cy={picture.at.y * picture.height}
        r={scale.metres / picture.metresPerPixel}
        loupe={loupe}
        faint={faint}
        facing={facing}
        scale={scale}
        words={pinned || hovered}
      />
      {children}
    </figure>
  );
}
