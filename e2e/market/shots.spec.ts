import {
  BUYER,
  NEWCOMER,
  PHONE,
  SELLER,
  WIDTHS,
  expect,
  test,
} from "./fixtures";

/**
 * S2, S3. Every marketplace view, at a laptop's width and a phone's, as the
 * conversion to Tailwind will have to find it again: populated, signed in
 * wherever being signed in is the point, and never mid-flight.
 *
 * Nothing here asserts pixels (AVOID): this item records, and a later one
 * compares. What each view does assert is a line of its own text, so that a
 * skeleton, an error or a signed-out page can never be recorded in place of
 * the view it is named after.
 *
 * `npm run market:shots` runs this and nothing else runs it: the files it
 * writes are committed, and `npm run test:e2e` must not rewrite them on its
 * way past (playwright.config.ts).
 *
 * One thing the shots show that production would not: the e2e build has no
 * identity provider (shared/web/auth.tsx), so where a signed-out page would
 * offer a way in, this one says sign-in is not configured.
 */

test("browse: the grid, and the filters open on a phone", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS)
    await shoot("browse", width, { as: BUYER }, async (page) => {
      await page.goto("/market");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Second-hand gear: across Ireland",
      );
      // Seven of the eight: the eighth is sold, and browse does not keep those.
      await expect(page.getByText("7 listings")).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(baseline.noPhoto.title) }),
      ).toBeVisible();
    });

  await shoot("browse-filters", PHONE, { as: BUYER }, async (page) => {
    await page.goto("/market?category=wing&maxPriceCents=60000");
    await expect(page.getByText("1 listing")).toBeVisible();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
  });

  // Nothing matches: the empty pane, the way back out of it, and the only
  // place the search box is drawn with something in it.
  for (const width of WIDTHS)
    await shoot("browse-empty", width, { as: BUYER }, async (page) => {
      await page.goto("/market?q=drysuit");
      await expect(page.getByText("0 listings")).toBeVisible();
      await expect(page.getByText("Nothing matches that search")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Clear all filters" }),
      ).toBeVisible();
    });
});

test("a listing, as a buyer: with photos, reviewed, with no photo, and sold", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("listing", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        baseline.featured.title,
      );
      await expect(
        page.getByRole("button", { name: "Contact seller" }),
      ).toBeVisible();
    });

    // The one they enquired on and rated, which is the only place the rating
    // form is drawn.
    await shoot("listing-review", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.reviewed.id}`);
      await expect(
        page.getByRole("heading", { name: "Your review of this seller" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Update review" }),
      ).toBeVisible();
    });

    // Pressed, on the listing they already enquired on: asking twice records
    // nothing new, and the panel of ways to reach the seller is drawn here and
    // nowhere else.
    await shoot("listing-contact", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.reviewed.id}`);
      await page.getByRole("button", { name: "Contact seller" }).click();
      await expect(page.getByText("Contact Maeve Doyle")).toBeVisible();
      await expect(page.getByRole("link", { name: /WhatsApp/ })).toBeVisible();
    });

    await shoot("listing-no-photo", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.noPhoto.id}`);
      await expect(
        page.getByText("The seller has not added photos"),
      ).toBeVisible();
    });

    await shoot("listing-sold", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.sold.id}`);
      await expect(page.getByText("Sold", { exact: true })).toBeVisible();
      await expect(page.getByText("This item has been sold")).toBeVisible();
    });

    await shoot("listing-signed-out", width, {}, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        baseline.featured.title,
      );
      await expect(
        page.getByRole("button", { name: "Sign in to contact" }),
      ).toBeVisible();
    });
  }
});

test("a listing the seller owns, and the dialog that removes it", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("listing-owner", width, { as: SELLER }, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(
        page.getByRole("link", { name: "Edit listing" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Mark as sold" }),
      ).toBeVisible();
    });

    await shoot(
      "confirm-dialog",
      width,
      { as: SELLER, viewportOnly: true },
      async (page) => {
        await page.goto(`/market/listing/${baseline.featured.id}`);
        await page.getByRole("button", { name: "Remove listing" }).click();
        await expect(
          page.getByRole("heading", { name: "Remove this listing?" }),
        ).toBeVisible();
      },
    );
  }
});

test("selling: the empty form, the form with errors, and the way in", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("sell", width, { as: SELLER }, async (page) => {
      await page.goto("/market/sell");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "What are you selling?",
      );
    });

    // The same form filled in, which is the only time the photo tiles, the
    // cover chip and the reorder and remove tools are on the screen.
    await shoot("sell-edit", width, { as: SELLER }, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}/edit`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Edit listing",
      );
      await expect(page.getByAltText("Photo 1")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save changes" }),
      ).toBeVisible();
    });

    // Step 1: somebody the API has never heard of, so there is no way to reach
    // them yet and the profile form is asked for before the listing form.
    await shoot("sell-contact", width, { as: NEWCOMER }, async (page) => {
      await page.goto("/market/sell");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "First, how buyers reach you",
      );
      await expect(
        page.getByRole("button", { name: "Save and continue" }),
      ).toBeVisible();
    });

    // Signed out, where the build's missing identity provider is the whole of
    // what is drawn: in production this offers a way in instead.
    await shoot("sell-signed-out", width, {}, async (page) => {
      await page.goto("/market/sell");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Sell your gear",
      );
      await expect(page.getByRole("alert")).toBeVisible();
    });

    // Nothing filled in and published anyway: the form answers before the API
    // is asked, field by field.
    await shoot("sell-errors", width, { as: SELLER }, async (page) => {
      await page.goto("/market/sell");
      await page.getByRole("button", { name: "Publish listing" }).click();
      await expect(
        page.getByText(/title of at least 4 characters/),
      ).toBeVisible();
      await expect(page.getByText(/Enter a price like 450/)).toBeVisible();
    });
  }
});

test("my account: every tab", async ({ shoot, baseline }) => {
  for (const width of WIDTHS) {
    // Two people, because a tab is only worth a baseline with something in it:
    // the seller has the listings and the profile, the buyer the rest.
    await shoot("me-listings", width, { as: SELLER }, async (page) => {
      await page.goto("/market/me");
      await expect(
        page.getByRole("heading", { name: "Live (7)" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Sold (1)" }),
      ).toBeVisible();
    });

    await shoot("me-saved", width, { as: BUYER }, async (page) => {
      await page.goto("/market/me/saved");
      // The card, by its title: the Saved tab draws no "Saved" badge, since
      // everything on it is.
      await expect(
        page.getByRole("link", { name: baseline.featured.title }),
      ).toBeVisible();
    });

    await shoot("me-reviews", width, { as: BUYER }, async (page) => {
      await page.goto("/market/me/reviews");
      await expect(page.getByText(/Met me at the slip/)).toBeVisible();
    });

    await shoot("me-profile", width, { as: SELLER }, async (page) => {
      await page.goto("/market/me/profile");
      await expect(
        page.getByRole("textbox", { name: "Display name" }),
      ).toHaveValue("Maeve Doyle");
    });

    // The gate, which is what /me is for anyone not signed in.
    await shoot("me-signed-out", width, {}, async (page) => {
      await page.goto("/market/me");
      await expect(page.getByText("Sign in to see your account")).toBeVisible();
    });
  }
});

test("the seller's public page, and their reviews", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("seller", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/seller/${baseline.sellerId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Maeve Doyle",
      );
      await expect(page.getByRole("tab", { name: "Live (7)" })).toBeVisible();
    });

    // The sold tab, which is the only grid drawn with a status on the cards.
    await shoot("seller-sold", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/seller/${baseline.sellerId}`);
      await page.getByRole("tab", { name: "Sold (1)" }).click();
      await expect(
        page.getByRole("link", { name: new RegExp(baseline.sold.title) }),
      ).toBeVisible();
    });

    await shoot("seller-reviews", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/seller/${baseline.sellerId}`);
      await page.getByRole("tab", { name: "Reviews (1)" }).click();
      await expect(page.getByText(/Met me at the slip/)).toBeVisible();
    });
  }
});

test("a URL under /market that is not a page", async ({ shoot }) => {
  for (const width of WIDTHS)
    await shoot("not-found", width, { as: BUYER }, async (page) => {
      await page.goto("/market/no-such-page");
      await expect(page.getByText("That page does not exist")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Browse listings" }),
      ).toBeVisible();
    });
});
