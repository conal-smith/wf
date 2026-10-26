/**
 * How each AI app adds the wingfoil.ie MCP server: a link that opens it with
 * the address filled in where the app has one, else the address copied and
 * the app's own page for it opened. Pure, so the links are tested rather than
 * eyeballed.
 *
 * The server (mcp/api/server.ts) is public and read-only over Streamable HTTP,
 * with no sign-in, so every app needs only its URL.
 */
export const SERVER_NAME = "wingfoil-ie";
export const DISPLAY_NAME = "wingfoil.ie";

/** The endpoint: the API's origin in production, this page's own in development. */
export function mcpUrl(apiRoot: string, origin: string): string {
  return `${(apiRoot || origin).replace(/\/$/, "")}/api/mcp`;
}

/* ---------------------------------------------------------- assistants */

/**
 * The chat apps that take a custom MCP server, in the order the page offers
 * them. Which links each one honours was read from its own association files
 * and docs in October 2026 (GitHub issues 116 and 117). None of it is
 * promised by its maker, so it is worth checking again each quarter.
 *
 * Meta AI and Copilot take no custom server and Gemini's custom apps are
 * US-only, so the page leaves them out. DeepSeek has no app link to offer.
 */
export const ASSISTANTS = [
  "chatgpt",
  "claude",
  "grok",
  "perplexity",
  "lechat",
] as const;
export type Assistant = (typeof ASSISTANTS)[number];

export const ASSISTANT_NAME: Record<Assistant, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  grok: "Grok",
  perplexity: "Perplexity",
  lechat: "Le Chat",
};

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

/**
 * The Android apps, by package, for the links their makers' association
 * files hand to them. Chrome on Android opens an https link in the browser
 * as often as in the app, so there the link names the app outright.
 */
export const ANDROID_APP: Partial<Record<Assistant, string>> = {
  chatgpt: "com.openai.chatgpt",
  claude: "com.anthropic.claude",
  grok: "ai.x.grok",
  perplexity: "ai.perplexity.app.android",
};

/**
 * An https link as an Android intent for one app: Chrome opens the app at
 * the same address, or the address itself where the app is not installed.
 * An iPhone needs nothing of the kind: the app claims the https link itself,
 * where a custom scheme (`chatgpt://`) is undocumented and comes and goes.
 */
export function androidLink(href: string, app: string): string {
  const { host, pathname, search } = new URL(href);
  const fallback = encodeURIComponent(href);
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=${app};S.browser_fallback_url=${fallback};end`;
}

/** The link that opens the assistant's own app on this device, where it has one. */
function inApp(href: string, assistant: Assistant, device: Device): string {
  const app = ANDROID_APP[assistant];
  return device === "android" && app ? androidLink(href, app) : href;
}

/* -------------------------------------------------------------- adding */

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
 * Where ChatGPT adds a custom MCP server: + then "Add custom MCP server".
 * OpenAI documents it on the web only, and nothing fills the address in, so
 * the page copies it first. The iPhone app claims the path, so a phone opens
 * the app, which may not offer custom servers at all.
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
 * Perplexity's plugins, where its help centre adds a custom remote connector
 * (Pro and Max). Its iPhone app does not claim the path, so it opens on the
 * web, which is where the help centre adds one.
 */
export const PERPLEXITY_PLUGINS = "https://www.perplexity.ai/computer/plugins";

/**
 * Le Chat. Mistral documents adding a custom MCP connector from its
 * Connectors page (under Context) but gives that page no address, so the
 * page opens Le Chat. Its iPhone app does not claim the root.
 */
export const LE_CHAT = "https://chat.mistral.ai/";

/** How one assistant takes the server on one device. */
export interface AddPlan {
  /** Where the button goes: the assistant's own app where it can be. */
  href: string;
  /** Copy the address before going, for the app to paste. */
  copies: boolean;
}

/** How an assistant is given the server, on this device. */
export function addPlan(
  assistant: Assistant,
  device: Device,
  url: string,
): AddPlan {
  switch (assistant) {
    case "claude":
      return { href: inApp(claudeLink(url), assistant, device), copies: false };
    case "chatgpt":
      return { href: inApp(CHATGPT_APPS, assistant, device), copies: true };
    case "grok":
      return { href: inApp(grokLink(), assistant, device), copies: true };
    case "perplexity":
      return { href: PERPLEXITY_PLUGINS, copies: true };
    case "lechat":
      return { href: LE_CHAT, copies: true };
  }
}

/**
 * The one line under a button once it has copied the address: what is left
 * to do. `app` is the app's name, or none for an app the page does not name.
 */
export function pasteLine(app?: string): string {
  return `Address copied. Paste it in ${app ?? "your app"}.`;
}

/* ------------------------------------------------- the phone app's lines */

/*
 * What the phone app's AI screen hands out besides
 * (mobile/src/features/settings/settingsLogic.ts): the lines a coding agent
 * takes, and questions worth asking. The web page shows none of them.
 */

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
  "When's the next good session after work near me?",
  "Where's the best wing foiling in Ireland this Saturday, in daylight?",
  "Is Brandon Bay worth the drive tomorrow afternoon? Do the models agree?",
  "What's the tide doing at Dollymount when the wind picks up?",
];
