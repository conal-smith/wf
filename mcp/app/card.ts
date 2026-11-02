/**
 * The spot card an AI app draws beside get_spot_forecast's answer (an MCP
 * App: modelcontextprotocol.io/extensions/apps). What the server hands the
 * card, and how it is made from the forecast: the place, its picture from
 * above, and its hours with their wind and stars. The card itself is
 * mcp/app/spotCard.ts; the server serves it as SPOT_CARD_URI
 * (mcp/api/server.ts).
 *
 * Plain data and plain functions: the server (Node and the Pages worker) and
 * the card (a browser, in the app's frame) both read this file.
 */

/** Where the card is served, as an MCP App resource. */
export const SPOT_CARD_URI = "ui://wingfoil/spot-card.html";

/** One hour on the card. */
export interface CardHour {
  /** ISO 8601, UTC. */
  time: string;
  /** Irish local time, as the answer gives it ("2026-11-07 14:00"). */
  local: string;
  /** Day, twilight or dark: the card dims the dark. */
  light: "day" | "twilight" | "dark";
  wind_kn: number | null;
  gust_kn: number | null;
  /** Where the wind comes from, degrees, and in words ("SW"). */
  from_deg: number | null;
  from: string | null;
  /** Whole stars, 0 to 5; null where the hour is not rated. */
  stars: number | null;
}

/** The place's picture from above, north up, and where on it the place is. */
export interface CardPicture {
  url: string;
  /** The place, as a share of the picture's width and height from its top left. */
  x: number;
  y: number;
  /** Width over height. */
  aspect: number;
  credit: string;
}

export interface SpotCardData {
  kind: "wingfoil-spot-card";
  spot: { id: string; name: string; county: string };
  /** The spot's own page on wingfoil.ie. */
  page: string;
  picture: CardPicture | null;
  hours: CardHour[];
  /** The hour the card opens on: the first of the best window, else the first light. */
  focus: string | null;
}

/** As much of get_spot_forecast's answer as the card is made from. */
export interface CardSource {
  spot: { id: string; name: string; county: string; lat: number; lon: number };
  hours: {
    time: string;
    local: string;
    daylight: boolean;
    light?: "day" | "twilight" | "dark";
    wind: {
      wind_kn: number;
      gust_kn: number | null;
      direction_deg: number;
      direction: string;
    } | null;
    rating?: { stars: number } | null;
  }[];
  best_windows?: { window: { from: string } | null }[];
}

/** The list of spot pictures, as the site publishes it (public/satellite/spots.json). */
export interface SpotPictureList {
  base: string;
  zoom: number;
  width: number;
  height: number;
  attribution: string;
  spots: { id: string; lonLat: [number, number]; high: string }[];
}

/** The list as the site serves it, or null for anything else. */
export function parsePictureList(json: unknown): SpotPictureList | null {
  const m = json as SpotPictureList & { kind?: string; schemaVersion?: number };
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (
    !m ||
    m.schemaVersion !== 1 ||
    m.kind !== "satellite-spots" ||
    typeof m.base !== "string" ||
    !/^satellite\/v[0-9a-f]+\/$/.test(m.base) ||
    !finite(m.zoom) ||
    !finite(m.width) ||
    !finite(m.height) ||
    !Array.isArray(m.spots)
  )
    return null;
  return m;
}

/** A point's place on the web map's world at a zoom, in pixels (as spot/web/satellite.ts). */
function worldPixel(lon: number, lat: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  };
}

/**
 * The place's high-tide picture, where one is published and the place is
 * well inside it; else null. `dataBase` is where the data host serves the
 * published files from (the picture is there, not on the site).
 */
export function cardPicture(
  list: SpotPictureList | null,
  spot: CardSource["spot"],
  dataBase: string | undefined,
): CardPicture | null {
  if (!list || !dataBase) return null;
  const entry = list.spots.find((s) => s.id === spot.id);
  if (!entry || !/^[a-z0-9-]+\.webp$/.test(entry.high)) return null;
  const centre = worldPixel(entry.lonLat[0], entry.lonLat[1], list.zoom);
  const here = worldPixel(spot.lon, spot.lat, list.zoom);
  const x = 0.5 + (here.x - centre.x) / list.width;
  const y = 0.5 + (here.y - centre.y) / list.height;
  if (x < 0.15 || x > 0.85 || y < 0.15 || y > 0.85) return null;
  return {
    url: new URL(`${list.base}${entry.high}`, dataBase).href,
    x,
    y,
    aspect: list.width / list.height,
    // The imagery's own clause, as the spot page credits it.
    credit: list.attribution.split(";")[0].trim(),
  };
}

/** The card's data, from a spot's forecast. */
export function spotCardData(
  forecast: CardSource,
  options: {
    site: string;
    pictures?: SpotPictureList | null;
    dataBase?: string;
  },
): SpotCardData {
  const hours: CardHour[] = forecast.hours.map((h) => ({
    time: h.time,
    local: h.local,
    light: h.light ?? (h.daylight ? "day" : "dark"),
    wind_kn: h.wind ? Math.round(h.wind.wind_kn) : null,
    gust_kn:
      h.wind?.gust_kn == null ? null : Math.round(h.wind.gust_kn),
    from_deg: h.wind ? h.wind.direction_deg : null,
    from: h.wind ? h.wind.direction : null,
    stars: h.rating ? h.rating.stars : null,
  }));
  const best = forecast.best_windows?.find((d) => d.window)?.window?.from;
  const focus =
    (best && hours.find((h) => h.time >= best)?.time) ??
    hours.find((h) => h.light === "day" && h.wind_kn !== null)?.time ??
    hours[0]?.time ??
    null;
  return {
    kind: "wingfoil-spot-card",
    spot: {
      id: forecast.spot.id,
      name: forecast.spot.name,
      county: forecast.spot.county,
    },
    page: new URL(`/spot/${encodeURIComponent(forecast.spot.id)}`, options.site)
      .href,
    picture: cardPicture(
      options.pictures ?? null,
      forecast.spot,
      options.dataBase,
    ),
    hours,
    focus,
  };
}

/** The card's data, if that is what a tool result's structured content is. */
export function isSpotCardData(value: unknown): value is SpotCardData {
  const v = value as SpotCardData;
  return (
    !!v &&
    v.kind === "wingfoil-spot-card" &&
    typeof v.spot?.name === "string" &&
    Array.isArray(v.hours)
  );
}
