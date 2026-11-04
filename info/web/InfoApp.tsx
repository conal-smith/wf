/**
 * The site's information pages: the privacy policy at /privacy, the terms of
 * use at /terms and help at /support. `src/main.tsx` lazy-loads this bundle
 * for those three paths alone, and the map opens it over itself from a link
 * (src/PagesOverMap.tsx), so none of the other pages pay for it and it pays
 * for none of them: no map, no forecast, nothing fetched but the page.
 *
 * Under the site's one top bar, a page of sentences: a heading, the date the
 * wording last changed, and sections under their own headings. The pages
 * link to each other at the foot, and the site menu links to all three.
 */
import type { JSX } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import {
  CHART_HREF,
  INFO_PAGES,
  infoPageOf,
  spotHref,
  type InfoPageId,
} from "../../force5/src/siteNav";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Link, SpotSearch, TopBar } from "../../ui";
import { tv } from "../../ui/tv";
import { infoStyles } from "./parts";
import { PrivacyPage } from "./Privacy";
import { SupportPage } from "./Support";
import { TermsPage } from "./Terms";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground font-body text-prose text-ink antialiased",
    // The same edge as the bar's, so the wordmark and the page line up.
    page: "flex w-full flex-1 flex-col px-safe-4 wide:px-safe-6",
    others:
      "m-0 mt-10 flex list-none flex-wrap gap-x-5 p-0 font-body text-body text-ink-muted",
    other: "inline-flex items-center pointer-coarse:min-h-touch",
  },
});

const PAGE: Record<InfoPageId, () => JSX.Element> = {
  privacy: PrivacyPage,
  terms: TermsPage,
  support: SupportPage,
};

export default function InfoApp() {
  const id = infoPageOf(window.location.pathname) ?? "support";
  const info = INFO_PAGES.find((page) => page.id === id)!;
  usePageTitle(info.title);
  const s = styles();
  const Page = PAGE[id];
  return (
    <div className={s.root()}>
      <TopBar
        search={
          <SpotSearch
            onPick={(spot) => window.location.assign(spotHref(spot.id))}
          />
        }
        view={{ to: "chart", href: CHART_HREF }}
        menu={<SiteMenu current={null} />}
      />
      <div className={s.page()}>
        <main className={infoStyles().main()} data-info={id}>
          <Page />
          <nav aria-label="About this site">
            <ul className={s.others()}>
              {INFO_PAGES.filter((page) => page.id !== id).map((page) => (
                <li key={page.id}>
                  <Link className={s.other()} href={page.href}>
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </main>
      </div>
    </div>
  );
}
