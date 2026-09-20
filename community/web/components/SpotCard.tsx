/**
 * The spot a thread names: its name, the way to its forecast on the wind map
 * and, when the map's data can be had, the wind there now.
 *
 * The reading is the one piece of forecast data the community touches, and the
 * browser fetches it: the API stores the spot's id and knows nothing about
 * weather. It is read from the series the map's manifest already publishes for
 * every riding location, so there is no frame to load and no grid to sample.
 * Without it the card is the name and the link, which is all it has to be.
 */
import { ChevronRight, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { forecastUrl } from "../../../force5/src/urls";
import {
  KNOTS,
  compass,
  direction,
  nearestFrame,
  speed,
  type Manifest,
} from "../../../force5/src/weather";
import { RING, tv, type VariantProps } from "../../../ui/tv";
import { spotLabel, type Spot } from "./NewThreadDialog";

export const spotCardStyles = tv({
  slots: {
    // On the opening post's card, so it takes the ground to stand apart from it.
    base: [
      "flex min-h-touch max-w-measure items-center gap-3 rounded-control bg-ground px-5 py-3 font-sans text-ink no-underline transition-colors duration-fast",
      "not-disabled:hover:bg-sunken max-rail:px-3 motion-reduce:transition-none",
      RING,
    ],
    // Wind is data: the swatch takes the ramp, and the number stays in ink.
    swatch: "h-control-sm w-2 shrink-0 rounded-full",
    text: "grid min-w-0 flex-1 gap-0.5",
    name: "flex min-w-0 items-center gap-1 text-prose font-semibold",
    nameText: "min-w-0 truncate",
    pin: "shrink-0 text-ink-muted",
    meta: "truncate text-body text-ink-muted",
    reading: "shrink-0 text-right text-lead whitespace-nowrap tabular-nums",
    unit: "text-body font-normal text-ink-muted",
    now: "max-rail:hidden",
    chevron: "shrink-0 text-ink-muted max-rail:hidden",
    hidden: "sr-only",
  },
  variants: {
    // The wind ramp's stops, as the theme names them. Written out: a class
    // name put together as the page runs is one the stylesheet never gets.
    wind: {
      k00: { swatch: "bg-wind-k00" },
      k05: { swatch: "bg-wind-k05" },
      k09: { swatch: "bg-wind-k09" },
      k10: { swatch: "bg-wind-k10" },
      k15: { swatch: "bg-wind-k15" },
      k20: { swatch: "bg-wind-k20" },
      k25: { swatch: "bg-wind-k25" },
      k30: { swatch: "bg-wind-k30" },
      k35: { swatch: "bg-wind-k35" },
      k40: { swatch: "bg-wind-k40" },
      k45: { swatch: "bg-wind-k45" },
      k50: { swatch: "bg-wind-k50" },
      k60: { swatch: "bg-wind-k60" },
      k65: { swatch: "bg-wind-k65" },
    },
  },
});

export type WindStop = NonNullable<VariantProps<typeof spotCardStyles>["wind"]>;

/** Where each stop starts, in knots: the map's ramp, stop for stop. */
export const WIND_STOPS: readonly (readonly [number, WindStop])[] = [
  [0, "k00"],
  [5, "k05"],
  [9, "k09"],
  [10, "k10"],
  [15, "k15"],
  [20, "k20"],
  [25, "k25"],
  [30, "k30"],
  [35, "k35"],
  [40, "k40"],
  [45, "k45"],
  [50, "k50"],
  [60, "k60"],
  [65, "k65"],
];

/** The stop a speed has reached: 19 kn is drawn at 15, and 20 kn at 20. */
export function windStop(knots: number): WindStop {
  let stop = WIND_STOPS[0][1];
  for (const [from, name] of WIND_STOPS) if (knots >= from) stop = name;
  return stop;
}

/**
 * The map, opened on a spot. An absolute path, as the site menu's are: crossing
 * sections swaps the bundle, which is a page load and not a push.
 */
export const mapSpotHref = (spotId: string) =>
  `/?spot=${encodeURIComponent(spotId)}`;

export interface SpotReading {
  /** Rounded, as shown: the swatch is chosen from the same number. */
  knots: number;
  gustKnots: number | null;
  /** Where the wind is coming from, as a compass point. Null in a calm. */
  from: string | null;
  validTime: string;
}

/** A forecast hour further from the clock than this is not "now". */
const NOW_WINDOW_MS = 90 * 60000;

/**
 * The spot's wind at the forecast hour nearest the clock, or null: a spot the
 * run does not list, a location the model does not reach, or a run that has
 * stopped covering the present.
 */
export function readingNow(
  manifest: Pick<Manifest, "spotForecasts">,
  spotId: string,
  now = Date.now(),
): SpotReading | null {
  const series = manifest.spotForecasts?.[spotId];
  if (!Array.isArray(series) || !series.length) return null;
  const hour = series[nearestFrame(series, now)];
  if (!(Math.abs(Date.parse(hour.validTime) - now) <= NOW_WINDOW_MS))
    return null;
  if (!Number.isFinite(hour.u) || !Number.isFinite(hour.v)) return null;
  const knots = Math.round(speed(hour) * KNOTS);
  return {
    knots,
    gustKnots:
      typeof hour.gust === "number" && Number.isFinite(hour.gust)
        ? Math.round(hour.gust * KNOTS)
        : null,
    from: knots > 0 ? compass(direction(hour.u, hour.v)) : null,
    validTime: hour.validTime,
  };
}

/** The line under the name: "WSW · gusting 26 kn". */
export function readingLine(reading: SpotReading): string {
  return [
    reading.from ?? "Calm",
    reading.gustKnots !== null && `gusting ${reading.gustKnots} kn`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const WHERE = "Forecast on the wind map";

export interface SpotCardViewProps {
  spot: Spot;
  reading: SpotReading | null;
}

/** The card as drawn. The whole of it is one link to the map. */
export function SpotCardView({ spot, reading }: SpotCardViewProps) {
  const styles = spotCardStyles({
    wind: reading ? windStop(reading.knots) : undefined,
  });
  return (
    <a className={styles.base()} href={mapSpotHref(spot.id)}>
      {reading && <span className={styles.swatch()} aria-hidden="true" />}
      <span className={styles.text()}>
        <span className={styles.name()}>
          <MapPin className={styles.pin()} size={14} aria-hidden="true" />
          <span className={styles.nameText()}>{spotLabel(spot)}</span>
        </span>
        <span className={styles.meta()}>
          {reading ? readingLine(reading) : WHERE}
        </span>
      </span>
      {reading && (
        <span className={styles.reading()}>
          {reading.knots}{" "}
          <span className={styles.unit()}>
            kn<span className={styles.now()}> now</span>
          </span>
          {/* Said where the words above are the wind's and not the link's. */}
          <span className={styles.hidden()}>. {WHERE}</span>
        </span>
      )}
      <ChevronRight className={styles.chevron()} size={18} aria-hidden="true" />
    </a>
  );
}

/**
 * The spot behind an id, and its wind once the spot is known. Both files are
 * the map's own. An id the list does not hold finds nothing, and a manifest
 * that cannot be had costs the card its reading and nothing else.
 */
export function useSpotCard(spotId: string | null): {
  spot: Spot | null;
  reading: SpotReading | null;
} {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [reading, setReading] = useState<SpotReading | null>(null);

  useEffect(() => {
    setSpot(null);
    if (!spotId) return;
    let current = true;
    fetch(`${import.meta.env.BASE_URL}riding-locations.json`)
      .then((reply) => (reply.ok ? reply.json() : []))
      .then(
        (list: Spot[]) => {
          if (!current || !Array.isArray(list)) return;
          setSpot(list.find((place) => place.id === spotId) ?? null);
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, [spotId]);

  const knownId = spot?.id ?? null;
  useEffect(() => {
    setReading(null);
    if (!knownId) return;
    let current = true;
    // The model the map opens on, asked for as the map asks: never a stale copy.
    fetch(forecastUrl("weather/harmonie.json"), { cache: "no-cache" })
      .then((reply) => (reply.ok ? reply.json() : null))
      .then(
        (manifest: Manifest | null) => {
          if (current && manifest) setReading(readingNow(manifest, knownId));
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, [knownId]);

  return { spot, reading };
}

/** Nothing for a thread without a spot, and nothing for a spot the map no longer lists. */
export function SpotCard({ spotId }: { spotId: string | null }) {
  const { spot, reading } = useSpotCard(spotId);
  return spot ? <SpotCardView spot={spot} reading={reading} /> : null;
}
