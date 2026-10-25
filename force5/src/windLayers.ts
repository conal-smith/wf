/**
 * The wind's two layers, the coloured wind and the particles, and the
 * rider's choice of them as a store keeps it. Apart from the layer that draws
 * them (windLayer.ts), so the app reads the same choice the same way without
 * the browser's map (mobile/src/features/map/windLogic.ts).
 */

/** The wind's two layers, each on or off. */
export interface WindLayers {
  /** The coloured wind: the speed as a wash over the sea. */
  wash: boolean;
  /** The particles: lines in ink moving with the wind. */
  particles: boolean;
}

/** A first visit's wind: the particles alone, as the chart has always opened. */
export const DEFAULT_WIND: WindLayers = { wash: false, particles: true };

/**
 * The wind as an older chart kept it, one style of three, in its two layers
 * now. Ink was the particles alone. The coloured wind drew the ink lines over
 * its colour, and is the colour alone now, the particles a layer of their own
 * to add. The coloured arrows were the particles tinted by speed: a rider who
 * chose them wanted the speed in colour and the way in lines, which is both.
 */
const FROM_STYLE: Record<string, WindLayers> = {
  ink: { wash: false, particles: true },
  wash: { wash: true, particles: false },
  arrows: { wash: true, particles: true },
};

/**
 * The rider's wind from the store: the two layers as saved, or else an older
 * chart's style (`older`) read into them, or else the default.
 */
export function parseWindLayers(
  saved: string | null,
  older: string | null = null,
): WindLayers {
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (
        typeof value?.wash === "boolean" &&
        typeof value?.particles === "boolean"
      )
        return { wash: value.wash, particles: value.particles };
    } catch {
      // Not ours: what an older store holds is read below.
    }
  }
  return {
    ...(older && Object.hasOwn(FROM_STYLE, older)
      ? FROM_STYLE[older]
      : DEFAULT_WIND),
  };
}
