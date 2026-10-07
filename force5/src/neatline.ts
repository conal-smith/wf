/**
 * The chart's border: a neatline of alternating ink and paper bars, one per
 * graticule step, with the latitudes up the side and the longitudes along the
 * top, as an Admiralty chart frames its sheet. Redrawn as the map moves.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300].map((m) => m / 60);

const two = (n: number) => String(n).padStart(2, "0");
function degrees(value: number, hemisphere: string) {
  const a = Math.abs(value);
  const d = Math.floor(a + 1e-9);
  const m = Math.round((a - d) * 60);
  return m === 60
    ? `${d + 1}°${hemisphere}`
    : m
      ? `${d}°${two(m)}′${hemisphere}`
      : `${d}°${hemisphere}`;
}

export function drawNeatline(
  svg: SVGSVGElement,
  map: MapLibreMap,
  options: {
    bottom: number;
    phone: boolean;
    /** Pixels above the frame's foot to keep the left-hand latitudes out of. */
    clearBottom?: number;
  },
) {
  const box = map.getContainer().getBoundingClientRect();
  const w = box.width;
  const bottom = Math.max(0, Math.min(box.height, options.bottom));
  const b = options.phone ? 5 : 7;
  if (!w || !bottom) {
    svg.innerHTML = "";
    return;
  }
  const tl = map.unproject([0, 0]);
  const br = map.unproject([w, bottom]);
  const pxLon = w / (br.lng - tl.lng);
  const pxLat = bottom / (tl.lat - br.lat);
  const sLon = STEPS.find((s) => s * pxLon >= 44) ?? 5;
  const sLat = STEPS.find((s) => s * pxLat >= 44) ?? 5;
  const parts: string[] = [];
  const bar = (i: number) => (((i % 2) + 2) % 2 ? "nl-b" : "nl-a");
  // Labels keep clear of the boxes in the corners.
  const clearX = options.phone ? 60 : 400;
  for (
    let i = Math.floor(tl.lng / sLon), v = i * sLon;
    v < br.lng;
    i++, v = i * sLon
  ) {
    const x1 = Math.max(0, map.project([v, tl.lat]).x);
    const x2 = Math.min(w, map.project([v + sLon, tl.lat]).x);
    parts.push(
      `<rect class="${bar(i)}" x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${b}"/>`,
    );
    if (!options.phone)
      parts.push(
        `<rect class="${bar(i)}" x="${x1.toFixed(1)}" y="${(bottom - b).toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${b}"/>`,
      );
    const lx = map.project([v, tl.lat]).x;
    if (
      !options.phone &&
      lx > clearX &&
      lx < w - clearX &&
      (i % 2 === 0 || sLon * pxLon > 90)
    )
      parts.push(
        `<text class="nl-t" x="${lx.toFixed(1)}" y="${b + 11}" text-anchor="middle">${degrees(v, "W")}</text>`,
      );
  }
  for (
    let i = Math.floor(br.lat / sLat), v = i * sLat;
    v < tl.lat;
    i++, v = i * sLat
  ) {
    const y1 = Math.min(bottom, map.project([tl.lng, v]).y);
    const y2 = Math.max(0, map.project([tl.lng, v + sLat]).y);
    parts.push(
      `<rect class="${bar(i)}" x="0" y="${y2.toFixed(1)}" width="${b}" height="${(y1 - y2).toFixed(1)}"/>`,
      `<rect class="${bar(i)}" x="${w - b}" y="${y2.toFixed(1)}" width="${b}" height="${(y1 - y2).toFixed(1)}"/>`,
    );
    const ly = map.project([tl.lng, v]).y;
    // A label runs some 22px either side of its line.
    if (
      ly > 90 &&
      ly < bottom - Math.max(20, (options.clearBottom ?? 0) + 22) &&
      (i % 2 === 0 || sLat * pxLat > 90)
    )
      parts.push(
        `<text class="nl-t" transform="translate(${b + 11} ${ly.toFixed(1)}) rotate(-90)" text-anchor="middle">${degrees(v, "N")}</text>`,
      );
  }
  parts.push(
    `<rect class="nl-frame" x=".5" y=".5" width="${w - 1}" height="${bottom - 1}"/>`,
    `<rect class="nl-frame nl-inner" x="${b + 0.5}" y="${b + 0.5}" width="${w - 2 * b - 1}" height="${bottom - 2 * b - (options.phone ? -b : 1)}"/>`,
  );
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(box.height));
  svg.innerHTML = parts.join("");
}
