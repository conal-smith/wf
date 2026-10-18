/**
 * A color-relief layer's ramp lives in two small WebGL textures (the ramp's
 * heights and its colours), which MapLibre (6.9) builds the first time the
 * layer draws after the ramp has changed. It keeps the newest pair and drops
 * the old one without deleting it, so every change of ramp leaks two
 * textures. The foilable depth changes its ramp at every forecast hour for
 * every area in view: five minutes of stepping the hours and panning left
 * 2,900 textures behind (scripts/perf, the soak).
 *
 * This deletes the old pair as the new one replaces it. It reaches into the
 * layer's own method, so it checks for it and does nothing if MapLibre has
 * changed shape; drop it once MapLibre frees the old ramp itself.
 */

interface Destroyable {
  destroy(): void;
}

interface RampTextures {
  elevationTexture?: Destroyable;
  colorTexture?: Destroyable;
}

interface RampLayer {
  colorRampTextures?: RampTextures;
  getColorRampTextures?: (...args: unknown[]) => RampTextures;
}

/**
 * Make `layer` (map.getLayer of a color-relief layer) delete each ramp it
 * replaces. True if it now does; false if it has no ramp to manage, or
 * already does.
 */
export function releaseReplacedColorRamps(layer: unknown): boolean {
  const l = layer as RampLayer | null | undefined;
  const build = l?.getColorRampTextures;
  if (!l || typeof build !== "function") return false;
  if (Object.prototype.hasOwnProperty.call(l, "getColorRampTextures"))
    return false;
  l.getColorRampTextures = function (this: RampLayer, ...args: unknown[]) {
    const old = this.colorRampTextures;
    const next = build.apply(this, args);
    if (old && next !== old) {
      old.elevationTexture?.destroy();
      old.colorTexture?.destroy();
    }
    return next;
  };
  return true;
}
