/**
 * An in-memory Repo with the same semantics as the Postgres one. It backs the
 * unit tests and `MARKET_DB=memory`, which lets the whole marketplace run on
 * a laptop with no database. Nothing survives a restart. People live in the
 * site's memory users repo, handed in so both see the same rows.
 */
import {
  histogram,
  withViewer,
  type ListingFields,
  type PhotoRow,
  type Repo,
} from "./repo.js";
import {
  LIMITS,
  type Listing,
  type ListingQuery,
  type Review,
  type SellerPage,
  type SellerSummary,
} from "../../shared/types.js";
import type { ReviewInputParsed } from "../../shared/validate.js";
import type { MemoryUsersRepo } from "../../../site/api/repo-memory.js";

interface Stored {
  listing: Omit<Listing, "photos" | "seller" | "saved" | "isOwner">;
  sellerId: string;
  photos: PhotoRow[];
}

interface StoredReview {
  id: string;
  sellerId: string;
  reviewerId: string;
  listingId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export function memoryRepo(
  users: MemoryUsersRepo,
  now: () => Date = () => new Date(),
): Repo {
  const listings = new Map<string, Stored>();
  const saved = new Map<string, string[]>(); // userId -> listingIds in save order
  const enquiries = new Set<string>(); // `${userId}\n${listingId}`
  const reviews = new Map<string, StoredReview>(); // `${reviewerId}\n${listingId}`

  const sellerReviews = (sellerId: string) =>
    [...reviews.values()].filter((r) => r.sellerId === sellerId);

  const seller = (id: string): SellerSummary => {
    const p = users.peek(id);
    if (!p) throw new Error(`No user ${id}`);
    const rs = sellerReviews(id);
    const soldCount = [...listings.values()].filter(
      (s) => s.sellerId === id && s.listing.status === "sold",
    ).length;
    return {
      id,
      displayName: p.displayName,
      county: p.county,
      memberSince: p.createdAt,
      ratingAvg: rs.length
        ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 100) /
          100
        : null,
      ratingCount: rs.length,
      soldCount,
    };
  };

  const view = (s: Stored, viewerId: string | null): Listing => {
    const listing: Listing = {
      ...s.listing,
      photos: [...s.photos]
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          id: p.id,
          url: p.url,
          width: p.width,
          height: p.height,
        })),
      seller: seller(s.sellerId),
    };
    return withViewer(
      listing,
      viewerId,
      Boolean(viewerId && saved.get(viewerId)?.includes(s.listing.id)),
    );
  };

  const toReview = (r: StoredReview): Review => ({
    id: r.id,
    listingId: r.listingId,
    listingTitle: listings.get(r.listingId)?.listing.title ?? "",
    rating: r.rating,
    comment: r.comment,
    reviewer: {
      id: r.reviewerId,
      displayName: users.peek(r.reviewerId)?.displayName ?? "",
    },
    createdAt: r.createdAt,
  });

  const fields = (f: ListingFields) => ({
    title: f.title,
    description: f.description,
    category: f.category as Listing["category"],
    condition: f.condition as Listing["condition"],
    brand: f.brand ?? null,
    sizeLabel: f.sizeLabel ?? null,
    year: f.year ?? null,
    priceCents: f.priceCents,
    currency: f.currency,
    county: f.county,
    town: f.town ?? null,
  });

  const byNewest = (a: Stored, b: Stored) =>
    b.listing.createdAt.localeCompare(a.listing.createdAt) ||
    a.listing.id.localeCompare(b.listing.id);

  return {
    async listListings(query: ListingQuery, viewerId) {
      const q = query.q?.toLowerCase();
      let items = [...listings.values()].filter((s) => {
        const l = s.listing;
        if (l.status !== "active") return false;
        if (query.category && l.category !== query.category) return false;
        if (query.county && l.county !== query.county) return false;
        if (query.condition && l.condition !== query.condition) return false;
        if (query.minPriceCents != null && l.priceCents < query.minPriceCents)
          return false;
        if (query.maxPriceCents != null && l.priceCents > query.maxPriceCents)
          return false;
        if (q) {
          const hay =
            `${l.title} ${l.brand ?? ""} ${l.description}`.toLowerCase();
          if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
        }
        return true;
      });
      items.sort((a, b) => {
        if (
          query.sort === "price-asc" &&
          a.listing.priceCents !== b.listing.priceCents
        )
          return a.listing.priceCents - b.listing.priceCents;
        if (
          query.sort === "price-desc" &&
          a.listing.priceCents !== b.listing.priceCents
        )
          return b.listing.priceCents - a.listing.priceCents;
        return byNewest(a, b);
      });
      const total = items.length;
      const pageSize = LIMITS.pageSize;
      items = items.slice((query.page - 1) * pageSize, query.page * pageSize);
      return {
        items: items.map((s) => view(s, viewerId)),
        page: query.page,
        pageSize,
        total,
      };
    },

    async getListing(id, viewerId) {
      const s = listings.get(id);
      return s ? view(s, viewerId) : null;
    },

    async listingPhotos(id) {
      return [...(listings.get(id)?.photos ?? [])].sort(
        (a, b) => a.position - b.position,
      );
    },

    async createListing(id, sellerId, f, photos) {
      const at = now().toISOString();
      listings.set(id, {
        sellerId,
        photos: [...photos],
        listing: {
          id,
          ...fields(f),
          status: "active",
          createdAt: at,
          updatedAt: at,
          soldAt: null,
        },
      });
      return view(listings.get(id)!, sellerId);
    },

    async updateListing(id, f, photos) {
      const s = listings.get(id);
      if (!s) throw new Error("Listing not found");
      s.listing = {
        ...s.listing,
        ...fields(f),
        updatedAt: now().toISOString(),
      };
      s.photos = [...photos];
      return view(s, null);
    },

    async setListingStatus(id, status) {
      const s = listings.get(id);
      if (!s) return null;
      const at = now().toISOString();
      s.listing = {
        ...s.listing,
        status,
        updatedAt: at,
        soldAt: status === "sold" ? at : null,
      };
      return view(s, null);
    },

    async listBySeller(sellerId) {
      return [...listings.values()]
        .filter(
          (s) => s.sellerId === sellerId && s.listing.status !== "removed",
        )
        .sort(byNewest)
        .map((s) => view(s, sellerId));
    },

    async countActiveBySeller(sellerId) {
      return [...listings.values()].filter(
        (s) => s.sellerId === sellerId && s.listing.status === "active",
      ).length;
    },

    async getSellerPage(sellerId, viewerId): Promise<SellerPage | null> {
      const p = users.peek(sellerId);
      if (!p) return null;
      const mine = [...listings.values()].filter(
        (s) => s.sellerId === sellerId,
      );
      const rs = sellerReviews(sellerId).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      const summary = seller(sellerId);
      return {
        seller: { ...summary, bio: p.bio },
        stats: {
          activeCount: mine.filter((s) => s.listing.status === "active").length,
          soldCount: summary.soldCount,
          listingCount: mine.filter((s) => s.listing.status !== "removed")
            .length,
          ratingAvg: summary.ratingAvg,
          ratingCount: summary.ratingCount,
          ratingHistogram: histogram(rs.map((r) => r.rating)),
        },
        active: mine
          .filter((s) => s.listing.status === "active")
          .sort(byNewest)
          .map((s) => view(s, viewerId)),
        sold: mine
          .filter((s) => s.listing.status === "sold")
          .sort((a, b) =>
            (b.listing.soldAt ?? "").localeCompare(a.listing.soldAt ?? ""),
          )
          .slice(0, 24)
          .map((s) => view(s, viewerId)),
        reviews: rs.slice(0, 50).map(toReview),
      };
    },

    async listSaved(userId) {
      return [...(saved.get(userId) ?? [])]
        .reverse()
        .map((id) => listings.get(id))
        .filter(
          (s): s is Stored => Boolean(s) && s!.listing.status !== "removed",
        )
        .map((s) => view(s, userId));
    },

    async setSaved(userId, listingId, isSaved) {
      const order = saved.get(userId) ?? [];
      const i = order.indexOf(listingId);
      if (isSaved && i < 0) order.push(listingId);
      if (!isSaved && i >= 0) order.splice(i, 1);
      saved.set(userId, order);
    },

    async recordEnquiry(userId, listingId) {
      enquiries.add(`${userId}\n${listingId}`);
    },

    async hasEnquired(userId, listingId) {
      return enquiries.has(`${userId}\n${listingId}`);
    },

    async enquiryCounts(sellerId) {
      const counts: Record<string, number> = {};
      for (const key of enquiries) {
        const listingId = key.split("\n")[1];
        if (listings.get(listingId)?.sellerId === sellerId)
          counts[listingId] = (counts[listingId] ?? 0) + 1;
      }
      return counts;
    },

    async getReview(reviewerId, listingId) {
      const r = reviews.get(`${reviewerId}\n${listingId}`);
      return r ? toReview(r) : null;
    },

    async upsertReview(
      id,
      sellerId,
      reviewerId,
      listingId,
      input: ReviewInputParsed,
    ) {
      const key = `${reviewerId}\n${listingId}`;
      const existing = reviews.get(key);
      const review: StoredReview = {
        id: existing?.id ?? id,
        sellerId,
        reviewerId,
        listingId,
        rating: input.rating,
        comment: input.comment ?? null,
        createdAt: existing?.createdAt ?? now().toISOString(),
      };
      reviews.set(key, review);
      return toReview(review);
    },

    async reviewsGiven(reviewerId) {
      return [...reviews.values()]
        .filter((r) => r.reviewerId === reviewerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toReview);
    },

    async close() {},
  };
}
