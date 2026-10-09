import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { devVerifier } from "./auth";
import { memoryRepo } from "./repo-memory";
import type { Storage } from "./storage";
import { memoryRepo as memoryCommunityRepo } from "../../../community/api/repo-memory";
import { devIdentity } from "../../../site/api/identity";
import { memoryUsersRepo } from "../../../site/api/repo-memory";
import type { User } from "../../../site/shared/types";
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
  const users = memoryUsersRepo();
  const repo = memoryRepo(users);
  const storage = fakeStorage();
  const app = createApp({
    repo,
    community: memoryCommunityRepo(users),
    people: { users, identity: devIdentity() },
    storage,
    verify: devVerifier(),
    storagePrefix: "market",
    corsOrigins: "*",
    authMode: "dev",
  });
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    user?: string,
  ) => {
    const res = await app.request(path, {
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
  const call = (method: string, path: string, body?: unknown, user?: string) =>
    request(method, `/api/market${path}`, body, user);
  return { app, repo, users, storage, call, request };
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
  it("requires contact details before listing, then publishes and lists", async () => {
    const { call } = harness();
    let r = await call("POST", "/listings", wing(), "aoife");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("contact_required");

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
    expect(me.profile).toMatchObject({ handle: "ciara", contactEmail: null });
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

  it("refuses an edit once the seller has no contact details left", async () => {
    const { call } = harness();
    await call("PUT", "/me", profile, "aoife");
    const { body } = await call("POST", "/listings", wing(), "aoife");

    let r = await call("PUT", "/me", { displayName: "Aoife" }, "aoife");
    expect(r.status).toBe(200);
    expect(r.body.contactEmail).toBeNull();

    r = await call("PUT", `/listings/${body.id}`, wing(), "aoife");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("contact_required");

    r = await call("PUT", "/me", { ...profile, contactEmail: "" }, "aoife");
    expect(r.status).toBe(200);
    r = await call("PUT", `/listings/${body.id}`, wing(), "aoife");
    expect(r.status).toBe(200);
  });

  it("answers 403 suspended on every write route, and still lets them read", async () => {
    const { call, request, users } = harness();
    await call("PUT", "/me", profile, "aoife");
    await call("PUT", "/me", profile, "brian");
    const { body: listing } = await call("POST", "/listings", wing(), "aoife");
    const { body: theirs } = await call("POST", "/listings", wing(), "brian");
    await call("GET", `/listings/${theirs.id}/contact`, undefined, "aoife");

    await users.setSuspendedUntil(
      "dev_aoife",
      new Date(Date.now() + 86_400_000),
    );

    const writes: [string, string, unknown][] = [
      ["POST", "/api/market/listings", wing()],
      ["PUT", `/api/market/listings/${listing.id}`, wing()],
      ["POST", `/api/market/listings/${listing.id}/status`, { status: "sold" }],
      ["PUT", `/api/market/listings/${theirs.id}/saved`, { saved: true }],
      ["PUT", `/api/market/listings/${theirs.id}/review`, { rating: 5 }],
      [
        "POST",
        "/api/market/uploads",
        { contentType: "image/jpeg", byteLength: 1000 },
      ],
      ["PUT", "/api/market/me", profile],
      ["PUT", "/api/me", profile],
    ];
    for (const [method, path, body] of writes) {
      const r = await request(method, path, body, "aoife");
      expect([method, path, r.status]).toEqual([method, path, 403]);
      expect(r.body.error).toBe("suspended");
    }

    expect((await request("GET", "/api/me", undefined, "aoife")).status).toBe(
      200,
    );
    expect((await call("GET", "/me", undefined, "aoife")).status).toBe(200);
    expect((await call("GET", "/listings", undefined, "aoife")).status).toBe(
      200,
    );
    // Someone else's writes are untouched.
    expect(
      (
        await call(
          "PUT",
          `/listings/${listing.id}/saved`,
          { saved: true },
          "brian",
        )
      ).status,
    ).toBe(200);

    // A suspension that has run out no longer blocks anything.
    await users.setSuspendedUntil("dev_aoife", new Date(Date.now() - 1000));
    expect((await request("PUT", "/api/me", profile, "aoife")).status).toBe(
      200,
    );
  });

  it("returns 401 for authenticated routes without a token", async () => {
    const { call, request } = harness();
    expect((await request("GET", "/api/me")).status).toBe(401);
    expect((await request("PUT", "/api/me", profile)).status).toBe(401);
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("POST", "/listings", wing())).status).toBe(401);
    expect((await call("GET", "/sellers/nobody")).status).toBe(404);
  });
});

describe("site API: /api/me", () => {
  it("makes the row on the first call, with a handle from the name", async () => {
    const { request } = harness();
    const r = await request("GET", "/api/me", undefined, "aoife");
    expect(r.status).toBe(200);
    const me: User = r.body;
    expect(me).toMatchObject({
      id: "dev_aoife",
      handle: "aoife",
      displayName: "aoife",
      avatarUrl: null,
      role: "member",
      suspendedUntil: null,
      contactEmail: null,
      contactPhone: null,
      contactWhatsapp: false,
    });

    const again: User = (await request("GET", "/api/me", undefined, "aoife"))
      .body;
    expect(again.createdAt).toBe(me.createdAt);
    expect(again.handle).toBe("aoife");
  });

  it("answers a cross-origin preflight, as /api/market does", async () => {
    const { app } = harness();
    for (const path of ["/api/me", "/api/market/me"]) {
      const res = await app.request(path, {
        method: "OPTIONS",
        headers: {
          Origin: "https://wingfoil.ie",
          "Access-Control-Request-Method": "PUT",
        },
      });
      expect([path, res.status]).toEqual([path, 204]);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    }
  });

  it("is the same row the marketplace reads and writes", async () => {
    const { call, request } = harness();
    let r = await request("PUT", "/api/me", profile, "aoife");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ handle: "aoife", displayName: "Aoife" });

    const me: MePayload = (await call("GET", "/me", undefined, "aoife")).body;
    expect(me.profile).toEqual(r.body);

    r = await call("PUT", "/me", { ...profile, handle: "aoife-k" }, "aoife");
    expect(r.status).toBe(200);
    expect((await request("GET", "/api/me", undefined, "aoife")).body).toEqual(
      r.body,
    );
    expect(r.body.handle).toBe("aoife-k");
  });

  it("saves a profile with no contact details", async () => {
    const { request } = harness();
    const r = await request(
      "PUT",
      "/api/me",
      { displayName: "Ciara", county: "Mayo", bio: "Rides Keel lake." },
      "ciara",
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      displayName: "Ciara",
      county: "Mayo",
      contactEmail: null,
      contactPhone: null,
    });
  });

  it("keeps the handle when none is sent, and validates one that is", async () => {
    const { request } = harness();
    await request("GET", "/api/me", undefined, "aoife");
    let r = await request("PUT", "/api/me", { displayName: "Aoife" }, "aoife");
    expect(r.body.handle).toBe("aoife");

    r = await request(
      "PUT",
      "/api/me",
      { displayName: "Aoife", handle: "Aoife-K" },
      "aoife",
    );
    expect(r.status).toBe(200);
    expect(r.body.handle).toBe("aoife-k");

    for (const handle of [
      "ab",
      "a".repeat(31),
      "aoife_k",
      "aoife k",
      "admin",
      "me",
    ]) {
      r = await request(
        "PUT",
        "/api/me",
        { displayName: "Aoife", handle },
        "aoife",
      );
      expect([handle, r.status]).toEqual([handle, 400]);
      expect(r.body.details.handle).toBeDefined();
    }
  });

  it("answers 409 handle_taken for someone else's handle", async () => {
    const { request } = harness();
    await request("GET", "/api/me", undefined, "aoife");
    const r = await request(
      "PUT",
      "/api/me",
      { displayName: "Brian", handle: "aoife" },
      "brian",
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("handle_taken");
    expect(r.body.details.handle).toBeDefined();
    expect(
      (await request("GET", "/api/me", undefined, "brian")).body.handle,
    ).toBe("brian");
  });
});

describe("switched-off sections", () => {
  function appWith(features: Parameters<typeof createApp>[0]["features"]) {
    const users = memoryUsersRepo();
    return createApp({
      repo: memoryRepo(users),
      community: memoryCommunityRepo(users),
      people: { users, identity: devIdentity() },
      storage: fakeStorage(),
      verify: devVerifier(),
      storagePrefix: "market",
      corsOrigins: "*",
      authMode: "dev",
      features,
    });
  }

  it("answers 404 off for the marketplace, but keeps its health check", async () => {
    const app = appWith({ market: false });
    const listings = await app.request("/api/market/listings");
    expect(listings.status).toBe(404);
    expect(await listings.json()).toMatchObject({ error: "off" });
    expect((await app.request("/api/market/health")).status).toBe(200);
    expect((await app.request("/api/community/meta")).status).toBe(200);
  });

  it("answers 404 off for the community", async () => {
    const app = appWith({ community: false });
    const meta = await app.request("/api/community/meta");
    expect(meta.status).toBe(404);
    expect(await meta.json()).toMatchObject({ error: "off" });
    expect((await app.request("/api/market/listings")).status).toBe(200);
  });

  it("tells the site Gust is off", async () => {
    const status = await appWith({ gust: false }).request(
      "/api/companion/status",
    );
    expect(await status.json()).toMatchObject({ state: "off" });
  });

  it("has everything on when nothing is said", async () => {
    const app = appWith(undefined);
    expect((await app.request("/api/market/listings")).status).toBe(200);
    expect((await app.request("/api/community/meta")).status).toBe(200);
  });
});
