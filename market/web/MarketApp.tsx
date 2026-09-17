/**
 * The marketplace shell: auth, routing, header, and the page for the URL.
 * `src/main.tsx` lazy-loads this for any path under /market, so the map
 * bundle never pays for it and vice versa.
 */
import { useEffect } from "react";
import "./market.css";
import { MarketAuthProvider } from "./auth";
import { Empty, MarketHeader } from "./components";
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

  return (
    <div className="mk-root" data-mode="light">
      <div className="mk-page">
        <MarketHeader />
        <main id="mk-main">
          <Page route={route} />
        </main>
        <footer
          className="mk-row mk-row--between"
          style={{ marginTop: "var(--sem-space-pad-dialog)" }}
        >
          <p className="mk-caption">
            wingfoil.ie Market is free for everyone. Deals happen directly
            between members; we hold no money and take no cut.
          </p>
          <a className="mk-caption mk-link" href="/">
            Back to the wind map
          </a>
        </footer>
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
        <Empty title="That page does not exist">
          <Link to={paths.browse()} className="f5-button f5-button--primary">
            Browse listings
          </Link>
        </Empty>
      );
  }
}
