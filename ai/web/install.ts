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

/**
 * The address in pieces that each end at a slash, for a narrow screen to
 * break between: "…/api/mc" over "p" reads as a wrong address.
 */
export function addressParts(url: string): string[] {
  return url.split(/(?<=\/)(?!\/)/);
}

/* ---------------------------------------------------------- assistants */

/**
 * The chat apps a rider asks, in the order the page offers them: the ones
 * that take a custom MCP server first, then the ones that can only be asked.
 * Which links each one honours was read from its own association files and
 * docs in October 2026 (GitHub issues 116 and 117). None of it is promised
 * by its maker, so it is worth checking again each quarter.
 *
 * DeepSeek is left out: it has no question link and no app link, so a tile
 * would only open a website.
 */
export const ASSISTANTS = [
  "chatgpt",
  "claude",
  "grok",
  "perplexity",
  "lechat",
  "meta",
  "gemini",
  "copilot",
] as const;
export type Assistant = (typeof ASSISTANTS)[number];

export const ASSISTANT_NAME: Record<Assistant, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  grok: "Grok",
  perplexity: "Perplexity",
  lechat: "Le Chat",
  meta: "Meta AI",
  gemini: "Gemini",
  copilot: "Copilot",
};

export function isAssistant(value: unknown): value is Assistant {
  return ASSISTANTS.includes(value as Assistant);
}

/**
 * The apps that take a custom MCP server, and so can read wingfoil.ie. The
 * rest can be asked, but answer without the forecast: Gemini's custom apps
 * are US-only, and Meta AI and Copilot take none.
 */
const TAKES_SERVER: ReadonlySet<Assistant> = new Set([
  "chatgpt",
  "claude",
  "grok",
  "perplexity",
  "lechat",
]);
export const takesServer = (assistant: Assistant) =>
  TAKES_SERVER.has(assistant);

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
 * Connectors page but gives that page no address, so the page opens Le Chat
 * and says where to go. Its iPhone app does not claim the root.
 */
export const LE_CHAT = "https://chat.mistral.ai/";

/** How one assistant takes the server on one device. */
export interface AddPlan {
  /** Where the button goes: the assistant's own app where it can be. */
  href: string;
  /** Copy the address before going, for the app to paste. */
  copies: boolean;
  /** The few words on the tile: the one thing to know before pressing. */
  brief: string;
  /** One line under the tiles: what happens, and what is left to do. */
  note: string;
  /** The line once the address is copied: that it is, and what is left. */
  copiedNote?: string;
}

/**
 * ChatGPT gates custom servers by plan, and moves where it puts them, so the
 * page says what to do when the option is not there rather than naming a
 * setting that may not exist.
 */
const CHATGPT_PLAN =
  "If you don't see Add custom MCP server, your plan may not include it.";

/** How an assistant that takes the server is given it, or none for the rest. */
export function addPlan(
  assistant: Assistant,
  device: Device,
  url: string,
): AddPlan | undefined {
  const phone = device !== "computer";
  switch (assistant) {
    case "claude":
      return {
        href: inApp(claudeLink(url), assistant, device),
        copies: false,
        brief: "Filled in for you",
        note: phone
          ? "Opens Claude with wingfoil.ie filled in. Tap Add."
          : "Opens Claude with wingfoil.ie filled in. Click Add, and it is in Claude on your phone too.",
      };
    case "chatgpt":
      // OpenAI documents custom servers on the web only. A phone still
      // opens the app's plugins, but says where it can be done for sure.
      return phone
        ? {
            href: inApp(CHATGPT_APPS, assistant, device),
            copies: true,
            brief: "Best on a computer",
            note: "Copies the address and opens ChatGPT's plugins. The phone app may not show custom servers: if not, add it on a computer at chatgpt.com/plugins, press +, then Add custom MCP server.",
            copiedNote: `Address copied. The phone app may not show custom servers: if not, add it on a computer at chatgpt.com/plugins, press +, then Add custom MCP server, and paste it. ${CHATGPT_PLAN}`,
          }
        : {
            href: CHATGPT_APPS,
            copies: true,
            brief: "On some plans",
            note: `Copies the address and opens ChatGPT's plugins: press +, then Add custom MCP server, paste it, and choose No authentication. ${CHATGPT_PLAN}`,
            copiedNote: `Address copied. In ChatGPT's plugins, press +, then Add custom MCP server, paste it, and choose No authentication. ${CHATGPT_PLAN}`,
          };
    case "grok":
      return {
        href: inApp(grokLink(), assistant, device),
        copies: true,
        brief: "Paste the address",
        note: "Copies the address and opens Grok's connectors: New Connector, Custom, then paste it.",
        copiedNote:
          "Address copied. In Grok's connectors: New Connector, Custom, then paste it.",
      };
    case "perplexity":
      return {
        href: PERPLEXITY_PLUGINS,
        copies: true,
        brief: "Pro and Max plans",
        note: "Copies the address and opens Perplexity's plugins: Add custom, Connector, Add MCP connector, then Remote. Paste it and choose None for authentication.",
        copiedNote:
          "Address copied. In Perplexity's plugins: Add custom, Connector, Add MCP connector, then Remote. Paste it and choose None for authentication.",
      };
    case "lechat":
      return {
        href: LE_CHAT,
        copies: true,
        brief: "Paste the address",
        note: "Copies the address and opens Le Chat: under Context, open Connectors, then Add Connector and Custom MCP Connector. Name it wingfoil and paste it.",
        copiedNote:
          "Address copied. In Le Chat, under Context, open Connectors, then Add Connector and Custom MCP Connector. Name it wingfoil and paste it.",
      };
    case "meta":
    case "gemini":
    case "copilot":
      return undefined;
  }
}

/* -------------------------------------------------------------- asking */

/**
 * What an app does with the question it is opened with:
 * - `asks`: asks it straight away (ChatGPT's `q`, Perplexity's search);
 * - `types`: types it in for the rider to send (Claude's `q`, which
 *   Anthropic documents for its desktop app; the web and phone apps are
 *   taken on trust, so it is copied as well);
 * - `mayAsk`: Grok's `q`, reported to ask straight away, which we have not
 *   seen for ourselves; copied as well, in case it is only typed in, or not;
 * - `paste`: no question link known to work (Le Chat's, Meta AI's, Gemini's
 *   and Copilot's are unverified or reported broken), so the app is opened
 *   and the question copied for the rider to paste.
 */
export type Asking = "asks" | "types" | "mayAsk" | "paste";

export const ASKING: Record<Assistant, Asking> = {
  chatgpt: "asks",
  claude: "types",
  grok: "mayAsk",
  perplexity: "asks",
  lechat: "paste",
  meta: "paste",
  gemini: "paste",
  copilot: "paste",
};

/** Whether the app is known to ask the question it is opened with. */
export const askSends = (assistant: Assistant) => ASKING[assistant] === "asks";

/**
 * A new chat with the question in it, or the app's new chat where no link
 * carries the question. The ones that carry it are claimed by the phone app
 * (claude.ai `/new`, chatgpt.com `/?q=`, grok.com everything, perplexity.ai
 * `/search`), so on a phone the question lands in the app.
 */
export function askLink(
  assistant: Assistant,
  prompt: string,
  device: Device = "computer",
): string {
  const q = new URLSearchParams({ q: prompt });
  const link = (href: string) => inApp(href, assistant, device);
  switch (assistant) {
    case "chatgpt":
      return link(`https://chatgpt.com/?${q}`);
    case "claude":
      return link(`https://claude.ai/new?${q}`);
    case "grok":
      return link(`https://grok.com/?${q}`);
    case "perplexity":
      return link(`https://www.perplexity.ai/search?${q}`);
    case "lechat":
      return "https://chat.mistral.ai/chat";
    case "meta":
      return "https://www.meta.ai/";
    case "gemini":
      return "https://gemini.google.com/app";
    case "copilot":
      return "https://copilot.microsoft.com/";
  }
}

/** The line under the questions: what opening one does in this app. */
export function askNote(assistant: Assistant): string {
  const name = ASSISTANT_NAME[assistant];
  const copied =
    "It is copied as it goes too: if it is not typed in, paste it.";
  const live = takesServer(assistant)
    ? ""
    : ` ${name} can't read wingfoil.ie's live data, so it answers without the forecast.`;
  switch (ASKING[assistant]) {
    case "asks":
      return `Each opens in ${name} and asks it.`;
    case "types":
      return `Each opens in ${name} with the question typed in, for you to send. ${copied}`;
    case "mayAsk":
      return `Each opens in ${name}, which may ask it straight away. ${copied}`;
    case "paste":
      return `Each is copied and opens ${name}: paste it in.${live}`;
  }
}

/** The few words on an app's tile that cannot read wingfoil.ie. */
export const NO_LIVE_DATA = "Can't read wingfoil.ie's live data";

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
