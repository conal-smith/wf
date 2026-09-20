/**
 * The browser side of the community API. One class, one method per route, and
 * a hook that binds it to the signed-in member's token. The request itself, the
 * token and the error shape are the site's: `shared/web/http.ts`.
 *
 * The shell's routes only. A page adds the methods it needs beside them.
 */
import { useMemo, useRef } from "react";
import { request, type ApiSettings } from "../../shared/web/http";
import { useSiteAuth } from "../../shared/web/auth";
import type { Channel, MetaPayload } from "../shared/types";

export { ApiRequestError } from "../../shared/web/http";

export class CommunityApi {
  private settings: ApiSettings;

  constructor(getToken: () => Promise<string | null>) {
    this.settings = {
      prefix: "/api/community",
      subject: "The community",
      getToken,
    };
  }

  private request<T>(method: string, path: string, body?: unknown) {
    return request<T>(this.settings, method, path, body);
  }

  /** Categories, channels, tags, reactions and limits. The same for everyone. */
  meta() {
    return this.request<MetaPayload>("GET", "/meta");
  }
  /** The channels again, with the viewer's unread counts when there is one. */
  listChannels() {
    return this.request<{ channels: Channel[] }>("GET", "/channels");
  }
  /** The bell's number. */
  notificationsCount() {
    return this.request<{ count: number }>("GET", "/notifications/count");
  }
}

/**
 * One client per signed-in identity. The token getter is read through a ref
 * so a provider that hands out a fresh function each render does not make
 * every page refetch.
 */
export function useApi(): CommunityApi {
  const { getToken, userId, provider } = useSiteAuth();
  const latest = useRef(getToken);
  latest.current = getToken;
  return useMemo(
    () => new CommunityApi(() => latest.current()),
    [userId, provider],
  );
}
