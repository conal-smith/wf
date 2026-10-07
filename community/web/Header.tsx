/**
 * The community's header: the site's masthead, with Community beside the name.
 * The site menu, the way home, and on the right what a member does from any
 * page: start a thread, read the bell, be themselves.
 */
import { UserButton } from "@clerk/clerk-react";
import { LogIn, PlusCircle, UserRound } from "lucide-react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { useSiteAuth } from "../../shared/web/auth";
import { Button } from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { RING, tv } from "../../ui/tv";
import { Bell } from "./components/Bell";
import { ME, paths, routed } from "./router";

/*
 * The site's masthead (ui/Masthead.tsx) with the community's own few actions.
 */
export const headerStyles = tv({
  slots: {
    // On a phone the way to start a thread is the page's own, not the bar's.
    newThread: "max-rail:hidden",
    user: "inline-flex items-center px-2 font-body text-body text-ink-muted",
    // Their own name is the way to their own profile.
    me: [
      "inline-flex min-h-control-sm items-center px-2 font-body text-body text-ink-muted no-underline decoration-1 underline-offset-4",
      "transition-colors duration-fast not-disabled:hover:text-chart-magenta not-disabled:hover:underline",
      RING,
    ],
  },
});

export interface HeaderProps {
  /**
   * One filled action per view: New thread is it, except on a view that brings
   * a primary of its own, where it goes quiet.
   */
  accentNew: boolean;
  /**
   * Where New thread goes: `paths.newThread`, for the channel that is open.
   * Null where this member cannot start one, and the bar then offers none.
   */
  newThread: string | null;
  /** Unread notifications, from `useNotificationsCount`, and its `setCount`. */
  unread: number;
  onUnread: (count: number) => void;
  /** Where the reader is, for the bell: it opens nothing over its own page. */
  pathname: string;
}

export function Header({
  accentNew,
  newThread,
  unread,
  onUnread,
  pathname,
}: HeaderProps) {
  const auth = useSiteAuth();
  const styles = headerStyles();
  const masthead = mastheadStyles();
  return (
    <Masthead>
      <SiteMenu current="community" size="sm" ground="content" />
      <a
        {...routed(paths.home())}
        className={masthead.brand()}
        aria-label="wingfoil.ie Community, home"
      >
        <MastheadMark section="Community" />
      </a>
      <nav className={masthead.actions()} aria-label="Community">
        {auth.signedIn ? (
          <>
            {newThread && (
              <Button
                {...routed(newThread)}
                variant={accentNew ? "primary" : "pill"}
                size="sm"
                className={styles.newThread()}
              >
                <PlusCircle size={15} aria-hidden="true" />
                <span>New thread</span>
              </Button>
            )}
            <Bell unread={unread} onUnread={onUnread} pathname={pathname} />
            {auth.provider === "clerk" ? (
              <span className={styles.user()}>
                {/* Clerk's own menu, with the way to the profile in it. */}
                <UserButton>
                  <UserButton.MenuItems>
                    <UserButton.Link
                      label="Your profile"
                      labelIcon={<UserRound size={15} aria-hidden="true" />}
                      href={paths.member(ME)}
                    />
                  </UserButton.MenuItems>
                </UserButton>
              </span>
            ) : (
              <a
                {...routed(paths.member(ME))}
                className={styles.me()}
                aria-current={
                  pathname === paths.member(ME) ? "page" : undefined
                }
              >
                {auth.identity.name}
              </a>
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
                ? "Signing in is not available on this version of the site"
                : undefined
            }
          >
            <LogIn size={15} aria-hidden="true" />
            <span>Sign in</span>
          </Button>
        )}
      </nav>
    </Masthead>
  );
}
