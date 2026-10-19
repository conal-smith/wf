import { describe, expect, it } from "vitest";
import {
  ASSISTANTS,
  CHATGPT_APPS,
  EXAMPLE_PROMPTS,
  addPlan,
  askLink,
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
  vscodeLink,
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

describe("asking", () => {
  const prompt = "When's the next good session after work near me?";

  it("opens a new chat in each app with the question typed in", () => {
    const at = (link: string) => {
      const u = new URL(link);
      return [u.origin + u.pathname, u.searchParams.get("q")];
    };
    expect(at(askLink("claude", prompt))).toEqual([
      "https://claude.ai/new",
      prompt,
    ]);
    expect(at(askLink("chatgpt", prompt))).toEqual([
      "https://chatgpt.com/",
      prompt,
    ]);
    expect(at(askLink("grok", prompt))).toEqual(["https://grok.com/", prompt]);
  });

  it("encodes the question, apostrophes, commas and question marks too", () => {
    const link = askLink("claude", "Is it 15 to 25 knots? & what's the tide?");
    expect(link).not.toMatch(/[ &?]what/);
    expect(new URL(link).searchParams.get("q")).toBe(
      "Is it 15 to 25 knots? & what's the tide?",
    );
  });

  it("knows which app asks the question it is opened with", () => {
    expect(askSends("chatgpt")).toBe(true);
    expect(askSends("claude")).toBe(false);
    expect(askSends("grok")).toBe(false);
  });

  it("leads with the question the page is for", () => {
    expect(EXAMPLE_PROMPTS[0]).toBe(prompt);
    expect(new Set(EXAMPLE_PROMPTS).size).toBe(EXAMPLE_PROMPTS.length);
  });
});

describe("devices", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

  it("tells a phone from a computer, an iPad asking for the desktop site included", () => {
    expect(deviceOf(IPHONE, 5)).toBe("iphone");
    expect(deviceOf(ANDROID, 5)).toBe("android");
    expect(deviceOf(MAC, 0)).toBe("computer");
    expect(deviceOf(MAC, 5)).toBe("iphone");
    expect(deviceOf("")).toBe("computer");
  });
});

describe("adding to an app", () => {
  it("knows the three apps by name", () => {
    expect(ASSISTANTS).toEqual(["claude", "chatgpt", "grok"]);
    expect(isAssistant("grok")).toBe(true);
    expect(isAssistant("gemini")).toBe(false);
    expect(isAssistant(null)).toBe(false);
  });

  it("fills Claude's dialog in, on a phone as on a computer", () => {
    for (const device of ["iphone", "android", "computer"] as const) {
      const plan = addPlan("claude", device, URL_);
      expect(plan.href).toBe(claudeLink(URL_));
      expect(plan.copies).toBe(false);
    }
    expect(addPlan("claude", "iphone", URL_).note).toMatch(/Tap Add/);
    expect(addPlan("claude", "computer", URL_).note).toMatch(/Click Add/);
  });

  it("copies the address for the apps that cannot be handed it", () => {
    for (const device of ["iphone", "android", "computer"] as const) {
      expect(addPlan("chatgpt", device, URL_).copies).toBe(true);
      expect(addPlan("grok", device, URL_).copies).toBe(true);
      // Grok's connectors, which open the Grok app on a phone.
      expect(addPlan("grok", device, URL_).href).toBe(
        "https://grok.com/connectors",
      );
    }
    expect(grokLink()).toBe("https://grok.com/connectors");
  });

  it("sends ChatGPT to its apps on a computer, and only copies on a phone", () => {
    expect(addPlan("chatgpt", "computer", URL_).href).toBe(CHATGPT_APPS);
    expect(CHATGPT_APPS).toBe("https://chatgpt.com/plugins");
    for (const device of ["iphone", "android"] as const) {
      const plan = addPlan("chatgpt", device, URL_);
      expect(plan.href).toBeUndefined();
      expect(plan.label).toBe("Copy the address");
      expect(plan.note).toMatch(/computer only/);
    }
  });
});
