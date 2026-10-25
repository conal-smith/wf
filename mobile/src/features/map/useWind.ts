/**
 * The wind's pictures for the camera at rest (force5/src/windLayer.ts, for
 * the app): the tiles the view needs asked for, and once they are in, the
 * screen's field for the particles (or Reduce Motion's still arrows) and
 * the coloured wind's image, whichever layers are on. Worked out on the JS thread when the camera
 * settles, the hour changes or a tile lands; never per frame.
 */
import { File, Paths } from "expo-file-system";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import { setMapView } from "../../../../force5/src/tiledField";
import type { Frame } from "../../../../force5/src/weather";
import { mapViewOf, type Camera } from "./mapLogic";
import type { FieldMessage } from "./particleSim";
import { encodePng } from "./png";
import {
  arrowGrid,
  DEPTHS_ZOOM,
  screenField,
  washBox,
  washImage,
  waterMask,
  type ArrowProps,
} from "./windLogic";

/** Lines per thousand square points (windLayer.ts). */
const DENSITY = 0.4;

const cameraKey = (c: Camera) => `${c.center[0].toFixed(5)},${c.center[1].toFixed(5)},${c.zoom.toFixed(3)},${c.width}x${c.height}`;

/**
 * The tiles the view needs, for the frame on screen; bumps when they land so
 * the pictures are drawn again from them, then the next hour's follow.
 */
export function useFrameTiles(frame: Frame | null, camera: Camera | null, onFailed?: (frame: Frame) => void): number {
  const [version, setVersion] = useState(0);
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  });
  useEffect(() => {
    if (!camera) return;
    const view = mapViewOf(camera);
    setMapView(view);
    if (!frame) return;
    let live = true;
    const loading = frame.field.request(view);
    if (!loading) {
      frame.field.prefetchNext(view);
      return;
    }
    loading.then(
      () => {
        if (!live) return;
        setVersion((v) => v + 1);
        frame.field.prefetchNext(view);
      },
      () => {
        if (live) failed.current?.(frame);
      },
    );
    return () => {
      live = false;
    };
  }, [frame, camera]);
  return version;
}

let fieldIds = 0;

/** The screen's field for the particles, or null when none are drawn: nothing is worked out for them while they are off. */
export function useParticleField(
  frame: Frame | null,
  camera: Camera | null,
  version: number,
  wanted: boolean,
): FieldMessage | null {
  return useMemo(() => {
    if (!wanted || !frame || !camera || !camera.width) return null;
    const field = screenField(camera, (lat, lon) => frame.field.sample(lat, lon));
    return {
      id: ++fieldIds,
      camera: cameraKey(camera),
      width: camera.width,
      height: camera.height,
      w: field.w,
      h: field.h,
      step: field.step,
      data: field.data,
      density: DENSITY,
    };
    // `version` says the field's tiles have changed under the same frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, frame, camera, version]);
}

/** The still arrows in ink over the view (Reduce Motion's particles), or null when they are not drawn. */
export function useArrows(
  frame: Frame | null,
  camera: Camera | null,
  version: number,
  on: boolean,
): FeatureCollection<Point, ArrowProps> | null {
  return useMemo(() => {
    if (!on || !frame || !camera || !camera.width) return null;
    return arrowGrid(camera, (lat, lon) => frame.field.sample(lat, lon));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, frame, camera, version]);
}

export interface Wash {
  uri: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

let washes = 0;

/**
 * The wash's image for the view, written to the cache as a PNG for the map's
 * image source, a moment after the camera settles. `water` reads the
 * basemap's sea in view, to keep the wash strong there and faint on land.
 */
export function useWash(
  frame: Frame | null,
  camera: Camera | null,
  version: number,
  on: boolean,
  water: () => Promise<readonly { type: string; coordinates?: unknown }[]>,
): Wash | null {
  const [wash, setWash] = useState<Wash | null>(null);
  const written = useRef<File | null>(null);
  const read = useRef(water);
  useEffect(() => {
    read.current = water;
  });
  useEffect(() => {
    if (!on || !frame || !camera || !camera.width || camera.zoom >= DEPTHS_ZOOM) return;
    let live = true;
    const timer = setTimeout(async () => {
      const box = washBox(camera);
      const geometries = await read.current().catch(() => []);
      if (!live) return;
      const sea = waterMask(geometries, box.width, box.height, box.toPixel);
      const image = washImage(camera, (lat, lon) => frame.field.sample(lat, lon), frame.grid, sea);
      try {
        const file = new File(Paths.cache, `wingfoil-wash-${++washes}.png`);
        file.write(encodePng(image.width, image.height, image.rgba));
        if (!live) return file.delete();
        const old = written.current;
        written.current = file;
        setWash({ uri: file.uri, coordinates: image.coordinates });
        // The last image is let go once the map has had time to read the next.
        if (old) setTimeout(() => old.exists && old.delete(), 3000);
      } catch {
        // No wash this time: the chart is still read without it.
      }
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [on, frame, camera, version]);
  useEffect(
    () => () => {
      const old = written.current;
      if (old?.exists) old.delete();
    },
    [],
  );
  return on ? wash : null;
}
