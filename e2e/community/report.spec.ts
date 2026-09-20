import { AOIFE, CIAN, STAFF } from "./people";
import { bell, expect, message, test, unique } from "./fixtures";

/**
 * S5. A report reaches the site's team in their bell, and nobody else (D21);
 * staff act where the message is, and what they remove reads as removed on the
 * pages that already had it open.
 */
test("a reported message reaches the staff bell, and removing it shows on both open pages", async ({
  as,
  member,
}) => {
  // A report goes to whoever is staff when it is made, so she is one by then.
  await member(STAFF).arrive();
  const thread = await member(AOIFE).startThread(
    "boards",
    unique("Volume for a first board"),
    "Eighty kilos, a year of kitesurfing behind me.",
  );
  await member(CIAN).reply(thread, "Twenty litres over your weight.");
  await member(CIAN).reply(thread, "Forget that, buy my old board, cash only.");
  // His bell starts from nothing, so that what it says later is this report's doing.
  await member(CIAN).readAll();

  const aoife = await as(AOIFE);
  const cian = await as(CIAN);
  await aoife.goto(thread.path);
  await cian.goto(thread.path);
  const advert = "buy my old board";
  await expect(message(cian, advert)).toBeVisible();

  await test.step("aoife reports it", async () => {
    await message(aoife, advert).hover();
    await message(aoife, advert)
      .getByRole("button", { name: "Report" })
      .click();
    const dialog = aoife.getByRole("dialog", { name: "Report cian’s message" });
    await dialog.getByLabel("What is wrong with it?").selectOption("spam");
    await dialog.getByRole("button", { name: "Send report" }).click();
    const sent = aoife.getByRole("dialog", {
      name: "Thanks, that has been sent",
    });
    await sent.getByRole("button", { name: "Done" }).click();
    await expect(sent).toHaveCount(0);
  });

  const staff = await as(STAFF);

  await test.step("the staff bell shows it, and the row opens the message", async () => {
    await staff.goto("/community");
    await expect(bell(staff)).toHaveAccessibleName(
      /^Notifications, \d+ unread$/,
    );
    await bell(staff).click();
    const row = staff
      .getByRole("dialog", { name: "Notifications" })
      .getByRole("link")
      .filter({ hasText: thread.title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Report");
    await expect(row).toContainText("aoife");
    await row.click();
    await expect(staff).toHaveURL(new RegExp(`${thread.path}#m-2$`));

    // Told to staff only: the one who wrote it has heard nothing. The count
    // is the API's answer on this load, since a bell that has not drawn its
    // answer yet reads the same as one with nothing in it.
    const counted = cian.waitForResponse(
      /\/api\/community\/notifications\/count/,
    );
    await cian.reload();
    expect((await (await counted).json()).count).toBe(0);
    await expect(message(cian, advert)).toBeVisible();
    await expect(bell(cian)).toHaveAccessibleName("Notifications");
  });

  await test.step("staff remove it, and it reads as removed for both", async () => {
    await message(staff, advert).hover();
    await message(staff, advert)
      .getByRole("button", { name: "Delete" })
      .click();
    await staff
      .getByRole("dialog", { name: "Delete this message?" })
      .getByRole("button", { name: "Delete" })
      .click();

    for (const page of [aoife, cian]) {
      const removed = page.locator("#m-2");
      await expect(removed).toContainText("This message was removed.");
      await expect(removed).not.toContainText(advert);
      await expect(page.getByText(advert)).toHaveCount(0);
      // The rest of the thread stands.
      await expect(message(page, "Twenty litres over")).toBeVisible();
    }
  });
});
