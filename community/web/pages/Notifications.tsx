/**
 * The bell, as a page: what a phone gets where there is no room to hang a
 * popover, and where See all notifications lands beside the rail. The same rows
 * as the popover, every page of them.
 */
import type { ReactNode } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Button, Notice, Pane } from "../../../ui";
import { tv } from "../../../ui/tv";
import { MembersOnly } from "../components/MembersOnly";
import {
  NotificationRows,
  NotificationTools,
  isUnread,
} from "../components/NotificationRow";
import { useBell } from "../hooks";

export const notificationsStyles = tv({
  slots: {
    head: "flex items-start justify-between gap-5",
    text: "grid min-w-0 gap-2",
    title: "m-0 text-title text-ink",
    lede: "m-0 text-prose text-ink-2",
    base: "flex flex-col gap-3",
    pane: "p-2",
    more: "self-center",
  },
});

export interface NotificationsProps {
  /** Unread notifications, from the shell's `useNotificationsCount`, and its `setCount`. */
  unread: number;
  onUnread: (count: number) => void;
}

export function Notifications(props: NotificationsProps) {
  const { signedIn } = useSiteAuth();
  usePageTitle("Notifications", "Community");
  return (
    <>
      {/* Signed in, the head is the inbox's own: it carries Mark all read. */}
      {!signedIn && <Head />}
      <MembersOnly what="your notifications">
        <Inbox {...props} />
      </MembersOnly>
    </>
  );
}

function Head({ tools }: { tools?: ReactNode }) {
  const styles = notificationsStyles();
  return (
    <div className={styles.head()}>
      <div className={styles.text()}>
        <h1 className={styles.title()}>Notifications</h1>
        <p className={styles.lede()}>
          Replies to what you follow, mentions of you, and new threads in the
          channels you follow.
        </p>
      </div>
      {tools}
    </div>
  );
}

function Inbox({ unread, onUnread }: NotificationsProps) {
  const styles = notificationsStyles();
  const { signedIn } = useSiteAuth();
  const rows = useBell(signedIn, 0, onUnread);
  const { state } = rows;
  const allRead =
    unread === 0 && !(state.status === "ready" && state.items.some(isUnread));

  return (
    <>
      <Head
        tools={<NotificationTools allRead={allRead} onMarkAll={rows.markAll} />}
      />
      {rows.failure && <Notice kind="warn">{rows.failure}</Notice>}
      <div className={styles.base()}>
        <Pane className={styles.pane()}>
          <NotificationRows
            state={state}
            onOpen={rows.open}
            onRetry={rows.reload}
          />
        </Pane>
        {state.status === "ready" && state.more.status === "error" && (
          <Notice kind="warn">
            <p>{state.more.message}</p>
          </Notice>
        )}
        {state.status === "ready" && state.nextCursor !== null && (
          <Button
            variant="pill"
            className={styles.more()}
            disabled={state.more.status === "loading"}
            onClick={rows.loadMore}
          >
            {state.more.status === "loading"
              ? "Loading…"
              : state.more.status === "error"
                ? "Try again"
                : "Load more"}
          </Button>
        )}
      </div>
    </>
  );
}
