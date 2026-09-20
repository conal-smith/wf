/**
 * The marketplace's name for the site's one auth bridge, which lives in
 * `shared/web/auth.tsx` so the community reads the same session. The pages
 * keep importing `useMarketAuth` from here; only the home path is ours.
 */
import type { ReactNode } from "react";
import { SiteAuthProvider } from "../../shared/web/auth";
import { BASE } from "./router";

export {
  useSiteAuth as useMarketAuth,
  type SiteAuth as MarketAuth,
} from "../../shared/web/auth";

export function MarketAuthProvider({ children }: { children: ReactNode }) {
  return <SiteAuthProvider home={BASE}>{children}</SiteAuthProvider>;
}
