/**
 * The few MCP Apps messages the spot card needs, spoken over postMessage to
 * the app that frames it (the spec: modelcontextprotocol.io/extensions/apps,
 * version 2026-01-26). The official helper (@modelcontextprotocol/ext-apps'
 * App) validates every message with a schema library half a megabyte large;
 * the card says hello, listens for its tool's result and the app's theme,
 * reports its height, and asks for a link to be opened, so it speaks those
 * itself in a few hundred bytes.
 */

/** The spec's version, as the card asks for it. */
export const PROTOCOL_VERSION = "2026-01-26";

interface Message {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface HostContext {
  theme?: "light" | "dark";
  [key: string]: unknown;
}

export interface Bridge {
  /** Ask the app to open a link; rejects where it will not. */
  openLink(url: string): Promise<void>;
}

/**
 * Say hello to the app around the card, and hand on what it sends: the tool's
 * result, and its context (the theme) as it opens and as it changes.
 */
export function connect(handlers: {
  info: { name: string; version: string };
  onToolResult: (result: { structuredContent?: unknown }) => void;
  onContext: (context: HostContext) => void;
}): Bridge {
  const host = window.parent;
  let next = 1;
  const waiting = new Map<
    number | string,
    { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  const send = (message: Omit<Message, "jsonrpc">) =>
    host.postMessage({ jsonrpc: "2.0", ...message }, "*");
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      send({ id, method, params });
    });

  window.addEventListener("message", (event: MessageEvent<Message>) => {
    // Only the frame's own app speaks to it.
    if (event.source !== host) return;
    const m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === undefined && m.id !== undefined) {
      const call = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) call?.reject(new Error(m.error.message));
      else call?.resolve(m.result ?? {});
      return;
    }
    if (m.method === "ui/notifications/tool-result")
      handlers.onToolResult((m.params ?? {}) as { structuredContent?: unknown });
    else if (m.method === "ui/notifications/host-context-changed")
      handlers.onContext((m.params ?? {}) as HostContext);
    else if (m.method === "ui/resource-teardown" && m.id !== undefined)
      send({ id: m.id, result: {} });
    else if (m.id !== undefined)
      // A request the card does not answer.
      send({ id: m.id, error: { code: -32601, message: "Method not found" } });
  });

  void request("ui/initialize", {
    appInfo: handlers.info,
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION,
  }).then(
    (result) => {
      handlers.onContext((result.hostContext ?? {}) as HostContext);
      send({ method: "ui/notifications/initialized", params: {} });
    },
    () => {},
  );

  // The card's height, as it changes, so the app gives it the room it needs.
  let last = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    send({
      method: "ui/notifications/size-changed",
      params: { width: document.documentElement.clientWidth, height },
    });
  }).observe(document.documentElement);

  return {
    async openLink(url) {
      const result = await request("ui/open-link", { url });
      if (result.isError) throw new Error("The app would not open the link.");
    },
  };
}
