/**
 * The browser side of the community API. One class, one method per route, and
 * a hook that binds it to the signed-in member's token. The request itself, the
 * token and the error shape are the site's: `shared/web/http.ts`.
 *
 * The shell's routes, then the feed's. A page adds the methods it needs beside
 * them.
 */
import { useMemo, useRef } from "react";
import { request, sendBytes, type ApiSettings } from "../../shared/web/http";
import { useSiteAuth } from "../../shared/web/auth";
import { resizeImage } from "../../shared/web/images";
import type { User } from "../../site/shared/types";
import type {
  Channel,
  MetaPayload,
  Thread,
  ThreadInput,
  ThreadPage,
} from "../shared/types";

/**
 * What POST /uploads answers with: where the bytes go, and the key a message
 * then names. The marketplace's presign reply, restated: nothing of the
 * marketplace is in this bundle, not even a type.
 */
interface UploadSlot {
  key: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
}

/** A path and what narrows it. A parameter with nothing in it is left out. */
function withQuery(path: string, params: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params))
    if (value) query.set(name, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

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

  /** Every channel's threads, most recent activity first. */
  feed(cursor: string | null = null) {
    return this.request<ThreadPage>(
      "GET",
      withQuery("/feed", { tab: "latest", cursor }),
    );
  }
  /** One channel's threads, pinned first, narrowed to a tag when one is given. */
  channelThreads(
    slug: string,
    tagId: string | null = null,
    cursor: string | null = null,
  ) {
    return this.request<ThreadPage>(
      "GET",
      withQuery(`/channels/${slug}/threads`, { tag: tagId, cursor }),
    );
  }
  search(q: string, cursor: string | null = null) {
    return this.request<ThreadPage>("GET", withQuery("/search", { q, cursor }));
  }
  /** The channel again, with its follower count as it now stands. */
  followChannel(slug: string, on: boolean) {
    return this.request<Channel>("PUT", `/channels/${slug}/follow`, { on });
  }
  createThread(slug: string, input: ThreadInput) {
    return this.request<Thread>("POST", `/channels/${slug}/threads`, input);
  }
  /** The member's own row. The site's route, not the community's: /api/me. */
  me() {
    return request<User>({ ...this.settings, prefix: "/api" }, "GET", "/me");
  }

  /** Resize in the browser, ask for an upload slot, PUT the bytes, return the key a message names. */
  async uploadPhoto(file: File): Promise<string> {
    const image = await resizeImage(file);
    const slot = await this.request<UploadSlot>("POST", "/uploads", {
      contentType: image.blob.type,
      byteLength: image.blob.size,
    });
    await sendBytes(slot, image.blob, "The photo upload failed. Try again.");
    return slot.key;
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
