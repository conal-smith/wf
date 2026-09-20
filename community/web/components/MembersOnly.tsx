/**
 * What a page that is a member's own shows to a reader who is not signed in:
 * Following, Mentions, the notifications, and `me`. Reading the community needs
 * no session; these have nothing in them without one.
 */
import { LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { Button, Empty, Skeleton } from "../../../ui";
import { tv } from "../../../ui/tv";

export const membersOnlyStyles = tv({
  slots: {
    loading: "grid gap-3",
    short: "w-1/3",
    hidden: "sr-only",
  },
});

export interface MembersOnlyProps {
  /** What signing in is for, after "Sign in to see": "what you follow". */
  what: string;
  children: ReactNode;
}

export function MembersOnly({ what, children }: MembersOnlyProps) {
  const auth = useSiteAuth();
  const styles = membersOnlyStyles();
  if (auth.signedIn) return <>{children}</>;
  if (!auth.loaded)
    return (
      <div className={styles.loading()} aria-busy="true">
        <span className={styles.hidden()}>Loading…</span>
        <Skeleton className={styles.short()} />
        <Skeleton />
      </div>
    );
  return (
    <Empty
      title={`Sign in to see ${what}`}
      icon={<LogIn size={24} aria-hidden="true" />}
    >
      {auth.provider === "none" ? (
        <p>Sign-in is not configured on this build.</p>
      ) : (
        <>
          <p>Reading needs no account. This page is a member’s own.</p>
          {/* Quiet, as in the header: signing in is offered, not pushed. */}
          <Button variant="pill" onClick={auth.signIn}>
            <LogIn size={15} aria-hidden="true" />
            <span>Sign in</span>
          </Button>
        </>
      )}
    </Empty>
  );
}
