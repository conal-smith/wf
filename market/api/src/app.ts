/**
 * The HTTP surface. The marketplace lives under /api/market, the community
 * under /api/community, the forecast for AI assistants under /api/mcp, Gust
 * the in-app companion under /api/companion, the app's star-condition
 * alerts under /api/alerts and the site's own routes (/api/me) beside them, so
 * the same routes work behind a same-origin proxy in development and on their
 * own Railway domain in production.
 */
import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import {
  optionalAuth,
  requireAuth,
  type AuthVariables,
  type Verifier,
} from "./auth.js";
import { fail } from "./errors.js";
import type { Features } from "./env.js";
import { ID_PATTERN, newId } from "./ids.js";
import type { PhotoRow, Repo } from "./repo.js";
import { keyBelongsTo, type Storage } from "./storage.js";
import {
  createAlertsRouter,
  type AlertsDeps,
} from "../../../alerts/api/router.js";
import type { Hub } from "../../../community/api/hub.js";
import type { Limiter } from "../../../community/api/limits.js";
import type { Repo as CommunityRepo } from "../../../community/api/repo.js";
import { createCommunityRouter } from "../../../community/api/router.js";
import {
  createCompanionRouter,
  type CompanionDeps,
} from "../../../companion/api/router.js";
import { createMcpRouter } from "../../../mcp/api/server.js";
import type { ForecastSource } from "../../../mcp/api/source.js";
import {
  blockSuspended,
  createSiteRouter,
  meHandlers,
} from "../../../site/api/router.js";
import { ensureUser, type People } from "../../../site/api/users.js";
import { hasContact } from "../../../site/shared/types.js";
import {
  CATEGORIES,
  CONDITIONS,
  COUNTIES,
  CURRENCIES,
  LIMITS,
  type Listing,
  type MePayload,
  type PhotoInput,
  type ReviewEligibility,
  type SellerContact,
} from "../../shared/types.js";
import {
  issuesByField,
  listingInputSchema,
  parseListingQuery,
  presignRequestSchema,
  reviewInputSchema,
} from "../../shared/validate.js";

export interface AppDeps {
  repo: Repo;
  /** The forum's own persistence seam, beside the marketplace's. */
  community: CommunityRepo;
  /** The site's `users` table and where a new row's name comes from. */
  people: People;
  verify: Verifier;
  storage: Storage;
  storagePrefix: string;
  corsOrigins: string[] | "*";
  authMode: "clerk" | "dev";
  /** The clock the community measures its edit window on. Tests move it. */
  now?: () => Date;
  /** Where the community announces a committed write to its open threads. */
  hub?: Hub;
  /** The community's rate limits. Left out, the real ones; see community/api/limits.ts. */
  limiter?: Limiter;
  /**
   * Where the MCP endpoint reads the published forecast. Left out, /api/mcp
   * is not mounted.
   */
  forecast?: ForecastSource;
  /**
   * Gust, the companion. Left out, /api/companion is still mounted and says
   * it is not configured, so the site can show Gust asleep rather than broken.
   */
  companion?: Omit<CompanionDeps, "source" | "enabled">;
  /**
   * The sections switched on (FEATURE_*, env.ts). Left out, everything is on,
   * as the tests and the e2e API want. A section that is off answers 404 off
   * for its routes; Gust says he is off from /api/companion/status.
   */
  features?: Partial<Features>;
  /**
   * The app's star-condition alerts (alerts/api). Left out, /api/alerts is
   * not mounted; with FEATURE_ALERTS off it answers 404 off.
   */
  alerts?: AlertsDeps;
}

type Env = { Variables: AuthVariables };

const JSON_LIMIT = 64 * 1024;

export function createApp(deps: AppDeps) {
  const { repo, people, storage } = deps;
  const app = new Hono<Env>();
  const features: Features = {
    gust: true,
    market: true,
    community: true,
    alerts: true,
    ...deps.features,
  };

  // A section that is switched off. The marketplace keeps its health check,
  // which the container's HEALTHCHECK reads, and the photos it serves in
  // local storage mode, which the community's messages use too.
  const off =
    (what: string, keep: RegExp | null) => async (c: Context, next: Next) => {
      if (keep?.test(c.req.path)) return next();
      return c.json(
        { error: "off", message: `The ${what} is switched off on this site.` },
        404,
      );
    };
  if (!features.market)
    app.use(
      "/api/market/*",
      off("marketplace", /^\/api\/market\/(health$|uploads\/)/),
    );
  if (!features.community) app.use("/api/community/*", off("community", null));
  if (!features.alerts) app.use("/api/alerts/*", off("alerts service", null));

  for (const path of [
    "/api/market/*",
    "/api/community/*",
    "/api/me",
    "/api/me/*",
  ]) {
    app.use(
      path,
      cors({
        origin: deps.corsOrigins === "*" ? "*" : deps.corsOrigins,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: 600,
      }),
    );
    app.use(path, optionalAuth(deps.verify));
  }

  // Gust is public and carries no credentials, but the site may call it from
  // another origin in production, as it calls the marketplace.
  app.use(
    "/api/companion/*",
    cors({
      origin: deps.corsOrigins === "*" ? "*" : deps.corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "invalid",
          message: "Some fields need attention.",
          details: issuesByField(err),
        },
        400,
      );
    }
    console.error(err);
    return c.json(
      { error: "internal", message: "Something went wrong on our side." },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: "not_found", message: "No such route." }, 404),
  );

  const r = new Hono<Env>();
  r.use("*", blockSuspended(people.users));

  r.get("/health", (c) => c.json({ ok: true }));

  r.get("/meta", (c) =>
    c.json({
      categories: CATEGORIES,
      conditions: CONDITIONS,
      counties: COUNTIES,
      currencies: CURRENCIES,
      limits: LIMITS,
      auth: deps.authMode,
    }),
  );

  // ---- listings -----------------------------------------------------------

  r.get("/listings", async (c) => {
    const query = parseListingQuery(new URL(c.req.url).searchParams);
    return c.json(await repo.listListings(query, c.var.userId));
  });

  async function visibleListing(
    id: string,
    viewerId: string | null,
  ): Promise<Listing> {
    if (!ID_PATTERN.test(id))
      fail(404, "not_found", "That listing does not exist.");
    const listing = await repo.getListing(id, viewerId);
    // A removed listing is gone for everyone but its owner.
    if (
      !listing ||
      (listing.status === "removed" && listing.seller.id !== viewerId)
    ) {
      fail(
        404,
        "not_found",
        "That listing does not exist or has been removed.",
      );
    }
    return listing;
  }

  async function ownedListing(id: string, userId: string): Promise<Listing> {
    const listing = await visibleListing(id, userId);
    if (listing.seller.id !== userId)
      fail(403, "forbidden", "Only the seller can change this listing.");
    return listing;
  }

  r.get("/listings/:id", async (c) =>
    c.json(await visibleListing(c.req.param("id"), c.var.userId)),
  );

  /**
   * Turn the client's photo list into rows. Existing photos are matched by
   * id against what the listing already has; new ones must be keys this API
   * issued to this user. Returns the rows plus the storage keys to drop.
   */
  function resolvePhotos(
    inputs: PhotoInput[],
    existing: PhotoRow[],
    userId: string,
  ): { rows: PhotoRow[]; removedKeys: string[] } {
    const byId = new Map(existing.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const rows: PhotoRow[] = inputs.map((input, position) => {
      if (input.id) {
        const current = byId.get(input.id);
        if (!current)
          fail(
            400,
            "invalid",
            "A photo you referenced is not on this listing.",
            { photos: input.id },
          );
        if (seen.has(current.id))
          fail(400, "invalid", "The same photo was listed twice.");
        seen.add(current.id);
        return { ...current, position };
      }
      const key = input.key!;
      if (!keyBelongsTo(key, deps.storagePrefix, userId)) {
        fail(400, "invalid", "A photo upload key was not issued to you.", {
          photos: key,
        });
      }
      if (seen.has(key))
        fail(400, "invalid", "The same photo was listed twice.");
      seen.add(key);
      return {
        id: newId(),
        storageKey: key,
        url: storage.publicUrl(key),
        width: input.width ?? null,
        height: input.height ?? null,
        position,
      };
    });
    const kept = new Set(rows.map((p) => p.id));
    return {
      rows,
      removedKeys: existing
        .filter((p) => !kept.has(p.id))
        .map((p) => p.storageKey),
    };
  }

  async function discard(keys: string[]) {
    await Promise.allSettled(keys.map((k) => storage.delete(k)));
  }

  /**
   * Publishing a listing is the one thing on the site that needs a way to
   * reach you, so this is where it is asked for, not when the row is made.
   */
  function requireContact(
    seller: { contactEmail: string | null; contactPhone: string | null } | null,
  ) {
    if (!seller || !hasContact(seller)) {
      fail(
        409,
        "contact_required",
        "Add an email or a phone number to your profile first, so buyers can reach you.",
      );
    }
  }

  r.post(
    "/listings",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const userId = c.var.userId!;
      requireContact(await ensureUser(people, userId));
      if (
        (await repo.countActiveBySeller(userId)) >=
        LIMITS.activeListingsPerSeller
      ) {
        fail(
          409,
          "limit",
          `You can have at most ${LIMITS.activeListingsPerSeller} live listings at once.`,
        );
      }
      const { photos, ...fields } = listingInputSchema.parse(
        await c.req.json(),
      );
      const { rows } = resolvePhotos(photos, [], userId);
      const listing = await repo.createListing(newId(), userId, fields, rows);
      return c.json(listing, 201);
    },
  );

  r.put(
    "/listings/:id",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const userId = c.var.userId!;
      const current = await ownedListing(c.req.param("id"), userId);
      requireContact(await people.users.getUser(userId));
      const { photos, ...fields } = listingInputSchema.parse(
        await c.req.json(),
      );
      const existing = await repo.listingPhotos(current.id);
      const { rows, removedKeys } = resolvePhotos(photos, existing, userId);
      const listing = await repo.updateListing(current.id, fields, rows);
      await discard(removedKeys);
      return c.json({ ...listing, saved: current.saved, isOwner: true });
    },
  );

  r.post(
    "/listings/:id/status",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const userId = c.var.userId!;
      const current = await ownedListing(c.req.param("id"), userId);
      const body = (await c.req.json()) as { status?: string };
      if (
        body.status !== "active" &&
        body.status !== "sold" &&
        body.status !== "removed"
      ) {
        fail(400, "invalid", "Status must be active, sold or removed.");
      }
      if (body.status === "active" && current.status !== "active") {
        if (
          (await repo.countActiveBySeller(userId)) >=
          LIMITS.activeListingsPerSeller
        ) {
          fail(
            409,
            "limit",
            `You can have at most ${LIMITS.activeListingsPerSeller} live listings at once.`,
          );
        }
      }
      const listing = await repo.setListingStatus(current.id, body.status);
      if (body.status === "removed") {
        await discard(
          (await repo.listingPhotos(current.id)).map((p) => p.storageKey),
        );
      }
      return c.json({ ...listing!, saved: current.saved, isOwner: true });
    },
  );

  r.get("/listings/:id/contact", requireAuth, async (c) => {
    const userId = c.var.userId!;
    const listing = await visibleListing(c.req.param("id"), userId);
    const profile = await people.users.getUser(listing.seller.id);
    if (!profile) fail(404, "not_found", "The seller's profile is gone.");
    if (listing.seller.id !== userId)
      await repo.recordEnquiry(userId, listing.id);
    const contact: SellerContact = {
      displayName: profile.displayName,
      email: profile.contactEmail,
      phone: profile.contactPhone,
      whatsapp: profile.contactWhatsapp && Boolean(profile.contactPhone),
      listingId: listing.id,
    };
    return c.json(contact);
  });

  // ---- reviews ------------------------------------------------------------

  /**
   * You can rate a seller once per listing, and only after asking for their
   * contact details on it. That is the closest thing a free classifieds site
   * has to proof of a transaction without getting between buyer and seller.
   */
  async function eligibility(
    listing: Listing,
    userId: string | null,
  ): Promise<ReviewEligibility> {
    if (!userId)
      return { canReview: false, reason: "signed-out", existing: null };
    if (listing.seller.id === userId)
      return { canReview: false, reason: "own-listing", existing: null };
    const existing = await repo.getReview(userId, listing.id);
    if (existing) return { canReview: true, reason: "ok", existing };
    if (!(await repo.hasEnquired(userId, listing.id)))
      return { canReview: false, reason: "no-enquiry", existing: null };
    return { canReview: true, reason: "ok", existing: null };
  }

  r.get("/listings/:id/review", requireAuth, async (c) => {
    const listing = await visibleListing(c.req.param("id"), c.var.userId);
    return c.json(await eligibility(listing, c.var.userId));
  });

  r.put(
    "/listings/:id/review",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const userId = c.var.userId!;
      const listing = await visibleListing(c.req.param("id"), userId);
      const status = await eligibility(listing, userId);
      if (!status.canReview) {
        const messages: Record<ReviewEligibility["reason"], string> = {
          ok: "",
          "signed-out": "Sign in to leave a review.",
          "own-listing": "You cannot review your own listing.",
          "no-enquiry":
            "Ask the seller for their contact details first; reviews are for people who actually got in touch.",
          "profile-required":
            "Set up your profile so the seller knows who is reviewing them.",
        };
        fail(403, status.reason, messages[status.reason]);
      }
      const input = reviewInputSchema.parse(await c.req.json());
      // The review names its reviewer, so the reviewer needs a row by now.
      await ensureUser(people, userId);
      const review = await repo.upsertReview(
        newId(),
        listing.seller.id,
        userId,
        listing.id,
        input,
      );
      return c.json(review, status.existing ? 200 : 201);
    },
  );

  // ---- sellers ------------------------------------------------------------

  r.get("/sellers/:id", async (c) => {
    const page = await repo.getSellerPage(c.req.param("id"), c.var.userId);
    if (!page) fail(404, "not_found", "There is no such seller.");
    return c.json(page);
  });

  r.put(
    "/listings/:id/saved",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const userId = c.var.userId!;
      const listing = await visibleListing(c.req.param("id"), userId);
      const body = (await c.req.json()) as { saved?: unknown };
      if (typeof body.saved !== "boolean")
        fail(400, "invalid", "Send { saved: true | false }.");
      await repo.setSaved(userId, listing.id, body.saved);
      return c.json({ id: listing.id, saved: body.saved });
    },
  );

  // ---- me -----------------------------------------------------------------

  // The marketplace's account page wants your row and your listings in one
  // answer. The row itself is the site's: GET reads it the way /api/me does
  // and PUT is /api/me's own handler under this path.
  const me = meHandlers(people);

  r.get("/me", requireAuth, async (c) => {
    const userId = c.var.userId!;
    const profile = await ensureUser(people, userId);
    const [listings, saved, enquiries, reviewsGiven] = await Promise.all([
      repo.listBySeller(userId),
      repo.listSaved(userId),
      repo.enquiryCounts(userId),
      repo.reviewsGiven(userId),
    ]);
    const payload: MePayload = {
      profile,
      listings,
      saved,
      enquiries,
      reviewsGiven,
    };
    return c.json(payload);
  });

  r.put("/me", requireAuth, bodyLimit({ maxSize: JSON_LIMIT }), me.put);

  // ---- uploads ------------------------------------------------------------

  r.post(
    "/uploads",
    requireAuth,
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) => {
      const { contentType } = presignRequestSchema.parse(await c.req.json());
      const key = storage.keyFor(c.var.userId!, contentType);
      return c.json(await storage.presign(key, contentType));
    },
  );

  if (storage.local) {
    const local = storage.local;
    const keyOf = (path: string) =>
      decodeURIComponent(path.replace(/^\/api\/market\/uploads\//, ""));

    r.put(
      "/uploads/*",
      bodyLimit({ maxSize: LIMITS.photoBytesMax }),
      async (c) => {
        const key = keyOf(c.req.path);
        const url = new URL(c.req.url);
        if (
          !local.verify(
            key,
            url.searchParams.get("expires") ?? "",
            url.searchParams.get("signature") ?? "",
          )
        ) {
          fail(403, "forbidden", "This upload link is invalid or has expired.");
        }
        await local.write(key, new Uint8Array(await c.req.arrayBuffer()));
        return c.body(null, 204);
      },
    );

    r.get("/uploads/*", async (c) => {
      const file = await local.read(keyOf(c.req.path));
      if (!file) return c.notFound();
      return c.body(new Uint8Array(file.body), 200, {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    });
  }

  app.route("/api/market", r);
  app.route(
    "/api/community",
    createCommunityRouter({
      repo: deps.community,
      people,
      storage,
      authMode: deps.authMode,
      now: deps.now,
      hub: deps.hub,
      limiter: deps.limiter,
    }),
  );
  if (deps.forecast)
    app.route("/api/mcp", createMcpRouter({ source: deps.forecast }));
  app.route(
    "/api/companion",
    createCompanionRouter({
      client: null,
      ...deps.companion,
      source: deps.forecast ?? null,
      enabled: features.gust,
    }),
  );
  if (deps.alerts) app.route("/api/alerts", createAlertsRouter(deps.alerts));
  app.route("/api", createSiteRouter(people));
  return app;
}
