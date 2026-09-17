/**
 * A history-API router small enough to read in one sitting. The marketplace
 * lives under /market; everything else on the site is not our business.
 */
import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";

export const BASE = "/market";

export type Route =
  | { page: "browse" }
  | { page: "sell" }
  | { page: "listing"; id: string }
  | { page: "edit"; id: string }
  | { page: "me"; tab: string }
  | { page: "seller"; id: string }
  | { page: "not-found" };

export function matchRoute(pathname: string): Route {
  const rest = pathname.replace(/\/+$/, "").slice(BASE.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) return { page: "browse" };
  if (parts[0] === "sell" && parts.length === 1) return { page: "sell" };
  if (parts[0] === "listing" && parts[1]) {
    if (parts.length === 2) return { page: "listing", id: parts[1] };
    if (parts.length === 3 && parts[2] === "edit")
      return { page: "edit", id: parts[1] };
  }
  if (parts[0] === "me" && parts.length <= 2)
    return { page: "me", tab: parts[1] ?? "listings" };
  if (parts[0] === "seller" && parts.length === 2)
    return { page: "seller", id: parts[1] };
  return { page: "not-found" };
}

const EVENT = "market:navigate";

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

export function Link({
  to,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
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
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

export const paths = {
  browse: (params?: URLSearchParams) => {
    const q = params?.toString();
    return q ? `${BASE}?${q}` : BASE;
  },
  sell: () => `${BASE}/sell`,
  listing: (id: string) => `${BASE}/listing/${id}`,
  edit: (id: string) => `${BASE}/listing/${id}/edit`,
  me: (tab = "listings") =>
    tab === "listings" ? `${BASE}/me` : `${BASE}/me/${tab}`,
  seller: (id: string) => `${BASE}/seller/${id}`,
};
