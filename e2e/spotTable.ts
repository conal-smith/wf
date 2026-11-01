import type { Page } from "@playwright/test";

/**
 * The spot report shows one day's hours in its Table at a time
 * (spot/web/report/SpotReport.tsx): press the day's card, then Table.
 */
export async function openDay(page: Page, iso: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
  }).format(new Date(iso));
  await page.locator(`[data-day-card="${date}"]`).click();
  const table = page.getByRole("button", { name: "Table", exact: true });
  if ((await table.getAttribute("aria-pressed")) !== "true") await table.click();
}
