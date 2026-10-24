// Display units. Every stored and computed speed stays in metres per second;
// conversion happens only when a value is shown.
//
// Force (Beaufort) is a unit of its own kind: not a factor but a step, the
// whole force a wind is in. A figure in Force is `knotsIn`/`speedShort`'s; a
// scale (a chart's axis, a range ring, a tidal stream) has no forces to draw
// along, so it reads Force in knots (`scaleUnits`).
export type Units = "kn" | "m/s" | "km/h" | "mph" | "bft";

/** The units a straight scale can be drawn in: everything but Force. */
export type ScaleUnits = Exclude<Units, "bft">;

export const KNOTS = 1.94384449;
const FACTORS: Record<Units, number> = {
  kn: KNOTS,
  "m/s": 1,
  "km/h": 3.6,
  mph: 2.2369362920544,
  // Read on a knot scale wherever a straight line is drawn: see scaleUnits.
  bft: KNOTS,
};

export const UNITS: readonly { id: Units; label: string; name: string }[] = [
  { id: "kn", label: "kn", name: "Knots" },
  { id: "m/s", label: "m/s", name: "Metres per second" },
  { id: "km/h", label: "km/h", name: "Kilometres per hour" },
  { id: "mph", label: "mph", name: "Miles per hour" },
  { id: "bft", label: "Force", name: "Force" },
];

export const isUnits = (value: unknown): value is Units =>
  UNITS.some((unit) => unit.id === value);

/** Whether the rider reads the wind in forces. */
export const isForce = (units: Units): units is "bft" => units === "bft";

/** The units a scale is drawn in: knots for a rider in Force, else theirs. */
export const scaleUnits = (units: Units): ScaleUnits =>
  units === "bft" ? "kn" : units;

export const convert = (speed: number, units: Units) => speed * FACTORS[units];

export const unitLabel = (units: Units) =>
  UNITS.find((unit) => unit.id === units)?.label ?? units;

/* ---- the Beaufort scale ---- */

/** The knots each force starts at, Force 1 to Force 12. Under a knot is Force 0. */
export const BEAUFORT_KN = [
  1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64,
] as const;

/**
 * The force a wind in knots is in, 0 to 12. Taken on the whole knot, as the
 * knots are shown, so a rider switching from knots to Force never sees 4 kn
 * turn into Force 1.
 */
export function beaufort(knots: number): number {
  if (!Number.isFinite(knots)) return 0;
  const kn = Math.round(knots);
  let force = 0;
  while (force < BEAUFORT_KN.length && kn >= BEAUFORT_KN[force]) force++;
  return force;
}

/**
 * A force's first or last whole knot: Force 5 is 17 to 21. Force 12 has no
 * top, so its last knot is taken as 64. Out of range forces are held to 0–12.
 */
export function forceKn(force: number, edge: "first" | "last"): number {
  const f = Math.min(12, Math.max(0, Math.round(force)));
  if (edge === "first") return f === 0 ? 0 : BEAUFORT_KN[f - 1];
  return f === 12 ? BEAUFORT_KN[11] : BEAUFORT_KN[f] - 1;
}

/** A speed held in knots, in `units`, rounded to a whole number as a label prints it; a whole force in Force. */
export const knotsIn = (knots: number, units: Units) =>
  units === "bft" ? beaufort(knots) : Math.round(convert(knots / KNOTS, units));

/** A speed held in knots, short, for a line of figures: "14", or "F4" in Force. */
export const speedShort = (knots: number, units: Units) =>
  units === "bft" ? `F${beaufort(knots)}` : String(knotsIn(knots, units));

/** A speed held in knots, as it is read aloud: "14 knots", "Force 4". */
export const speedWords = (knots: number, units: Units) =>
  units === "bft"
    ? `Force ${beaufort(knots)}`
    : `${knotsIn(knots, units)} ${unitName(units)}`;

/** The unit as it is read aloud: "knots", "metres per second", "force". */
export const unitName = (units: Units) =>
  (UNITS.find((unit) => unit.id === units)?.name ?? units).toLowerCase();

/** Rounded value with its unit label; "Force 5" in Force; an em dash for missing data, never zero. */
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
  if (units === "bft") return `Force ${beaufort(metresPerSecond * KNOTS)}`;
  return `${convert(metresPerSecond, units).toFixed(digits)} ${unitLabel(units)}`;
}
