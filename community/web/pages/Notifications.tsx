/**
 * The bell, as a page: what a phone gets where there is no room to hang a
 * popover, and where See all notifications lands beside the rail. The same rows
 * as the popover, every page of them.
 */
import type { ReactNode } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import { Button, Notice } from "../../../ui";
import { tv } from "../../../ui/tv";
import { MembersOnly } from "../components/MembersOnly";
import { PageHead, dateline } from "../components/PageHead";
import {
  NotificationRows,
  NotificationTools,
  isUnread,
} from "../components/NotificationRow";
import { useBell } from "../hooks";

export const notificationsStyles = tv({
  slots: {
    base: "flex flex-col gap-4",
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

function Head({ tools, unread }: { tools?: ReactNode; unread?: number }) {
  return (
    <PageHead
      dateline={dateline(new Date())}
      figures={unread ? `${unread} unread` : undefined}
      title="Notifications"
      actions={tools}
    />
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
        unread={unread}
        tools={<NotificationTools allRead={allRead} onMarkAll={rows.markAll} />}
      />
      {rows.failure && <Notice kind="warn">{rows.failure}</Notice>}
      <div className={styles.base()}>
        <NotificationRows
          state={state}
          onOpen={rows.open}
          onRetry={rows.reload}
        />
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
