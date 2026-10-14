/**
 * Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/):
 * messages go out in batches of 100, each answered by a ticket; a ticket's
 * receipt is read some minutes later, and either may say the device is no
 * longer registered, which is when its token is dropped. `fetch` is injected
 * so the tests run without the network.
 */
export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const SEND_BATCH = 100;
export const RECEIPT_BATCH = 1000;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  channelId: string;
  priority: "high" | "default";
  /** Seconds the service may hold the message for an offline phone. */
  ttl?: number;
}

export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; message: string; details?: { error?: string } };

export interface PushClient {
  /** One ticket per message, in order. Throws when the service cannot be reached. */
  send(messages: readonly ExpoMessage[]): Promise<ExpoTicket[]>;
  receipts(ids: readonly string[]): Promise<Record<string, ExpoReceipt>>;
}

/** The ticket or receipt error that means the token is dead. */
export const deadToken = (r: ExpoTicket | ExpoReceipt) =>
  r.status === "error" && r.details?.error === "DeviceNotRegistered";

export function expoPush(
  options: { fetch?: typeof fetch; accessToken?: string | null } = {},
): PushClient {
  const get = options.fetch ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  const post = async (url: string, body: unknown) => {
    const response = await get(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Expo push answered ${response.status}.`);
    return (await response.json()) as { data?: unknown; errors?: unknown };
  };
  return {
    async send(messages) {
      const tickets: ExpoTicket[] = [];
      for (let i = 0; i < messages.length; i += SEND_BATCH) {
        const batch = messages.slice(i, i + SEND_BATCH);
        const answer = await post(EXPO_SEND_URL, batch);
        const data = Array.isArray(answer.data) ? (answer.data as ExpoTicket[]) : [];
        if (data.length !== batch.length)
          throw new Error(`Expo push answered ${data.length} tickets for ${batch.length} messages.`);
        tickets.push(...data);
      }
      return tickets;
    },
    async receipts(ids) {
      const out: Record<string, ExpoReceipt> = {};
      for (let i = 0; i < ids.length; i += RECEIPT_BATCH) {
        const answer = await post(EXPO_RECEIPTS_URL, { ids: ids.slice(i, i + RECEIPT_BATCH) });
        if (answer.data && typeof answer.data === "object")
          Object.assign(out, answer.data as Record<string, ExpoReceipt>);
      }
      return out;
    },
  };
}
