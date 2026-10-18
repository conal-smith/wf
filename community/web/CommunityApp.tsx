/**
 * The community shell: auth, routing, the header, the channel rail, and the
 * page for the URL. `src/main.tsx` lazy-loads this for any path under
 * /community, so neither the map nor the marketplace pays for it.
 *
 * Two columns and no third (D22): the channels, and the page. Below the rail
 * breakpoint there is room for one, and it is the page's: a phone opens on
 * the latest threads, not on the index of channels. The channels are one tap
 * away, under a Channels control at the head of every page but a thread
 * (whose way back is to its own channel), and fold away again once one is
 * chosen.
 */
import { ChevronDown, Compass, List } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteAuthProvider } from "../../shared/web/auth";
import { RiderSync } from "../../shared/web/useRiderSync";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, Empty } from "../../ui";
import { tv } from "../../ui/tv";
import { Header } from "./Header";
import {
  findChannel,
  useChannels,
  useNotificationsCount,
  useViewerRole,
  type ChannelsState,
} from "./hooks";
import { canStartThread, Channel } from "./pages/Channel";
import { Following } from "./pages/Following";
import { Home } from "./pages/Home";
import { Mentions } from "./pages/Mentions";
import { Notifications } from "./pages/Notifications";
import { Profile } from "./pages/Profile";
import { ThreadPage } from "./pages/Thread";
import { Rail, railCurrent } from "./Rail";
import {
  BASE,
  NEW_THREAD,
  matchRoute,
  paths,
  routed,
  useLocation,
  type Route,
} from "./router";

export const shellStyles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink",
    // The marketplace's page measure, and its narrower gutter on a phone.
    page: "mx-auto flex w-full max-w-page flex-1 flex-col px-6 max-rail:px-3",
    // On a phone the rows sit at the top: stretched, the grid would hand its
    // spare height to the row the Channels control is in.
    shell:
      "grid flex-1 grid-cols-1 items-start gap-8 pt-4 pb-8 max-rail:content-start max-rail:gap-5 rail:grid-cols-shell",
    rail: "",
    main: "flex min-w-0 flex-col gap-5",
    // The way to the channels where they are not beside the page, a finger's
    // height as the rows it opens are. Open, it is on the second sheet, as
    // the menu's current row is.
    channels:
      "min-h-touch self-start justify-self-start rail:hidden aria-expanded:bg-sunken",
    chevron: "transition-transform duration-fast motion-reduce:transition-none",
  },
  variants: {
    // On a phone the channels are folded away until they are asked for.
    channelsOpen: {
      false: { rail: "max-rail:hidden" },
      true: { chevron: "rotate-180" },
    },
    // A list a phone floats New thread over (NewThreadDialog's `fab`): its
    // foot clears the button, so the last row can still be read and pressed.
    floating: { true: { shell: "max-rail:pb-24" } },
  },
  defaultVariants: { channelsOpen: false, floating: false },
});

/** The rail's id, for the Channels control that unfolds it on a phone. */
const RAIL_ID = "community-channels";

export default function CommunityApp() {
  return (
    <SiteAuthProvider home={BASE}>
      <RiderSync />
      <Shell />
    </SiteAuthProvider>
  );
}

/**
 * One filled action per view: the header's New thread is it, except where the
 * page brings a primary of its own (Reply on a thread, the way back on a page
 * that does not exist), and while the dialog it opens is up, whose Post thread
 * is the filled one.
 */
export const accentNewThread = (route: Route, composing = false) =>
  !composing && route.page !== "thread" && route.page !== "not-found";

function Shell() {
  const { pathname, search } = useLocation();
  const route = matchRoute(pathname);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const channels = useChannels();
  const bell = useNotificationsCount();
  // A phone's channels, unfolded. Choosing one, or searching, is a new page,
  // and the list folds away so the page is what the reader sees.
  const [channelsOpen, setChannelsOpen] = useState(false);
  const where = `${pathname}?${search.toString()}`;
  useEffect(() => setChannelsOpen(false), [where]);
  // A channel the site's team posts in offers New thread to them alone, which
  // is the one thing here that needs the member's role: asked only there.
  const open =
    route.page === "channel" ? findChannel(channels.state, route.slug) : null;
  const role = useViewerRole(open?.postPolicy === "staff");
  // A thread's channel is known once its page has loaded, and told to the rail.
  const [threadChannel, setThreadChannel] = useState<string | null>(null);
  const styles = shellStyles({
    channelsOpen,
    floating: route.page === "home" || route.page === "channel",
  });

  return (
    <div className={styles.root()}>
      <div className={styles.page()}>
        <Header
          accentNew={accentNewThread(route, search.has(NEW_THREAD))}
          newThread={
            open && !canStartThread(open, role)
              ? null
              : paths.newThread(
                  route.page === "channel" ? route.slug : undefined,
                )
          }
          unread={bell.count}
          onUnread={bell.setCount}
          pathname={pathname}
        />
        <div className={styles.shell()}>
          {/* A thread's way back is its own, to its channel. */}
          {route.page !== "thread" && (
            <Button
              variant="pill"
              size="sm"
              className={styles.channels()}
              aria-expanded={channelsOpen}
              aria-controls={RAIL_ID}
              onClick={() => setChannelsOpen(!channelsOpen)}
            >
              <List size={15} strokeWidth={1.5} aria-hidden="true" />
              <span>Channels</span>
              <ChevronDown
                className={styles.chevron()}
                size={13}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </Button>
          )}
          <Rail
            id={RAIL_ID}
            className={styles.rail()}
            state={channels.state}
            reload={channels.reload}
            current={railCurrent(route, threadChannel)}
          />
          <main id="community-main" className={styles.main()}>
            <Page
              route={route}
              onThreadChannel={setThreadChannel}
              channels={channels.state}
              onPosted={channels.reload}
              role={role}
              pathname={pathname}
              search={search}
              unread={bell.count}
              onUnread={bell.setCount}
            />
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
  unread,
  onUnread,
  ...page
}: {
  route: Route;
  onThreadChannel: (slug: string | null) => void;
  channels: ChannelsState;
  /** The shell's `useChannels().reload`: a post or a follow changes the rail's copy. */
  onPosted: () => void;
  role: ReturnType<typeof useViewerRole>;
  pathname: string;
  search: URLSearchParams;
  unread: number;
  onUnread: (count: number) => void;
}) {
  switch (route.page) {
    case "home":
      return <Home {...page} />;
    case "following":
      return <Following channels={page.channels} onFollowed={page.onPosted} />;
    case "mentions":
      return <Mentions />;
    case "notifications":
      return <Notifications unread={unread} onUnread={onUnread} />;
    case "channel":
      return <Channel key={route.slug} slug={route.slug} {...page} />;
    case "thread":
      // Keyed, so another thread is another page: nothing of the last one stays.
      return (
        <ThreadPage key={route.id} id={route.id} onChannel={onThreadChannel} />
      );
    case "member":
      return <Profile handle={route.handle} />;
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
      icon={<Compass size={24} strokeWidth={1.5} aria-hidden="true" />}
    >
      <p>The link may be old, or the thread may have been removed.</p>
      <Button {...routed(paths.home())} variant="primary">
        Back to the community
      </Button>
    </Empty>
  );
}
