/**
 * The forecast tools an agent can call, once, for both of the places it can
 * call them from: the MCP server at /api/mcp (server.ts) and the site's own
 * pages through WebMCP (mcp/web/webmcp.ts). Each tool is its name, its words,
 * its arguments as a zod shape and what it does with them; how an answer or a
 * failure is wrapped is left to the transport.
 *
 * Never imports Node, so the browser can load it.
 */
import { z } from "zod";
import {
  GUSTY_SPREAD_KN,
  MAX_WINDOW_HOURS,
  METHOD,
  axis,
  countyKey,
  distanceKm,
  findPlace,
  findSessions,
  findSpot,
  forecastReach,
  loadSpots,
  localStamp,
  modelStatus,
  spotForecast,
  windowFor,
  type Place,
  type Reach,
  type RidingSpot,
  type Window,
} from "./forecast.js";
import type { ForecastSource } from "./httpSource.js";
import {
  DEFAULT_STARS_FROM,
  STARS_MODELS,
  leadFor,
  type StarsFrom,
} from "../../force5/src/lead.js";

export interface ToolDeps {
  source: ForecastSource;
  /** The clock "now" is read from. Tests pin it to the fixtures' runs. */
  now?: () => number;
}

/** An answer to pass on, or a message saying why there is none. */
export type ToolOutcome =
  { ok: true; value: unknown } | { ok: false; message: string };

export interface ForecastTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  run(args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps): Promise<ToolOutcome>;
}

/**
 * What an agent must not leave out when it passes a forecast on. Part of the
 * server's instructions; a WebMCP client has no instructions, so the page adds
 * it to the forecast tools' descriptions instead.
 */
export const CARE =
  "Never tell anyone conditions are safe. Wing foiling depends on the launch, offshore winds, tides, water users and ability, which a forecast cannot know. When wind blows offshore at a spot, point it out.";

export const INSTRUCTIONS = `wingfoil.ie forecasts wind, waves and tides for wing foiling spots in Ireland (Republic and Northern Ireland).

- Start with list_spots or find_wind to learn spot ids; get_spot_forecast accepts an id, a name or part of one.
- Before recommending spots, ask where the person is based (or use their location if you have it) and pass find_wind near ({ lat, lon } for a town, or a county or spot) with max_km, or the counties they'd travel to. Searching all of Ireland suits only someone willing to travel anywhere.
- Speeds are knots, directions are degrees the wind comes FROM, times are UTC with a \`local\` label in Irish time that ends in its zone, IST (UTC+1) or GMT (UTC+0). Quote the local time to people, and its zone around a clock change: the night the clocks go back has two 01:00s.
- The forecast is one model's own, the one wingfoil.ie rates its stars from, never a blend of several: HARMONIE's (Met Éireann's 2.5 km model, the most accurate here) while it reaches the hour, about the next 60 hours, and ECMWF's past it, unless a caller passes \`model\` to choose another (ECMWF still takes over past the end of its run). \`lead\` says which model an hour is. \`agreement\` says how closely all the models agree, as context; \`confidence\` is the same but low wherever fewer than three models cover the hour (\`models\`), as happens a few days out. Hedge when confidence is low, say why (few models, or models disagreeing), and use by_model to explain a disagreement.
- ${METHOD}
- \`shore\` says how the wind meets the spot's beach: onshore, cross-on, cross, cross-off or offshore (the same rule wingfoil.ie's stars use). Offshore and cross-off wind carry a rider who falls away from the beach out to sea: always warn about them. find_wind leaves dead offshore hours out unless allow_offshore is set. A null shore means the beach's facing is unknown, so say offshore wind can't be ruled out there.
- Point out sessions find_wind marks \`gusty\`. When someone has a gust limit, pass max_gust_kn (or max_gust_factor) so hours past it are left out.
- Light: a session ends by last light (civil dusk, in \`sun\`), not at sunset and never after dark; quote last light as the time to be off the water. find_wind's sessions already stop there.
- Thunder: wherever an hour's \`thunder_risk\` is high or possible, tell the person to stay off the water then and in the hours either side (lightning strikes ahead of a storm), whatever the wind. Low is not a promise of no storm.
- ${CARE}
- Credit the model providers named in \`sources\` when you share a forecast, and link people to https://wingfoil.ie for the map.`;

/** How far from `near` find_wind looks unless told: about an hour and a half's drive. */
export const DEFAULT_MAX_KM = 100;

const answer = (value: unknown): ToolOutcome => ({ ok: true, value });
const failure = (message: string): ToolOutcome => ({ ok: false, message });

const describeSpot = (s: RidingSpot) => `${s.name} (${s.county}, id ${s.id})`;

const tool = <Shape extends z.ZodRawShape>(t: ForecastTool<Shape>) => t;

const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * Whether `from` is an ISO 8601 date or time, and a real one. Date.parse alone
 * would take "next friday" as no time at all, and the window would quietly
 * start now: an agent could pass today's forecast on as Friday's.
 */
function isIsoTime(value: string): boolean {
  const parts = ISO_TIME.exec(value.trim());
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [y, m, d] = parts.slice(1, 4).map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

/** The start of a window, as both tools take it. */
const fromArg = (words: string) =>
  z
    .string()
    .max(40)
    .refine(isIsoTime, {
      message:
        'from must be an ISO 8601 time such as 2026-10-23T00:00:00Z. Work out a day like "tomorrow" or "next friday" from today\'s date first.',
    })
    .optional()
    .describe(words);

/** How far find_wind's max_km may reach: well past any two points in Ireland. */
const MAX_KM = 600;
const HOUR = 3600000;

const timeOf = (millis: number) =>
  `${localStamp(millis)} (${new Date(millis).toISOString()})`;

/**
 * What an answer must say about its window, since both tools quietly move or
 * cut it short and the rows alone don't show it: a `from` in the past starts
 * at the current hour instead, and hours past the end of the forecast have no
 * wind. A window wholly past that end is an error, not rows of nulls or an
 * empty list that reads as "no wind that week".
 */
function aboutWindow(
  window: Window,
  from: string | undefined,
  reach: Reach,
  words: { before: string; after: string },
): { error: string } | { note: string | undefined } {
  const ends = `${timeOf(reach.time)}, the last hour ${reach.model} covers`;
  if (reach.time < window.from)
    return {
      error: `The forecast does not reach ${localStamp(window.from)} yet: it ends ${ends}. ${words.before}, or ask again nearer the time.`,
    };
  const notes: string[] = [];
  // windowFor starts no earlier than the current hour.
  if (from && Math.ceil(Date.parse(from) / HOUR) * HOUR < window.from)
    notes.push(
      `from was in the past, so the window starts at the current hour, ${timeOf(window.from)}; earlier hours aren't available.`,
    );
  if (reach.time < axis(window).at(-1)!)
    notes.push(
      `Only part of the window is forecast: it ends ${ends}. ${words.after}`,
    );
  return { note: notes.join(" ") || undefined };
}

export const listSpots = tool({
  name: "list_spots",
  title: "List riding spots",
  description:
    "The wing foiling spots wingfoil.ie forecasts for, with county and coordinates. Optionally only one county.",
  inputSchema: {
    county: z
      .string()
      .max(40)
      .optional()
      .describe("A county name, e.g. Kerry, Dublin, Down."),
  },
  async run({ county }, deps) {
    const spots = await loadSpots(deps.source);
    const wanted = county ? countyKey(county) : "";
    const list = wanted
      ? spots.filter((s) => countyKey(s.county) === wanted)
      : spots;
    if (wanted && !list.length)
      return failure(
        `No spots in ${county}. Counties with spots: ${[...new Set(spots.map((s) => s.county))].sort().join(", ")}.`,
      );
    return answer({ spots: list });
  },
});

/** The argument that chooses the model a forecast's headline is (force5/src/lead.ts). */
const MODEL_ARGS = {
  model: z
    .enum(STARS_MODELS as [string, ...string[]])
    .optional()
    .describe(
      "The one model the wind, gust and direction come from, as a wingfoil.ie rider picks it (default harmonie). Past the end of its run ECMWF's take over, as on the site.",
    ),
};

const modelArg = (model: string | undefined): StarsFrom =>
  model ? leadFor(model) : DEFAULT_STARS_FROM;

export const getSpotForecast = tool({
  name: "get_spot_forecast",
  title: "Spot forecast",
  description:
    "Hour-by-hour forecast for one spot: wind speed, gusts and direction from one weather model, the one wingfoil.ie rates its stars from (HARMONIE while it reaches the hour, then ECMWF, unless `model` names another, which ECMWF then follows), with the range across every model and how well they agree as context, how the wind meets the shore (onshore to offshore), plus waves, air temperature and how cold it feels in the mean wind (`feels_like_c`, a wind chill), rain, a thunder and lightning risk (`thunder_risk`), the sky in words (`description` and `sky`, as wingfoil.ie's sky glyph has it; `weather_code` is WMO 4677), how light each hour is (`light`: day, twilight or dark), each day's first light, sunrise, sunset and last light, high and low tides and the latest sea temperature. Rain is the weather model's own total over an interval (`rain_interval_hours`: an hour for ICON-EU, so each hourly row has its own hour's rain; three hours for GFS far ahead), given once on the row where its interval ends and null on any hours before it inside the interval, so add rain_mm up over the rows for a period's rain.",
  inputSchema: {
    spot: z
      .string()
      .min(1)
      .max(80)
      .describe(
        "Spot id, name or part of a name, e.g. 'dollymount' or 'Brandon Bay'.",
      ),
    from: fromArg(
      "ISO 8601 start time, e.g. 2026-10-23T09:00:00Z. Defaults to now; earlier times are not available.",
    ),
    hours: z
      .number()
      .int()
      .min(1)
      .max(MAX_WINDOW_HOURS)
      .optional()
      .describe(
        "How many hours to cover from the start (default 48, at most 240). The end is exclusive: 24 at hourly steps is 24 rows.",
      ),
    step_hours: z
      .union([z.literal(1), z.literal(3), z.literal(6)])
      .optional()
      .describe(
        "Hours between rows: 1, 3 or 6. Defaults to 1 up to a day, else 3.",
      ),
    per_model: z
      .boolean()
      .optional()
      .describe(
        "Also give each model's own wind at every hour, to explain disagreement.",
      ),
    ...MODEL_ARGS,
  },
  async run({ spot, from, hours, step_hours, per_model, model }, deps) {
    const spots = await loadSpots(deps.source);
    const match = findSpot(spots, spot);
    if (!match.spot)
      return failure(
        match.candidates.length
          ? `"${spot}" could be any of: ${match.candidates.map(describeSpot).join("; ")}. Ask which, then call again with its id.`
          : `No spot matches "${spot}". Call list_spots to see them all.`,
      );
    const at = (deps.now ?? Date.now)();
    const window = windowFor(at, { from, hours, stepHours: step_hours });
    const models = modelArg(model);
    const forecast = await spotForecast(deps.source, match.spot, window, {
      perModel: per_model,
      now: at,
      from: models,
    });
    // Only the headline's two models give an hour wind, as in find_wind.
    const reach = forecastReach(forecast.sources.wind, models);
    if (!reach)
      return failure(
        `No wind forecast is published for ${match.spot.name} right now. Try again later or see https://wingfoil.ie.`,
      );
    const about = aboutWindow(window, from, reach, {
      before: "Ask for a time before then",
      after: "Later hours have no wind yet.",
    });
    if ("error" in about) return failure(about.error);
    // The note beside the window it is about.
    const { spot: where, window: span, ...rest } = forecast;
    const { note } = about;
    return answer({
      spot: where,
      window: span,
      ...(note && { note }),
      ...rest,
    });
  },
});

export const findWind = tool({
  name: "find_wind",
  title: "Find wind",
  description:
    "Rank spots by how many hours the wind will be in a range, grouped into sessions, on the one model wingfoil.ie rates its stars from (HARMONIE, then ECMWF, unless `model` names another, which ECMWF then follows), leaving out hours blowing dead offshore. Each session says how the wind meets the shore. Use this for 'where should I go this weekend?'.",
  inputSchema: {
    min_kn: z
      .number()
      .min(0)
      .max(60)
      .optional()
      .describe("Lowest usable wind in knots (default 14)."),
    max_kn: z
      .number()
      .min(0)
      .max(80)
      .optional()
      .describe("Highest wind wanted in knots (default 30)."),
    max_gust_kn: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        "Leave out hours gusting over this many knots (default no limit).",
      ),
    max_gust_factor: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "Leave out hours whose gust is more than this many times the mean wind, e.g. 1.5.",
      ),
    from: fromArg(
      "ISO 8601 start of the search, e.g. 2026-10-23T00:00:00Z. Defaults to now; earlier times are not available.",
    ),
    hours: z
      .number()
      .int()
      .min(1)
      .max(MAX_WINDOW_HOURS)
      .optional()
      .describe("How far ahead to search (default 72 hours)."),
    county: z
      .string()
      .max(40)
      .optional()
      .describe('Only spots in this county, e.g. "Kerry" or "Co. Kerry".'),
    counties: z
      .array(z.string().max(40))
      .max(32)
      .optional()
      .describe("Only spots in these counties, e.g. ['Dublin', 'Wicklow']."),
    near: z
      .union([
        z.string().min(1).max(80),
        z.object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        }),
      ])
      .optional()
      .describe(
        'Where the person is: { lat, lon }, "lat, lon", a county or a spot name. Only spots within max_km are searched, and each gets its distance_km.',
      ),
    max_km: z
      .number()
      .min(1)
      .max(MAX_KM)
      .optional()
      .describe(
        `How far from near to look, as the crow flies (default ${DEFAULT_MAX_KM} km). Only with near.`,
      ),
    allow_offshore: z
      .boolean()
      .optional()
      .describe(
        "Also count hours with the wind blowing dead offshore (default false: they are left out).",
      ),
    daylight_only: z
      .boolean()
      .optional()
      .describe(
        "Only count hours that start between sunrise and sunset, the hours wingfoil.ie rates, and end every session by last light (default true). False also counts hours in the twilight and the dark, and lets a session run past last light; each says its dark_hours.",
      ),
    min_session_hours: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe("Shortest run of good hours worth reporting (default 2)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("How many spots to return (default 8)."),
    ...MODEL_ARGS,
  },
  async run(args, deps) {
    const minKnots = args.min_kn ?? 14;
    const maxKnots = args.max_kn ?? 30;
    if (maxKnots < minKnots) return failure("max_kn must be at least min_kn.");
    if (args.max_gust_kn !== undefined && args.max_gust_kn < minKnots)
      return failure("max_gust_kn must be at least min_kn.");
    // Without near there is nothing to measure from, and all of Ireland
    // would come back looking as if it were within max_km.
    if (args.max_km !== undefined && args.near === undefined)
      return failure(
        "max_km needs near, the place to measure from. Pass where the person is as near, or leave max_km out.",
      );
    const at = (deps.now ?? Date.now)();
    const spots = await loadSpots(deps.source);
    // Each county by its own name, however it was asked for ("co. wicklow").
    const names = new Map(
      spots.filter((s) => s.county).map((s) => [countyKey(s.county), s.county]),
    );
    const asked = [
      ...(args.county ? [args.county] : []),
      ...(args.counties ?? []),
    ];
    const unknown = asked.filter((c) => !names.has(countyKey(c)));
    if (unknown.length)
      return failure(
        `No spots in ${unknown.join(", ")}. Counties with spots: ${[...new Set(names.values())].sort().join(", ")}.`,
      );
    const counties = [...new Set(asked.map((c) => names.get(countyKey(c))!))];
    const near = args.near === undefined ? null : findPlace(spots, args.near);
    if (near && "error" in near) return failure(near.error);
    const maxKm = args.max_km ?? DEFAULT_MAX_KM;
    const window = windowFor(at, {
      from: args.from,
      hours: args.hours ?? 72,
      stepHours: 1,
    });
    const found = await findSessions(deps.source, spots, window, {
      minKnots,
      maxKnots,
      maxGustKnots: args.max_gust_kn,
      maxGustFactor: args.max_gust_factor,
      allowOffshore: args.allow_offshore ?? false,
      daylightOnly: args.daylight_only ?? true,
      minSessionHours: args.min_session_hours ?? 2,
      counties,
      near: near?.place,
      maxKm,
      limit: args.limit ?? 8,
      now: at,
      from: modelArg(args.model),
    });
    if (near && !found.searched)
      return failure(
        outsideIreland(spots, near.place, maxKm) ??
          (counties.length
            ? tooFar(spots, counties, near.place, maxKm)
            : tooSmall(spots, near.place, maxKm)),
      );
    if (!found.reach)
      return failure(
        "No wind forecast is published right now. Try again later.",
      );
    const about = aboutWindow(window, args.from, found.reach, {
      before: "Search from before then",
      after: "No spot can have a session after that yet.",
    });
    if ("error" in about) return failure(about.error);
    const { note } = about;
    return answer({
      window: {
        from: new Date(window.from).toISOString(),
        to: new Date(window.to).toISOString(),
      },
      ...(note && { note }),
      wind_range_kn: [minKnots, maxKnots],
      ...(near && { near: { ...near.place, max_km: maxKm } }),
      ...(counties.length && { counties }),
      offshore_hours: args.allow_offshore ? "counted" : "left out",
      ...(args.max_gust_kn !== undefined && { max_gust_kn: args.max_gust_kn }),
      ...(args.max_gust_factor !== undefined && {
        max_gust_factor: args.max_gust_factor,
      }),
      searched_spots: found.searched,
      spots: found.spots,
      sources: found.sources,
      unavailable: found.unavailable,
      method:
        "An hour counts when its wind is inside the range and its gust (the lead model's, else the top of every model's) is inside max_gust_kn and max_gust_factor. " +
        `A session is \`gusty\` when some hour gusts ${GUSTY_SPREAD_KN} kn or more over its mean; \`gust_kn\` is its strongest gust. ` +
        "Hours with the wind dead offshore are left out unless allow_offshore; a session's `shore` is its most offshore hour's, null where the beach's facing is unknown. " +
        "Each session's agreement, confidence and models are the worst of its hours, as context. " +
        METHOD,
    });
  },
});

/** The spot nearest `near`, and how far it is. */
function nearestSpot(
  spots: readonly RidingSpot[],
  near: Place,
): { spot: RidingSpot; km: number } {
  return spots
    .map((spot) => ({ spot, km: distanceKm(near, spot) }))
    .reduce((a, b) => (b.km < a.km ? b : a));
}

/**
 * Why nothing is within max_km of a place so far from Ireland that no max_km
 * could reach a spot, or null when one could: "try a larger max_km" would
 * send the agent round in circles.
 */
function outsideIreland(
  spots: readonly RidingSpot[],
  near: Place,
  maxKm: number,
): string | null {
  const { spot, km } = nearestSpot(spots, near);
  return km > MAX_KM
    ? `No spots within ${maxKm} km of ${near.name}. The nearest spot is ${spot.name} (${spot.county}), about ${Math.round(km)} km away, beyond the ${MAX_KM} km limit on max_km. This server covers Ireland only.`
    : null;
}

/** Why nothing is within max_km of near, and how far max_km has to go. */
function tooSmall(
  spots: readonly RidingSpot[],
  near: Place,
  maxKm: number,
): string {
  const { spot, km } = nearestSpot(spots, near);
  return `No spots within ${maxKm} km of ${near.name}. The nearest spot is ${spot.name} (${spot.county}), about ${Math.round(km)} km away. Try a larger max_km, at least ${Math.ceil(km)}.`;
}

/**
 * Why no spot is both in the counties asked for and within max_km of near:
 * how far each county's nearest spot is, so the agent can drop the counties or
 * raise max_km far enough, rather than nudge it.
 */
function tooFar(
  spots: readonly RidingSpot[],
  counties: readonly string[],
  near: Place,
  maxKm: number,
): string {
  const nearest = counties.map((county) => {
    const [spot, km] = spots
      .filter((s) => s.county === county)
      .map((s): [RidingSpot, number] => [s, distanceKm(near, s)])
      .reduce((a, b) => (b[1] < a[1] ? b : a));
    return { county, spot, km };
  });
  const [first, ...rest] = nearest;
  const each = [
    `${first.county}'s nearest spot (${first.spot.name}) is about ${Math.round(first.km)} km from ${near.name}`,
    ...rest.map(
      (n) => `${n.county}'s (${n.spot.name}) about ${Math.round(n.km)} km`,
    ),
  ].join("; ");
  const reach = Math.ceil(Math.min(...nearest.map((n) => n.km)));
  return reach <= MAX_KM
    ? `${each}, past max_km ${maxKm}. Drop counties, or raise max_km to at least ${reach}.`
    : `${each}, past the ${MAX_KM} km max_km allows. Drop counties.`;
}

export const forecastSources = tool({
  name: "forecast_sources",
  title: "Forecast sources",
  description:
    "Which weather models are live on wingfoil.ie, when each run was made and how old it is, how far ahead it reaches, whether it is stale (older than that model's schedule allows: a once-a-day run on time is not), and its attribution and licence.",
  inputSchema: {},
  async run(_args, deps) {
    return answer(await modelStatus(deps.source, (deps.now ?? Date.now)()));
  },
});

/** In the order a client lists them. */
export const FORECAST_TOOLS = [
  listSpots,
  getSpotForecast,
  findWind,
  forecastSources,
] as const;
