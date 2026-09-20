/**
 * Types and vocabularies shared by the marketplace API and the web client.
 *
 * Everything here is plain data. Nothing imports React, Node or a database,
 * so both sides can depend on it without pulling in the other's runtime.
 */
import {
  USER_LIMITS,
  type County,
  type User,
  type UserInput,
} from "../../site/shared/types.js";

export const CATEGORIES = [
  { id: "wing", label: "Wings", hint: "Inflatable wings, any size" },
  { id: "board", label: "Boards", hint: "Wing boards, downwind boards" },
  {
    id: "foil",
    label: "Complete foils",
    hint: "Mast, fuselage, front wing and stabiliser",
  },
  {
    id: "foil-parts",
    label: "Foil parts",
    hint: "Front wings, stabilisers, masts, fuselages",
  },
  { id: "wetsuit", label: "Wetsuits", hint: "Wetsuits, boots, gloves, hoods" },
  {
    id: "safety",
    label: "Harness & safety",
    hint: "Harnesses, impact vests, helmets, leashes",
  },
  {
    id: "accessory",
    label: "Accessories",
    hint: "Pumps, bags, repair kits, spares",
  },
  {
    id: "package",
    label: "Complete setups",
    hint: "Wing, board and foil sold together",
  },
  { id: "other", label: "Other", hint: "Anything else wingfoil related" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];

export const CONDITIONS = [
  { id: "new", label: "New", hint: "Unused, possibly still in packaging" },
  {
    id: "like-new",
    label: "Like new",
    hint: "Used a handful of times, no marks",
  },
  { id: "good", label: "Good", hint: "Normal wear, fully working" },
  { id: "fair", label: "Fair", hint: "Visible wear or repairs, still works" },
  { id: "needs-repair", label: "Needs repair", hint: "Sold as seen" },
] as const;

export type ConditionId = (typeof CONDITIONS)[number]["id"];
export const CONDITION_IDS = CONDITIONS.map((c) => c.id) as ConditionId[];

// The counties and the person's row belong to the whole site; the marketplace
// re-exports them so its own modules keep one import.
export { COUNTIES, type County } from "../../site/shared/types.js";

export const CURRENCIES = ["EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const LISTING_STATUSES = ["active", "sold", "removed"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const SORTS = ["newest", "price-asc", "price-desc"] as const;
export type Sort = (typeof SORTS)[number];

export const LIMITS = {
  titleMax: 80,
  descriptionMax: 3000,
  brandMax: 40,
  sizeMax: 30,
  townMax: 60,
  displayNameMax: USER_LIMITS.displayNameMax,
  bioMax: USER_LIMITS.bioMax,
  reviewCommentMax: 600,
  photosPerListing: 8,
  activeListingsPerSeller: 20,
  /** Bytes accepted per photo after the client has resized it. */
  photoBytesMax: 6 * 1024 * 1024,
  pageSize: 24,
  priceCentsMax: 5_000_000,
} as const;

export const PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export interface ListingPhoto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface SellerSummary {
  id: string;
  displayName: string;
  county: County | null;
  memberSince: string;
  /** Mean of 1-5 star ratings, null until the first review. */
  ratingAvg: number | null;
  ratingCount: number;
  soldCount: number;
}

export interface Review {
  id: string;
  listingId: string;
  listingTitle: string;
  rating: number;
  comment: string | null;
  reviewer: { id: string; displayName: string };
  createdAt: string;
}

export interface ReviewInput {
  rating: number;
  comment?: string | null;
}

/** A seller's public page: who they are, what they have sold, what people said. */
export interface SellerPage {
  seller: SellerSummary & { bio: string | null };
  stats: {
    activeCount: number;
    soldCount: number;
    listingCount: number;
    ratingAvg: number | null;
    ratingCount: number;
    /** How many 1, 2, 3, 4 and 5 star reviews; index 0 is unused. */
    ratingHistogram: number[];
  };
  active: Listing[];
  sold: Listing[];
  reviews: Review[];
}

/** What a signed-in viewer may do about reviewing a listing's seller. */
export interface ReviewEligibility {
  canReview: boolean;
  reason:
    "ok" | "own-listing" | "no-enquiry" | "profile-required" | "signed-out";
  existing: Review | null;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  condition: ConditionId;
  brand: string | null;
  sizeLabel: string | null;
  year: number | null;
  priceCents: number;
  currency: Currency;
  county: County;
  town: string | null;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  soldAt: string | null;
  photos: ListingPhoto[];
  seller: SellerSummary;
  /** Only present when the request carried a signed-in viewer. */
  saved?: boolean;
  isOwner?: boolean;
}

/** A seller is a person of the site: the marketplace keeps no profile of its own. */
export type Profile = User;

/** What a signed-in viewer sees when they ask for a seller's contact details. */
export interface SellerContact {
  displayName: string;
  email: string | null;
  phone: string | null;
  whatsapp: boolean;
  listingId: string;
}

/** A photo as the client submits it: an existing row by id, or a fresh upload by key. */
export interface PhotoInput {
  id?: string;
  key?: string;
  width?: number | null;
  height?: number | null;
}

export interface ListingInput {
  title: string;
  description: string;
  category: CategoryId;
  condition: ConditionId;
  brand?: string | null;
  sizeLabel?: string | null;
  year?: number | null;
  priceCents: number;
  currency: Currency;
  county: County;
  town?: string | null;
  photos: PhotoInput[];
}

export type ProfileInput = UserInput;

export interface ListingQuery {
  q?: string;
  category?: CategoryId;
  county?: County;
  condition?: ConditionId;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort: Sort;
  page: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PresignRequest {
  contentType: (typeof PHOTO_CONTENT_TYPES)[number];
  byteLength: number;
}

export interface PresignResponse {
  key: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  publicUrl: string;
}

export interface MePayload {
  /** Never null: the row is made the first time anything asks for it. */
  profile: Profile;
  listings: Listing[];
  saved: Listing[];
  /** Enquiries received per listing id (contact reveals), for the seller's own view. */
  enquiries: Record<string, number>;
  reviewsGiven: Review[];
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
