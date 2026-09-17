/**
 * The marketplace shell: auth, routing, header, and the page for the URL.
 * `src/main.tsx` lazy-loads this for any path under /market, so the map
 * bundle never pays for it and vice versa.
 */
import { useEffect } from "react";
import "./market.css";
import { MarketAuthProvider } from "./auth";
import { Compass } from "lucide-react";
import { Empty, MarketFooter, MarketHeader } from "./components";
import BrowsePage from "./pages/BrowsePage";
import ListingPage from "./pages/ListingPage";
import MePage from "./pages/MePage";
import SellPage from "./pages/SellPage";
import SellerPage from "./pages/SellerPage";
import { Link, matchRoute, paths, useLocation } from "./router";

export default function MarketApp() {
  return (
    <MarketAuthProvider>
      <Shell />
    </MarketAuthProvider>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  // One filled action per view: the header's Sell is it, except on the pages
  // that bring a primary of their own (contact the seller, publish, sign in).
  const accentSell = route.page === "browse" || route.page === "seller";
  const narrow = route.page === "sell" || route.page === "edit";

  return (
    <div className="mk-root" data-mode="light">
      <div className="mk-page">
        <MarketHeader accentSell={accentSell} />
        <main
          id="mk-main"
          className={`mk-main ${narrow ? "mk-main--narrow" : ""}`}
        >
          <Page route={route} />
        </main>
        <MarketFooter />
      </div>
    </div>
  );
}

function Page({ route }: { route: ReturnType<typeof matchRoute> }) {
  switch (route.page) {
    case "browse":
      return <BrowsePage />;
    case "listing":
      return <ListingPage id={route.id} />;
    case "sell":
      return <SellPage />;
    case "edit":
      return <SellPage editId={route.id} />;
    case "me":
      return <MePage tab={route.tab} />;
    case "seller":
      return <SellerPage id={route.id} />;
    default:
      return (
        <Empty
          title="That page does not exist"
          icon={<Compass size={24} aria-hidden="true" />}
        >
          <p>The link may be old, or the listing may have been removed.</p>
          <div className="mk-empty__actions">
            <Link to={paths.browse()} className="f5-button f5-button--primary">
              Browse listings
            </Link>
          </div>
        </Empty>
      );
  }
}
