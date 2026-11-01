/**
 * The spot page's frame (backlog/mockups/2026-10-31-spot-page.html): a clean
 * top bar the full width of the window (the wordmark, a way to the spot
 * search, the chart, light or dark, and the site's menu) over a page that
 * uses the whole width too: a spot report has a lot to show, and the wider
 * the window the more of the week it shows.
 */
import { Map as MapIcon, Search } from "lucide-react";
import type { ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { Button } from "../../ui";
import { MastheadMark } from "../../ui/Masthead";
import { ThemeButton } from "../../ui/ThemeButton";
import { RING, tv } from "../../ui/tv";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground font-body text-prose text-ink antialiased",
    page: "flex w-full flex-1 flex-col px-safe-4 wide:px-safe-8 xwide:px-safe-12",
    bar: "flex h-16 items-center gap-3 border-0 border-b border-line",
    brand: ["text-ink no-underline", RING],
    search: [
      "ml-5 hidden h-10 w-80 items-center gap-2 rounded-full bg-sunken px-3.5 text-body text-ink-muted no-underline wide:flex",
      "transition-colors duration-fast hover:text-ink",
      RING,
    ],
    gap: "flex-1",
    tools: "flex items-center gap-2",
  },
});

export function SpotFrame({
  back,
  backLabel = "Chart",
  children,
}: {
  back: string;
  backLabel?: string;
  children: ReactNode;
}) {
  const s = styles();
  return (
    <div className={s.root()}>
      <div className={s.page()}>
        <header className={s.bar()}>
          <a
            href="/"
            className={s.brand()}
            aria-label="wingfoil.ie, the Spot finder"
          >
            <MastheadMark />
          </a>
          <a href="/" className={s.search()} data-spot-search>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            Search spots
          </a>
          <span className={s.gap()} />
          <span className={s.tools()}>
            <Button variant="raised" size="sm" href={back} data-back-to-map>
              <MapIcon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{backLabel}</span>
            </Button>
            <ThemeButton />
            {/* The site's navigation: neither of the menu's pages is this one. */}
            <SiteMenu current={null} size="sm" ground="content" />
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
