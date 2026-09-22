import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { FRAME_COUNT, PHOTO, photo } from "./photos";

/**
 * What the marketplace's visual baseline stands on: the real API (the one
 * e2e/community/api.ts boots over the memory repos and dev identities, behind
 * the preview's /api proxy), a seller with eight listings, a buyer who saved
 * one and reviewed another, and a camera.
 *
 * Nothing is seeded inside the API (D23). The fixtures are posted over HTTP as
 * the two of them, once a worker, because every shot reads the same
 * marketplace and no shot writes to it.
 *
 * Two things a screenshot needs that a live marketplace does not:
 *
 * - A clock. Half of what a listing says is how old it is, and the API stamps
 *   its rows with the wall clock, so every page here is pinned three days past
 *   the instant the fixtures were made: "3 days ago" on any machine at any
 *   hour. `page.clock.setFixedTime` moves Date and nothing else, so the search
 *   box's debounce and the rest of the timers still run.
 * - Photos. photos.ts draws them, so a cover is the same pixels every run and
 *   never a broken image.
 *
 * Ids are random (market/api/src/ids.ts) and none of them is drawn: they are
 * in URLs and in DOM ids, neither of which a screenshot holds.
 *
 * One date the fixtures cannot stamp: "Member since", which the API takes from
 * when the dev identity first asked it for anything, and which the seller page
 * draws as a month and the listing page as a year. The API's clock is the
 * community suite's too, so it is pinned on the way into the browser instead.
 */

/** shared/web/auth.tsx DEV_USER_KEY, which cannot be imported without the identity provider's package. */
const DEV_USER_KEY = "wingfoil:dev-user";

/** Who the baseline is: dev identities, as e2e/community/people.ts explains. */
export const SELLER = "maeve";
export const BUYER = "fionn";
/** Signed in, and the API has never heard of them: the sell form's first step. */
export const NEWCOMER = "ronan";

/** The two widths every view is recorded at: a laptop and a phone. */
export const WIDTHS = [1240, 390] as const;
export type Width = (typeof WIDTHS)[number];
export const PHONE: Width = 390;

/** Where the recorded views live, relative to the repository root. */
const BASELINE = "e2e/market/__baseline__";

/** Three days, which is how far past the fixtures every page's clock is set. */
const AGE = 3 * 24 * 60 * 60 * 1000;

/** What every seller has been a member since, whatever month the shots are taken in. */
const MEMBER_SINCE = "2024-04-11T09:00:00.000Z";

/** A listing a shot goes looking for, by what it is there to show. */
export interface Fixture {
  id: string;
  title: string;
}

export interface Baseline {
  /** The seller, whose public page is /market/seller/<id>. */
  sellerId: string;
  /** Three photos, saved by the buyer: the pick of the grid. */
  featured: Fixture;
  /** The one the buyer enquired on and then reviewed. */
  reviewed: Fixture;
  /** Listed with no photo at all, and the newest, so browse opens on it. */
  noPhoto: Fixture;
  /** Sold, which browse hides and /me files under Sold. */
  sold: Fixture;
  /** What every page's clock is set to. */
  clock: number;
}

interface Gear {
  title: string;
  category: string;
  condition: string;
  brand: string | null;
  sizeLabel: string | null;
  year: number | null;
  priceCents: number;
  county: string;
  town: string;
  description: string;
  /** How many drawn photos it was listed with. */
  frames: number;
}

/**
 * The seller's eight, oldest first, which is the order they are posted in and
 * the reverse of the order browse shows them in. Brands are places, not makers:
 * nothing here names a real company.
 */
const GEAR: Gear[] = [
  {
    title: "Brandon 4m wing, 2023",
    category: "wing",
    condition: "good",
    brand: "Brandon",
    sizeLabel: "4m",
    year: 2023,
    priceCents: 38000,
    county: "Kerry",
    town: "Castlegregory",
    description:
      "My first wing and the one I learned on. Two seasons of use, no repairs, handle stitching all sound. Bag and leash included.",
    frames: 1,
  },
  {
    title: "Maharees 5m wing, 2024",
    category: "wing",
    condition: "like-new",
    brand: "Maharees",
    sizeLabel: "5m",
    year: 2024,
    priceCents: 55000,
    county: "Kerry",
    town: "Castlegregory",
    description:
      "Out about ten times last summer and stored dry all winter. No repairs, no leaks, every seam as it left the shop. Comes with the bag it came in.",
    frames: 3,
  },
  {
    title: "Achill 95L wing board",
    category: "board",
    condition: "good",
    brand: "Achill",
    sizeLabel: "95L",
    year: 2023,
    priceCents: 90000,
    county: "Mayo",
    town: "Keel",
    description:
      "Light enough to carry down the path and forgiving on a bad day. Two pressure dings on the rail, both filled and sealed, nothing soft. Straps and inserts all good.",
    frames: 2,
  },
  {
    title: "Complete foil, 85cm mast",
    category: "foil",
    condition: "fair",
    brand: "Inch",
    sizeLabel: "1250cm²",
    year: 2022,
    priceCents: 65000,
    county: "Galway",
    town: "Barna",
    description:
      "Mast, fuselage, front wing and stabiliser, all rinsed after every session. Scratches on the mast from a shallow launch, nothing structural. Selling as I have gone shorter.",
    frames: 2,
  },
  {
    title: "Front wing, 1250cm²",
    category: "foil-parts",
    condition: "good",
    brand: "Inch",
    sizeLabel: "1250cm²",
    year: 2023,
    priceCents: 34500,
    county: "Kerry",
    town: "Inch",
    description:
      "A low aspect front wing that gets up early and is happy at walking pace. Fits the usual fuselage bolt spacing. Marks on the tips, nothing that changes how it rides.",
    frames: 1,
  },
  {
    title: "5/4 winter wetsuit, large",
    category: "wetsuit",
    condition: "good",
    brand: null,
    sizeLabel: "L",
    year: null,
    priceCents: 12000,
    county: "Dublin",
    town: "Malahide",
    description:
      "Two winters in it and still warm. Chest zip, sealed seams, one small repair inside the left ankle. Fits about six foot and eighty kilos.",
    frames: 1,
  },
  {
    title: "Impact vest and quick-release harness",
    category: "safety",
    condition: "like-new",
    brand: null,
    sizeLabel: "M",
    year: null,
    priceCents: 14000,
    county: "Clare",
    town: "Lahinch",
    description:
      "Worn a handful of times before I changed size. The release on the harness works as it should and the vest has no tears. Sold together.",
    frames: 1,
  },
  {
    title: "Electric pump, two seasons on it",
    category: "accessory",
    condition: "fair",
    brand: null,
    sizeLabel: null,
    year: null,
    priceCents: 8000,
    county: "Cork",
    town: "Kinsale",
    description:
      "Runs off the car and fills a wing while you get changed. The case is scuffed and the hose has been taped once. Collection in Kinsale, or I can meet in the city.",
    frames: 0,
  },
];

/** The same person over HTTP that a shot's browser is signed in as. */
function over(request: APIRequestContext, who: string) {
  const headers = { Authorization: `Bearer dev:${who}` };
  return {
    async get(path: string) {
      const reply = await request.get(`/api/market${path}`, { headers });
      expect(reply.status(), `${who} GET ${path}`).toBe(200);
      return reply.json();
    },
    async post(path: string, data: unknown, status = 201) {
      const reply = await request.post(`/api/market${path}`, { headers, data });
      expect(reply.status(), `${who} POST ${path}`).toBe(status);
      return reply.json();
    },
    async put(path: string, data: unknown, status = 200) {
      const reply = await request.put(`/api/market${path}`, { headers, data });
      expect(reply.status(), `${who} PUT ${path}`).toBe(status);
      return reply.json();
    },
  };
}

async function makeBaseline(request: APIRequestContext): Promise<Baseline> {
  const seller = over(request, SELLER);
  const buyer = over(request, BUYER);

  await seller.put("/me", {
    displayName: "Maeve Doyle",
    county: "Kerry",
    contactEmail: "maeve@example.com",
    contactPhone: "087 123 4567",
    contactWhatsapp: true,
    bio: "Out in the Maharees most weekends since 2018. Everything here is my own gear, ridden and looked after, and I am happy to let you try it before you buy.",
  });
  // The reviewer needs a name of their own, or the review section asks for a
  // profile instead of a rating (app.ts, "profile-required").
  await buyer.put("/me", {
    displayName: "Fionn Casey",
    county: "Galway",
    contactEmail: "fionn@example.com",
  });

  // Every frame, uploaded again wherever a listing needs another photo: it is
  // the same camera, and a run is shorter for drawing them once.
  const frames = Array.from({ length: FRAME_COUNT }, (_, i) => photo(i));
  let next = 0;
  const upload = async () => {
    const body = frames[next++ % frames.length];
    const grant = await seller.post(
      "/uploads",
      { contentType: "image/png", byteLength: body.byteLength },
      200,
    );
    const put = await request.put(grant.uploadUrl, {
      headers: { "Content-Type": "image/png" },
      data: body,
    });
    expect(put.status(), "photo upload").toBe(204);
    return { key: grant.key, ...PHOTO };
  };

  const posted: Fixture[] = [];
  for (const { frames: count, ...input } of GEAR) {
    const photos = [];
    for (let i = 0; i < count; i++) photos.push(await upload());
    const listing = await seller.post("/listings", {
      ...input,
      currency: "EUR",
      photos,
    });
    posted.push({ id: listing.id, title: input.title });
    // Browse sorts on createdAt and breaks a tie on a random id, so no two
    // listings may be stamped the same millisecond.
    await new Promise((done) => setTimeout(done, 2));
  }

  const [sold, featured, reviewed] = posted;
  const noPhoto = posted[posted.length - 1];

  await buyer.put(`/listings/${featured.id}/saved`, { saved: true });
  // A review is for someone you actually got in touch with, so the buyer asks
  // for the seller's details first; it is also the seller's one enquiry.
  await buyer.get(`/listings/${reviewed.id}/contact`);
  await buyer.put(
    `/listings/${reviewed.id}/review`,
    {
      rating: 5,
      comment:
        "Met me at the slip, let me take the board out first, and it was exactly as described. Easy to deal with.",
    },
    201,
  );
  await seller.post(`/listings/${sold.id}/status`, { status: "sold" }, 200);

  const me = await seller.get("/me");
  return {
    sellerId: me.profile.id,
    featured,
    reviewed,
    noPhoto,
    sold,
    clock: Date.now() + AGE,
  };
}

/** The API outlives a test: the fixtures are made once and every shot reads them. */
let made: Promise<Baseline> | null = null;

export interface ShotOptions {
  /** The dev identity the browser is. Left out, nobody is signed in. */
  as?: string;
  /** A dialog belongs to the window, not the document: shoot what is on screen. */
  viewportOnly?: boolean;
}

/** Records one view at one width, once `prepare` has put it on the screen. */
export type Shoot = (
  view: string,
  width: Width,
  options: ShotOptions,
  prepare: (page: Page) => Promise<void>,
) => Promise<void>;

/**
 * The seller's age, pinned. Every marketplace reply but the photos goes through
 * here on its way into the browser and comes out with the one field the API
 * stamps from its own wall clock replaced, so a recapture next month draws the
 * same two lines as this one.
 */
async function pinMemberSince(page: Page) {
  await page.route(/\/api\/market\/(?!uploads\/)/, async (route) => {
    const reply = await route.fetch();
    await route.fulfill({
      status: reply.status(),
      contentType: reply.headers()["content-type"],
      body: (await reply.text()).replace(
        /"memberSince":"[^"]*"/g,
        `"memberSince":"${MEMBER_SINCE}"`,
      ),
    });
  });
}

/**
 * Everything that must be finished before the shutter, and the two states that
 * must never be recorded: a baseline of a skeleton or of an error page would be
 * converted to Tailwind as carefully as the view it stands in for.
 */
async function settle(page: Page) {
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  await expect(page.getByText(/could not be loaded/)).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // A full-page shot never scrolls, so a lazy image below the fold is never
    // asked for. Ask for all of them, and wait for pixels rather than bytes.
    for (const image of document.querySelectorAll("img"))
      image.loading = "eager";
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {})),
    );
  });
  // The site's type is fetched, not bundled (src/styles.css imports it), and a
  // fallback face moves every line of every shot. `document.fonts.check` is no
  // use — it answers true for a family nobody has — so ask the set itself.
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (f) => f.family.includes("DM Sans") && f.status === "loaded",
      ),
    ),
    "DM Sans loaded",
  ).toBe(true);
  // Every view is shot from the top. The header is sticky, so a page left
  // scrolled — the sell form scrolls its first bad field into view — would be
  // recorded with the header sitting across the middle of it.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

export const test = base.extend<{ baseline: Baseline; shoot: Shoot }>({
  baseline: async ({ request }, use) => {
    await use(await (made ??= makeBaseline(request)));
  },
  shoot: async ({ browser, baseURL, baseline }, use) => {
    await use(async (view, width, options, prepare) => {
      const phone = width === PHONE;
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: phone ? 844 : 900 },
        isMobile: phone,
        hasTouch: phone,
        deviceScaleFactor: 1,
        colorScheme: "light",
        // The pages drop every transition and animation under it, which is
        // most of what a screenshot can otherwise catch in flight.
        reducedMotion: "reduce",
      });
      try {
        if (options.as)
          await context.addInitScript(
            ([key, who]) => localStorage.setItem(key, who),
            [DEV_USER_KEY, options.as],
          );
        const page = await context.newPage();
        await page.clock.setFixedTime(baseline.clock);
        await pinMemberSince(page);
        await prepare(page);
        await settle(page);
        await page.screenshot({
          path: `${BASELINE}/${view}-${width}.png`,
          fullPage: !options.viewportOnly,
          animations: "disabled",
          caret: "hide",
          scale: "css",
        });
      } finally {
        await context.close();
      }
    });
  },
});

export { expect };
export type { Page };
