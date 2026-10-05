import type { ReactNode } from "react";
import { MONO_LABEL, RING, tv } from "./tv";
import { Wordmark } from "./Wordmark";

/*
 * The masthead every page that is read shares: the site menu, the nameplate
 * with the section beside it in the mono label, and the section's own few
 * actions set right, over the broadsheet's double rule. It is paper, sticky,
 * and sits inside the page measure, as a nameplate sits inside the type area.
 *
 *   <Masthead>
 *     <SiteMenu current="market" size="sm" ground="content" />
 *     <Link to="/market" className={mastheadStyles().brand()}
 *       aria-label="wingfoil.ie Market, home">
 *       <MastheadMark section="Market" />
 *     </Link>
 *     <nav className={mastheadStyles().actions()} aria-label="Marketplace">…</nav>
 *   </Masthead>
 *
 * The brand link is the caller's, because each section's router takes a
 * link over in its own way; the classes and the mark inside it are these.
 */
export const mastheadStyles = tv({
  slots: {
    // Clear of a notch at the top: the larger of the step and the inset.
    base: "sticky top-0 z-header bg-ground paper-grain pt-safe-2",
    // `border-0` first: the site has no reset, and `border-double` sets the
    // style of all four sides, whose width is otherwise the browser's medium.
    bar: "flex min-h-14 items-center gap-3 border-0 border-b-3 border-double border-ink pb-2 max-wide:gap-2",
    // On a phone the section stands under the name rather than beside it, so
    // the menu, the name and two actions share 390px.
    brand: [
      "inline-flex min-w-0 items-center gap-3 rounded-control text-ink no-underline",
      "max-wide:flex-col max-wide:items-start max-wide:gap-0.5",
      RING,
    ],
    // The wordmark steps down a size on a phone.
    mark: "max-wide:text-lead",
    // The section, after a hairline: MARKET, COMMUNITY.
    section: [
      "border-0 border-l border-line pl-3 text-ink-muted max-wide:border-l-0 max-wide:pl-0",
      MONO_LABEL,
    ],
    actions: "ml-auto flex items-center gap-2 max-wide:gap-1",
  },
});

export interface MastheadProps {
  className?: string;
  /** The menu, the brand link, and the actions: in that order. */
  children: ReactNode;
}

export function Masthead({ className, children }: MastheadProps) {
  const styles = mastheadStyles();
  return (
    <header className={styles.base({ className })}>
      <div className={styles.bar()}>{children}</div>
    </header>
  );
}

/**
 * What goes inside the brand link: the wordmark, smaller on a phone, and the
 * section it is the home of, if it is not the map's own.
 */
export function MastheadMark({ section }: { section?: string }) {
  const styles = mastheadStyles();
  return (
    <>
      <Wordmark size="md" className={styles.mark()} />
      {section && <span className={styles.section()}>{section}</span>}
    </>
  );
}
