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
  MAX_WINDOW_HOURS,
  METHOD,
  findSessions,
  findSpot,
  loadSpots,
  modelStatus,
  spotForecast,
  windowFor,
  type RidingSpot,
} from "./forecast.js";
import type { ForecastSource } from "./httpSource.js";

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
- Speeds are knots, directions are degrees the wind comes FROM, times are UTC with a \`local\` Europe/Dublin label. Quote the local time to people.
- The forecast is HARMONIE's own (Met Éireann's 2.5 km model, the most accurate here) while it reaches the hour, about the next 60 hours; past it, a weighted median of the other models (ICON-EU and ECMWF). \`lead\` says which an hour is. \`agreement\` says how closely all the models agree; say so when it is low, and use by_model to explain a disagreement.
- ${METHOD}
- ${CARE}
- Credit the model providers named in \`sources\` when you share a forecast, and link people to https://wingfoil.ie for the map.`;

const answer = (value: unknown): ToolOutcome => ({ ok: true, value });
const failure = (message: string): ToolOutcome => ({ ok: false, message });

const describeSpot = (s: RidingSpot) => `${s.name} (${s.county}, id ${s.id})`;

const tool = <Shape extends z.ZodRawShape>(t: ForecastTool<Shape>) => t;

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
    const wanted = county?.trim().toLowerCase();
    const list = wanted
      ? spots.filter((s) => s.county.toLowerCase() === wanted)
      : spots;
    if (wanted && !list.length)
      return failure(
        `No spots in ${county}. Counties with spots: ${[...new Set(spots.map((s) => s.county))].sort().join(", ")}.`,
      );
    return answer({ spots: list });
  },
});

export const getSpotForecast = tool({
  name: "get_spot_forecast",
  title: "Spot forecast",
  description:
    "Hour-by-hour forecast for one spot: wind speed, gusts and direction (HARMONIE's own while it reaches the hour, past it a weighted median of the other weather models) with the range across every model and how well they agree, plus waves, air temperature, rain, daylight, sunrise and sunset, high and low tides and the latest sea temperature.",
  inputSchema: {
    spot: z
      .string()
      .min(1)
      .max(80)
      .describe(
        "Spot id, name or part of a name, e.g. 'dollymount' or 'Brandon Bay'.",
      ),
    from: z
      .string()
      .max(40)
      .optional()
      .describe(
        "ISO 8601 start time. Defaults to now; earlier times are not available.",
      ),
    hours: z
      .number()
      .int()
      .min(1)
      .max(MAX_WINDOW_HOURS)
      .optional()
      .describe("How many hours ahead to cover (default 48, at most 240)."),
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
  },
  async run({ spot, from, hours, step_hours, per_model }, deps) {
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
    const forecast = await spotForecast(deps.source, match.spot, window, {
      perModel: per_model,
      now: at,
    });
    if (!forecast.sources.wind.length)
      return failure(
        `No wind forecast is published for ${match.spot.name} right now. Try again later or see https://wingfoil.ie.`,
      );
    return answer(forecast);
  },
});

export const findWind = tool({
  name: "find_wind",
  title: "Find wind",
  description:
    "Rank spots by how many hours the models agree the wind will be in a range, grouped into sessions. Use this for 'where should I go this weekend?'.",
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
    from: z
      .string()
      .max(40)
      .optional()
      .describe("ISO 8601 start of the search. Defaults to now."),
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
      .describe("Only spots in this county."),
    daylight_only: z
      .boolean()
      .optional()
      .describe("Only count hours between sunrise and sunset (default true)."),
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
  },
  async run(args, deps) {
    const minKnots = args.min_kn ?? 14;
    const maxKnots = args.max_kn ?? 30;
    if (maxKnots < minKnots) return failure("max_kn must be at least min_kn.");
    const at = (deps.now ?? Date.now)();
    const spots = await loadSpots(deps.source);
    const window = windowFor(at, {
      from: args.from,
      hours: args.hours ?? 72,
      stepHours: 1,
    });
    const found = await findSessions(deps.source, spots, window, {
      minKnots,
      maxKnots,
      daylightOnly: args.daylight_only ?? true,
      minSessionHours: args.min_session_hours ?? 2,
      county: args.county,
      limit: args.limit ?? 8,
      now: at,
    });
    if (args.county && !found.searched)
      return failure(
        `No spots in ${args.county}. Call list_spots to see the counties.`,
      );
    if (!found.sources.length)
      return failure(
        "No wind forecast is published right now. Try again later.",
      );
    return answer({
      window: {
        from: new Date(window.from).toISOString(),
        to: new Date(window.to).toISOString(),
      },
      wind_range_kn: [minKnots, maxKnots],
      searched_spots: found.searched,
      spots: found.spots,
      sources: found.sources,
      unavailable: found.unavailable,
      method:
        "An hour counts when its wind (HARMONIE's own while it reaches the hour; past it, a weighted median of the other models) is inside the range and the models' agreement is not low. " +
        METHOD,
    });
  },
});

export const forecastSources = tool({
  name: "forecast_sources",
  title: "Forecast sources",
  description:
    "Which weather models are live on wingfoil.ie, when each run was made, how far ahead it reaches, and its attribution and licence.",
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
