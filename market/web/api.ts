/**
 * The browser side of the marketplace API. One class, one method per route,
 * and a hook that binds it to the signed-in user's token. The request itself,
 * the token and the error shape are the site's: `shared/web/http.ts`.
 */
import { useMemo, useRef } from "react";
import { request, sendBytes, type ApiSettings } from "../../shared/web/http";
import { resizeImage } from "../../shared/web/images";
import { useMarketAuth } from "./auth";
import type {
  Listing,
  ListingInput,
  ListingQuery,
  ListingStatus,
  MePayload,
  Page,
  PhotoInput,
  PresignResponse,
  Profile,
  ProfileInput,
  Review,
  ReviewEligibility,
  ReviewInput,
  SellerContact,
  SellerPage,
} from "../shared/types";
import { listingQueryToParams } from "../shared/validate";

export { ApiRequestError } from "../../shared/web/http";

export class MarketApi {
  private settings: ApiSettings;

  constructor(getToken: () => Promise<string | null>) {
    this.settings = {
      prefix: "/api/market",
      subject: "The marketplace",
      getToken,
    };
  }

  private request<T>(method: string, path: string, body?: unknown) {
    return request<T>(this.settings, method, path, body);
  }

  listListings(query: Partial<ListingQuery>) {
    const params = listingQueryToParams(query).toString();
    return this.request<Page<Listing>>(
      "GET",
      `/listings${params ? `?${params}` : ""}`,
    );
  }
  getListing(id: string) {
    return this.request<Listing>("GET", `/listings/${id}`);
  }
  createListing(input: ListingInput) {
    return this.request<Listing>("POST", "/listings", input);
  }
  updateListing(id: string, input: ListingInput) {
    return this.request<Listing>("PUT", `/listings/${id}`, input);
  }
  setStatus(id: string, status: ListingStatus) {
    return this.request<Listing>("POST", `/listings/${id}/status`, { status });
  }
  getContact(id: string) {
    return this.request<SellerContact>("GET", `/listings/${id}/contact`);
  }
  setSaved(id: string, saved: boolean) {
    return this.request<{ id: string; saved: boolean }>(
      "PUT",
      `/listings/${id}/saved`,
      { saved },
    );
  }
  reviewEligibility(id: string) {
    return this.request<ReviewEligibility>("GET", `/listings/${id}/review`);
  }
  putReview(id: string, input: ReviewInput) {
    return this.request<Review>("PUT", `/listings/${id}/review`, input);
  }
  getSeller(id: string) {
    return this.request<SellerPage>("GET", `/sellers/${id}`);
  }
  me() {
    return this.request<MePayload>("GET", "/me");
  }
  saveProfile(input: ProfileInput) {
    return this.request<Profile>("PUT", "/me", input);
  }

  /** Resize in the browser, ask for an upload slot, PUT the bytes, return what the listing needs. */
  async uploadPhoto(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<PhotoInput & { previewUrl: string }> {
    const image = await resizeImage(file);
    onProgress?.(0.2);
    const slot = await this.request<PresignResponse>("POST", "/uploads", {
      contentType: image.blob.type,
      byteLength: image.blob.size,
    });
    onProgress?.(0.3);
    await sendBytes(slot, image.blob, "The photo upload failed. Try again.");
    onProgress?.(1);
    return {
      key: slot.key,
      width: image.width,
      height: image.height,
      previewUrl: URL.createObjectURL(image.blob),
    };
  }
}

/**
 * One client per signed-in identity. The token getter is read through a ref
 * so a provider that hands out a fresh function each render does not make
 * every page refetch.
 */
export function useApi(): MarketApi {
  const { getToken, userId, provider } = useMarketAuth();
  const latest = useRef(getToken);
  latest.current = getToken;
  return useMemo(
    () => new MarketApi(() => latest.current()),
    [userId, provider],
  );
}
