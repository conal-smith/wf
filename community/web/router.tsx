/**
 * The community's router: the marketplace's, under another base. The history
 * API and one event; everything outside /community is not our business.
 */
import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";

export const BASE = "/community";

export type Route =
  | { page: "home" }
  | { page: "following" }
  | { page: "mentions" }
  | { page: "notifications" }
  | { page: "channel"; slug: string }
  /** The slug is decoration for the reader; the id is what resolves. */
  | { page: "thread"; id: string; slug: string | null }
  | { page: "member"; handle: string }
  | { page: "not-found" };

export function matchRoute(pathname: string): Route {
  const rest = pathname.replace(/\/+$/, "").slice(BASE.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) return { page: "home" };
  if (parts.length === 1) {
    if (parts[0] === "following") return { page: "following" };
    if (parts[0] === "mentions") return { page: "mentions" };
    if (parts[0] === "notifications") return { page: "notifications" };
  }
  if (parts[0] === "c" && parts.length === 2)
    return { page: "channel", slug: parts[1] };
  if (parts[0] === "t" && (parts.length === 2 || parts.length === 3))
    return { page: "thread", id: parts[1], slug: parts[2] ?? null };
  if (parts[0] === "u" && parts.length === 2)
    return { page: "member", handle: parts[1] };
  return { page: "not-found" };
}

const EVENT = "community:navigate";

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const read = () => ({
    pathname: location.pathname,
    search: new URLSearchParams(location.search),
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return state;
}

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;

/**
 * What makes an anchor ours: the `href` it would have anyway, and a click that
 * pushes instead of loading. Spread onto a kit `Button` or `Link`, which are
 * plain anchors, so a row that looks like a button is still a link that opens
 * in a new tab when asked to.
 */
export function routed(
  to: string,
  { onClick, target }: Pick<AnchorProps, "onClick" | "target"> = {},
) {
  return {
    href: to,
    target,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      if (target && target !== "_self") return;
      e.preventDefault();
      navigate(to);
    },
  };
}

export function Link({
  to,
  onClick,
  target,
  ...rest
}: AnchorProps & { to: string }) {
  return <a {...rest} {...routed(to, { onClick, target })} />;
}

/** The search parameter that asks for the new-thread dialog. */
export const NEW_THREAD = "new";
/** The one that narrows a channel to a tag, and the one that carries a search. */
export const TAG = "tag";
export const QUERY = "q";

/** The URL the dialog was opened over: the same one, no longer asking for it. */
export function withoutNewThread(pathname: string, search: URLSearchParams) {
  const rest = new URLSearchParams(search);
  rest.delete(NEW_THREAD);
  const q = rest.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export const paths = {
  home: (params?: URLSearchParams) => {
    const q = params?.toString();
    return q ? `${BASE}?${q}` : BASE;
  },
  following: () => `${BASE}/following`,
  mentions: () => `${BASE}/mentions`,
  notifications: () => `${BASE}/notifications`,
  /** A tag narrows a channel's list, and rides in the URL so a link keeps it. */
  channel: (slug: string, tagId?: string | null) =>
    tagId ? `${BASE}/c/${slug}?${TAG}=${tagId}` : `${BASE}/c/${slug}`,
  thread: (id: string, slug?: string | null) =>
    slug ? `${BASE}/t/${id}/${slug}` : `${BASE}/t/${id}`,
  member: (handle: string) => `${BASE}/u/${handle}`,
  /**
   * Starting a thread is a dialog over the channel it will land in, or over
   * home. It is a URL so that a sign-in on the way comes back to it.
   */
  newThread: (slug?: string) =>
    `${slug ? `${BASE}/c/${slug}` : BASE}?${NEW_THREAD}=1`,
};
