/**
 * The one top bar, on every page that has a head: the finder, the chart, a
 * spot's page, How the stars work, the spot index, Use with AI. The wordmark
 * at the left (it goes home), the search beside it, then at the right one
 * outlined button for the other view (Chart, or Spots on the chart), light or
 * dark, and the site menu at the far right. 64px tall, 56 on a phone, with one
 * hairline under it and nothing heavier. On a phone the search folds into a
 * round button and light or dark moves into the menu.
 *
 *   <TopBar
 *     search={<SpotSearch onPick={…} />}
 *     view={{ to: "chart", href: CHART_HREF }}
 *     menu={<SiteMenu current="finder" />}
 *   />
 */
import { List, Map as MapIcon } from "lucide-react";
import type { MouseEvent, ReactNode, Ref } from "react";
import { Button } from "./Button";
import { ThemeButton } from "./ThemeButton";
import { RING, tv } from "./tv";
import { Wordmark } from "./Wordmark";

export const topBarStyles = tv({
  slots: {
    base: [
      "relative z-header flex h-16 shrink-0 items-center gap-2.5 border-0 border-b border-line bg-ground px-safe-6 font-body text-ink",
      "max-wide:h-14 max-wide:gap-2 max-wide:px-safe-4",
    ],
    brand: ["shrink-0 rounded-control text-ink no-underline", RING],
    search: "ml-4.5 min-w-0 max-wide:ml-0 max-wide:order-1",
    gap: "flex-1",
    actions: "flex items-center gap-2 max-wide:order-2 max-wide:gap-1",
    view: "max-wide:order-2 max-wide:px-3.5",
    // On a phone with a section's own actions beside it, the button to the
    // other view keeps its glyph and its name for a screen reader only.
    viewWord: "",
    theme: "max-wide:hidden",
    menu: "max-wide:order-3",
  },
  variants: {
    crowded: {
      true: {
        view: "max-wide:w-control-md max-wide:px-0",
        viewWord: "max-wide:sr-only",
      },
    },
  },
});

export interface TopBarView {
  /** The other view: the full chart, or the list of spots. */
  to: "chart" | "spots";
  href: string;
  /** In place of following the link, where the page can open it itself. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface TopBarProps {
  /** Where the wordmark goes: home, the Spot finder. */
  home?: string;
  /** In place of following the wordmark's link. */
  onHome?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** The search (ui/SpotSearch.tsx). */
  search?: ReactNode;
  /** A section's own few actions (the marketplace's Sell, the community's
   * bell), before the button to the other view. */
  actions?: ReactNode;
  /** The button to the other view. */
  view?: TopBarView;
  /** Light or dark, on a computer; on a phone Settings carries it. */
  theme?: boolean;
  /** The site menu (force5/src/SiteMenu.tsx), at the far right. */
  menu: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
}

/** Following a link the page would rather open itself, but not into a new tab. */
const plainClick = (event: MouseEvent) =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) &&
  event.button === 0;

export function TopBar({
  home = "/",
  onHome,
  search,
  actions,
  view,
  theme = true,
  menu,
  className,
  ref,
}: TopBarProps) {
  const s = topBarStyles({ crowded: !!actions });
  return (
    <header className={s.base({ className })} ref={ref} data-top-bar>
      <a
        href={home}
        className={s.brand()}
        aria-label="wingfoil.ie, the Spot finder"
        onClick={
          onHome
            ? (event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                onHome(event);
              }
            : undefined
        }
      >
        <Wordmark />
      </a>
      {search && <div className={s.search()}>{search}</div>}
      <span className={s.gap()} />
      {actions && <div className={s.actions()}>{actions}</div>}
      {view && (
        <Button
          href={view.href}
          className={s.view()}
          title={view.to === "chart" ? "The full chart" : "The list of spots"}
          onClick={
            view.onClick
              ? (event: MouseEvent<HTMLAnchorElement>) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  view.onClick?.(event);
                }
              : undefined
          }
          data-view-switch={view.to}
        >
          {view.to === "chart" ? (
            <MapIcon size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <List size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className={s.viewWord() || undefined}>
            {view.to === "chart" ? "Chart" : "Spots"}
          </span>
        </Button>
      )}
      {theme && <ThemeButton className={s.theme()} />}
      <div className={s.menu()}>{menu}</div>
    </header>
  );
}
