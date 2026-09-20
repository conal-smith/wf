/**
 * The community's header: the marketplace's bar, with Community in the chip.
 * The site menu, the way home, and on the right what a member does from any
 * page: start a thread, read the bell, be themselves.
 */
import { UserButton } from "@clerk/clerk-react";
import { Bell, LogIn, PlusCircle, Wind } from "lucide-react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { useSiteAuth } from "../../shared/web/auth";
import { Button, Chip, Count } from "../../ui";
import { RING, tv } from "../../ui/tv";
import { paths, routed } from "./router";

export const headerStyles = tv({
  slots: {
    base: "sticky top-0 z-header py-3",
    // A card, not glass: there is no map under it to show through.
    bar: "flex min-h-control-lg items-center gap-2 rounded-pill border border-line bg-card pr-2 pl-3 shadow-marker max-rail:gap-1 max-rail:px-1",
    brand: [
      "inline-flex min-w-0 items-center gap-2 rounded-control font-sans text-lead whitespace-nowrap text-ink no-underline",
      RING,
    ],
    domain: "font-normal text-ink-muted",
    actions: "ml-auto flex items-center gap-1",
    // On a phone the way to start a thread is the page's own, not the bar's.
    newThread: "max-rail:hidden",
    bell: "relative",
    count: "absolute -top-1 -right-1",
    user: "inline-flex items-center px-2 font-sans text-body text-ink-muted",
  },
});

export interface HeaderProps {
  /**
   * One filled action per view: New thread is it, except on a view that brings
   * a primary of its own, where it goes quiet.
   */
  accentNew: boolean;
  /** Where New thread goes: `paths.newThread`, for the channel that is open. */
  newThread: string;
  /** Unread notifications, from `useNotificationsCount`. */
  unread: number;
}

export function Header({ accentNew, newThread, unread }: HeaderProps) {
  const auth = useSiteAuth();
  const styles = headerStyles();
  return (
    <header className={styles.base()}>
      <div className={styles.bar()}>
        <SiteMenu current="community" size="sm" />
        <a
          {...routed(paths.home())}
          className={styles.brand()}
          aria-label="wingfoil.ie Community, home"
        >
          <Wind size={22} aria-hidden="true" />
          <span>
            wingfoil<span className={styles.domain()}>.ie</span>
          </span>
          <Chip eyebrow>Community</Chip>
        </a>
        <nav className={styles.actions()} aria-label="Community">
          {auth.signedIn ? (
            <>
              <Button
                {...routed(newThread)}
                variant={accentNew ? "primary" : "pill"}
                size="sm"
                className={styles.newThread()}
              >
                <PlusCircle size={15} aria-hidden="true" />
                <span>New thread</span>
              </Button>
              <Button
                {...routed(paths.notifications())}
                variant="pill"
                size="sm"
                icon
                className={styles.bell()}
                aria-label={
                  unread > 0
                    ? `Notifications, ${unread} unread`
                    : "Notifications"
                }
              >
                <Bell size={15} aria-hidden="true" />
                <Count value={unread} className={styles.count()} />
              </Button>
              {auth.provider === "clerk" ? (
                <span className={styles.user()}>
                  <UserButton />
                </span>
              ) : (
                <span className={styles.user()}>{auth.identity.name}</span>
              )}
            </>
          ) : (
            <Button
              variant="pill"
              size="sm"
              onClick={auth.signIn}
              disabled={auth.provider === "none" || !auth.loaded}
              title={
                auth.provider === "none"
                  ? "Sign-in is not configured on this build"
                  : undefined
              }
            >
              <LogIn size={15} aria-hidden="true" />
              <span>Sign in</span>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
