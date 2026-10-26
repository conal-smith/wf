/**
 * The chart beside the spot finder's list, on a wide screen (src/App.tsx):
 * where it stands, what it fits, and when a card under the pointer moves it.
 * Pure, so the rules are tested without a map (chartPanel.test.ts).
 */

/** The room the chart is given beside the list: 40% of the page, 440 to 720 px. */
export const panelWidth = (pageWidth: number) =>
  Math.round(Math.max(440, Math.min(720, pageWidth * 0.4)));

/** The gap round the chart beside the list, as the cards' own gutter. */
export const PANEL_GAP = 12;

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the chart stands beside the list: the right of the page, under the
 * finder's head, a gap clear of each edge.
 */
export function panelRect(
  pageWidth: number,
  pageHeight: number,
  headBottom: number,
): Rect {
  const width = panelWidth(pageWidth);
  const top = headBottom + PANEL_GAP;
  return {
    top,
    left: pageWidth - width - PANEL_GAP,
    width,
    height: Math.max(0, pageHeight - top - PANEL_GAP),
  };
}

/** The box round some places, west-south and east-north, or null for none. */
export function spotsBounds(
  spots: readonly { lon: number; lat: number }[],
): [[number, number], [number, number]] | null {
  if (!spots.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lon, lat } of spots) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Room kept clear round the places when the chart is fitted to them: the
 * Full chart button at the top left and the zoom at the top right, and the
 * hour's label at the foot.
 */
export const fitPadding = { top: 64, bottom: 48, left: 44, right: 64 };

/**
 * Whether a point on the chart (its pixel `x`, `y`) is comfortably inside
 * it: more than 18% of the chart's width or height from each edge, and at
 * least 70 px. A card for a place that is, only lights it; one that is not
 * pans the chart to put it in the middle.
 */
export function inView(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const mx = Math.max(70, width * 0.18);
  const my = Math.max(70, height * 0.18);
  return x > mx && x < width - mx && y > my && y < height - my;
}

/** A clip of the whole page down to `rect`, with its corner, for an animation. */
export function clipTo(
  rect: Rect,
  pageWidth: number,
  pageHeight: number,
  radius: number,
): string {
  const right = pageWidth - rect.left - rect.width;
  const bottom = pageHeight - rect.top - rect.height;
  return `inset(${rect.top}px ${right}px ${bottom}px ${rect.left}px round ${radius}px)`;
}
