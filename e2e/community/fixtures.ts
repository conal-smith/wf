import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * What the community specs stand on: the real API (api.ts) behind the preview's
 * /api proxy, and people.
 *
 * A person is a browser context of their own. The e2e build signs nobody in
 * and reads who it is from localStorage (shared/web/auth.tsx, `devUserNow`),
 * so `as("aoife")` is a page whose every request is `Bearer dev:aoife`, and a
 * plain `page` is a reader who is signed out.
 *
 * These specs run on the wall clock, unlike the map's (e2e/fixtures.ts): the
 * API stamps what it is sent with the real time, and a page a month away from
 * it would call every message old. A spec that steps time installs a clock on
 * the one page that needs it.
 *
 * Nothing is seeded (D23). The API starts with its ten channels and no
 * threads, and what a spec needs it posts over HTTP first, as the member it
 * names: `member("cian").startThread(...)`.
 */

/** shared/web/auth.tsx DEV_USER_KEY, which cannot be imported without the identity provider's package. */
const DEV_USER_KEY = "wingfoil:dev-user";

export interface ThreadRef {
  id: string;
  slug: string;
  title: string;
  /** Where its page is. */
  path: string;
}

export interface Member {
  /** Their first request, which is what makes a dev identity a member with a row. */
  arrive(): Promise<void>;
  startThread(channel: string, title: string, body: string): Promise<ThreadRef>;
  /** Replies, in order, and answers the last one's id. */
  reply(thread: ThreadRef, ...bodies: string[]): Promise<string>;
  /**
   * Marks everything in their bell read. The API outlives a test and its
   * people are the same few names, so a spec that counts starts from nothing
   * by saying so, not by what ran before it.
   */
  readAll(): Promise<void>;
}

function memberOver(request: APIRequestContext, name: string): Member {
  const headers = { Authorization: `Bearer dev:${name}` };
  const post = async (path: string, data: unknown) => {
    const reply = await request.post(`/api/community${path}`, {
      headers,
      data,
    });
    expect(reply.status(), `${name} POST ${path}`).toBe(201);
    return reply.json();
  };
  return {
    async arrive() {
      const reply = await request.get("/api/me", { headers });
      expect(reply.status(), `${name} GET /api/me`).toBe(200);
    },
    async startThread(channel, title, body) {
      const thread = await post(`/channels/${channel}/threads`, {
        title,
        body,
      });
      return {
        id: thread.id,
        slug: thread.slug,
        title,
        path: `/community/t/${thread.id}/${thread.slug}`,
      };
    },
    async reply(thread, ...bodies) {
      let id = "";
      for (const body of bodies)
        id = (await post(`/threads/${thread.id}/messages`, { body })).id;
      return id;
    },
    async readAll() {
      const reply = await request.put("/api/community/notifications/read", {
        headers,
        data: { all: true },
      });
      expect(reply.status(), `${name} PUT /notifications/read`).toBe(200);
      expect((await reply.json()).count).toBe(0);
    },
  };
}

/** A title no other test, and no earlier try of this one, has used: the API outlives a test. */
export const unique = (title: string) =>
  `${title} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const test = base.extend<{
  /** A page of their own, signed in as this dev member. */
  as: (name: string) => Promise<Page>;
  /** The same member over HTTP, for what a spec needs there before it starts. */
  member: (name: string) => Member;
}>({
  as: async ({ browser, baseURL, viewport, isMobile, hasTouch }, use) => {
    const opened: { close(): Promise<void> }[] = [];
    await use(async (name) => {
      // The project's own window, so a person on the phone project is on a phone.
      const context = await browser.newContext({
        baseURL,
        viewport,
        isMobile,
        hasTouch,
      });
      opened.push(context);
      await context.addInitScript(
        ([key, who]) => localStorage.setItem(key, who),
        [DEV_USER_KEY, name],
      );
      return context.newPage();
    });
    for (const context of opened) await context.close();
  },
  member: async ({ request }, use) => {
    await use((name) => memberOver(request, name));
  },
});

/** The bell, by what it says: "Notifications", or "Notifications, 2 unread". */
export const bell = (page: Page) =>
  page
    .getByRole("navigation", { name: "Community" })
    .getByRole("link", { name: /^Notifications/ });

/** One message of a thread, by words in it. */
export const message = (page: Page, text: string | RegExp) =>
  page.locator('article[id^="m-"]').filter({ hasText: text });

/** Types a reply into the docked composer and sends it. */
export async function sendReply(page: Page, text: string) {
  const composer = page.getByRole("form", { name: "Reply" });
  await composer.getByRole("textbox", { name: "Your reply" }).fill(text);
  await composer.getByRole("button", { name: "Reply" }).click();
}

export { expect };
export type { Page };
