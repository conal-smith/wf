/**
 * The persistence seam. `app.ts` talks only to this interface; `repo-pg.ts`
 * implements it on Postgres and `repo-memory.ts` on plain arrays for tests
 * and for running the API with no database at all.
 */
import type {
  Listing,
  ListingQuery,
  ListingStatus,
  Page,
  Profile,
  Review,
  SellerPage,
} from "../../shared/types.js";
import type {
  ListingInputParsed,
  ProfileInputParsed,
  ReviewInputParsed,
} from "../../shared/validate.js";

export type ListingFields = Omit<ListingInputParsed, "photos">;

/** A photo row as the API wants it stored, positions already assigned. */
export interface PhotoRow {
  id: string;
  storageKey: string;
  url: string;
  width: number | null;
  height: number | null;
  position: number;
}

export interface Repo {
  listListings(
    query: ListingQuery,
    viewerId: string | null,
  ): Promise<Page<Listing>>;
  getListing(id: string, viewerId: string | null): Promise<Listing | null>;
  /** The listing's photo rows, in position order, regardless of status. */
  listingPhotos(id: string): Promise<PhotoRow[]>;
  createListing(
    id: string,
    sellerId: string,
    fields: ListingFields,
    photos: PhotoRow[],
  ): Promise<Listing>;
  /** Replaces the photo set wholesale: rows absent from `photos` are deleted. */
  updateListing(
    id: string,
    fields: ListingFields,
    photos: PhotoRow[],
  ): Promise<Listing>;
  setListingStatus(id: string, status: ListingStatus): Promise<Listing | null>;
  listBySeller(sellerId: string): Promise<Listing[]>;
  countActiveBySeller(sellerId: string): Promise<number>;

  getProfile(userId: string): Promise<Profile | null>;
  upsertProfile(userId: string, input: ProfileInputParsed): Promise<Profile>;
  /** Null when the seller has no profile (never listed anything). */
  getSellerPage(
    sellerId: string,
    viewerId: string | null,
  ): Promise<SellerPage | null>;

  listSaved(userId: string): Promise<Listing[]>;
  setSaved(userId: string, listingId: string, saved: boolean): Promise<void>;

  /** Records that `userId` asked for the seller's contact on `listingId`. Idempotent. */
  recordEnquiry(userId: string, listingId: string): Promise<void>;
  hasEnquired(userId: string, listingId: string): Promise<boolean>;
  /** Enquiry counts keyed by listing id, for every listing `sellerId` owns. */
  enquiryCounts(sellerId: string): Promise<Record<string, number>>;

  getReview(reviewerId: string, listingId: string): Promise<Review | null>;
  upsertReview(
    id: string,
    sellerId: string,
    reviewerId: string,
    listingId: string,
    input: ReviewInputParsed,
  ): Promise<Review>;
  reviewsGiven(reviewerId: string): Promise<Review[]>;

  close(): Promise<void>;
}

/** Adds the viewer-relative flags every listing response carries. */
export function withViewer(
  listing: Listing,
  viewerId: string | null,
  saved: boolean,
): Listing {
  if (!viewerId) return listing;
  return { ...listing, saved, isOwner: listing.seller.id === viewerId };
}

/** Counts of 1..5 star reviews; index 0 stays zero so histogram[rating] reads naturally. */
export function histogram(ratings: number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  for (const r of ratings) if (r >= 1 && r <= 5) out[r] += 1;
  return out;
}
