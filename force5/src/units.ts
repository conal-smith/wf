// Display units. Every stored and computed speed stays in metres per second;
// conversion happens only when a value is shown.
export type Units = "kn" | "m/s" | "km/h" | "mph";

export const KNOTS = 1.94384449;
const FACTORS: Record<Units, number> = {
  kn: KNOTS,
  "m/s": 1,
  "km/h": 3.6,
  mph: 2.2369362920544,
};

export const UNITS: readonly { id: Units; label: string; name: string }[] = [
  { id: "kn", label: "kn", name: "Knots" },
  { id: "m/s", label: "m/s", name: "Metres per second" },
  { id: "km/h", label: "km/h", name: "Kilometres per hour" },
  { id: "mph", label: "mph", name: "Miles per hour" },
];

export const isUnits = (value: unknown): value is Units =>
  UNITS.some((unit) => unit.id === value);

export const convert = (speed: number, units: Units) => speed * FACTORS[units];

export const unitLabel = (units: Units) =>
  UNITS.find((unit) => unit.id === units)?.label ?? units;

/** A speed held in knots, in `units`, rounded to a whole number as a label prints it. */
export const knotsIn = (knots: number, units: Units) =>
  Math.round(convert(knots / KNOTS, units));

/** The unit as it is read aloud: "knots", "metres per second". */
export const unitName = (units: Units) =>
  (UNITS.find((unit) => unit.id === units)?.name ?? units).toLowerCase();

/** Rounded value with its unit label; an em dash for missing data, never zero. */
export function formatSpeed(
  metresPerSecond: number | null | undefined,
  units: Units,
  digits = 0,
): string {
  if (
    metresPerSecond === null ||
    metresPerSecond === undefined ||
    !Number.isFinite(metresPerSecond)
  )
    return "—";
  return `${convert(metresPerSecond, units).toFixed(digits)} ${unitLabel(units)}`;
}
