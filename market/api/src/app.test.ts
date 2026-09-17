import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { devVerifier } from "./auth";
import { memoryRepo } from "./repo-memory";
import type { Storage } from "./storage";
import type {
  Listing,
  MePayload,
  Page,
  Review,
  ReviewEligibility,
  SellerPage,
} from "../../shared/types";

function fakeStorage(): Storage & { deleted: string[] } {
  const deleted: string[] = [];
  let n = 0;
  return {
    deleted,
    keyFor: (userId) =>
      `market/${userId}/${String(++n).padStart(16, "0").replace(/0/g, "a")}.jpg`,
    publicUrl: (key) => `https://cdn.test/${key}`,
    async presign(key, contentType) {
      return {
        key,
        uploadUrl: `https://bucket.test/${key}?signed`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        publicUrl: `https://cdn.test/${key}`,
      };
    },
    async delete(key) {
      deleted.push(key);
    },
  };
}

function harness() {
  const repo = memoryRepo();
  const storage = fakeStorage();
  const app = createApp({
    repo,
    storage,
    verify: devVerifier(),
    storagePrefix: "market",
    corsOrigins: "*",
    authMode: "dev",
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    user?: string,
  ) => {
    const res = await app.request(`/api/market${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(user ? { Authorization: `Bearer dev:${user}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { app, repo, storage, call };
}

const profile = {
  displayName: "Aoife",
  county: "Kerry",
  contactEmail: "aoife@example.com",
  contactPhone: "087 123 4567",
  contactWhatsapp: true,
};

const wing = (over: Partial<Record<string, unknown>> = {}) => ({
  title: "Duotone Unit 5m",
  description:
    "Two seasons of use, no repairs, comes with bag and leash. Collect in Tralee.",
  category: "wing",
  condition: "good",
  brand: "Duotone",
  sizeLabel: "5m",
  year: 2024,
  priceCents: 55000,
  currency: "EUR",
  county: "Kerry",
  town: "Tralee",
  photos: [],
  ...over,
});

describe("marketplace API", () => {
  it("requires a profile before listing, then publishes and lists", async () => {
    const { call } = harness();
    let r = await call("POST", "/listings", wing(), "aoife");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("profile_required");

    r = await call("PUT", "/me", profile, "aoife");
    expect(r.status).toBe(200);
    expect(r.body.contactPhone).toBe("0871234567");

    r = await call("POST", "/listings", wing(), "aoife");
    expect(r.status).toBe(201);
    const listing: Listing = r.body;
    expect(listing.seller.displayName).toBe("Aoife");
    expect(listing.isOwner).toBe(true);
    expect(listing.seller.ratingAvg).toBeNull();

    const page = await call("GET", "/listings");
    expect((page.body as Page<Listing>).total).toBe(1);
    expect((page.body as Page<Listing>).items[0].isOwner).toBeUndefined();
  });

  it("rejects listings that fail validation with field messages", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    const r = await call(
      "POST",
      "/listings",
      wing({ title: "x", priceCents: -1, county: "Narnia" }),
      "aoife",
    );
    expect(r.status).toBe(400);
    expect(r.body.details.title).toMatch(/at least 4/);
    expect(r.body.details.priceCents).toBeDefined();
    expect(r.body.details.county).toBeDefined();
  });

  it("filters, searches and sorts", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    await call("POST", "/listings", wing(), "aoife");
    await call(
      "POST",
      "/listings",
      wing({
        title: "Armstrong 95L board",
        category: "board",
        priceCents: 90000,
        county: "Dublin",
        brand: "Armstrong",
      }),
      "aoife",
    );
    await call(
      "POST",
      "/listings",
      wing({ title: "Cheap pump", category: "accessory", priceCents: 2000 }),
      "aoife",
    );

    let r = await call("GET", "/listings?category=board");
    expect(r.body.items.map((l: Listing) => l.title)).toEqual([
      "Armstrong 95L board",
    ]);

    r = await call("GET", "/listings?q=armstrong");
    expect(r.body.total).toBe(1);

    r = await call("GET", "/listings?sort=price-asc");
    expect(r.body.items.map((l: Listing) => l.priceCents)).toEqual([
      2000, 55000, 90000,
    ]);

    r = await call("GET", "/listings?county=Kerry&maxPriceCents=60000");
    expect(r.body.total).toBe(2);

    r = await call("GET", "/listings?sort=nonsense&page=abc");
    expect(r.status).toBe(200);
    expect(r.body.page).toBe(1);
  });

  it("only lets the owner edit, and cleans up dropped photos", async () => {
    const { call, storage } = harness();
    await call("PUT", "/me", profile, "aoife");
    await call("PUT", "/me", { ...profile, displayName: "Brian" }, "brian");

    const presign = await call(
      "POST",
      "/uploads",
      { contentType: "image/jpeg", byteLength: 1000 },
      "aoife",
    );
    expect(presign.status).toBe(200);
    expect(presign.body.uploadUrl).toContain("signed");
    const key: string = presign.body.key;

    let r = await call(
      "POST",
      "/listings",
      wing({ photos: [{ key, width: 1600, height: 1200 }] }),
      "aoife",
    );
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect(r.body.photos).toHaveLength(1);
    expect(r.body.photos[0].url).toBe(`https://cdn.test/${key}`);

    r = await call(
      "POST",
      "/listings",
      wing({ photos: [{ key: "market/aoife/stolen.jpg" }] }),
      "brian",
    );
    expect(r.status).toBe(400);

    r = await call(
      "PUT",
      `/listings/${id}`,
      wing({ title: "Hijacked" }),
      "brian",
    );
    expect(r.status).toBe(403);

    r = await call(
      "PUT",
      `/listings/${id}`,
      wing({ title: "Duotone Unit 5m, price drop", photos: [] }),
      "aoife",
    );
    expect(r.status).toBe(200);
    expect(r.body.title).toBe("Duotone Unit 5m, price drop");
    expect(r.body.photos).toHaveLength(0);
    expect(storage.deleted).toEqual([key]);
  });

  it("hides removed listings from everyone but the owner", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    const { body } = await call("POST", "/listings", wing(), "aoife");
    let r = await call(
      "POST",
      `/listings/${body.id}/status`,
      { status: "sold" },
      "aoife",
    );
    expect(r.body.status).toBe("sold");
    expect(r.body.soldAt).toBeTruthy();
    expect((await call("GET", "/listings")).body.total).toBe(0);
    expect((await call("GET", `/listings/${body.id}`)).status).toBe(200);

    r = await call(
      "POST",
      `/listings/${body.id}/status`,
      { status: "removed" },
      "aoife",
    );
    expect(r.status).toBe(200);
    expect((await call("GET", `/listings/${body.id}`)).status).toBe(404);
    expect(
      (await call("GET", `/listings/${body.id}`, undefined, "aoife")).status,
    ).toBe(200);
  });

  it("saves listings and reports them in /me without needing a profile", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    const { body } = await call("POST", "/listings", wing(), "aoife");

    let r = await call(
      "PUT",
      `/listings/${body.id}/saved`,
      { saved: true },
      "ciara",
    );
    expect(r.status).toBe(200);
    r = await call("GET", `/listings/${body.id}`, undefined, "ciara");
    expect(r.body.saved).toBe(true);
    expect(r.body.isOwner).toBe(false);

    const me: MePayload = (await call("GET", "/me", undefined, "ciara")).body;
    expect(me.profile).toBeNull();
    expect(me.saved.map((l) => l.id)).toEqual([body.id]);
    expect(me.listings).toEqual([]);
  });

  it("gates reviews behind an enquiry and rolls them into seller ratings", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    await call("PUT", "/me", { ...profile, displayName: "Ciara" }, "ciara");
    const { body: listing } = await call("POST", "/listings", wing(), "aoife");

    let elig: ReviewEligibility = (
      await call("GET", `/listings/${listing.id}/review`, undefined, "ciara")
    ).body;
    expect(elig).toMatchObject({ canReview: false, reason: "no-enquiry" });

    let r = await call(
      "PUT",
      `/listings/${listing.id}/review`,
      { rating: 5 },
      "ciara",
    );
    expect(r.status).toBe(403);

    const contact = await call(
      "GET",
      `/listings/${listing.id}/contact`,
      undefined,
      "ciara",
    );
    expect(contact.status).toBe(200);
    expect(contact.body.phone).toBe("0871234567");
    expect(contact.body.whatsapp).toBe(true);

    elig = (
      await call("GET", `/listings/${listing.id}/review`, undefined, "ciara")
    ).body;
    expect(elig.canReview).toBe(true);

    r = await call(
      "PUT",
      `/listings/${listing.id}/review`,
      { rating: 4, comment: "Quick replies, gear as described." },
      "ciara",
    );
    expect(r.status).toBe(201);
    const review: Review = r.body;
    expect(review.reviewer.displayName).toBe("Ciara");

    r = await call(
      "PUT",
      `/listings/${listing.id}/review`,
      { rating: 5 },
      "ciara",
    );
    expect(r.status).toBe(200);

    r = await call(
      "PUT",
      `/listings/${listing.id}/review`,
      { rating: 5 },
      "aoife",
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("own-listing");

    const seller: SellerPage = (await call("GET", "/sellers/dev_aoife")).body;
    expect(seller.stats.ratingAvg).toBe(5);
    expect(seller.stats.ratingCount).toBe(1);
    expect(seller.stats.ratingHistogram[5]).toBe(1);
    expect(seller.reviews).toHaveLength(1);
    expect(seller.active).toHaveLength(1);

    const fresh = (await call("GET", `/listings/${listing.id}`))
      .body as Listing;
    expect(fresh.seller.ratingAvg).toBe(5);

    const me: MePayload = (await call("GET", "/me", undefined, "aoife")).body;
    expect(me.enquiries[listing.id]).toBe(1);
  });

  it("returns 401 for authenticated routes without a token", async () => {
    const { call } = harness();
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("POST", "/listings", wing())).status).toBe(401);
    expect((await call("GET", "/sellers/nobody")).status).toBe(404);
  });
});
