/**
 * What a card says beside the wind and the stars: the sky and the air, the
 * waves, and the tide, for each place listed, on the chart's own strip of
 * columns. All of it is what the dock's rows read (src/ForecastDock.tsx):
 * the wave and weather runs from the same sweep of the models
 * (`useMarineModels`), each place's square of them read as the dock reads
 * one place's (`useSpotSquares`), the sources handed on from one run to the
 * next as the dock hands them, and the nearest station's tide. A place none
 * of them reaches has nothing here, and its card leaves the reading out.
 */
import { useMemo } from "react";
import { spotSquare } from "../../force5/src/squares";
import {
  handedWeatherSource,
  presentWeather,
  weatherAtAxis,
  weatherSources,
  type PresentWeather,
  type WeatherManifest,
} from "../../force5/src/surface";
import type { TideEvent } from "../../force5/src/tides";
import { variableValue } from "../../force5/src/variables";
import {
  handedWaveSource,
  waveAtAxis,
  waveSources,
  type WaveManifest,
} from "../../force5/src/waves";
import type { Spot } from "../../force5/src/weather";
import { useMarineModels, useSpotsTides } from "../useBlend";
import { useSpotSquares } from "../useSpotSquares";

/** The sea at one column: its height in metres, and its period in seconds. */
export interface Sea {
  height: number;
  period: number | null;
}

/** One place's readings, a value per strip column (null where none is near). */
export interface Readings {
  sky: (PresentWeather | null)[];
  /** The air, °C. */
  air: (number | null)[];
  sea: (Sea | null)[];
  /** High and low waters at the place's nearest station, or none. */
  tides: readonly TideEvent[];
}

const NONE: Readings = { sky: [], air: [], sea: [], tides: [] };

/** A place's readings from the merged runs, on the strip's axis. */
export function readingsFor(
  waves: readonly WaveManifest[],
  weather: readonly WeatherManifest[],
  spotId: string,
  axis: readonly string[],
): Omit<Readings, "tides"> {
  const out: Omit<Readings, "tides"> = { sky: [], air: [], sea: [] };
  const sky = handedWeatherSource(weatherSources(weather, spotId));
  if (sky) {
    const steps = weatherAtAxis(sky.series, axis);
    out.sky = steps.map((step) =>
      presentWeather(variableValue(step, sky.fields.present)),
    );
    out.air = steps.map((step) => variableValue(step, sky.fields.air));
  }
  const sea = handedWaveSource(waveSources(waves, spotId));
  if (sea) {
    const { height, period } = sea.fields.total;
    out.sea = waveAtAxis(sea.series, axis).map((step) => {
      const h = variableValue(step, height);
      return h === null
        ? null
        : { height: h, period: variableValue(step, period) };
    });
  }
  return out;
}

/** The readings for every place listed, by its id. */
export function useReadings(
  spots: readonly Spot[],
  axis: readonly string[],
): ReadonlyMap<string, Readings> {
  const marine = useMarineModels(spots.length > 0);
  const squares = useMemo(
    () =>
      spots.length
        ? [...new Set(spots.map((s) => spotSquare(s.lat, s.lon)))].sort()
        : null,
    [spots],
  );
  const merged = useSpotSquares(marine, squares);
  const tides = useSpotsTides(useMemo(() => spots.map((s) => s.id), [spots]));
  const axisKey = axis.length ? `${axis[0]}/${axis.at(-1)}/${axis.length}` : "";
  const read = useMemo(() => {
    const waves = merged.flatMap((m) => (m.wave ? [m.wave] : []));
    const weather = merged.flatMap((m) => (m.weather ? [m.weather] : []));
    return new Map(
      spots.map((spot) => [
        spot.id,
        readingsFor(waves, weather, spot.id, axis),
      ]),
    );
    // axisKey stands in for the axis array, which is rebuilt every render.
  }, [merged, spots, axisKey]);
  return useMemo(
    () =>
      new Map(
        spots.map((spot) => [
          spot.id,
          {
            ...(read.get(spot.id) ?? NONE),
            tides: tides.get(spot.id)?.curve.events ?? [],
          },
        ]),
      ),
    [read, tides, spots],
  );
}
