/**
 * The spot a thread names, as the chart writes a spot up: its name in the
 * display face's italic, the county in the mono label, and, when the map's
 * data can be had, the hour now in figures (its stars, the wind and the gust
 * raised over it, where it comes from) and the best run of hours left today.
 * The whole card is the way to the spot on the chart.
 *
 * The forecast is the one piece of weather the community touches, and the
 * browser fetches it: the API stores the spot's id and knows nothing about
 * weather. It is read from the series the map's manifest already publishes for
 * every riding location, so there is no frame to load and no grid to sample,
 * and rated by the same stars the dock and the spot page draw, for the rider
 * the reader has set on the map. Without it the card is the name and the link,
 * which is all it has to be.
 */
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadPrefs } from "../../../force5/src/prefs";
import { shoreFacing } from "../../../force5/src/shoreFacing";
import {
  bestWindow,
  rateHour,
  type HourRating,
  type Rider,
} from "../../../force5/src/stars";
import { dayNights } from "../../../force5/src/sun";
import { forecastUrl } from "../../../force5/src/urls";
import {
  KNOTS,
  compass,
  direction,
  nearestFrame,
  speed,
  type Manifest,
} from "../../../force5/src/weather";
import { mapSpotHref } from "../../../force5/src/siteNav";
import { windStop } from "../../../shared/web/windStops";
import { Figure, StarGlyphs } from "../../../ui";
import { MONO_LABEL, RING, tv, type VariantProps } from "../../../ui/tv";
import type { Spot } from "./NewThreadDialog";

export const spotCardStyles = tv({
  slots: {
    // A box of its own inside the opening post: one ink rule, square.
    base: [
      "group grid min-h-touch max-w-measure gap-2 border border-ink bg-ground px-4 py-3 font-body text-ink no-underline",
      "max-rail:px-3",
      RING,
    ],
    head: "flex min-w-0 items-baseline gap-2",
    name: [
      "min-w-0 truncate font-display text-lead font-semibold italic transition-colors duration-fast",
      "group-hover:text-chart-magenta motion-reduce:transition-none",
    ],
    county: ["shrink-0 text-ink-muted", MONO_LABEL],
    // Where the card goes, set right: CHART ->, as the spot page's way back.
    go: [
      "ml-auto inline-flex shrink-0 items-center gap-1 self-center text-ink",
      MONO_LABEL,
    ],
    // The hour now, in figures, on a hairline.
    now: "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 border-t border-line pt-2",
    // Wind is data: the swatch takes the ramp, and the number stays in ink.
    swatch: "h-5 w-1.5 shrink-0 rounded-full",
    from: "font-mono text-caption text-ink-2",
    label: ["text-ink-muted", MONO_LABEL],
    dark: "font-mono text-caption text-ink-muted italic",
    // The best of what is left today.
    best: "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1",
    bestTimes: "font-mono text-caption font-semibold text-ink tabular-nums",
    meta: "font-body text-body text-ink-muted italic",
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

// The stops are shared with the spot page, which paints its wind with them too.
export { WIND_STOPS, windStop } from "../../../shared/web/windStops";

/**
 * The map, opened on a spot. An absolute path, as the site menu's are: crossing
 * sections swaps the bundle, which is a page load and not a push.
 */
export { mapSpotHref } from "../../../force5/src/siteNav";

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

/** The words for the wind now: "WSW · gusting 26 kn". */
export function readingLine(reading: SpotReading): string {
  return [
    reading.from ?? "Calm",
    reading.gustKnots !== null && `gusting ${reading.gustKnots} kn`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const WHERE = "Forecast on the wind map";

/** What the stars make of the spot today, for the reader's rider. */
export interface SpotOutlook {
  /** The hour now, rated. Null in the dark, or with no wind to rate. */
  now: Pick<HourRating, "stars" | "potential"> | null;
  /** The best run of hours left today, rated on its weakest. */
  best: {
    stars: number;
    /** The first hour and the instant the run ends, in ms. */
    from: number;
    to: number;
    /** The wing it takes, in m²: the rider's own, or the one picked. */
    wing: number;
  } | null;
}

const HOUR_MS = 3600000;
const dublinDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dublinClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "13:00", Irish time: the clock the rest of the site keeps. */
export const clock = (time: number) => dublinClock.format(new Date(time));

/**
 * The hour now and the best of what is left of today, rated as the dock rates
 * an hour: the run's wind and gust, where it blows from against the way the
 * shore faces, and the dark left unrated. One model's run, so the models'
 * agreement is not known and costs nothing.
 */
export function spotOutlook(
  series: SpotSeries,
  place: { id: string; lat?: number; lon?: number },
  now: number,
  rider: Rider,
  facing: number | null = shoreFacing(place.id),
): SpotOutlook {
  const hours = (series ?? []).filter(
    (hour) => Number.isFinite(hour.u) && Number.isFinite(hour.v),
  );
  if (!hours.length) return { now: null, best: null };
  const times = hours.map((hour) => Date.parse(hour.validTime));
  const nights =
    place.lat === undefined || place.lon === undefined
      ? []
      : dayNights(
          place.lat,
          place.lon,
          new Date(times[0]),
          new Date(times[times.length - 1] + HOUR_MS),
        );
  const rate = (at: number) => {
    const hour = hours[at];
    const time = times[at];
    return rateHour(
      {
        windKn: speed(hour) * KNOTS,
        gustKn:
          typeof hour.gust === "number" && Number.isFinite(hour.gust)
            ? hour.gust * KNOTS
            : null,
        from: direction(hour.u, hour.v),
        agreement: null,
        daylight: !nights.some(
          (night) => time >= night.from.getTime() && time < night.to.getTime(),
        ),
      },
      { facing },
      rider,
    );
  };

  const nearest = nearestFrame(hours, now);
  const covered = Math.abs(times[nearest] - now) <= NOW_WINDOW_MS;
  const rated = covered ? rate(nearest) : null;

  // What is left of today: from the top of this hour to Irish midnight.
  const today = dublinDay.format(new Date(now));
  const from = now - (now % HOUR_MS);
  const left = times
    .map((time, at) => ({ time, at }))
    .filter(
      ({ time }) => time >= from && dublinDay.format(new Date(time)) === today,
    );
  const ratings = left.map(({ at }) => rate(at));
  const window = bestWindow(ratings);
  const first = window ? ratings[window.from] : null;
  return {
    now: rated && { stars: rated.stars, potential: rated.potential },
    best:
      window && first
        ? {
            stars: window.stars,
            from: left[window.from].time,
            to: left[window.to].time + HOUR_MS,
            wing: first.wing.own ?? first.wing.recommended,
          }
        : null,
  };
}

export interface SpotCardViewProps {
  spot: Spot;
  reading: SpotReading | null;
  outlook?: SpotOutlook | null;
}

/** The card as drawn. The whole of it is one link to the map. */
export function SpotCardView({ spot, reading, outlook }: SpotCardViewProps) {
  const styles = spotCardStyles({
    wind: reading ? windStop(reading.knots) : undefined,
  });
  const best = outlook?.best ?? null;
  return (
    <a className={styles.base()} href={mapSpotHref(spot.id)}>
      <span className={styles.head()}>
        <span className={styles.name()}>{spot.name}</span>
        <span className={styles.county()}>Co. {spot.county}</span>
        <span className={styles.go()} aria-hidden="true">
          Chart
          <ArrowRight size={12} strokeWidth={1.5} />
        </span>
      </span>
      {reading ? (
        <span className={styles.now()}>
          <span className={styles.label()}>Now</span>
          {outlook &&
            (outlook.now ? (
              <StarGlyphs
                stars={outlook.now.stars}
                potential={outlook.now.potential}
                size={12}
              />
            ) : (
              <span className={styles.dark()}>dark</span>
            ))}
          <span className={styles.swatch()} aria-hidden="true" />
          <Figure
            value={reading.knots}
            sup={reading.gustKnots ?? undefined}
            unit="kn"
            label={`${reading.knots} knots now, ${readingLine(reading)}`}
          />
          <span className={styles.from()} aria-hidden="true">
            {reading.from ?? "Calm"}
          </span>
          {/* Said where the figures above are the wind's and not the link's. */}
          <span className={styles.hidden()}>. {WHERE}</span>
        </span>
      ) : (
        <span className={styles.meta()}>{WHERE}</span>
      )}
      {best && (
        <span className={styles.best()}>
          <span className={styles.label()}>Best today</span>
          <StarGlyphs stars={best.stars} size={12} />
          <span className={styles.bestTimes()}>
            {clock(best.from)}–{clock(best.to)}
          </span>
          <Figure
            value={best.wing}
            unit="m"
            size="sm"
            label={`on a ${best.wing} square metre wing`}
          />
        </span>
      )}
    </a>
  );
}

/** One spot's hours, as the manifest holds them. */
type SpotSeries = Manifest["spotForecasts"][string];

/**
 * The spot behind an id, and its wind once the spot is known. Both files are
 * the map's own. An id the list does not hold finds nothing, and a manifest
 * that cannot be had costs the card its reading and nothing else.
 *
 * The hours are kept and the reading is taken from them at `now`: a thread is
 * a page left open, and "now" on it has to move with the clock, or stand down
 * once the run has stopped covering it.
 */
/**
 * The model the map opens on, asked for as the map asks — revalidated, never a
 * stale copy — but once per five minutes for the page rather than once per
 * card: a thread list or a long thread can name the same spot many times.
 */
const MANIFEST_TTL_MS = 5 * 60 * 1000;
let harmonie: { at: number; manifest: Promise<Manifest | null> } | null = null;
function harmonieManifest(): Promise<Manifest | null> {
  if (harmonie && Date.now() - harmonie.at < MANIFEST_TTL_MS)
    return harmonie.manifest;
  const manifest = fetch(forecastUrl("weather/harmonie.json"), {
    cache: "no-cache",
  })
    .then((reply) => (reply.ok ? (reply.json() as Promise<Manifest>) : null))
    .catch(() => null);
  harmonie = { at: Date.now(), manifest };
  // A failure is not kept: the next card asks again.
  void manifest.then((m) => {
    if (!m && harmonie?.manifest === manifest) harmonie = null;
  });
  return manifest;
}

export function useSpotCard(
  spotId: string | null,
  now: number,
): {
  spot: Spot | null;
  reading: SpotReading | null;
  outlook: SpotOutlook | null;
} {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [series, setSeries] = useState<SpotSeries | null>(null);

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

  // Only for a spot the map lists: a thread naming a place the map does not
  // know has no reading to show, and no reason to download the forecast.
  const knownId = spot?.id ?? null;
  useEffect(() => {
    setSeries(null);
    if (!knownId) return;
    let current = true;
    harmonieManifest().then((manifest) => {
      if (current && manifest)
        setSeries(manifest.spotForecasts?.[knownId] ?? null);
    });
    return () => {
      current = false;
    };
  }, [knownId]);

  const reading = useMemo(
    () =>
      knownId && series
        ? readingNow({ spotForecasts: { [knownId]: series } }, knownId, now)
        : null,
    [knownId, series, now],
  );

  // The rider the reader has set on the map, read once: the stars are theirs.
  const rider = useMemo(() => loadPrefs().rider, []);
  const outlook = useMemo(
    () =>
      spot && series && reading ? spotOutlook(series, spot, now, rider) : null,
    [spot, series, reading, now, rider],
  );

  return { spot, reading, outlook };
}

/** Nothing for a thread without a spot, and nothing for a spot the map no longer lists. */
export function SpotCard({
  spotId,
  now,
}: {
  spotId: string | null;
  /** The page's clock, so the reading keeps up with it. */
  now: Date;
}) {
  const { spot, reading, outlook } = useSpotCard(spotId, now.getTime());
  return spot ? (
    <SpotCardView spot={spot} reading={reading} outlook={outlook} />
  ) : null;
}
