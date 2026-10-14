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
import {
  FORECAST_TOOLS,
  INSTRUCTIONS,
  type ForecastTool,
  type ToolDeps,
} from "./tools.js";

export { INSTRUCTIONS };

export const MCP_SERVER_NAME = "wingfoil-ie";
export const MCP_SERVER_TITLE = "wingfoil.ie wind forecast";

export type McpDeps = ToolDeps;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function register(server: McpServer, tool: ForecastTool, deps: McpDeps) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: READ_ONLY,
    },
    async (args) => {
      const outcome = await tool.run(args, deps);
      return outcome.ok
        ? {
            content: [
              { type: "text" as const, text: JSON.stringify(outcome.value) },
            ],
          }
        : {
            content: [{ type: "text" as const, text: outcome.message }],
            isError: true,
          };
    },
  );
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of FORECAST_TOOLS)
    register(server, tool as ForecastTool, deps);
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
