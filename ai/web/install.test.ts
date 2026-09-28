import { describe, expect, it } from "vitest";
import {
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  cursorLink,
  geminiConfig,
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
