import { AOIFE, CIAN } from "./people";
import {
  bell,
  expect,
  message,
  sendReply,
  test,
  unique,
  type Page,
} from "./fixtures";

/**
 * S3 and S4: two people, two browser contexts, one thread.
 *
 * Aoife's page runs on a clock the test steps, so the bell's minute (D19) is
 * a line here and not a wait. Everything else on it (the stream, the reply
 * arriving) is the page's own doing: it is never reloaded after it opens the
 * thread, and `stayed` holds it to that.
 */

const MINUTE = 60_000;

/** A page that has been loaded since this was set has lost it. */
const stay = (page: Page) =>
  page.evaluate(() => {
    (window as { stayed?: boolean }).stayed = true;
  });
const stayed = (page: Page) =>
  page.evaluate(() => (window as { stayed?: boolean }).stayed === true);

/**
 * Steps the bell's clock a minute on, waits for the count it then asks for and
 * answers with it. The number is the API's own: a bell that still reads
 * "Notifications" may only not have drawn the answer yet, so a step that
 * expects silence holds the answer to it as well as the bell.
 */
async function nextCount(page: Page): Promise<number> {
  const counted = page.waitForResponse(
    /\/api\/community\/notifications\/count/,
  );
  await page.clock.fastForward(MINUTE);
  return (await (await counted).json()).count;
}

test("a thread, a reply that arrives live, the bell, a mention, and a thread set to nothing", async ({
  as,
  member,
}) => {
  test.slow();
  const title = unique("Dollymount on a north-easterly");

  // Cian is a member in standing: three messages up, so he may mention people.
  const warmUp = await member(CIAN).startThread(
    "off-topic",
    unique("Wetsuit boots that last"),
    "Mine are done after one winter.",
  );
  await member(CIAN).reply(warmUp, "Size up, they say.", "Or go barefoot.");
  // Whatever another spec left in her bell is not this one's to count.
  await member(AOIFE).readAll();

  const aoife = await as(AOIFE);
  await aoife.clock.install();

  await test.step("aoife starts a thread", async () => {
    await aoife.goto("/community/c/spots-and-conditions");
    await aoife
      .getByRole("navigation", { name: "Community" })
      .getByRole("link", { name: "New thread" })
      .click();
    const dialog = aoife.getByRole("dialog", { name: "Start a thread" });
    await dialog.getByLabel("Title").fill(title);
    await dialog
      .getByLabel("What’s on your mind?")
      .fill("Is the causeway end rideable at low water?");
    await dialog.getByRole("button", { name: "Post thread" }).click();

    await expect(aoife).toHaveURL(/\/community\/t\/[^/]+\/dollymount-/);
    await expect(aoife.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(message(aoife, "Is the causeway end rideable")).toBeVisible();
    // Starting it follows it (D19).
    await expect(
      aoife.getByRole("button", { name: "Following · every reply" }),
    ).toBeVisible();
  });

  const path = new URL(aoife.url()).pathname;
  const thread = {
    id: path.split("/")[3],
    slug: path.split("/")[4],
    title,
    path,
  };

  await test.step("the thread grows past the window, and she reads from its top", async () => {
    // Her own words, which notify nobody. They arrive on the open page.
    await member(AOIFE).reply(
      thread,
      ...Array.from({ length: 16 }, (_, i) => `Tide note ${i + 1}`),
    );
    await expect(message(aoife, "Tide note 16")).toBeVisible();
    // Away from the end: what arrives now is unread, as it is for anyone who
    // has the thread open and is looking at something else in it.
    await aoife.evaluate(() => window.scrollTo({ top: 0 }));
    await stay(aoife);
    await expect(bell(aoife)).toHaveAccessibleName("Notifications");
  });

  const cian = await as(CIAN);
  await cian.goto(thread.path);

  await test.step("S3: cian replies, and it is on her open page and then in her bell", async () => {
    await sendReply(cian, "Rideable, but mind the mussel beds.");
    await expect(message(cian, "mind the mussel beds")).toBeVisible();

    await expect(message(aoife, "mind the mussel beds")).toBeAttached();
    await expect(aoife.getByRole("button", { name: "1 new" })).toBeVisible();
    expect(await stayed(aoife)).toBe(true);

    // The bell asks once a minute. Until the minute passes it has not heard.
    await expect(bell(aoife)).toHaveAccessibleName("Notifications");
    expect(await nextCount(aoife)).toBe(1);
    await expect(bell(aoife)).toHaveAccessibleName("Notifications, 1 unread");
  });

  await test.step("S4: a mention is a row of its own", async () => {
    const field = cian.getByRole("textbox", { name: "Your reply" });
    await field.pressSequentially("@ao");
    await expect(
      cian
        .getByRole("listbox", { name: "Mention someone" })
        .getByRole("option", { name: /aoife/ }),
    ).toHaveAttribute("aria-selected", "true");
    await field.press("Enter");
    await expect(field).toHaveValue("@aoife ");
    // The pick puts the caret after the name on the next frame; a person is
    // never faster than that, and a test that is would type in front of it.
    await cian.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => done(null))),
    );
    await field.pressSequentially("the beds are marked on the chart.");
    await cian
      .getByRole("form", { name: "Reply" })
      .getByRole("button", { name: "Reply" })
      .click();
    await expect(message(cian, "marked on the chart")).toContainText("@aoife");

    await expect(message(aoife, "marked on the chart")).toBeAttached();
    expect(await nextCount(aoife)).toBe(2);
    await expect(bell(aoife)).toHaveAccessibleName("Notifications, 2 unread");

    await bell(aoife).click();
    const inbox = aoife.getByRole("dialog", { name: "Notifications" });
    const rows = inbox.getByRole("link").filter({ hasText: title });
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Mention" })).toHaveCount(1);
    await expect(rows.filter({ hasText: /new repl/ })).toHaveCount(1);

    // Read, so that the count starts from nothing for what comes next.
    await inbox.getByRole("button", { name: "Mark all read" }).click();
    await expect(bell(aoife)).toHaveAccessibleName("Notifications");
    await aoife.keyboard.press("Escape");
    await expect(inbox).toHaveCount(0);
  });

  await test.step("S4: set to nothing, a further reply raises no count", async () => {
    await aoife
      .getByRole("button", { name: "Following · every reply" })
      .click();
    await aoife
      .getByRole("group", { name: "Notify me about" })
      .getByRole("button", { name: "Nothing" })
      .click();
    await expect(
      aoife.getByRole("button", { name: "Not following" }),
    ).toBeVisible();

    await sendReply(cian, "Low water is half four tomorrow.");
    // It still arrives: the thread is open. It is the bell that stays quiet.
    await expect(message(aoife, "half four tomorrow")).toBeAttached();
    expect(await nextCount(aoife)).toBe(0);
    await expect(bell(aoife)).toHaveAccessibleName("Notifications");
    expect(await stayed(aoife)).toBe(true);
  });
});
