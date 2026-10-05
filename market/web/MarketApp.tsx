/**
 * The marketplace shell: auth, routing, header, and the page for the URL.
 * `src/main.tsx` lazy-loads this for any path under /market, so the map
 * bundle never pays for it and vice versa.
 */
import { useEffect } from "react";
import { MarketAuthProvider } from "./auth";
import { buttonStyles } from "../../ui/Button";
import { tv } from "../../ui/tv";
import { PenNote, Puffin } from "../../ui";
import { MarketFooter, MarketHeader } from "./components";
import BrowsePage from "./pages/BrowsePage";
import ListingPage from "./pages/ListingPage";
import MePage from "./pages/MePage";
import SellPage from "./pages/SellPage";
import SellerPage from "./pages/SellerPage";
import { Link, matchRoute, paths, useLocation } from "./router";

export const shellStyles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    // The page measure, and the narrower gutter a phone can spare. Neither
    // gutter goes under a notch: `px-safe-*` takes the device's own inset
    // where it is the larger, as market.css's `max(…, env(…))` did.
    page: "mx-auto flex w-full max-w-page flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    main: "flex min-w-0 flex-1 flex-col gap-6 pt-3 max-wide:gap-5",
    // A URL that is not a page: the puffin on his rock, and the pen's word.
    lost: "grid justify-items-center gap-4 py-14 text-center",
    lostTitle: "m-0 -rotate-1",
    lostText: "m-0 max-w-reading font-body text-prose text-ink-muted",
  },
  variants: {
    // A form is read down a column, not across a page: it stops well short of
    // the page measure and sits in the middle of what is left.
    narrow: { true: { main: "mx-auto w-full max-w-form" } },
  },
});

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
  const styles = shellStyles({ narrow });

  return (
    <div className={styles.root()}>
      <div className={styles.page()}>
        <MarketHeader accentSell={accentSell} />
        <main id="market-main" className={styles.main()}>
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
      return <NotFound />;
  }
}

function NotFound() {
  const styles = shellStyles();
  return (
    <section className={styles.lost()} aria-labelledby="not-found-title">
      <Puffin size={88} bob />
      <h1 className={styles.lostTitle()} id="not-found-title">
        <PenNote as="span">That page does not exist</PenNote>
      </h1>
      <p className={styles.lostText()}>
        The link may be old, or the listing may have been taken down.
      </p>
      <Link to={paths.browse()} className={buttonStyles({ variant: "primary" })}>
        Browse listings
      </Link>
    </section>
  );
}
