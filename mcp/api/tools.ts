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
  GUST_FACTOR_RULE,
  MAX_WINDOW_HOURS,
  METHOD,
  axis,
  countyKey,
  distanceKm,
  findPlace,
  findSessions,
  findSpot,
  forecastReach,
  nearbySpots,
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
import { riderOf, riderUsed } from "./rating.js";
import { shoreType } from "../../force5/src/shoreFacing.js";
import { GUST_FACTOR_MIN_WIND_KN } from "../../force5/src/gustFactor.js";
import {
  loadWarnings,
  warningsAcross,
  type WarningsAnswer,
} from "./warnings.js";
import {
  DEFAULT_STARS_FROM,
  STARS_MODELS,
  leadFor,
  type StarsFrom,
} from "../../force5/src/lead.js";
import {
  GUST_EASE_KN,
  MAX_WEIGHT_KG,
  MAX_WING_M2,
  MIN_WEIGHT_KG,
  MIN_WING_M2,
  OURS,
} from "../../force5/src/stars.js";

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

const { min, sweetLow, sweetHigh, max } = OURS.wind;

/**
 * How the stars come, in plain words, from ours (force5/src/stars.ts): what
 * an agent may pass on when someone asks why an hour has the stars it has.
 */
export const STARS_IN_WORDS = `The stars come from four numbers: too light (${min} kn), the sweet spot (${sweetLow}–${sweetHigh} kn) and too much, in gusts (${max} kn). Steady wind under too light gets no stars; at too light one star, then a star a knot up to four; five through the sweet spot; then fewer, down to one star at ${max - 5} kn and none from ${max - 3} kn. A gust past too much means no stars. Otherwise the gust is read ${GUST_EASE_KN} kn lighter, and if that is worth fewer stars the hour takes the lower. The wind's direction can take stars off too: cross-offshore one star, offshore always none. An orange or red Met Éireann warning replaces the stars, as does a bathing water prohibition or advice against bathing. The rider's weight and wings never change the stars: they only pick the wing size shown beside them.`;

export const INSTRUCTIONS = `wingfoil.ie forecasts wind, waves and tides for wing foiling spots in Ireland (Republic and Northern Ireland).

- Start with list_spots or find_wind to learn spot ids; get_spot_forecast accepts an id, a name or part of one.
- Before recommending spots, ask where the person is based (or use their location if you have it) and pass find_wind near ({ lat, lon } for a town, or a county or spot) with max_km, or the counties they'd travel to. Searching all of Ireland suits only someone willing to travel anywhere.
- Speeds are knots, directions are degrees the wind comes FROM, times are UTC with a \`local\` label in Irish time that ends in its zone, IST (UTC+1) or GMT (UTC+0). Quote the local time to people, and its zone around a clock change: the night the clocks go back has two 01:00s.
- The forecast is one model's own, the one wingfoil.ie rates its stars from, never a blend of several: HARMONIE's (Met Éireann's 2.5 km model, the most accurate here) while it reaches the hour, about the next 60 hours, and ECMWF's past it, unless a caller passes \`model\` to choose another (ECMWF still takes over past the end of its run). \`lead\` says which model an hour is. \`agreement\` says how closely all the models agree, as context; \`confidence\` is the same but low wherever fewer than three models cover the hour (\`models\`), as happens a few days out. Hedge when confidence is low, say why (few models, or models disagreeing), and use by_model to explain a disagreement.
- ${METHOD}
- Met Éireann's official warnings: every tool gives \`warnings\` (yellow, orange or red; wind, weather or marine; headline, description and validity exactly as Met Éireann issued them), and get_spot_forecast marks each hour a warning covers (\`warning\`). Check them before answering "can I go?". An orange or red warning covering an hour replaces its rating (\`replaces_rating\`): never call such an hour good or rideable, and find_wind leaves it out of every session. A yellow warning leaves the forecast as it is, since some (rain, fog) matter little on the water, but always mention it. When \`warnings.status\` is not "current" the warnings could not be checked: say so and send people to https://www.met.ie/warnings. Credit Met Éireann for any warning you pass on.
- Water quality: get_spot_forecast and find_wind give \`water_quality\`, the EPA's bathing water notices (beaches.ie) at bathing waters near a spot: a prohibition, an advice against bathing or a prior warning, with its cause (a sewage or storm water overflow, an algal bloom, heavy rain) as the council wrote it. Riders fall in and swallow water, so mention every notice. A prohibition or advice against bathing replaces the rating of the hours it covers (\`water\` on each hour, \`replaces_rating\`), like an orange warning. \`status\` "not-monitored" means no bathing water is near enough: nothing is known, which is not a sign the water is clean. The EPA monitors in the Republic, mostly in the bathing season (June to mid-September). Credit the EPA (beaches.ie) and link the notice.
- \`shore\` says how the wind meets the spot's beach: onshore, cross-on, cross, cross-off or offshore (the same rule wingfoil.ie's stars use). Offshore and cross-off wind carry a rider who falls away from the beach out to sea: always warn about them. find_wind leaves dead offshore hours out unless allow_offshore is set. Some spots are on the water (\`shore_type\` "on-water", e.g. Malahide Estuary): riders launch and ride in the middle of the water, so \`shore\` is "on-water", onshore and offshore don't apply and the offshore filter doesn't either; say so, and that the rider must judge the wind against the shore they launch from and the one it would blow them to. A null shore means a beach's facing is unknown, so say offshore wind can't be ruled out there. \`nearby\` names other spots within 1.5 km, often the same beach or water.
- To answer "can I go?" and "when?", use the stars: each hour's \`rating\` in get_spot_forecast, and each find_wind session's, is wingfoil.ie's own rating, ours, the same code and the same numbers as the spot page (stars 0–5; \`potential\` is what the steady wind alone is worth, and the stars between the two are the ones the gusts or the shore took, which the site draws as outlines). ${STARS_IN_WORDS} Say the stars are wingfoil.ie's, \`rider.label\` ("Ours · ~80 kg"); a rider who has made the stars their own in Settings on the site may see others there. Zero stars is a no: say why from \`why_no_stars\` (too light, too strong, gusts over your limit, offshore). \`best_windows\` gives each day's best stretch, ended by last light, with its tides: quote its local time and stars. \`best_directions\` are the winds the beach wants. Never rate an hour higher than the site does.
- Gusts: \`gust_factor\` is gust ÷ mean, as context; the stars read the gust itself. Under ${GUST_FACTOR_MIN_WIND_KN} kn of mean wind there is none (\`why_no_gust_factor\` says so): read the gust in knots. A gust over the rider's limit (\`rider.gust_limit_kn\`) leaves the hour no stars, so find_wind never counts such an hour. Mention gusty sessions. When someone has a tighter gust limit, pass max_gust_kn or max_gust_factor.
- Safety comes before stars: a thunder risk, an official warning, or offshore wind outweighs any rating.
- Light: a session ends by last light (civil dusk, in \`sun\`), not at sunset and never after dark; quote last light as the time to be off the water. find_wind's sessions already stop there.
- Thunder: wherever an hour's \`thunder_risk\` is high or possible, tell the person to stay off the water then and in the hours either side (lightning strikes ahead of a storm), whatever the wind. Low is not a promise of no storm.
- ${CARE}
- Credit the model providers named in \`sources\` when you share a forecast, and link people to https://wingfoil.ie for the map.
- Answers are compact: the notes that are the same on every call (each field's full meaning in \`units\`, the \`method\`, each source's attribution and licence) come only when you pass explain: true. Read them once if you need them, not on every call. Each tool's description says roughly how big its answer is: keep a window to the hours the question needs, and use step_hours 3 or 6 for a week.`;

/** How far from `near` find_wind looks unless told: about an hour and a half's drive. */
export const DEFAULT_MAX_KM = 100;

/**
 * The units every get_spot_forecast answer carries, a line each. The long
 * notes (forecast.ts UNITS), the method and each source's attribution are the
 * same on every call, some 8 KB of an answer that may hold one hour, so they
 * come only with `explain`.
 */
export const UNITS_BRIEF = {
  wind: "knots",
  direction: "degrees the wind or waves come FROM (0 = north)",
  time: "`time` is UTC; `local` is Irish time, ending IST (UTC+1) or GMT (UTC+0)",
  waves: "metres (significant height), seconds (peak period)",
  temperature: "°C; `feels_like_c` is the wind chill in the mean wind",
  rain: "mm, the model's total over `rain_interval_hours`, on the row it ends (null on the rows before it): add rows up for a period",
  gust_factor: `gust ÷ mean wind, as context; null under ${GUST_FACTOR_MIN_WIND_KN} kn of mean wind, where \`why_no_gust_factor\` says so`,
  thunder:
    "`thunder_risk` high or possible: stay off the water then and the hours either side; low is no promise",
  more: "explain: true gives each field's full notes, the method and each source's attribution",
};

/** The argument that asks for the notes every answer would otherwise repeat. */
const EXPLAIN_ARG = {
  explain: z
    .boolean()
    .optional()
    .describe(
      "Also give the notes that are the same on every call (about 9 KB): what each field means in full (`units`), how the forecast is made (`method`) and each source's attribution and licence. Default false: read them once if you need them, not on every call.",
    ),
};

const NOTES_ONLY = new Set(["attribution", "license_url"]);

/** A model run without its attribution and licence, which explain and forecast_sources give. */
function briefRun(run: unknown): unknown {
  if (typeof run !== "object" || run === null || !("run_time" in run))
    return run;
  return Object.fromEntries(
    Object.entries(run).filter(([key]) => !NOTES_ONLY.has(key)),
  );
}

/** `sources`, a list of runs or a record of runs and lists of them, without each run's notes. */
function briefSources(sources: object): unknown {
  if (Array.isArray(sources)) return sources.map(briefRun);
  return Object.fromEntries(
    Object.entries(sources).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(briefRun) : briefRun(value),
    ]),
  );
}

/**
 * The warnings as an answer gives them. Each item's `id` is short, "w1" on in
 * the answer's order, with Met Éireann's own identifier beside it as `cap_id`:
 * spots and hours name their warnings by id, and a CAP identifier is some 65
 * characters (a third of list_spots' answer, at 149 spots under one warning
 * for all coasts). The rule comes with any warning, or with explain; every
 * warning comes whole, always.
 */
function answerWarnings(warnings: WarningsAnswer, explain: boolean) {
  const ids = new Map(warnings.items.map((w, i) => [w.id, `w${i + 1}`]));
  const { rule, items, ...rest } = warnings;
  return {
    warnings: {
      ...((explain || items.length > 0) && { rule }),
      ...rest,
      items: items.map(({ id, ...item }) => ({
        id: ids.get(id)!,
        cap_id: id,
        ...item,
      })),
    },
    /** A warning's id in this answer, from its CAP identifier. */
    idOf: (capId: string) => ids.get(capId) ?? capId,
  };
}

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
    "The wing foiling spots wingfoil.ie forecasts for, with county and coordinates, whether each is a beach or a spot on the water (`shore_type`), and the other spots within 1.5 km of it (`nearby`). Optionally only one county. `warnings` lists Met Éireann's official warnings in force or still to come at any of them, and each spot with one names them by id in its own `warnings`. Answer size: about 30 KB for all 149 spots, about 6 KB for one county such as Kerry.",
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
    const warned = warningsAcross(
      await loadWarnings(deps.source),
      list,
      (deps.now ?? Date.now)(),
    );
    const { warnings, idOf } = answerWarnings(warned.answer, false);
    return answer({
      spots: list.map((s) => {
        const nearby = nearbySpots(spots, s);
        const ids = warned.bySpot.get(s.id)?.map((w) => idOf(w.warning.capId));
        return {
          ...s,
          shore_type: shoreType(s.id),
          ...(nearby.length && { nearby }),
          ...(ids && { warnings: ids }),
        };
      }),
      warnings,
    });
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

/**
 * The rider, for the wing size shown beside the stars (force5/src/stars.ts).
 * Neither moves a star. The `level` and `gusty` an agent may still send from
 * before 25 October 2026 are not in the schema: the server's zod object drops
 * unknown keys, so they are taken and ignored, never an error.
 */
const RIDER_ARGS = {
  weight_kg: z
    .number()
    .min(MIN_WEIGHT_KG)
    .max(MAX_WEIGHT_KG)
    .optional()
    .describe(
      "The rider's weight in kg (default: the site's estimate, 80 kg), for the wing size: a heavier rider needs a bigger wing. It never changes the stars.",
    ),
  wings_m2: z
    .array(z.number().min(MIN_WING_M2).max(MAX_WING_M2))
    .max(8)
    .optional()
    .describe(
      "Wing sizes the rider owns, m², to say which to take. Left out, a size is recommended. They never change the stars.",
    ),
};

const modelArg = (model: string | undefined): StarsFrom =>
  model ? leadFor(model) : DEFAULT_STARS_FROM;

export const getSpotForecast = tool({
  name: "get_spot_forecast",
  title: "Spot forecast",
  description:
    "Hour-by-hour forecast for one spot, each hour rated in stars (0-5) exactly as wingfoil.ie's spot page rates it (ours, the same for every rider: `rider.label` 'Ours · ~80 kg'), with why an hour has no stars, each day's best window and the winds the beach wants (`best_directions`): wind speed, gusts, gust factor and direction from one weather model, the one wingfoil.ie rates its stars from (HARMONIE while it reaches the hour, then ECMWF, unless `model` names another, which ECMWF then follows), with the range across every model and how well they agree as context, how the wind meets the shore (onshore to offshore), plus waves, air temperature and how cold it feels in the mean wind (`feels_like_c`, a wind chill), rain, a thunder and lightning risk (`thunder_risk`), the sky in words (`description` and `sky`, as wingfoil.ie's sky glyph has it; `weather_code` is WMO 4677), how light each hour is (`light`: day, twilight or dark), each day's first light, sunrise, sunset and last light, high and low tides and the latest sea temperature, Met Éireann's official warnings for the spot (`warnings`, and `warning` on each hour one covers: under orange or red the hour has no stars and is never rideable), and the EPA's bathing water notices near it (`water_quality`, and `water` on each hour one covers: under a prohibition or advice against bathing the hour has no stars). Rain is the weather model's own total over an interval (`rain_interval_hours`: an hour for ICON-EU, so each hourly row has its own hour's rain; three hours for GFS far ahead), given once on the row where its interval ends and null on any hours before it inside the interval, so add rain_mm up over the rows for a period's rain. Answer size: about 5–7 KB with one row (most of it the warnings in force, given whole), then about 0.75 KB a row, 1 KB with per_model: about 20 KB for the default 48 hours (16 rows), 45 KB for 240 hours at step_hours 6 and 190 KB at step_hours 1, so ask for the hours the question needs. explain adds about 7 KB.",
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
    ...RIDER_ARGS,
    ...EXPLAIN_ARG,
  },
  async run(args, deps) {
    const { spot, from, hours, step_hours, per_model, model } = args;
    const explain = args.explain ?? false;
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
      rider: riderOf(args),
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
    const {
      spot: where,
      window: span,
      units,
      hours: rows,
      warnings: warned,
      sources,
      method,
      ...rest
    } = forecast;
    const { note } = about;
    const nearby = nearbySpots(spots, match.spot);
    const { warnings, idOf } = answerWarnings(warned, explain);
    return answer({
      spot: where,
      window: span,
      ...(note && { note }),
      ...(nearby.length && { nearby }),
      ...rest,
      units: explain ? units : UNITS_BRIEF,
      hours: rows.map((row) =>
        row.warning
          ? {
              ...row,
              warning: { ...row.warning, ids: row.warning.ids.map(idOf) },
            }
          : row,
      ),
      warnings,
      sources: explain ? sources : briefSources(sources),
      ...(explain && { method }),
    });
  },
});

/** How find_wind finds its sessions, for explain. */
const FIND_METHOD =
  "Every hour is rated in stars for `rider` as wingfoil.ie's spot page rates it (force5/src/stars.ts rateHour, on the one model's wind, gust and direction), and counts when it earns min_stars or more and is inside min_kn/max_kn, max_gust_kn and max_gust_factor where given. A gust over the rider's limit (`rider.gust_limit_kn`) leaves an hour no stars, so it never counts. " +
  "Counting hours in a row make a session; a session's `stars` is its weakest hour's and `best_stars` its best, `gust_factor` its highest gust ÷ mean, as context. Each spot's `best_window` is the longest run at the highest stars any run reaches; spots rank by its stars, then by rideable_hours, then nearest. Sessions end by last light unless daylight_only is false. " +
  "Hours with the wind dead offshore are left out unless allow_offshore; a session's `shore` is its most offshore hour's, \"on-water\" at a spot on the water (where the offshore filter doesn't apply), null where a beach's facing is unknown. " +
  "Each session's agreement, confidence and models are the worst of its hours, as context. " +
  "An hour under a Met Éireann orange or red warning is never counted; a yellow one changes nothing but is listed in `warnings`. " +
  "Nor is an hour under a bathing water prohibition or advice against bathing; a prior warning changes nothing but is listed in `water_quality`. " +
  `${GUST_FACTOR_RULE}. ` +
  METHOD;

export const findWind = tool({
  name: "find_wind",
  title: "Find wind",
  description:
    "Rank spots by their stars, wingfoil.ie's own rating (ours, the same as each spot page's, `rider.label` 'Ours · ~80 kg'), on the one model the stars come from (HARMONIE, then ECMWF, unless `model` names another, which ECMWF then follows). Hours earning min_stars or more (default 1) make sessions, ended by last light; hours gusting over the rider's limit never count, nor hours blowing dead offshore, nor hours under a Met Éireann orange or red warning (`warnings` lists every warning in force at a searched spot during the window), nor hours under a bathing water prohibition or advice against bathing (`water_quality` lists every notice at a searched spot, with the spots it reaches). Each session gives its stars, gust factor and how the wind meets the shore, and each spot its best window. Use this for 'where should I go this weekend?'. Answer size: about 5 KB plus 2 KB a spot over 3 days, 3 KB over 10: about 20 KB for the default 8 spots and 72 hours, 100 KB for limit 30 over 240 hours. explain adds about 4 KB.",
  inputSchema: {
    min_stars: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "The fewest stars an hour must earn for the rider to count (default 1), on wingfoil.ie's own rating.",
      ),
    min_kn: z
      .number()
      .min(0)
      .max(60)
      .optional()
      .describe(
        "Also leave out hours whose mean wind is under this many knots (default: the stars decide).",
      ),
    max_kn: z
      .number()
      .min(0)
      .max(80)
      .optional()
      .describe(
        "Also leave out hours whose mean wind is over this many knots (default: the stars decide).",
      ),
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
        `Leave out hours whose gust is more than this many times the mean wind, e.g. 1.5. Under ${GUST_FACTOR_MIN_WIND_KN} kn of mean wind there is no gust factor, as on wingfoil.ie, so this lets those hours through; they earn no stars, so never count anyway.`,
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
    ...RIDER_ARGS,
    ...EXPLAIN_ARG,
  },
  async run(args, deps) {
    const minKnots = args.min_kn;
    const maxKnots = args.max_kn;
    if (minKnots !== undefined && maxKnots !== undefined && maxKnots < minKnots)
      return failure("max_kn must be at least min_kn.");
    if (
      minKnots !== undefined &&
      args.max_gust_kn !== undefined &&
      args.max_gust_kn < minKnots
    )
      return failure("max_gust_kn must be at least min_kn.");
    const rider = riderOf(args);
    const minStars = args.min_stars ?? 1;
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
      rider,
      minStars,
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
    const explain = args.explain ?? false;
    const { warnings, idOf } = answerWarnings(found.warnings, explain);
    return answer({
      window: {
        from: new Date(window.from).toISOString(),
        to: new Date(window.to).toISOString(),
      },
      ...(note && { note }),
      rider: riderUsed(rider),
      min_stars: minStars,
      ...((minKnots !== undefined || maxKnots !== undefined) && {
        wind_range_kn: [minKnots ?? null, maxKnots ?? null],
      }),
      ...(near && { near: { ...near.place, max_km: maxKm } }),
      ...(counties.length && { counties }),
      offshore_hours: args.allow_offshore ? "counted" : "left out",
      ...(args.max_gust_kn !== undefined && { max_gust_kn: args.max_gust_kn }),
      ...(args.max_gust_factor !== undefined && {
        max_gust_factor: args.max_gust_factor,
      }),
      searched_spots: found.searched,
      spots: found.spots.map((s) =>
        s.warnings ? { ...s, warnings: s.warnings.map(idOf) } : s,
      ),
      warnings,
      water_quality: found.water_quality,
      sources: explain ? found.sources : briefSources(found.sources),
      unavailable: found.unavailable,
      ...(explain && { method: FIND_METHOD }),
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
    "Which weather models are live on wingfoil.ie, when each run was made and how old it is, how far ahead it reaches, whether it is stale (older than that model's schedule allows: a once-a-day run on time is not), and its attribution and licence. Answer size: about 4 KB.",
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
