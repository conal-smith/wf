import { useEffect } from "react";

/** `Sell your gear — wingfoil.ie Market`: the page, then the site and section. */
export const pageTitle = (title: string, section: string) =>
  `${title} — wingfoil.ie ${section}`;

/** Names the tab for as long as the page is mounted, then puts back what was there. */
export function usePageTitle(title: string, section: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle(title, section);
    return () => {
      document.title = previous;
    };
  }, [title, section]);
}
