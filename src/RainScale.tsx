import { RAIN_KEY_MM } from "../force5/src/rain";

/**
 * Each amount's colour, as the layer paints it (force5/src/rain.ts): the
 * theme's four stops, and 1 and 4 mm halfway between their neighbours, which
 * on the layer's logarithmic ramp they are.
 */
const SWATCH: Record<(typeof RAIN_KEY_MM)[number], string> = {
  0.1: "var(--map-rain-drizzle)",
  0.5: "var(--map-rain-light)",
  1: "color-mix(in srgb, var(--map-rain-light), var(--map-rain-moderate))",
  2: "var(--map-rain-moderate)",
  4: "color-mix(in srgb, var(--map-rain-moderate), var(--map-rain-heavy))",
  8: "var(--map-rain-heavy)",
};

/**
 * The Rain layer's key: the rain in an hour, from drizzle to heavy, each in
 * the colour the layer lays over the chart, on the chart's own sea. Dry is
 * nothing at all, so it has no swatch.
 */
export function RainScale() {
  return (
    <figure
      className="rain-scale"
      data-rain-key
      aria-label="Rain scale, millimetres in the hour: faint blue at 0.1, deepening through 0.5, 1, 2 and 4, strong at 8 and over; nothing where it is dry"
    >
      <ol aria-hidden="true">
        {RAIN_KEY_MM.map((mm) => (
          <li key={mm}>
            <span style={{ background: SWATCH[mm] }} />
            <small>
              {mm}
              {mm === 8 ? "+" : ""}
            </small>
          </li>
        ))}
      </ol>
      <i aria-hidden="true">mm/h</i>
    </figure>
  );
}
