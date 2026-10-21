import { useEffect } from "react";
import { pageTitle } from "./pageTitle";

export { pageTitle };

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
