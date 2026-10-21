/**
 * `Sell your gear — wingfoil.ie Market`: the page, then the site and section.
 * Without React, so the Pages worker writes the title a spot page sets for
 * itself into the HTML it sends (mcp/pages/head.ts).
 */
export const pageTitle = (title: string, section: string) =>
  `${title} — wingfoil.ie ${section}`;
