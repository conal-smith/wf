/**
 * The spot bundle's frame: the shared masthead, with the way back to the
 * chart, over the page's one column. The masthead scrolls away here rather
 * than sticking, so a day's header can stick to the top of the screen while
 * its hours pass under it.
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { Button } from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { tv } from "../../ui/tv";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-form flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    masthead: "static",
  },
});

/** The page's frame: the masthead, with the way back to the chart. */
export function SpotFrame({
  back,
  backLabel = "Chart",
  actions,
  children,
}: {
  back: string;
  /** What the way back says: Chart by default. */
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const s = styles();
  return (
    <div className={s.root()}>
      <div className={s.page()}>
        <Masthead className={s.masthead()}>
          <SiteMenu current="map" size="sm" ground="content" />
          <a
            href="/"
            className={mastheadStyles().brand()}
            aria-label="wingfoil.ie, wind map"
          >
            <MastheadMark />
          </a>
          <span className={mastheadStyles().actions()}>
            {actions}
            <Button variant="link" size="sm" href={back} data-back-to-map>
              <ArrowLeft size={13} strokeWidth={1.5} aria-hidden="true" />
              <span>{backLabel}</span>
            </Button>
          </span>
        </Masthead>
        {children}
      </div>
    </div>
  );
}
