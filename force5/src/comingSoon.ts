import type { SiteSectionId } from "./siteNav";

/**
 * The sections that are built but not open yet. The live site starts with the
 * wind map alone: the marketplace and the community answer with a "coming
 * soon" page (shared/web/ComingSoon.tsx) and the site menu marks them so.
 *
 * VITE_OPEN_SECTIONS=1 at build time opens them: the e2e build does, so their
 * suites keep running, and so can a local demo. Opening one for good is
 * deleting it from the list here.
 */
export const COMING_SOON: ReadonlySet<SiteSectionId> = new Set<SiteSectionId>(
  import.meta.env.VITE_OPEN_SECTIONS ? [] : ["market", "community"],
);
