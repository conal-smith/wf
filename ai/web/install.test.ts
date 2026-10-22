import { describe, expect, it } from "vitest";
import {
  ANDROID_APP,
  ASKING,
  ASSISTANTS,
  CHATGPT_APPS,
  EXAMPLE_PROMPTS,
  LE_CHAT,
  PERPLEXITY_PLUGINS,
  addPlan,
  addressParts,
  androidLink,
  askLink,
  askNote,
  askSends,
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  cursorLink,
  deviceOf,
  geminiConfig,
  grokLink,
  isAssistant,
  mcpUrl,
  takesServer,
  vscodeLink,
  type Assistant,
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

  it("breaks the address only after a slash", () => {
    expect(addressParts(URL_)).toEqual([
      "https://",
      "api.wingfoil.ie/",
      "api/",
      "mcp",
    ]);
    expect(addressParts(URL_).join("")).toBe(URL_);
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

  it("gives Cursor its config as base64 JSON", () => {
    const link = new URL(cursorLink(URL_));
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("wingfoil-ie");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({
      url: URL_,
    });
  });

  it("gives VS Code its config as URL-encoded JSON", () => {
    const link = vscodeLink(URL_);
    expect(link.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.split("?")[1]))).toEqual({
      name: "wingfoil-ie",
      type: "http",
      url: URL_,
    });
  });

  it("writes the lines to paste for the command-line agents", () => {
    expect(claudeCodeCommand(URL_)).toBe(
      `claude mcp add --transport http wingfoil-ie ${URL_}`,
    );
    expect(codexConfig(URL_)).toBe(
      `[mcp_servers.wingfoil-ie]\nurl = "${URL_}"`,
    );
    expect(JSON.parse(geminiConfig(URL_))).toEqual({
      mcpServers: { "wingfoil-ie": { httpUrl: URL_ } },
    });
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
  it("offers the apps that take the server first, then the ones that can only be asked", () => {
    expect(ASSISTANTS).toEqual([
      "chatgpt",
      "claude",
      "grok",
      "perplexity",
      "lechat",
      "meta",
      "gemini",
      "copilot",
    ]);
    const takes = ASSISTANTS.map(takesServer);
    expect(takes.indexOf(false)).toBe(5);
    expect(takes.slice(5).every((t) => !t)).toBe(true);
    expect(isAssistant("grok")).toBe(true);
    expect(isAssistant("deepseek")).toBe(false);
    expect(isAssistant(null)).toBe(false);
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

describe("asking", () => {
  const prompt = "When's the next good session after work near me?";
  const at = (link: string) => {
    const u = new URL(link);
    return [u.origin + u.pathname, u.searchParams.get("q")];
  };

  it("opens a new chat with the question typed in, where a link is known to carry it", () => {
    expect(at(askLink("claude", prompt))).toEqual([
      "https://claude.ai/new",
      prompt,
    ]);
    expect(at(askLink("chatgpt", prompt))).toEqual([
      "https://chatgpt.com/",
      prompt,
    ]);
    expect(at(askLink("grok", prompt))).toEqual(["https://grok.com/", prompt]);
    expect(at(askLink("perplexity", prompt))).toEqual([
      "https://www.perplexity.ai/search",
      prompt,
    ]);
  });

  it("opens the others' new chat with no question in the link, to paste it", () => {
    const paste = ASSISTANTS.filter((a) => ASKING[a] === "paste");
    expect(paste).toEqual(["lechat", "meta", "gemini", "copilot"]);
    for (const a of paste)
      for (const device of DEVICES) {
        const link = askLink(a, prompt, device);
        expect(link).toMatch(/^https:\/\//);
        expect(link).not.toContain("When");
        expect(askSends(a)).toBe(false);
        expect(askNote(a)).toMatch(/is copied and opens .+: paste it in\./);
      }
  });

  it("opens the app on Android by name, and the plain link everywhere else", () => {
    for (const a of ASSISTANTS) {
      const plain = askLink(a, prompt, "computer");
      expect(askLink(a, prompt, "iphone")).toBe(plain);
      const android = askLink(a, prompt, "android");
      if (ANDROID_APP[a] && ASKING[a] !== "paste") {
        const intent = fromIntent(android);
        expect(intent).toEqual({
          href: plain,
          app: ANDROID_APP[a],
          fallback: plain,
        });
      } else expect(android).toBe(plain);
    }
  });

  it("encodes the question, apostrophes, commas and question marks too", () => {
    const link = askLink("claude", "Is it 15 to 25 knots? & what's the tide?");
    expect(link).not.toMatch(/[ &?]what/);
    expect(new URL(link).searchParams.get("q")).toBe(
      "Is it 15 to 25 knots? & what's the tide?",
    );
  });

  it("copies the question for every app not known to ask it", () => {
    expect(ASSISTANTS.filter(askSends)).toEqual(["chatgpt", "perplexity"]);
    expect(askNote("chatgpt")).toBe("Each opens in ChatGPT and asks it.");
    expect(askNote("claude")).toMatch(
      /typed in, for you to send\. It is copied/,
    );
  });

  it("says Grok may ask straight away, and copies it in case it does not", () => {
    // Reported to send at once, which we have not seen for ourselves: the
    // note is true either way.
    expect(ASKING.grok).toBe("mayAsk");
    expect(askSends("grok")).toBe(false);
    expect(askNote("grok")).toBe(
      "Each opens in Grok, which may ask it straight away. It is copied as it goes too: if it is not typed in, paste it.",
    );
  });

  it("says plainly which apps answer without the forecast", () => {
    for (const a of ASSISTANTS)
      if (takesServer(a)) expect(askNote(a)).not.toMatch(/live data/);
      else expect(askNote(a)).toMatch(/can't read wingfoil\.ie's live data/);
  });

  it("leads with the question the page is for", () => {
    expect(EXAMPLE_PROMPTS[0]).toBe(prompt);
    expect(new Set(EXAMPLE_PROMPTS).size).toBe(EXAMPLE_PROMPTS.length);
  });
});

describe("adding to an app", () => {
  const plan = (a: Assistant, device: Device) => {
    const p = addPlan(a, device, URL_);
    if (!p) throw new Error(`${a} takes no server`);
    return p;
  };

  it("has a way to add the server for every app that takes one, and none for the rest", () => {
    for (const a of ASSISTANTS)
      for (const device of DEVICES) {
        const p = addPlan(a, device, URL_);
        expect(p !== undefined).toBe(takesServer(a));
        if (p) {
          expect(p.href).toMatch(/^(https|intent):\/\//);
          expect(p.brief.length).toBeLessThan(25);
        }
      }
  });

  it("fills Claude's dialog in, on a phone as on a computer", () => {
    for (const device of ["iphone", "computer"] as const) {
      expect(plan("claude", device).href).toBe(claudeLink(URL_));
      expect(plan("claude", device).copies).toBe(false);
    }
    expect(fromIntent(plan("claude", "android").href)).toEqual({
      href: claudeLink(URL_),
      app: "com.anthropic.claude",
      fallback: claudeLink(URL_),
    });
    expect(plan("claude", "iphone").note).toMatch(/Tap Add/);
    expect(plan("claude", "computer").note).toMatch(/Click Add/);
  });

  it("copies the address for every app that cannot be handed it", () => {
    for (const device of DEVICES)
      for (const a of ["chatgpt", "grok", "perplexity", "lechat"] as const)
        expect(plan(a, device).copies).toBe(true);
    expect(grokLink()).toBe("https://grok.com/connectors");
    expect(plan("grok", "iphone").href).toBe(grokLink());
    expect(fromIntent(plan("grok", "android").href).app).toBe("ai.x.grok");
  });

  it("opens Perplexity's plugins and Le Chat on the web, on any device", () => {
    for (const device of DEVICES) {
      expect(plan("perplexity", device).href).toBe(PERPLEXITY_PLUGINS);
      expect(plan("lechat", device).href).toBe(LE_CHAT);
    }
    expect(PERPLEXITY_PLUGINS).toBe(
      "https://www.perplexity.ai/computer/plugins",
    );
    expect(plan("perplexity", "computer").note).toMatch(
      /None for authentication/,
    );
    expect(plan("lechat", "computer").note).toMatch(/Custom MCP Connector/);
  });

  it("says the address is copied, and what is left, for every app that copies it", () => {
    for (const device of DEVICES)
      for (const a of ASSISTANTS.filter(takesServer)) {
        const p = plan(a, device);
        if (p.copies) expect(p.copiedNote).toMatch(/^Address copied\. /);
        else expect(p.copiedNote).toBeUndefined();
      }
  });

  it("opens ChatGPT's plugins on a phone too, in the app, and says to add it on a computer", () => {
    expect(CHATGPT_APPS).toBe("https://chatgpt.com/plugins");
    expect(plan("chatgpt", "computer").href).toBe(CHATGPT_APPS);
    expect(plan("chatgpt", "iphone").href).toBe(CHATGPT_APPS);
    expect(fromIntent(plan("chatgpt", "android").href)).toEqual({
      href: CHATGPT_APPS,
      app: "com.openai.chatgpt",
      fallback: CHATGPT_APPS,
    });
    for (const device of ["iphone", "android"] as const) {
      const p = plan("chatgpt", device);
      for (const line of [p.note, p.copiedNote])
        expect(line).toMatch(
          /The phone app may not show custom servers: if not, add it on a computer at chatgpt\.com\/plugins/,
        );
    }
  });

  it("says ChatGPT's custom servers depend on the plan, not on a setting that may not exist", () => {
    for (const device of DEVICES) {
      const p = plan("chatgpt", device);
      for (const line of [p.note, p.copiedNote]) {
        expect(line).not.toMatch(/Developer mode|in the app too/);
      }
      expect(p.copiedNote).toMatch(
        /If you don't see Add custom MCP server, your plan may not include it\.$/,
      );
    }
    expect(plan("chatgpt", "computer").note).toMatch(
      /your plan may not include it\.$/,
    );
  });
});
