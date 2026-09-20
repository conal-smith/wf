/**
 * The browser side of the community API. One class, one method per route, and
 * a hook that binds it to the signed-in member's token. The request itself, the
 * token and the error shape are the site's: `shared/web/http.ts`.
 *
 * The shell's routes, then each page's beside them: the feed's, then the
 * thread's.
 */
import { useMemo, useRef } from "react";
import {
  API_ROOT,
  request,
  sendBytes,
  type ApiSettings,
} from "../../shared/web/http";
import { useSiteAuth } from "../../shared/web/auth";
import { resizeImage } from "../../shared/web/images";
import type { User } from "../../site/shared/types";
import { afterQuery } from "../shared/followThread";
import type {
  Channel,
  FollowLevel,
  Message,
  MessageInput,
  MessagePage,
  MessageWindow,
  MetaPayload,
  Reaction,
  Thread,
  ThreadInput,
  ThreadPage,
  ThreadView,
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

/** Why a message is reported. The note beside it is the reporter's own words. */
export const REPORT_REASONS = [
  { id: "spam", label: "Spam or selling" },
  { id: "abuse", label: "Abusive or hateful" },
  { id: "unsafe", label: "Dangerous advice" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

/** What staff do to a thread, in place. Only `lock` carries a reason. */
export type ThreadAction = "pin" | "unpin" | "lock" | "unlock" | "remove";

/** One of after, before or around, as the query GET /threads/:id/messages reads. */
export function windowQuery(window: MessageWindow): string {
  if ("after" in window) return afterQuery(window.after);
  return "before" in window
    ? `?before=${window.before}`
    : `?around=${window.around}`;
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

  // ---- the thread page ------------------------------------------------------

  /** The head, the opening post, and a page around the viewer's last read. */
  getThread(id: string) {
    return this.request<ThreadView>("GET", `/threads/${id}`);
  }
  listMessages(threadId: string, window: MessageWindow) {
    return this.request<MessagePage>(
      "GET",
      `/threads/${threadId}/messages${windowQuery(window)}`,
    );
  }
  /** Where a browser's EventSource listens. Public, like the thread: no token. */
  eventsUrl(threadId: string) {
    return `${API_ROOT}${this.settings.prefix}/threads/${threadId}/events`;
  }
  postMessage(threadId: string, input: MessageInput) {
    return this.request<Message>(
      "POST",
      `/threads/${threadId}/messages`,
      input,
    );
  }
  editMessage(id: string, body: string) {
    return this.request<Message>("PUT", `/messages/${id}`, { body });
  }
  /** Soft: the answer is the message as it now stands, removed. */
  deleteMessage(id: string) {
    return this.request<Message>("DELETE", `/messages/${id}`);
  }
  setReaction(messageId: string, emoji: Reaction, on: boolean) {
    return this.request<Message>(
      "PUT",
      `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      { on },
    );
  }
  setThreadFollow(threadId: string, level: FollowLevel) {
    return this.request<Thread>("PUT", `/threads/${threadId}/follow`, {
      level,
    });
  }
  /** The highest seq the reader has seen. The answer is the thread, counted again. */
  markRead(threadId: string, seq: number) {
    return this.request<Thread>("PUT", `/threads/${threadId}/read`, { seq });
  }
  report(messageId: string, reason: ReportReason, note: string) {
    return this.request<unknown>("POST", `/messages/${messageId}/report`, {
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }
  moderateThread(threadId: string, action: ThreadAction, reason?: string) {
    return this.request<unknown>(
      "POST",
      `/threads/${threadId}/${action}`,
      reason === undefined ? {} : { reason },
    );
  }

  /** Resize in the browser, ask for an upload slot, PUT the bytes, return the key a message names. */
  async uploadPhoto(file: File): Promise<string> {
    return (await this.sendPhoto(file)).key;
  }
  /** The same, with a preview of what went up. The caller revokes it. */
  async uploadPhotoPreviewed(
    file: File,
  ): Promise<{ key: string; previewUrl: string }> {
    const { key, blob } = await this.sendPhoto(file);
    return { key, previewUrl: URL.createObjectURL(blob) };
  }
  private async sendPhoto(file: File): Promise<{ key: string; blob: Blob }> {
    const image = await resizeImage(file);
    const slot = await this.request<UploadSlot>("POST", "/uploads", {
      contentType: image.blob.type,
      byteLength: image.blob.size,
    });
    await sendBytes(slot, image.blob, "The photo upload failed. Try again.");
    return { key: slot.key, blob: image.blob };
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
