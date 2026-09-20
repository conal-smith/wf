import AxeBuilder from "@axe-core/playwright";
import { AOIFE, CIAN } from "./people";
import { expect, message, test, unique, type Page } from "./fixtures";

/**
 * S7. A smoke, not an audit: the rules engine over the four views a member
 * spends their time in, signed in and with something on them, and nothing it
 * calls serious or critical. What it cannot see (focus order, what a control
 * is called, whether colour alone says something) is the other specs' and the
 * kit's business.
 */
async function worst(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      where: v.nodes.map((node) => node.target.join(" ")),
    }));
}

test("home, a channel, a thread and the new-thread dialog have no serious or critical violations", async ({
  as,
  member,
}) => {
  const thread = await member(CIAN).startThread(
    "foils",
    unique("Front wing for a heavier rider"),
    "Ninety kilos and **mostly** flat water. What area?\n\n- 1500\n- 1800",
  );
  await member(AOIFE).reply(thread, "1800, and you will not regret it.");
  await member(CIAN).reply(thread, "That is what the shop said too.");

  const aoife = await as(AOIFE);

  await test.step("home", async () => {
    await aoife.goto("/community");
    await expect(
      aoife.getByRole("main").getByRole("link", { name: thread.title }),
    ).toBeVisible();
    expect(await worst(aoife)).toEqual([]);
  });

  await test.step("a channel", async () => {
    await aoife.goto("/community/c/foils");
    await expect(
      aoife.getByRole("main").getByRole("link", { name: thread.title }),
    ).toBeVisible();
    expect(await worst(aoife)).toEqual([]);
  });

  await test.step("a thread", async () => {
    await aoife.goto(thread.path);
    await expect(message(aoife, "what the shop said")).toBeVisible();
    await expect(aoife.getByRole("form", { name: "Reply" })).toBeVisible();
    expect(await worst(aoife)).toEqual([]);
  });

  await test.step("the new-thread dialog", async () => {
    await aoife.goto("/community/c/foils?new=1");
    await expect(
      aoife.getByRole("dialog", { name: "Start a thread" }),
    ).toBeVisible();
    expect(await worst(aoife)).toEqual([]);
  });
});
