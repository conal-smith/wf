/**
 * How each AI client adds the wingfoil.ie MCP server, and how a question is
 * handed to it: a one-click link where the client has one, the lines to paste
 * where it does not. Pure, so the links are tested rather than eyeballed.
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

/* ---------------------------------------------------------- assistants */

/** The chat apps a rider asks, in the order the page offers them. */
export const ASSISTANTS = ["claude", "chatgpt", "grok"] as const;
export type Assistant = (typeof ASSISTANTS)[number];

export const ASSISTANT_NAME: Record<Assistant, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  grok: "Grok",
};

export function isAssistant(value: unknown): value is Assistant {
  return ASSISTANTS.includes(value as Assistant);
}

/**
 * Claude's custom-connector dialog, opened with the name and URL filled in
 * (Anthropic documents these parameters); the rider confirms with Add.
 * claude.ai's apple-app-site-association claims this path with
 * `modal=add-custom-connector` for the iPhone app, so there it opens the app.
 */
export function claudeLink(url: string): string {
  const query = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: DISPLAY_NAME,
    connectorUrl: url,
  });
  return `https://claude.ai/customize/connectors?${query}`;
}

/**
 * Where ChatGPT adds a custom MCP server: + then "Add custom MCP server". It
 * is web only, and nothing fills the address in, so the page copies it first.
 */
export const CHATGPT_APPS = "https://chatgpt.com/plugins";

/**
 * Grok's connectors (docs.x.ai/grok/connectors): New Connector, Custom, then
 * the URL. Nothing fills the address in, so the page copies it first.
 * grok.com's association files hand every path but a few to the Grok app,
 * on an iPhone and on Android alike, this one included.
 */
export function grokLink(): string {
  return "https://grok.com/connectors";
}

/**
 * A new chat with the question in it. Each app's association files claim
 * these for the phone app (claude.ai `/new`, chatgpt.com `/?q=`, grok.com
 * everything), so on a phone the question lands in the app.
 *
 * ChatGPT asks it straight away. Claude's and Grok's `q` are not documented
 * and not always honoured, so the page copies the question as it goes
 * (`askSends`).
 */
export function askLink(assistant: Assistant, prompt: string): string {
  const q = new URLSearchParams({ q: prompt });
  switch (assistant) {
    case "claude":
      return `https://claude.ai/new?${q}`;
    case "chatgpt":
      return `https://chatgpt.com/?${q}`;
    case "grok":
      return `https://grok.com/?${q}`;
  }
}

/** Whether the app is known to ask the question it is opened with. */
export const askSends = (assistant: Assistant) => assistant === "chatgpt";

/* -------------------------------------------------------------- devices */

export type Device = "iphone" | "android" | "computer";

/**
 * What the page is open on, from the user agent and whether the screen is
 * touched: an iPad that asks for the desktop site says Macintosh, and only
 * its touch screen gives it away.
 */
export function deviceOf(userAgent: string, touchPoints = 0): Device {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iphone";
  if (/Macintosh/i.test(userAgent) && touchPoints > 1) return "iphone";
  return "computer";
}

/** How one assistant takes the server on one device. */
export interface AddPlan {
  /** Where the button goes; none where there is nowhere useful to go. */
  href?: string;
  /** The button's words. */
  label: string;
  /** Copy the address before going, for the app to paste. */
  copies: boolean;
  /** One line under the button: what happens, and what is left to do. */
  note: string;
  /** The line once the address is copied: that it is, and what is left. */
  copiedNote?: string;
}

/** Where ChatGPT hides custom servers until they are asked for. */
const CHATGPT_DEVELOPER_MODE =
  "No such option? First open Settings → Security and turn on Developer mode.";

export function addPlan(
  assistant: Assistant,
  device: Device,
  url: string,
): AddPlan {
  const phone = device !== "computer";
  switch (assistant) {
    case "claude":
      return {
        href: claudeLink(url),
        label: "Add to Claude",
        copies: false,
        note: phone
          ? "Opens Claude with wingfoil.ie filled in. Tap Add."
          : "Opens Claude with wingfoil.ie filled in. Click Add, and it is in Claude on your phone too.",
      };
    case "chatgpt":
      // ChatGPT takes a custom server on the web only.
      return phone
        ? {
            label: "Copy the address",
            copies: true,
            note: "ChatGPT adds a server on a computer only: at chatgpt.com/plugins, press +, then Add custom MCP server. Once added it is in the app too.",
            copiedNote:
              "Address copied. ChatGPT adds a server on a computer only: at chatgpt.com/plugins, press +, then Add custom MCP server, and paste it. Once added it is in the app too.",
          }
        : {
            href: CHATGPT_APPS,
            label: "Add to ChatGPT",
            copies: true,
            note: `Copies the address and opens ChatGPT: press +, then Add custom MCP server, paste it, and choose No authentication. ${CHATGPT_DEVELOPER_MODE}`,
            copiedNote: `Address copied. In ChatGPT, press +, then Add custom MCP server, paste it, and choose No authentication. ${CHATGPT_DEVELOPER_MODE}`,
          };
    case "grok":
      return {
        href: grokLink(),
        label: "Add to Grok",
        copies: true,
        note: "Copies the address and opens Grok's connectors: New Connector, Custom, then paste it.",
        copiedNote:
          "Address copied. In Grok's connectors: New Connector, Custom, then paste it.",
      };
  }
}

/* ------------------------------------------------- editors and terminals */

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

/**
 * Things worth asking, which exercise each tool the server offers. The first
 * is the page's subheading: the question the whole thing is for.
 */
export const EXAMPLE_PROMPTS: readonly string[] = [
  "When's the next good session after work near me?",
  "Where's the best wing foiling in Ireland this Saturday, in daylight?",
  "Is Brandon Bay worth the drive tomorrow afternoon? Do the models agree?",
  "What's the tide doing at Dollymount when the wind picks up?",
];
