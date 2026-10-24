// One surface current as the dock and the map print it: small enough for the
// dock to import as the page loads, where force5/src/currents.ts (the layer's
// reading and drawing) is a chunk of its own, loaded only when it is needed.
import { convert, scaleUnits, unitLabel, type Units } from "./units";

/** The water at one place and hour: how fast, and where it runs to. */
export interface CurrentReading {
  /** Metres per second. */
  speed: number;
  /** The bearing the water runs towards, degrees true. */
  towards: number;
}

/** Slower than this (about 0.1 kn) and an arrow says nothing worth drawing. */
export const MIN_ARROW_MS = 0.05;

/**
 * The unit a current is said in: the rider's, but water has no forces, so a
 * rider in Force reads a stream in knots.
 */
export const currentUnits = scaleUnits;

/** A speed held in m/s, in the rider's units, to a tenth: currents are slow. */
export const currentFigure = (metresPerSecond: number, units: Units) =>
  convert(metresPerSecond, currentUnits(units)).toFixed(1);

/** The same with its unit: "0.8 kn". */
export const currentText = (metresPerSecond: number, units: Units) =>
  `${currentFigure(metresPerSecond, units)} ${unitLabel(currentUnits(units))}`;
