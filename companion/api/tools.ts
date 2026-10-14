/**
 * What Gust can do, as tools: look the forecast up, rate it for the rider in
 * the request, move the rider's map and propose a profile. Each tool returns
 * two things: compact JSON for the model to reason over, and the structured
 * cards, map actions and proposals the browser draws itself, so the numbers a
 * rider sees on a card are the forecast's and never the model's prose.
 *
 * The forecast reading is mcp/api/forecast.ts (the consensus the MCP server
 * answers with) and the rating is force5/src/stars.ts (the dock's stars), so a
 * card, the dock and an AI assistant over MCP all agree.
 */
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  DEFAULT_RIDER,
  ESTIMATE_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  SHORE_LABEL,
  SKILLS,
  bestWindow,
  pickWing,
  rateHour,
  shoreAngle,
  type HourRating,
  type Rider,
} from "../../force5/src/stars.js";
import {
  MAX_WINDOW_HOURS,
  axis,
  compass,
  daylight,
  findSpot,
  fold,
  hourWind,
  loadWind,
  localTime,
  spotForecast,
  spotWindLines,
  windowFor,
  type ForecastHour,
  type HourWind,
  type Window,
} from "../../mcp/api/forecast.js";
import type { ForecastSource } from "../../mcp/api/source.js";
import { squaresFor } from "../../force5/src/spotData.js";
import {
  SKILL_LABEL,
  riderSummary,
  type Card,
  type ChatContext,
  type MapAction,
  type ProfileProposal,
  type RiderContext,
  type SpotCardData,
  type WindowChip,
  type WindowSummary,
} from "../shared/protocol.js";
import { ratedSpots, type RatedSpot } from "./spots.js";
import { dublinDayStart, windowLabel } from "./time.js";

const HOUR = 3600000;

export interface ToolContext {
  source: ForecastSource;
  /** The server's clock: forecast windows never start before it. */
  now: number;
  /** The rider every rating in this request is for. */
  rider: Rider;
  context: ChatContext;
  newId: () => string;
}

export interface ToolOutcome {
  /** What the model reads, as JSON. */
  result: unknown;
  isError?: boolean;
  /** One line for the tool chip once it is done. */
  summary: string;
  cards?: Card[];
  actions?: MapAction[];
  proposal?: ProfileProposal;
}

export interface CompanionTool {
  definition: BetaTool;
  /** The running label, before anything is looked up: "Checking Brandon Bay". */
  label(input: unknown, ctx: ToolContext): string;
  /** Validates the model's input against the schema, then runs. */
  run(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

/** The rider in the request, made safe: anything out of range is the estimate. */
export function riderFrom(context: RiderContext | null): Rider {
  if (!context) return DEFAULT_RIDER;
  const weight = context.weightKg;
  return {
    weightKg:
      typeof weight === "number" &&
      weight >= MIN_WEIGHT_KG &&
      weight <= MAX_WEIGHT_KG
        ? Math.round(weight)
        : null,
    skill: SKILLS.includes(context.skill) ? context.skill : "intermediate",
    wings: [
      ...new Set(
        context.wings.filter((w) => w >= MIN_WING_M2 && w <= MAX_WING_M2),
      ),
    ].sort((a, b) => a - b),
  };
}

const riderForModel = (rider: Rider) => ({
  weight_kg: rider.weightKg ?? ESTIMATE_WEIGHT_KG,
  weight_assumed: rider.weightKg === null,
  level: SKILL_LABEL[rider.skill],
  wings_m2: rider.wings,
});

// ---- rating ---------------------------------------------------------------------------

interface RatedHour {
  time: number;
  wind: HourWind | null;
  daylight: boolean;
  rating: HourRating | null;
}

function rate(
  wind: HourWind | null,
  isDay: boolean,
  facing: number | null,
  rider: Rider,
): HourRating | null {
  if (!wind) return null;
  return rateHour(
    {
      windKn: wind.wind_kn,
      gustKn: wind.gust_kn,
      from: wind.direction_deg,
      agreement: wind.agreement,
      daylight: isDay,
    },
    { facing },
    rider,
  );
}

const AGREEMENT_RANK = { high: 0, moderate: 1, low: 2 } as const;

/** The window from column `from` to column `to` (inclusive), summed up. */
function summarise(
  hours: readonly RatedHour[],
  from: number,
  to: number,
  stars: number,
  facing: number | null,
  rider: Rider,
): WindowSummary {
  const span = hours.slice(from, to + 1);
  const winds = span.flatMap((h) => (h.wind ? [h.wind] : []));
  const mean = winds.reduce((s, w) => s + w.wind_kn, 0) / winds.length;
  const gusts = winds.flatMap((w) => (w.gust_kn === null ? [] : [w.gust_kn]));
  let x = 0;
  let y = 0;
  for (const w of winds) {
    x += Math.sin((w.direction_deg * Math.PI) / 180);
    y += Math.cos((w.direction_deg * Math.PI) / 180);
  }
  const direction =
    Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360) % 360;
  const agreement = winds.reduce<WindowSummary["agreement"]>((worst, w) => {
    if (w.agreement === null) return worst;
    return worst === null || AGREEMENT_RANK[w.agreement] > AGREEMENT_RANK[worst]
      ? w.agreement
      : worst;
  }, null);
  const ratings = span.flatMap((h) => (h.rating ? [h.rating] : []));
  const wing = pickWing(rider, mean);
  const start = hours[from].time;
  const end = hours[to].time + HOUR;
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    local: windowLabel(start, end),
    stars,
    potential: Math.min(...ratings.map((r) => r.potential)),
    wind_kn: Math.round(mean),
    gust_kn: gusts.length ? Math.round(Math.max(...gusts)) : null,
    direction: compass(direction),
    direction_deg: direction,
    wing_m2: wing.recommended,
    own_wing_m2: wing.own,
    shore: facing === null ? null : SHORE_LABEL[shoreAngle(direction, facing)],
    agreement,
  };
}

/**
 * The good stretches: runs of at least two hours rated `minStars` or more,
 * each rated on its weakest hour, best first and at most `limit` of them.
 */
function windowsOf(
  hours: readonly RatedHour[],
  minStars: number,
  limit: number,
): { from: number; to: number; stars: number }[] {
  const runs: { from: number; to: number; stars: number }[] = [];
  let start = -1;
  for (let i = 0; i <= hours.length; i++) {
    const stars = i < hours.length ? (hours[i].rating?.stars ?? -1) : -1;
    if (stars >= minStars && start < 0) start = i;
    if (stars < minStars && start >= 0) {
      if (i - start >= 2) {
        const weakest = Math.min(
          ...hours.slice(start, i).map((h) => h.rating!.stars),
        );
        runs.push({ from: start, to: i - 1, stars: weakest });
      }
      start = -1;
    }
  }
  return runs
    .sort((a, b) => b.stars - a.stars || b.to - b.from - (a.to - a.from))
    .slice(0, limit);
}

interface SpotRating {
  spot: RatedSpot;
  hours: RatedHour[];
  best: WindowSummary | null;
  /** The hours that cost the best window its stars, in words. */
  reasons: string[];
  others: WindowChip[];
}

function rateSpot(
  spot: RatedSpot,
  hours: RatedHour[],
  rider: Rider,
): SpotRating {
  const window = bestWindow(hours.map((h) => h.rating));
  if (!window) return { spot, hours, best: null, reasons: [], others: [] };
  const best = summarise(
    hours,
    window.from,
    window.to,
    window.stars,
    spot.facing,
    rider,
  );
  const weakest = hours
    .slice(window.from, window.to + 1)
    .flatMap((h) => (h.rating ? [h.rating] : []))
    .sort((a, b) => a.stars - b.stars)[0];
  const others = windowsOf(hours, Math.max(2, window.stars - 1), 4)
    .filter((w) => w.to < window.from || w.from > window.to)
    .slice(0, 3)
    .sort((a, b) => a.from - b.from)
    .map((w) => {
      const start = hours[w.from].time;
      const end = hours[w.to].time + HOUR;
      return {
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
        local: windowLabel(start, end),
        stars: w.stars,
      };
    });
  return { spot, hours, best, reasons: weakest?.reasons ?? [], others };
}

function card(rating: SpotRating, rider: Rider): SpotCardData {
  const rated = rating.hours.some((h) => h.rating);
  return {
    kind: "spot",
    id: rating.spot.id,
    name: rating.spot.name,
    county: rating.spot.county,
    best: rating.best,
    windows: rating.others,
    rider: {
      weightKg: rider.weightKg ?? ESTIMATE_WEIGHT_KG,
      assumed: rider.weightKg === null,
      skill: rider.skill,
    },
    note: rating.best
      ? null
      : rated
        ? "No two-hour window earns a star in this search."
        : "No daylight hours with a wind forecast in this search.",
  };
}

const bestForModel = (rating: SpotRating) =>
  rating.best && {
    ...rating.best,
    why_not_more_stars: rating.reasons,
  };

const starsGlyph = (n: number) => "★".repeat(n) || "0★";

// ---- the window a tool searches ----------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A Dublin day (and the days after it), or the next 48 hours from now. */
function searchWindow(
  now: number,
  date: string | null,
  days: number | null,
): Window | string {
  const span = Math.min(5, Math.max(1, days ?? (date ? 1 : 2))) * 24;
  if (!date) return windowFor(now, { hours: span, stepHours: 1 });
  const start = dublinDayStart(date);
  if (start === null) return `"${date}" is not a YYYY-MM-DD date.`;
  if (start + span * HOUR <= now)
    return `${date} has already passed. Forecasts start from now.`;
  if (start - now > (MAX_WINDOW_HOURS - 24) * HOUR)
    return `${date} is beyond the forecast, which reaches about ten days ahead.`;
  const from = new Date(Math.max(start, now)).toISOString();
  const hours = Math.max(
    1,
    Math.round((start + span * HOUR - Date.parse(from)) / HOUR),
  );
  return windowFor(now, { from, hours, stepHours: 1 });
}

const nullable = <T extends object>(schema: T) => ({
  anyOf: [schema, { type: "null" }],
});

const DATE_INPUT = nullable({
  type: "string",
  description:
    "A day in Europe/Dublin as YYYY-MM-DD (work it out from today's date in the context). Null for the next 48 hours from now.",
});
const DAYS_INPUT = nullable({
  type: "integer",
  description:
    "How many days from `date` to cover, 1 to 5 (2 for a weekend). Null for 1, or 2 when date is null.",
});

const dateSchema = z.string().regex(DATE).nullable();
const daysSchema = z.number().int().min(1).max(5).nullable();

function failed(message: string): ToolOutcome {
  return { result: { error: message }, isError: true, summary: message };
}

/** "dollymount" → "Dollymount", for a running label before the spot is found. */
const titled = (text: string) =>
  text
    .trim()
    .slice(0, 40)
    .replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase());

function tool<T>(spec: {
  definition: Omit<BetaTool, "strict" | "eager_input_streaming">;
  schema: z.ZodType<T>;
  label(input: T | null, ctx: ToolContext): string;
  run(input: T, ctx: ToolContext): Promise<ToolOutcome>;
}): CompanionTool {
  const parse = (input: unknown) => {
    const parsed = spec.schema.safeParse(input);
    return parsed.success ? parsed.data : null;
  };
  return {
    // Strict: arguments always match the schema. Eager: the inputs stream as
    // they are written (the streaming default for client tools), which means
    // the server no longer validates them, so run() parses them here first.
    definition: {
      ...spec.definition,
      strict: true,
      eager_input_streaming: true,
    },
    label: (input, ctx) => spec.label(parse(input), ctx),
    run: async (input, ctx) => {
      const parsed = spec.schema.safeParse(input);
      if (!parsed.success)
        return {
          result: { INVALID_INPUT: JSON.stringify(input) },
          isError: true,
          summary: "Could not read that request",
        };
      return spec.run(parsed.data, ctx);
    },
  };
}

// ---- the tools ------------------------------------------------------------------------------

const listSpots = tool({
  definition: {
    name: "list_spots",
    description:
      "Find riding spots by name, part of a name, or county. Call this to learn a spot's id when the rider names a place you have not looked up yet, or to list a county's spots.",
    input_schema: {
      type: "object",
      properties: {
        query: nullable({
          type: "string",
          description: "Part of a spot name, e.g. 'brandon' or 'Dollymount'.",
        }),
        county: nullable({
          type: "string",
          description: "A county, e.g. Kerry, Dublin, Down.",
        }),
      },
      required: ["query", "county"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    query: z.string().max(80).nullable(),
    county: z.string().max(40).nullable(),
  }),
  label: (input) =>
    input?.county
      ? `Listing spots in ${titled(input.county)}`
      : "Looking up spots",
  async run({ query, county }, ctx) {
    const spots = await ratedSpots(ctx.source);
    let list = county
      ? spots.filter((s) => fold(s.county) === fold(county))
      : spots;
    if (query) {
      const match = findSpot(list, query);
      // findSpot hands back elements of the list it was given.
      list = (match.spot ? [match.spot] : match.candidates) as RatedSpot[];
    }
    if (!list.length)
      return failed(
        `No spots match. Counties with spots: ${[...new Set(spots.map((s) => s.county))].sort().join(", ")}.`,
      );
    return {
      result: {
        spots: list.slice(0, 40).map((s) => ({
          id: s.id,
          name: s.name,
          county: s.county,
          shore_facing_known: s.facing !== null,
        })),
        more: Math.max(0, list.length - 40),
      },
      summary: `${list.length} spot${list.length === 1 ? "" : "s"}`,
    };
  },
});

const getSpotForecast = tool({
  definition: {
    name: "get_spot_forecast",
    description:
      "The forecast for one spot, rated in stars (0-5) for the rider in the context: daylight hours with the headline wind, gusts and direction (HARMONIE's own while it reaches the hour, else the weighted median of the models), how well the models agree, the stars, the wing to take and how the wind meets the shore (onshore … offshore), plus the best window, waves, tides, sunrise/sunset and sea temperature. Call it for questions about one place: 'is X on this weekend?', 'what wing should I take?', 'when is best at X?'. The rider sees a card with the best window.",
    input_schema: {
      type: "object",
      properties: {
        spot: {
          type: "string",
          description:
            "Spot id (preferred), name or part of a name, e.g. 'brandon' or 'Brandon Bay'.",
        },
        date: DATE_INPUT,
        days: DAYS_INPUT,
      },
      required: ["spot", "date", "days"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    spot: z.string().min(1).max(80),
    date: dateSchema,
    days: daysSchema,
  }),
  label: (input, ctx) => {
    if (!input) return "Checking the forecast";
    const own = ctx.context.spot;
    return `Checking ${own && own.id === input.spot ? own.name : titled(input.spot)}`;
  },
  async run({ spot, date, days }, ctx) {
    const spots = await ratedSpots(ctx.source);
    const match = findSpot(spots, spot);
    if (!match.spot)
      return failed(
        match.candidates.length
          ? `"${spot}" could be any of: ${match.candidates
              .slice(0, 12)
              .map((s) => `${s.name} (${s.county}, id ${s.id})`)
              .join("; ")}. Ask which.`
          : `No spot matches "${spot}". Try list_spots.`,
      );
    const place = spots.find((s) => s.id === match.spot!.id)!;
    const window = searchWindow(ctx.now, date, days);
    if (typeof window === "string") return failed(window);
    const forecast = await spotForecast(ctx.source, place, window, {
      now: ctx.now,
    });
    if (!forecast.sources.wind.length)
      return failed(
        `No wind forecast is published for ${place.name} right now.`,
      );
    const times = axis(window);
    const byTime = new Map(
      forecast.hours.map((h): [number, ForecastHour] => [
        Date.parse(h.time),
        h,
      ]),
    );
    const hours: RatedHour[] = times.map((time) => {
      const h = byTime.get(time);
      const wind = h?.wind ?? null;
      const isDay = h?.daylight ?? false;
      return {
        time,
        wind,
        daylight: isDay,
        rating: rate(wind, isDay, place.facing, ctx.rider),
      };
    });
    const rating = rateSpot(place, hours, ctx.rider);
    const step = hours.length > 30 ? 3 : 1;
    const rows = hours.flatMap((h, i) => {
      const f = byTime.get(h.time);
      if (!h.daylight || !h.wind || !f || i % step) return [];
      return [
        {
          local: f.local,
          wind_kn: Math.round(h.wind.wind_kn),
          gust_kn: h.wind.gust_kn === null ? null : Math.round(h.wind.gust_kn),
          direction: h.wind.direction,
          agreement: h.wind.agreement,
          stars: h.rating?.stars ?? null,
          potential: h.rating?.potential ?? null,
          wing_m2: h.rating?.wing.recommended ?? null,
          own_wing_m2: h.rating?.wing.own ?? null,
          shore: h.rating?.shore ? SHORE_LABEL[h.rating.shore] : null,
          waves_m: f.waves?.height_m ?? null,
          air_c: f.weather?.air_c ?? null,
        },
      ];
    });
    const spotCard = card(rating, ctx.rider);
    return {
      result: {
        spot: {
          id: place.id,
          name: place.name,
          county: place.county,
          shore_facing_deg: place.facing,
          shore_note:
            place.facing === null
              ? "The shore's facing is not known here, so the stars rate the wind alone and cannot warn about offshore wind. Say so."
              : "Shore angle is computed from a map estimate of the facing, not a survey.",
        },
        rider: riderForModel(ctx.rider),
        best_window: bestForModel(rating),
        other_windows: rating.others,
        daylight_hours: rows,
        rows_every_hours: step,
        sun: forecast.sun,
        tides:
          forecast.tides && "events" in forecast.tides
            ? {
                station: forecast.tides.station,
                events: forecast.tides.events.map((e) => ({
                  local: e.local,
                  tide: e.tide,
                  height_m: e.height_m,
                })),
              }
            : forecast.tides,
        sea_temperature_c: forecast.sea_temperature?.celsius ?? null,
        models: forecast.sources.wind.map((m) => m.name),
        shown_to_rider: "A spot card with the best window and other windows.",
      },
      summary: rating.best
        ? `${place.name}: ${starsGlyph(rating.best.stars)} ${rating.best.local}`
        : `${place.name}: no rated window`,
      cards: [spotCard],
    };
  },
});

const findSessions = tool({
  definition: {
    name: "find_sessions",
    description:
      "Rank every spot (or one county's) by its best window in stars for the rider in the context, over a day or the next 48 hours. Call it for 'where's best tomorrow?', 'where should I go this weekend?', 'anywhere good near Dublin?'. The rider sees cards for the top three.",
    input_schema: {
      type: "object",
      properties: {
        date: DATE_INPUT,
        days: DAYS_INPUT,
        county: nullable({
          type: "string",
          description:
            "Only spots in this county, e.g. 'Kerry'. Null for all of Ireland.",
        }),
        min_stars: nullable({
          type: "integer",
          description:
            "Only windows rated at least this many stars (1-5). Null for 1.",
        }),
      },
      required: ["date", "days", "county", "min_stars"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    date: dateSchema,
    days: daysSchema,
    county: z.string().max(40).nullable(),
    min_stars: z.number().int().min(1).max(5).nullable(),
  }),
  label: (input) =>
    input?.county
      ? `Comparing spots in ${titled(input.county)}`
      : "Comparing every spot",
  async run({ date, days, county, min_stars }, ctx) {
    const window = searchWindow(ctx.now, date, days);
    if (typeof window === "string") return failed(window);
    const all = await ratedSpots(ctx.source);
    const pool = county
      ? all.filter((s) => fold(s.county) === fold(county))
      : all;
    if (!pool.length)
      return failed(
        `No spots in ${county}. Counties: ${[...new Set(all.map((s) => s.county))].sort().join(", ")}.`,
      );
    const wind = await loadWind(ctx.source, ctx.now, squaresFor(pool));
    if (!wind.loaded.length)
      return failed("No wind forecast is published right now.");
    const times = axis(window);
    const rated = pool.flatMap((spot) => {
      const { lines } = spotWindLines(wind.loaded, spot.id);
      if (!lines.length) return [];
      const hours = times.map((time): RatedHour => {
        const w = hourWind(lines, time, false);
        const isDay = daylight(spot, time);
        return {
          time,
          wind: w,
          daylight: isDay,
          rating: rate(w, isDay, spot.facing, ctx.rider),
        };
      });
      return [rateSpot(spot, hours, ctx.rider)];
    });
    const floor = min_stars ?? 1;
    const ranked = rated
      .filter((r) => r.best && r.best.stars >= floor)
      .sort(
        (a, b) =>
          b.best!.stars - a.best!.stars ||
          Date.parse(b.best!.to) -
            Date.parse(b.best!.from) -
            (Date.parse(a.best!.to) - Date.parse(a.best!.from)) ||
          b.best!.potential - a.best!.potential,
      );
    const top = ranked.slice(0, 6);
    return {
      result: {
        rider: riderForModel(ctx.rider),
        searched: {
          from: localTime(window.from),
          to: localTime(window.to),
          spots: rated.length,
          county: county ?? "all of Ireland",
        },
        spots: top.map((r) => ({
          id: r.spot.id,
          name: r.spot.name,
          county: r.spot.county,
          best_window: bestForModel(r),
          other_windows: r.others,
        })),
        spots_below_min_stars: rated.length - ranked.length,
        models: wind.loaded.map((l) => l.run.name),
        shown_to_rider: top.length
          ? `Spot cards for ${top
              .slice(0, 3)
              .map((r) => r.spot.name)
              .join(", ")}.`
          : "Nothing: no spot has a window that good.",
      },
      summary: top.length
        ? `${top[0].spot.name} leads: ${starsGlyph(top[0].best!.stars)}`
        : "No window found",
      cards: top.slice(0, 3).map((r) => card(r, ctx.rider)),
    };
  },
});

const showOnMap = tool({
  definition: {
    name: "show_on_map",
    description:
      "Move the rider's map: select a spot (opens its forecast in the timeline dock), move the timeline to a time, and/or briefly highlight some spots' markers. Only call this when the rider asks to see something on the map ('show me', 'take me there', 'put it on the map'). Never call it unasked: the cards already have their own Show on map buttons.",
    input_schema: {
      type: "object",
      properties: {
        spot_id: nullable({
          type: "string",
          description: "A spot id to select.",
        }),
        time: nullable({
          type: "string",
          description:
            "ISO 8601 time to move the timeline to, e.g. a window's `from`.",
        }),
        highlight_ids: nullable({
          type: "array",
          items: { type: "string" },
          description: "Spot ids to highlight for a few seconds (at most 8).",
        }),
      },
      required: ["spot_id", "time", "highlight_ids"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    spot_id: z.string().max(80).nullable(),
    time: z.string().max(40).nullable(),
    highlight_ids: z.array(z.string().max(80)).max(8).nullable(),
  }),
  label: () => "Moving the map",
  async run({ spot_id, time, highlight_ids }, ctx) {
    const spots = await ratedSpots(ctx.source);
    const known = new Map(spots.map((s) => [s.id, s]));
    const actions: MapAction[] = [];
    const unknown = [spot_id, ...(highlight_ids ?? [])].filter(
      (id): id is string => id !== null && !known.has(id),
    );
    if (unknown.length)
      return failed(`Unknown spot id: ${unknown.join(", ")}. Use list_spots.`);
    if (highlight_ids?.length)
      actions.push({
        type: "highlight_spots",
        ids: [...new Set(highlight_ids)],
      });
    if (spot_id) actions.push({ type: "select_spot", id: spot_id });
    if (time) {
      const at = Date.parse(time);
      if (
        !Number.isFinite(at) ||
        at < ctx.now - 2 * HOUR ||
        at > ctx.now + MAX_WINDOW_HOURS * HOUR
      )
        return failed("That time is outside the forecast.");
      actions.push({ type: "set_time", iso: new Date(at).toISOString() });
    }
    if (!actions.length)
      return failed("Nothing to show: give a spot, a time or ids.");
    return {
      result: { shown: true, note: "The rider's map has moved." },
      summary: spot_id ? `Showing ${known.get(spot_id)!.name}` : "Map moved",
      actions,
    };
  },
});

const proposeRiderProfile = tool({
  definition: {
    name: "propose_rider_profile",
    description:
      "Propose saving the rider's profile (weight, level, the wings they own), which the stars and wing sizes are rated for. The rider sees a card and must tap Confirm; nothing is saved until they do. Call it when the rider tells you their weight, level or wings, or asks to set up their profile and has given at least one of them. Fields left null keep their current value.",
    input_schema: {
      type: "object",
      properties: {
        weight_kg: nullable({
          type: "number",
          description: "Body weight in kg, 30-160.",
        }),
        level: nullable({
          type: "string",
          enum: ["beginner", "intermediate", "advanced"],
          description:
            "beginner = Learning (still getting up on the foil), intermediate = Riding, advanced = Advanced.",
        }),
        wings_m2: nullable({
          type: "array",
          items: { type: "number" },
          description:
            "Every wing size the rider owns, in m² (1.5-10), e.g. [4, 5, 6].",
        }),
      },
      required: ["weight_kg", "level", "wings_m2"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    weight_kg: z.number().nullable(),
    level: z.enum(["beginner", "intermediate", "advanced"]).nullable(),
    wings_m2: z.array(z.number()).max(12).nullable(),
  }),
  label: () => "Preparing your rider profile",
  async run({ weight_kg, level, wings_m2 }, ctx) {
    if (
      weight_kg !== null &&
      (weight_kg < MIN_WEIGHT_KG || weight_kg > MAX_WEIGHT_KG)
    )
      return failed(`Weight must be ${MIN_WEIGHT_KG}-${MAX_WEIGHT_KG} kg.`);
    const badWing = (wings_m2 ?? []).find(
      (w) => w < MIN_WING_M2 || w > MAX_WING_M2,
    );
    if (badWing !== undefined)
      return failed(
        `A wing of ${badWing} m² is outside ${MIN_WING_M2}-${MAX_WING_M2} m².`,
      );
    const current = ctx.rider;
    const rider: RiderContext = {
      weightKg: weight_kg === null ? current.weightKg : Math.round(weight_kg),
      skill: level ?? current.skill,
      wings:
        wings_m2 === null
          ? current.wings
          : [...new Set(wings_m2.map((w) => Math.round(w * 2) / 2))].sort(
              (a, b) => a - b,
            ),
    };
    const proposal: ProfileProposal = {
      id: ctx.newId(),
      rider,
      summary: `Save ${riderSummary(rider)}?`,
    };
    return {
      result: {
        proposed: {
          weight_kg: rider.weightKg,
          level: rider.skill,
          wings_m2: rider.wings,
        },
        status: "Shown to the rider with Confirm and Not now. Not saved yet.",
      },
      summary: riderSummary(rider),
      proposal,
    };
  },
});

/** Sorted by name: the tool list is the start of the cached prompt. */
export const TOOLS: readonly CompanionTool[] = [
  findSessions,
  getSpotForecast,
  listSpots,
  proposeRiderProfile,
  showOnMap,
].sort((a, b) => a.definition.name.localeCompare(b.definition.name));

export const TOOL_DEFINITIONS: BetaTool[] = TOOLS.map((t) => t.definition);

export function toolNamed(name: string): CompanionTool | undefined {
  return TOOLS.find((t) => t.definition.name === name);
}
