import { describe, expect, it } from "vitest";
import {
  ANDROID_APP,
  ASSISTANTS,
  ASSISTANT_NAME,
  CHATGPT_APPS,
  EXAMPLE_PROMPTS,
  LE_CHAT,
  PERPLEXITY_PLUGINS,
  addPlan,
  androidLink,
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  deviceOf,
  geminiConfig,
  grokLink,
  mcpUrl,
  pasteLine,
  type Device,
} from "./install";

const URL_ = "https://api.wingfoil.ie/api/mcp";

describe("mcpUrl", () => {
  it("uses the API's own origin when it has one, else this page's", () => {
    expect(mcpUrl("https://api.wingfoil.ie", "https://wingfoil.ie")).toBe(URL_);
    expect(mcpUrl("https://api.wingfoil.ie/", "https://wingfoil.ie")).toBe(
      URL_,
    );
    expect(mcpUrl("", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173/api/mcp",
    );
  });
});

describe("install links", () => {
  it("opens Claude's connector dialog with the name and URL filled in", () => {
    const link = new URL(claudeLink(URL_));
    expect(link.origin + link.pathname).toBe(
      "https://claude.ai/customize/connectors",
    );
    expect(Object.fromEntries(link.searchParams)).toEqual({
      modal: "add-custom-connector",
      connectorName: "wingfoil.ie",
      connectorUrl: URL_,
    });
  });

  it("writes the lines the phone app hands out for the command-line agents", () => {
    expect(claudeCodeCommand(URL_)).toBe(
      `claude mcp add --transport http wingfoil-ie ${URL_}`,
    );
    expect(codexConfig(URL_)).toBe(
      `[mcp_servers.wingfoil-ie]\nurl = "${URL_}"`,
    );
    expect(JSON.parse(geminiConfig(URL_))).toEqual({
      mcpServers: { "wingfoil-ie": { httpUrl: URL_ } },
    });
    expect(new Set(EXAMPLE_PROMPTS).size).toBe(EXAMPLE_PROMPTS.length);
  });
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const DEVICES: readonly Device[] = ["iphone", "android", "computer"];

/** The https address an Android intent opens, and the app it names. */
function fromIntent(link: string) {
  const match = link.match(
    /^intent:\/\/([^#]+)#Intent;scheme=https;package=([\w.]+);S\.browser_fallback_url=([^;]+);end$/,
  );
  if (!match) throw new Error(`not an intent: ${link}`);
  const [, address, app, fallback] = match;
  return {
    href: `https://${address}`,
    app,
    fallback: decodeURIComponent(fallback),
  };
}

describe("devices", () => {
  it("tells a phone from a computer, an iPad asking for the desktop site included", () => {
    expect(deviceOf(IPHONE, 5)).toBe("iphone");
    expect(deviceOf(ANDROID, 5)).toBe("android");
    expect(deviceOf(MAC, 0)).toBe("computer");
    expect(deviceOf(MAC, 5)).toBe("iphone");
    expect(deviceOf("")).toBe("computer");
  });

  it("names the Android app in an intent, with the same address to fall back on", () => {
    const link = androidLink(CHATGPT_APPS, "com.openai.chatgpt");
    expect(link).toBe(
      "intent://chatgpt.com/plugins#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fplugins;end",
    );
    // A query stays in the address, ahead of the intent's own part.
    const claude = fromIntent(
      androidLink(claudeLink(URL_), "com.anthropic.claude"),
    );
    expect(claude.href).toBe(claudeLink(URL_));
    expect(claude.fallback).toBe(claudeLink(URL_));
  });
});

describe("the assistants", () => {
  it("offers the apps that take the server, in the page's order", () => {
    expect(ASSISTANTS).toEqual([
      "chatgpt",
      "claude",
      "grok",
      "perplexity",
      "lechat",
    ]);
    expect(ASSISTANTS.map((a) => ASSISTANT_NAME[a])).toEqual([
      "ChatGPT",
      "Claude",
      "Grok",
      "Perplexity",
      "Le Chat",
    ]);
  });

  it("names an Android app only where its maker's files hand it the links", () => {
    expect(ANDROID_APP).toEqual({
      chatgpt: "com.openai.chatgpt",
      claude: "com.anthropic.claude",
      grok: "ai.x.grok",
      perplexity: "ai.perplexity.app.android",
    });
  });
});

describe("adding to an app", () => {
  it("has a way to add the server for every app, on every device", () => {
    for (const a of ASSISTANTS)
      for (const device of DEVICES)
        expect(addPlan(a, device, URL_).href).toMatch(/^(https|intent):\/\//);
  });

  it("fills Claude's dialog in, on a phone as on a computer", () => {
    for (const device of ["iphone", "computer"] as const) {
      expect(addPlan("claude", device, URL_)).toEqual({
        href: claudeLink(URL_),
        copies: false,
      });
    }
    expect(fromIntent(addPlan("claude", "android", URL_).href)).toEqual({
      href: claudeLink(URL_),
      app: "com.anthropic.claude",
      fallback: claudeLink(URL_),
    });
  });

  it("copies the address for every app that cannot be handed it", () => {
    for (const device of DEVICES)
      for (const a of ["chatgpt", "grok", "perplexity", "lechat"] as const)
        expect(addPlan(a, device, URL_).copies).toBe(true);
    expect(grokLink()).toBe("https://grok.com/connectors");
    expect(addPlan("grok", "iphone", URL_).href).toBe(grokLink());
    expect(fromIntent(addPlan("grok", "android", URL_).href).app).toBe(
      "ai.x.grok",
    );
  });

  it("opens ChatGPT's plugins, in the app on Android", () => {
    expect(CHATGPT_APPS).toBe("https://chatgpt.com/plugins");
    expect(addPlan("chatgpt", "computer", URL_).href).toBe(CHATGPT_APPS);
    expect(addPlan("chatgpt", "iphone", URL_).href).toBe(CHATGPT_APPS);
    expect(fromIntent(addPlan("chatgpt", "android", URL_).href)).toEqual({
      href: CHATGPT_APPS,
      app: "com.openai.chatgpt",
      fallback: CHATGPT_APPS,
    });
  });

  it("opens Perplexity's plugins and Le Chat on the web, on any device", () => {
    expect(PERPLEXITY_PLUGINS).toBe(
      "https://www.perplexity.ai/computer/plugins",
    );
    for (const device of DEVICES) {
      expect(addPlan("perplexity", device, URL_).href).toBe(PERPLEXITY_PLUGINS);
      expect(addPlan("lechat", device, URL_).href).toBe(LE_CHAT);
    }
  });

  it("says the address is copied and where to paste it", () => {
    expect(pasteLine("ChatGPT")).toBe("Address copied. Paste it in ChatGPT.");
    expect(pasteLine("Le Chat")).toBe("Address copied. Paste it in Le Chat.");
    expect(pasteLine()).toBe("Address copied. Paste it in your app.");
  });
});
