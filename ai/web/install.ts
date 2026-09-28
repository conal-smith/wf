/**
 * How each AI client adds the wingfoil.ie MCP server: a one-click link where
 * the client has one, the lines to paste where it does not. Pure, so the
 * links are tested rather than eyeballed.
 *
 * The server (mcp/api/server.ts) is public and read-only over Streamable HTTP,
 * with no sign-in, so every client needs only its URL.
 */
export const SERVER_NAME = "wingfoil-ie";
export const DISPLAY_NAME = "wingfoil.ie";

/** The endpoint: the API's origin in production, this page's own in development. */
export function mcpUrl(apiRoot: string, origin: string): string {
  return `${(apiRoot || origin).replace(/\/$/, "")}/api/mcp`;
}

/** Claude's custom-connector dialog, opened with the name and URL filled in. */
export function claudeLink(url: string): string {
  const query = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: DISPLAY_NAME,
    connectorUrl: url,
  });
  return `https://claude.ai/customize/connectors?${query}`;
}

/** Cursor's install deeplink: the server's config as base64 JSON. */
export function cursorLink(url: string): string {
  const config = btoa(JSON.stringify({ url }));
  const query = new URLSearchParams({ name: SERVER_NAME, config });
  return `cursor://anysphere.cursor-deeplink/mcp/install?${query}`;
}

/** VS Code's install link: the server's config as URL-encoded JSON. */
export function vscodeLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: SERVER_NAME, type: "http", url }),
  )}`;
}

export const claudeCodeCommand = (url: string) =>
  `claude mcp add --transport http ${SERVER_NAME} ${url}`;

/** ~/.codex/config.toml */
export const codexConfig = (url: string) =>
  `[mcp_servers.${SERVER_NAME}]\nurl = "${url}"`;

/** ~/.gemini/settings.json */
export const geminiConfig = (url: string) =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { httpUrl: url } } }, null, 2);

/** Things worth asking, which exercise each tool the server offers. */
export const EXAMPLE_PROMPTS: readonly string[] = [
  "Where's the best wing foiling in Ireland this Saturday, in daylight, 15 to 25 knots?",
  "Is it worth driving to Brandon Bay tomorrow afternoon? Do the models agree?",
  "When is the next good session at Dollymount, and what's the tide doing then?",
];
