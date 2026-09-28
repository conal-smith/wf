/**
 * wingfoil.ie over the Model Context Protocol: the forecast as tools an AI
 * assistant can call, mounted at /api/mcp by createApp.
 *
 * Read-only and public, like the map. The server is stateless — a fresh MCP
 * server and transport answer each POST with plain JSON — so it needs no
 * sessions, no sticky routing and nothing to clean up, and any number of API
 * instances can answer the same client.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
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
import type { ForecastSource } from "./source.js";

export const MCP_SERVER_NAME = "wingfoil-ie";
export const MCP_SERVER_TITLE = "wingfoil.ie wind forecast";

export interface McpDeps {
  source: ForecastSource;
  /** The clock "now" is read from. Tests pin it to the fixtures' runs. */
  now?: () => number;
}

export const INSTRUCTIONS = `wingfoil.ie forecasts wind, waves and tides for wing foiling spots in Ireland (Republic and Northern Ireland).

- Start with list_spots or find_wind to learn spot ids; get_spot_forecast accepts an id, a name or part of one.
- Speeds are knots, directions are degrees the wind comes FROM, times are UTC with a \`local\` Europe/Dublin label. Quote the local time to people.
- The forecast is a consensus of several numerical weather models (HARMONIE, ECMWF, ICON-EU, GFS, ARPEGE, AROME, AIFS and ensembles). \`agreement\` says how closely they agree; say so when it is low, and use by_model to explain a disagreement.
- ${METHOD}
- Never tell anyone conditions are safe. Wing foiling depends on the launch, offshore winds, tides, water users and ability, which a forecast cannot know. When wind blows offshore at a spot, point it out.
- Credit the model providers named in \`sources\` when you share a forecast, and link people to https://wingfoil.ie for the map.`;

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

const describeSpot = (s: RidingSpot) => `${s.name} (${s.county}, id ${s.id})`;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createMcpServer(deps: McpDeps): McpServer {
  const now = deps.now ?? Date.now;
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_spots",
    {
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
      annotations: READ_ONLY,
    },
    async ({ county }) => {
      const spots = await loadSpots(deps.source);
      const wanted = county?.trim().toLowerCase();
      const list = wanted
        ? spots.filter((s) => s.county.toLowerCase() === wanted)
        : spots;
      if (wanted && !list.length)
        return failure(
          `No spots in ${county}. Counties with spots: ${[...new Set(spots.map((s) => s.county))].sort().join(", ")}.`,
        );
      return text({ spots: list });
    },
  );

  server.registerTool(
    "get_spot_forecast",
    {
      title: "Spot forecast",
      description:
        "Hour-by-hour forecast for one spot: consensus wind speed, gusts and direction across every weather model with how well they agree, plus waves, air temperature, rain, daylight, sunrise and sunset, high and low tides and the latest sea temperature.",
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
      annotations: READ_ONLY,
    },
    async ({ spot, from, hours, step_hours, per_model }) => {
      const spots = await loadSpots(deps.source);
      const match = findSpot(spots, spot);
      if (!match.spot)
        return failure(
          match.candidates.length
            ? `"${spot}" could be any of: ${match.candidates.map(describeSpot).join("; ")}. Ask which, then call again with its id.`
            : `No spot matches "${spot}". Call list_spots to see them all.`,
        );
      const at = now();
      const window = windowFor(at, { from, hours, stepHours: step_hours });
      const forecast = await spotForecast(deps.source, match.spot, window, {
        perModel: per_model,
        now: at,
      });
      if (!forecast.sources.wind.length)
        return failure(
          `No wind forecast is published for ${match.spot.name} right now. Try again later or see https://wingfoil.ie.`,
        );
      return text(forecast);
    },
  );

  server.registerTool(
    "find_wind",
    {
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
          .describe(
            "Only count hours between sunrise and sunset (default true).",
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
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      const minKnots = args.min_kn ?? 14;
      const maxKnots = args.max_kn ?? 30;
      if (maxKnots < minKnots)
        return failure("max_kn must be at least min_kn.");
      const at = now();
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
      return text({
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
          "An hour counts when the models' median wind is inside the range and they do not disagree by 8 kn or more. " +
          METHOD,
      });
    },
  );

  server.registerTool(
    "forecast_sources",
    {
      title: "Forecast sources",
      description:
        "Which weather models are live on wingfoil.ie, when each run was made, how far ahead it reaches, and its attribution and licence.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => text(await modelStatus(deps.source, now())),
  );

  return server;
}

/** Everything a JSON-RPC error on this endpoint needs, for the non-POST verbs. */
const notAllowed = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message:
      "This is the wingfoil.ie MCP endpoint. It answers POST requests from MCP clients; see https://wingfoil.ie/ai to add it to one.",
  },
  id: null,
};

/** The routes under /api/mcp. */
export function createMcpRouter(deps: McpDeps) {
  const r = new Hono();
  // Anyone's agent may call it, from anywhere: it is public, read-only and
  // carries no credentials.
  r.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Accept",
        "Authorization",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
        "Last-Event-ID",
      ],
      exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
      maxAge: 600,
    }),
  );
  r.post("/", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
    const server = createMcpServer(deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  // No server-initiated stream and no session to end: stateless servers say 405.
  r.on(["GET", "DELETE"], "/", (c) => c.json(notAllowed, 405));
  return r;
}
