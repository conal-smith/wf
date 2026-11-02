/**
 * `Sell your gear — wingfoil.ie Market`: the page, then the site and section,
 * or the site alone for a page of no section (`Privacy — wingfoil.ie`).
 * Without React, so the Pages worker writes the title a spot page sets for
 * itself into the HTML it sends (mcp/pages/head.ts).
 */
export const pageTitle = (title: string, section?: string) =>
  section ? `${title} — wingfoil.ie ${section}` : `${title} — wingfoil.ie`;
