/**
 * The community shell: auth, routing, the header, the channel rail, and the
 * page for the URL. `src/main.tsx` lazy-loads this for any path under
 * /community, so neither the map nor the marketplace pays for it.
 *
 * Two columns and no third (D22): the channels, and the page. Below the rail
 * breakpoint there is room for one, so the channels are the page at /community
 * and every other page stands alone with a way back to them.
 */
import { ArrowLeft, Compass } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteAuthProvider } from "../../shared/web/auth";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, Empty } from "../../ui";
import { tv } from "../../ui/tv";
import { Header } from "./Header";
import { useChannels, useNotificationsCount } from "./hooks";
import { ThreadPage } from "./pages/Thread";
import { Rail, railCurrent } from "./Rail";
import {
  BASE,
  matchRoute,
  paths,
  routed,
  useLocation,
  type Route,
} from "./router";

export const shellStyles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground font-sans text-prose text-ink",
    // The marketplace's page measure, and its narrower gutter on a phone.
    page: "mx-auto flex w-full max-w-page flex-1 flex-col px-6 max-rail:px-3",
    shell:
      "grid flex-1 grid-cols-1 items-start gap-8 pt-3 pb-8 max-rail:gap-5 rail:grid-cols-shell",
    rail: "",
    main: "flex min-w-0 flex-col gap-5",
    // Only where the rail is not beside the page.
    back: "self-start rail:hidden",
  },
  variants: {
    // Away from /community a phone shows the page, not the channels.
    railIsPage: { false: { rail: "max-rail:hidden" } },
  },
});

export default function CommunityApp() {
  return (
    <SiteAuthProvider home={BASE}>
      <Shell />
    </SiteAuthProvider>
  );
}

/**
 * One filled action per view: the header's New thread is it, except where the
 * page brings a primary of its own (Reply on a thread, the way back on a page
 * that does not exist).
 */
export const accentNewThread = (route: Route) =>
  route.page !== "thread" && route.page !== "not-found";

function Shell() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const channels = useChannels();
  const unread = useNotificationsCount();
  const home = route.page === "home";
  // A thread's channel is known once its page has loaded, and told to the rail.
  const [threadChannel, setThreadChannel] = useState<string | null>(null);
  const styles = shellStyles({ railIsPage: home });

  return (
    <div className={styles.root()}>
      <div className={styles.page()}>
        <Header
          accentNew={accentNewThread(route)}
          newThread={paths.newThread(
            route.page === "channel" ? route.slug : undefined,
          )}
          unread={unread}
        />
        <div className={styles.shell()}>
          <Rail
            className={styles.rail()}
            state={channels.state}
            reload={channels.reload}
            current={railCurrent(route, threadChannel)}
          />
          <main id="community-main" className={styles.main()}>
            {/* A thread's way back is its own, to its channel. */}
            {!home && route.page !== "thread" && (
              <Button
                {...routed(paths.home())}
                size="sm"
                className={styles.back()}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>Channels</span>
              </Button>
            )}
            <Page route={route} onThreadChannel={setThreadChannel} />
          </main>
        </div>
      </div>
    </div>
  );
}

/** The pages arrive with their own items; the shell holds their place. */
function Page({
  route,
  onThreadChannel,
}: {
  route: Route;
  onThreadChannel: (slug: string | null) => void;
}) {
  switch (route.page) {
    case "thread":
      // Keyed, so another thread is another page: nothing of the last one stays.
      return (
        <ThreadPage key={route.id} id={route.id} onChannel={onThreadChannel} />
      );
    case "not-found":
      return <NotFound />;
    default:
      return null;
  }
}

function NotFound() {
  usePageTitle("Page not found", "Community");
  return (
    <Empty
      title="That page does not exist"
      icon={<Compass size={24} aria-hidden="true" />}
    >
      <p>The link may be old, or the thread may have been removed.</p>
      <Button {...routed(paths.home())} variant="primary">
        Back to the community
      </Button>
    </Empty>
  );
}
