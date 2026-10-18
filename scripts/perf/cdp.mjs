/**
 * A bare Chrome DevTools Protocol client over the browser's WebSocket, beside
 * Playwright's own pipe. Playwright gives a CDP session for a page but not for
 * the page's dedicated workers, and MapLibre fetches the basemap's vector
 * tiles from its workers: throttling the page alone would leave them on the
 * full line and count none of their bytes. Flattened sessions here reach both.
 */
import { createServer } from "node:net";

/** A free TCP port on the loopback, for Chrome's --remote-debugging-port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export class Cdp {
  /** @param {string} wsUrl the browser's webSocketDebuggerUrl */
  static async connect(port) {
    let version;
    for (let i = 0; i < 50 && !version; i++) {
      try {
        version = await (
          await fetch(`http://127.0.0.1:${port}/json/version`)
        ).json();
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!version) throw new Error(`No DevTools endpoint on port ${port}.`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws, version);
  }

  constructor(ws, version) {
    this.ws = ws;
    this.version = version;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.error)
          waiting.reject(
            new Error(`${waiting.method}: ${message.error.message}`),
          );
        else waiting.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? [])
        listener(message.params, message.sessionId);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method).delete(listener);
  }

  close() {
    this.ws.close();
  }
}
