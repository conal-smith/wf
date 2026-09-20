/**
 * The fetch core every section's API client stands on: the bearer token, the
 * JSON in and out, and one error class for everything that can go wrong. A
 * section keeps its own endpoints and hands this its prefix and its name.
 *
 * This is the only file in the browser code that calls `fetch`.
 */

/** Where the API lives. Empty in development, where Vite proxies /api. */
export const API_ROOT = (
  (import.meta.env.VITE_MARKET_API_URL as string | undefined) ?? ""
).replace(/\/$/, "");

/** The body of every failed reply the API writes itself. */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface ApiSettings {
  /** The section's mount point on the API: `/api/market`. */
  prefix: string;
  /** How a reader is told which part of the site failed: `The marketplace`. */
  subject: string;
  getToken(): Promise<string | null>;
}

/** What a reader is told when the API answers with nothing of its own to say. */
const unavailable = (subject: string, status: number) =>
  status >= 500
    ? `${subject} is not responding right now. Try again in a moment.`
    : `That did not work (error ${status}). Try again in a moment.`;

export async function request<T>(
  api: ApiSettings,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = await api.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_ROOT}${api.prefix}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(
      0,
      "offline",
      `${api.subject} could not be reached. Check your connection.`,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // This API only ever writes JSON. A body that is not JSON did not come
  // from it: a proxy, a captive portal, a login wall, or the site's own SPA
  // fallback answering for a path the API never saw. That is a failed
  // request with a status worth reporting, not a SyntaxError from inside a
  // parser three layers down.
  let payload: unknown = null;
  if (text)
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiRequestError(
        res.status,
        "bad-response",
        res.ok
          ? `${api.subject} sent a reply this page could not read. Try again in a moment.`
          : unavailable(api.subject, res.status),
      );
    }
  if (!res.ok) {
    const err = (payload ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      res.status,
      err.error ?? "error",
      err.message ?? unavailable(api.subject, res.status),
      err.details as Record<string, string> | undefined,
    );
  }
  return payload as T;
}

/**
 * Bytes to an upload slot the API presigned. The slot is another origin's: it
 * gets the headers it was signed with and no bearer token, and its reply is
 * not the API's JSON, so only the status is read.
 */
export async function sendBytes(
  slot: { uploadUrl: string; method: string; headers: Record<string, string> },
  body: Blob,
  failure: string,
): Promise<void> {
  const put = await fetch(slot.uploadUrl, {
    method: slot.method,
    headers: slot.headers,
    body,
  });
  if (!put.ok) throw new ApiRequestError(put.status, "upload", failure);
}
