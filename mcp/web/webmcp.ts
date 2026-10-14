/**
 * wingfoil.ie over WebMCP: the forecast tools of the MCP server, offered by
 * the page itself to an agent working in the visitor's browser
 * (https://webmachinelearning.github.io/webmcp/).
 *
 * The forecast tools are the server's own (mcp/api/tools.ts), run here on the
 * same reader the spot page uses (shared/web/forecastSource.ts), so an agent in
 * the tab and one calling /api/mcp are given the same answers. Two more only
 * make sense in a browser: which spots this visitor is looking at and has
 * starred, and opening a spot in the tab.
 *
 * src/main.tsx loads this module only where the browser has a model context,
 * so nobody else downloads it or zod.
 */
import { z } from "zod";
import { findSpot, loadSpots, type RidingSpot } from "../api/forecast";
import type { ForecastSource } from "../api/httpSource";
import {
  CARE,
  FORECAST_TOOLS,
  type ForecastTool,
  type ToolDeps,
} from "../api/tools";
import {
  mapSpotHref,
  spotHref,
  spotIdFromPath,
} from "../../force5/src/siteNav";
import { favourites, type FavouritesStore } from "../../shared/web/favourites";
import { siteSource } from "../../shared/web/forecastSource";

/** A tool as `registerTool` takes it. */
export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  execute(input: unknown): Promise<unknown>;
  annotations: { readOnlyHint: boolean };
}

/**
 * The part of `document.modelContext` this module uses. Chrome's first preview
 * hung it on `navigator`, returned a handle with `unregister()` and had an
 * `unregisterTool(name)`; the draft takes an AbortSignal instead. Both work.
 */
export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
}

export function modelContext(
  doc: object = document,
  nav: object = navigator,
): ModelContextLike | undefined {
  for (const host of [doc, nav]) {
    const context = (host as { modelContext?: ModelContextLike }).modelContext;
    if (context && typeof context.registerTool === "function") return context;
  }
  return undefined;
}

/** What the page tells the agent about where the visitor is. */
export interface PageDeps extends ToolDeps {
  location: Pick<Location, "pathname" | "search">;
  favourites: Pick<FavouritesStore, "get" | "frequent">;
  /** Called once the tool has answered, so the answer is not lost to the unload. */
  navigate: (href: string) => void;
}

const READ_ONLY = { readOnlyHint: true } as const;

/** WebMCP has no instructions, so the forecast's care goes with the forecast. */
const CARED_FOR = new Set(["get_spot_forecast", "find_wind"]);

/**
 * A shared forecast tool as WebMCP takes it: its arguments as JSON Schema,
 * checked again here because a page cannot trust its caller to have, and a
 * failure answered as `{ error }` rather than thrown, so the agent reads why.
 */
export function webTool(tool: ForecastTool, deps: ToolDeps): WebMcpTool {
  const args = z.object(tool.inputSchema);
  return {
    name: tool.name,
    title: tool.title,
    description: CARED_FOR.has(tool.name)
      ? `${tool.description} ${CARE}`
      : tool.description,
    inputSchema: z.toJSONSchema(args),
    annotations: READ_ONLY,
    async execute(input) {
      const parsed = args.safeParse(input ?? {});
      if (!parsed.success) return { error: z.prettifyError(parsed.error) };
      const outcome = await tool.run(parsed.data, deps);
      return outcome.ok ? outcome.value : { error: outcome.message };
    },
  };
}

/** The spot a visitor's page or map link is on, if either names one. */
export function viewingId(location: PageDeps["location"]): string | null {
  return (
    spotIdFromPath(location.pathname) ??
    new URLSearchParams(location.search).get("spot")
  );
}

/** The two tools only a page can offer. */
export function pageTools(deps: PageDeps): WebMcpTool[] {
  const mySpots = z.object({});
  const openSpot = z.object({
    spot: z
      .string()
      .min(1)
      .max(80)
      .describe(
        "Spot id, name or part of a name, e.g. 'dollymount' or 'Brandon Bay'.",
      ),
    view: z
      .enum(["page", "map"])
      .optional()
      .describe(
        "'page' for the spot's own forecast page (default), 'map' for the wind map centred on it.",
      ),
  });

  return [
    {
      name: "my_spots",
      title: "This visitor's spots",
      description:
        "The spot this visitor has open in the tab, if any, the spots they have starred, and the ones they open most, as kept on this device. Use it to answer 'my spot' or 'my usual spots' without asking.",
      inputSchema: z.toJSONSchema(mySpots),
      annotations: READ_ONLY,
      async execute(input) {
        const parsed = mySpots.safeParse(input ?? {});
        if (!parsed.success) return { error: z.prettifyError(parsed.error) };
        const spots = await loadSpots(deps.source);
        const byId = new Map(spots.map((s) => [s.id, s] as const));
        const known = (ids: Iterable<string>) =>
          [...ids].flatMap((id) => byId.get(id) ?? []);
        const viewing = viewingId(deps.location);
        return {
          viewing: (viewing && byId.get(viewing)) ?? null,
          starred: known(deps.favourites.get().starred),
          frequent: known(deps.favourites.frequent().map((v) => v.id)),
        };
      },
    },
    {
      name: "open_spot",
      title: "Open a spot",
      description:
        "Show a spot in this tab: its own forecast page, or the wind map centred on it. The page reloads, so answer the visitor first if you have more to say.",
      inputSchema: z.toJSONSchema(openSpot),
      annotations: { readOnlyHint: false },
      async execute(input) {
        const parsed = openSpot.safeParse(input ?? {});
        if (!parsed.success) return { error: z.prettifyError(parsed.error) };
        const { spot, view = "page" } = parsed.data;
        const match = findSpot(await loadSpots(deps.source), spot);
        if (!match.spot)
          return {
            error: match.candidates.length
              ? `"${spot}" could be any of: ${match.candidates.map(describe).join("; ")}. Ask which, then call again with its id.`
              : `No spot matches "${spot}". Call list_spots to see them all.`,
          };
        const href =
          view === "map" ? mapSpotHref(match.spot.id) : spotHref(match.spot.id);
        deps.navigate(href);
        return { opened: href, spot: match.spot };
      },
    },
  ];
}

const describe = (s: RidingSpot) => `${s.name} (${s.county}, id ${s.id})`;

export function webTools(deps: PageDeps): WebMcpTool[] {
  return [
    ...FORECAST_TOOLS.map((tool) => webTool(tool as ForecastTool, deps)),
    ...pageTools(deps),
  ];
}

/**
 * Registers every tool with the context; the returned function takes them
 * back. A tool the browser refuses (a name taken, a policy) is passed over so
 * the others still register.
 */
export function registerTools(
  context: ModelContextLike,
  tools: readonly WebMcpTool[],
): () => void {
  const controller = new AbortController();
  const handles: unknown[] = [];
  for (const tool of tools) {
    try {
      const handle = context.registerTool(tool, { signal: controller.signal });
      handles.push(handle);
      if (handle instanceof Promise) handle.catch(() => {});
    } catch {
      // Refused: the rest still go.
    }
  }
  return () => {
    controller.abort();
    for (const handle of handles)
      if (handle && typeof handle === "object" && "unregister" in handle)
        (handle as { unregister(): void }).unregister();
    if (context.unregisterTool)
      for (const tool of tools)
        try {
          context.unregisterTool(tool.name);
        } catch {
          // Already gone.
        }
  };
}

let source: ForecastSource | null = null;

/** Offers the site's tools to the browser's agent, if it has one. */
export function startWebMcp(): (() => void) | undefined {
  const context = modelContext();
  if (!context) return undefined;
  return registerTools(
    context,
    webTools({
      source: (source ??= siteSource()),
      location: window.location,
      favourites: favourites(),
      // After the answer has gone back, not before: the unload would drop it.
      navigate: (href) => setTimeout(() => window.location.assign(href), 0),
    }),
  );
}
