import { HTTPException } from "hono/http-exception";

/** Ends the request with the API's error shape. createApp's onError hands the response back. */
export function fail(
  status: 400 | 403 | 404 | 409 | 413,
  error: string,
  message: string,
  details?: unknown,
): never {
  throw new HTTPException(status, {
    res: Response.json({ error, message, details }, { status }),
  });
}
