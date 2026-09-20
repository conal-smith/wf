import { AOIFE, CIAN } from "./people";
import { expect, message, sendReply, test, unique } from "./fixtures";

/**
 * S6. The phone project's one spec (playwright.config.ts): 390 wide, touch.
 * On a phone the channel list is the home page, and each step down is a page
 * of its own: channels, a channel, a thread, a reply.
 */
test("on a phone: channels, a channel, a thread, a reply", async ({
  as,
  member,
}) => {
  const thread = await member(CIAN).startThread(
    "technique",
    unique("Gybing without coming off the foil"),
    "I touch down every time the wing goes over.",
  );

  const aoife = await as(AOIFE);
  await aoife.goto("/community");
  expect(aoife.viewportSize()?.width).toBe(390);

  const sideways = () =>
    aoife.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

  // Channels: the list is the page.
  const channels = aoife.getByRole("navigation", { name: "Channels" });
  await expect(channels.getByRole("link", { name: /Technique/ })).toBeVisible();
  expect(await sideways()).toBe(0);
  await channels.getByRole("link", { name: /Technique/ }).tap();

  // A channel: its threads, and the list it came from is a way back, not a column.
  await expect(aoife).toHaveURL(/\/community\/c\/technique$/);
  await expect(aoife.getByRole("heading", { level: 1 })).toHaveText(
    /Technique/,
  );
  await expect(channels).toBeHidden();
  // Technique has more tags than a phone is wide: the strip scrolls, the page does not.
  const strip = aoife
    .getByRole("navigation", { name: "Filter by tag" })
    .getByRole("list");
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(await sideways()).toBe(0);
  await aoife.getByRole("main").getByRole("link", { name: thread.title }).tap();

  // A thread, and a reply from the docked composer.
  await expect(aoife).toHaveURL(new RegExp(`${thread.path}$`));
  await expect(aoife.getByRole("heading", { level: 1 })).toHaveText(
    thread.title,
  );
  await expect(message(aoife, "I touch down every time")).toBeVisible();
  await sendReply(aoife, "Look where you want to go, not at the wing.");
  await expect(message(aoife, "Look where you want to go")).toBeVisible();
  await expect(aoife.getByRole("textbox", { name: "Your reply" })).toHaveValue(
    "",
  );
  expect(await sideways()).toBe(0);

  // It is in the thread for everyone, not only on this page.
  await aoife.reload();
  await expect(message(aoife, "Look where you want to go")).toBeVisible();
});
