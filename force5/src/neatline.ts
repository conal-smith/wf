/**
 * The chart's border: a neatline of alternating ink and paper bars, one per
 * graticule step, with the latitudes up the side and the longitudes along the
 * top, as an Admiralty chart frames its sheet. Drawn again as the map moves,
 * over the elements already there.
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

const SVG = "http://www.w3.org/2000/svg";

/** An element to draw: its tag, its attributes, and a label's words. */
type Shape = { attrs: Record<string, string>; text?: string };

/**
 * `shapes` drawn into `g` over what is there: the elements already drawn are
 * moved, and only what differs is set. Built again from markup on every frame
 * of a move, the frame was parsed, made and laid out anew each time.
 */
function paint(g: Element, tag: string, shapes: readonly Shape[]) {
  const kids = g.children;
  shapes.forEach((shape, i) => {
    let el = kids[i];
    if (!el) el = g.appendChild(document.createElementNS(SVG, tag));
    for (const name of el.getAttributeNames())
      if (!(name in shape.attrs)) el.removeAttribute(name);
    for (const [name, value] of Object.entries(shape.attrs))
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    if (shape.text !== undefined && el.textContent !== shape.text)
      el.textContent = shape.text;
  });
  while (kids.length > shapes.length) g.lastElementChild!.remove();
}

/** The neatline's three sheets, bars under labels under the frame, made once. */
function sheets(svg: SVGSVGElement) {
  if (svg.children.length !== 3) {
    svg.replaceChildren();
    for (let i = 0; i < 3; i++)
      svg.appendChild(document.createElementNS(SVG, "g"));
  }
  return [...svg.children] as [Element, Element, Element];
}

export function drawNeatline(
  svg: SVGSVGElement,
  map: MapLibreMap,
  options: {
    /** The map's size, read when it changes, not on every frame of a move. */
    width: number;
    height: number;
    bottom: number;
    phone: boolean;
    /** Pixels above the frame's foot to keep the left-hand latitudes out of. */
    clearBottom?: number;
  },
) {
  const w = options.width;
  const bottom = Math.max(0, Math.min(options.height, options.bottom));
  const b = options.phone ? 5 : 7;
  if (!w || !bottom) {
    svg.replaceChildren();
    return;
  }
  const tl = map.unproject([0, 0]);
  const br = map.unproject([w, bottom]);
  const pxLon = w / (br.lng - tl.lng);
  const pxLat = bottom / (tl.lat - br.lat);
  const sLon = STEPS.find((s) => s * pxLon >= 44) ?? 5;
  const sLat = STEPS.find((s) => s * pxLat >= 44) ?? 5;
  const bars: Shape[] = [];
  const labels: Shape[] = [];
  const bar = (i: number) => (((i % 2) + 2) % 2 ? "nl-b" : "nl-a");
  const rect = (
    cls: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) =>
    bars.push({
      attrs: {
        class: cls,
        x: x.toFixed(1),
        y: y.toFixed(1),
        width: width.toFixed(1),
        height: height.toFixed(1),
      },
    });
  // Labels keep clear of the boxes in the corners.
  const clearX = options.phone ? 60 : 400;
  for (
    let i = Math.floor(tl.lng / sLon), v = i * sLon;
    v < br.lng;
    i++, v = i * sLon
  ) {
    const lx = map.project([v, tl.lat]).x;
    const x1 = Math.max(0, lx);
    const x2 = Math.min(w, map.project([v + sLon, tl.lat]).x);
    rect(bar(i), x1, 0, x2 - x1, b);
    if (!options.phone) rect(bar(i), x1, bottom - b, x2 - x1, b);
    if (
      !options.phone &&
      lx > clearX &&
      lx < w - clearX &&
      (i % 2 === 0 || sLon * pxLon > 90)
    )
      labels.push({
        attrs: {
          class: "nl-t",
          x: lx.toFixed(1),
          y: String(b + 11),
          "text-anchor": "middle",
        },
        text: degrees(v, "W"),
      });
  }
  for (
    let i = Math.floor(br.lat / sLat), v = i * sLat;
    v < tl.lat;
    i++, v = i * sLat
  ) {
    const ly = map.project([tl.lng, v]).y;
    const y1 = Math.min(bottom, ly);
    const y2 = Math.max(0, map.project([tl.lng, v + sLat]).y);
    rect(bar(i), 0, y2, b, y1 - y2);
    rect(bar(i), w - b, y2, b, y1 - y2);
    // A label runs some 22px either side of its line.
    if (
      ly > 90 &&
      ly < bottom - Math.max(20, (options.clearBottom ?? 0) + 22) &&
      (i % 2 === 0 || sLat * pxLat > 90)
    )
      labels.push({
        attrs: {
          class: "nl-t",
          transform: `translate(${b + 11} ${ly.toFixed(1)}) rotate(-90)`,
          "text-anchor": "middle",
        },
        text: degrees(v, "N"),
      });
  }
  const frame = (
    cls: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => ({
    attrs: {
      class: cls,
      x: String(x),
      y: String(y),
      width: String(width),
      height: String(height),
    },
  });
  const [barSheet, labelSheet, frameSheet] = sheets(svg);
  paint(barSheet, "rect", bars);
  paint(labelSheet, "text", labels);
  paint(frameSheet, "rect", [
    frame("nl-frame", 0.5, 0.5, w - 1, bottom - 1),
    frame(
      "nl-frame nl-inner",
      b + 0.5,
      b + 0.5,
      w - 2 * b - 1,
      bottom - 2 * b - (options.phone ? -b : 1),
    ),
  ]);
  if (svg.getAttribute("width") !== String(w))
    svg.setAttribute("width", String(w));
  const h = String(options.height);
  if (svg.getAttribute("height") !== h) svg.setAttribute("height", h);
}
