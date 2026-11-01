/**
 * The spot bundle's frame (a spot's page, the spot index, How the stars
 * work): the site's one top bar (ui/TopBar.tsx) the full width of the window,
 * over a page that uses the whole width too: a spot report has a lot to show,
 * and the wider the window the more of the week it shows.
 *
 * The bar's search goes to the spot picked, here in this bundle; its Chart
 * button opens the full chart (on this spot, from a spot's page).
 */
import type { ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { isStarsPath, spotHref } from "../../force5/src/siteNav";
import { SpotSearch, TopBar } from "../../ui";
import { tv } from "../../ui/tv";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground font-body text-prose text-ink antialiased",
    // The same edge as the bar's, so the wordmark and the page line up.
    page: "flex w-full flex-1 flex-col px-safe-4 wide:px-safe-6",
  },
});

export function SpotFrame({
  back,
  children,
}: {
  /** Where the bar's Chart button goes: the full chart, on this spot. */
  back: string;
  children: ReactNode;
}) {
  const s = styles();
  return (
    <div className={s.root()}>
      <TopBar
        search={
          <SpotSearch onPick={(spot) => window.location.assign(spotHref(spot.id))} />
        }
        view={{ to: "chart", href: back }}
        menu={
          <SiteMenu
            current={isStarsPath(window.location.pathname) ? "stars" : null}
          />
        }
      />
      <div className={s.page()}>{children}</div>
    </div>
  );
}
