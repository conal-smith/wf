/**
 * The place from above, under the page's header: our own Sentinel-2
 * composite at high tide or at low tide (satellite.ts), framed as the chart
 * frames a box, north up, the place ringed at its centre with an arrow out
 * the way its beach faces, and a scale. At low tide the sand, the flats and
 * the rocks the high tide covers are bare.
 *
 * Nothing is drawn until the list of pictures says this place has one, and
 * nothing if its picture will not load: no picture, no gap. The frame keeps
 * the picture's shape while it loads, so the page never moves under it. Once
 * the first picture is in, the other tide's is fetched behind it, so the
 * switch is one press; a press before it is in keeps the picture there is,
 * says the other is loading, and swaps it in the moment it arrives.
 */
import { ArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chip, Segmented } from "../../ui";
import { tv } from "../../ui/tv";
import { compass } from "./spot";
import {
  inFrame,
  loadSpotPictures,
  pictureCredit,
  scaleBar,
  spotPicture,
  type PictureTide,
  type SpotPicture,
} from "./satellite";

const styles = tv({
  slots: {
    figure: "m-0 flex flex-col gap-2",
    // Three to two on a phone, its sides cut off; two to one from 720.
    frame:
      "relative aspect-3/2 overflow-hidden border border-ink bg-sunken wide:aspect-2/1",
    image: "block size-full object-cover",
    // The chart's double rule, laid over the picture's edge.
    rule: "pointer-events-none absolute inset-0 inset-shadow-frame",
    mark: "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 overflow-visible",
    halo: "fill-none stroke-ground",
    ink: "fill-none stroke-ink",
    ring: "fill-card stroke-ink",
    north: "absolute top-3 right-3 gap-0.5 font-semibold",
    loading: "absolute top-3 left-3",
    scale: "absolute bottom-3 left-3 gap-2",
    bar: "block h-1.5 border-0 border-x border-b border-ink",
    caption: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
    credit: "m-0 font-body text-caption text-ink-muted",
  },
});

const TIDES = [
  { value: "high", label: "High tide" },
  { value: "low", label: "Low tide" },
] as const;

/**
 * The place's picture, once the list is read: null until then, and for a
 * place the list has no picture of (or none published yet).
 */
export function useSpotPicture(spot: {
  id: string;
  lat: number;
  lon: number;
}): SpotPicture | null {
  const [picture, setPicture] = useState<SpotPicture | null>(null);
  useEffect(() => {
    let current = true;
    void loadSpotPictures().then((pictures) => {
      if (current) setPicture(pictures && spotPicture(pictures, spot));
    });
    return () => {
      current = false;
    };
  }, [spot]);
  return picture;
}

/** The picture, framed, with its tide switch and its credit; nothing if it will not load. */
export function SpotSatellite(props: {
  picture: SpotPicture;
  name: string;
  facing: number | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === props.picture.urls.high) return null;
  return (
    <Picture {...props} onFail={() => setFailed(props.picture.urls.high)} />
  );
}

function Picture({
  picture,
  name,
  facing,
  onFail,
}: {
  picture: SpotPicture;
  name: string;
  facing: number | null;
  onFail: () => void;
}) {
  const s = styles();
  const [tide, setTide] = useState<PictureTide>("high");
  // The pictures the browser has, by address.
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const loaded = (url: string) =>
    setReady((r) => (r.has(url) ? r : new Set(r).add(url)));
  const has = (which: PictureTide) => ready.has(picture.urls[which]);
  const other: PictureTide = tide === "high" ? "low" : "high";
  // The chosen tide's picture once it is in; until then the other's, if that
  // one is (the switch was pressed before its picture arrived).
  const shown = !has(tide) && has(other) ? other : tide;
  const waiting = shown !== tide;
  // Fetch what is not in yet: the chosen tide's, and once either picture is
  // in, the other's behind it. A picture the browser has loaded is in its
  // cache, so the <img> takes it from there the moment `shown` turns to it.
  const fetching = useRef(new Map<string, HTMLImageElement>());
  const started = has("high") || has("low");
  useEffect(() => {
    for (const which of ["high", "low"] as const) {
      const url = picture.urls[which];
      if (ready.has(url) || fetching.current.has(url)) continue;
      if (which !== tide && !started) continue;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => loaded(url);
      image.onerror = onFail;
      image.src = url;
      fetching.current.set(url, image);
    }
  }, [picture, tide, started]);
  useEffect(() => {
    const images = fetching.current;
    return () => {
      for (const image of images.values()) image.onload = image.onerror = null;
    };
  }, []);
  const [frameRef, size] = useSize<HTMLDivElement>();
  const place = size && inFrame(picture, size.width, size.height);
  const scale = place && scaleBar(place.metresPerScreenPixel, size.width * 0.3);
  const faces =
    facing === null
      ? ""
      : `, and an arrow the way its beach faces (${compass(facing)})`;
  return (
    <figure className={s.figure()} data-spot-satellite data-tide={tide}>
      <div className={s.frame()} ref={frameRef} aria-busy={waiting}>
        <img
          className={s.image()}
          src={picture.urls[shown]}
          width={picture.width}
          height={picture.height}
          alt={`${name} from above at ${shown} tide, north up: a satellite picture with the riding place ringed at its centre${faces}.`}
          loading="lazy"
          decoding="async"
          onLoad={() => loaded(picture.urls[shown])}
          onError={onFail}
        />
        {place && (
          <svg
            className={s.mark()}
            style={{ left: place.x, top: place.y }}
            width={72}
            height={72}
            viewBox="-36 -36 72 72"
            aria-hidden="true"
            data-place-mark
          >
            {facing !== null && (
              <g
                transform={`rotate(${Math.round(facing)})`}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path className={s.halo()} d={FACING_ARROW} strokeWidth={4.5} />
                <path className={s.ink()} d={FACING_ARROW} strokeWidth={1.8} />
              </g>
            )}
            <circle className={s.halo()} r={7.6} strokeWidth={4} />
            <circle className={s.ring()} r={7.6} strokeWidth={1.4} />
            <circle className="fill-ink" r={2} />
          </svg>
        )}
        {waiting && (
          <Chip
            tone="glass"
            eyebrow
            className={s.loading()}
            role="status"
            data-picture-loading
          >
            Loading {tide} tide…
          </Chip>
        )}
        <Chip tone="glass" eyebrow className={s.north()} aria-hidden="true">
          <ArrowUp size={11} strokeWidth={2} />N
        </Chip>
        {scale && (
          <Chip tone="glass" className={s.scale()} data-scale>
            <span
              className={s.bar()}
              style={{ width: Math.round(scale.pixels) }}
              aria-hidden="true"
            />
            {scale.label}
          </Chip>
        )}
        <span className={s.rule()} aria-hidden="true" />
      </div>
      <figcaption className={s.caption()}>
        <Segmented
          aria-label="Show the place at"
          options={TIDES}
          value={tide}
          onChange={setTide}
        />
        <p className={s.credit()}>{pictureCredit(picture.attribution)}</p>
      </figcaption>
    </figure>
  );
}

/** Out from the ring the way the beach faces: north, before it is turned. */
const FACING_ARROW = "M0 -11V-31M-4.2 -26L0 -31.5L4.2 -26";

/** An element's size, kept current; null until it is measured. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width && height) setSize({ width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  return [ref, size] as const;
}
