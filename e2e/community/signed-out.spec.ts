import { AOIFE, CIAN } from "./people";
import { expect, message, test, unique } from "./fixtures";

/**
 * S2. Reading is open to everyone: home, a channel and a thread, with nobody
 * signed in, against the real API. Where a member would write, a reader is
 * offered the way in and nothing they cannot use.
 */
test("a signed-out reader browses home, a channel and a thread, and is offered sign-in where the reply goes", async ({
  page,
  member,
}) => {
  const thread = await member(AOIFE).startThread(
    "wings",
    unique("Which wing for twelve knots"),
    "A five metre is as big as I have. Is that enough?",
  );
  await member(CIAN).reply(thread, "Plenty, on a big enough foil.");

  await page.goto("/community");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Community");
  const actions = page.getByRole("navigation", { name: "Community" });
  await expect(actions.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(actions.getByText("New thread")).toHaveCount(0);
  await expect(
    actions.getByRole("link", { name: /^Notifications/ }),
  ).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: thread.title })).toBeVisible();

  // The channel, from the rail, without a page load.
  await page
    .getByRole("navigation", { name: "Channels" })
    .getByRole("link", { name: /Wings/ })
    .click();
  await expect(page).toHaveURL(/\/community\/c\/wings$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Wings/);
  await main.getByRole("link", { name: thread.title }).click();

  await expect(page).toHaveURL(new RegExp(`${thread.path}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    thread.title,
  );
  await expect(message(page, "Is that enough?")).toBeVisible();
  await expect(message(page, "Plenty, on a big enough foil.")).toBeVisible();

  // The gate stands where the composer would.
  await expect(page.getByText("Join the conversation")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in to reply" }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: "Reply" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveCount(
    0,
  );
});
