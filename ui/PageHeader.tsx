import type { ReactNode, Ref } from "react";
import { tv } from "./tv";
import { Wordmark } from "./Wordmark";

/*
 * The head of a page that is a tool rather than a read: the round site menu,
 * the small wordmark, and the page's own control set right, over the
 * broadsheet's double rule. The wordmark is there at every width, a phone's
 * included, as it is on the chart's head and a spot's page: the page always
 * says whose site it is. Plain paper, the width of the screen. The spot
 * finder (src/finder/SpotFinder.tsx) and the AI page (ai/web/AiApp.tsx) share
 * it, so the two stay the same.
 *
 *   <PageHeader menu={<SiteMenu current="finder" />}>
 *     <Segmented … />
 *   </PageHeader>
 *
 * `border-0` first: the site has no reset, and `border-double` sets the style
 * of all four sides, whose width is otherwise the browser's medium.
 */
export const pageHeaderStyles = tv({
  slots: {
    base: [
      "relative z-header flex items-center gap-3 border-0 border-b-3 border-double border-ink bg-ground px-4.5 py-3",
      "max-wide:gap-2 max-wide:px-3 max-wide:py-2.5",
    ],
    lead: "flex flex-1 items-center gap-3 max-wide:gap-2",
  },
});

export interface PageHeaderProps {
  /** The site menu, its trigger first in the row. */
  menu: ReactNode;
  className?: string;
  /** The page's own control, set right. */
  children?: ReactNode;
  /** The header itself, for a page that lays something out under it. */
  headRef?: Ref<HTMLElement>;
}

export function PageHeader({
  menu,
  className,
  children,
  headRef,
}: PageHeaderProps) {
  const styles = pageHeaderStyles();
  return (
    <header className={styles.base({ className })} ref={headRef}>
      <span className={styles.lead()}>
        {menu}
        <Wordmark size="sm" />
      </span>
      {children}
    </header>
  );
}
