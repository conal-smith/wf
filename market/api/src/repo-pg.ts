import type { TransactionSql } from "postgres";
import type { Db } from "./db.js";
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
  type ListingStatus,
  type Profile,
  type Review,
  type SellerPage,
} from "../../shared/types.js";
import type {
  ProfileInputParsed,
  ReviewInputParsed,
} from "../../shared/validate.js";

interface ListingRow {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  brand: string | null;
  size_label: string | null;
  year: number | null;
  price_cents: number;
  currency: string;
  county: string;
  town: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  sold_at: Date | null;
  display_name: string;
  seller_county: string | null;
  seller_since: Date;
  rating_avg: string | null;
  rating_count: string | number;
  sold_count: string | number;
  saved: boolean;
  total?: string | number;
}

interface PhotoDbRow {
  id: string;
  listing_id: string;
  storage_key: string;
  url: string;
  width: number | null;
  height: number | null;
  position: number;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  county: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp: boolean;
  bio: string | null;
  created_at: Date;
  updated_at: Date;
}

interface StatsRow {
  active_count: string | number;
  sold_count: string | number;
  listing_count: string | number;
  rating_avg: string | null;
  rating_count: string | number;
}

interface ReviewRow {
  id: string;
  listing_id: string;
  listing_title: string;
  rating: number;
  comment: string | null;
  reviewer_id: string;
  reviewer_name: string;
  created_at: Date;
}

const iso = (d: Date) => d.toISOString();
const num = (v: string | number | null | undefined) =>
  v == null ? 0 : Number(v);
const avg = (v: string | null | undefined) => (v == null ? null : Number(v));

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.user_id,
    displayName: r.display_name,
    county: r.county as Profile["county"],
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    contactWhatsapp: r.contact_whatsapp,
    bio: r.bio,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    rating: r.rating,
    comment: r.comment,
    reviewer: { id: r.reviewer_id, displayName: r.reviewer_name },
    createdAt: iso(r.created_at),
  };
}

function toListing(
  r: ListingRow,
  photos: PhotoDbRow[],
  viewerId: string | null,
): Listing {
  const listing: Listing = {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category as Listing["category"],
    condition: r.condition as Listing["condition"],
    brand: r.brand,
    sizeLabel: r.size_label,
    year: r.year,
    priceCents: r.price_cents,
    currency: r.currency as Listing["currency"],
    county: r.county as Listing["county"],
    town: r.town,
    status: r.status as ListingStatus,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    soldAt: r.sold_at ? iso(r.sold_at) : null,
    photos: photos.map((p) => ({
      id: p.id,
      url: p.url,
      width: p.width,
      height: p.height,
    })),
    seller: {
      id: r.seller_id,
      displayName: r.display_name,
      county: r.seller_county as Listing["seller"]["county"],
      memberSince: iso(r.seller_since),
      ratingAvg: avg(r.rating_avg),
      ratingCount: num(r.rating_count),
      soldCount: num(r.sold_count),
    },
  };
  return withViewer(listing, viewerId, r.saved);
}

export function pgRepo(sql: Db): Repo {
  const savedFlag = (viewerId: string | null) =>
    viewerId
      ? sql`exists (select 1 from market_saved s where s.user_id = ${viewerId} and s.listing_id = l.id)`
      : sql`false`;

  const select = (viewerId: string | null) => sql`
    select l.*, p.display_name, p.county as seller_county, p.created_at as seller_since,
           st.rating_avg, st.rating_count, st.sold_count,
           ${savedFlag(viewerId)} as saved`;

  const from = sql`
    from market_listings l
    join market_profiles p on p.user_id = l.seller_id
    left join market_seller_stats st on st.user_id = l.seller_id`;

  const reviewSelect = sql`
    select r.id, r.listing_id, l.title as listing_title, r.rating, r.comment,
           r.reviewer_id, rp.display_name as reviewer_name, r.created_at
    from market_reviews r
    join market_listings l on l.id = r.listing_id
    join market_profiles rp on rp.user_id = r.reviewer_id`;

  async function photosFor(ids: string[]): Promise<Map<string, PhotoDbRow[]>> {
    const map = new Map<string, PhotoDbRow[]>();
    if (!ids.length) return map;
    const rows = await sql<PhotoDbRow[]>`
      select * from market_listing_photos where listing_id in ${sql(ids)} order by position, created_at`;
    for (const row of rows) {
      const list = map.get(row.listing_id) ?? [];
      list.push(row);
      map.set(row.listing_id, list);
    }
    return map;
  }

  async function hydrate(
    rows: ListingRow[],
    viewerId: string | null,
  ): Promise<Listing[]> {
    const photos = await photosFor(rows.map((r) => r.id));
    return rows.map((r) => toListing(r, photos.get(r.id) ?? [], viewerId));
  }

  async function one(
    id: string,
    viewerId: string | null,
  ): Promise<Listing | null> {
    const rows = await sql<
      ListingRow[]
    >`${select(viewerId)} ${from} where l.id = ${id}`;
    if (!rows.length) return null;
    return (await hydrate(rows, viewerId))[0];
  }

  async function replacePhotos(
    tx: TransactionSql,
    listingId: string,
    photos: PhotoRow[],
  ) {
    const keep = photos.map((p) => p.id);
    await tx`delete from market_listing_photos where listing_id = ${listingId}
             and id not in ${keep.length ? tx(keep) : tx([""])}`;
    for (const p of photos) {
      await tx`
        insert into market_listing_photos (id, listing_id, storage_key, url, width, height, position)
        values (${p.id}, ${listingId}, ${p.storageKey}, ${p.url}, ${p.width}, ${p.height}, ${p.position})
        on conflict (id) do update set position = excluded.position`;
    }
  }

  const fieldColumns = (f: ListingFields) => ({
    title: f.title,
    description: f.description,
    category: f.category,
    condition: f.condition,
    brand: f.brand ?? null,
    size_label: f.sizeLabel ?? null,
    year: f.year ?? null,
    price_cents: f.priceCents,
    currency: f.currency,
    county: f.county,
    town: f.town ?? null,
  });

  return {
    async listListings(query: ListingQuery, viewerId) {
      const pageSize = LIMITS.pageSize;
      const q = query.q?.trim();
      const like = q ? `%${q}%` : null;
      const order =
        query.sort === "price-asc"
          ? sql`order by l.price_cents asc, l.created_at desc, l.id`
          : query.sort === "price-desc"
            ? sql`order by l.price_cents desc, l.created_at desc, l.id`
            : sql`order by l.created_at desc, l.id`;
      const rows = await sql<ListingRow[]>`
        ${select(viewerId)}, count(*) over() as total
        ${from}
        where l.status = 'active'
        ${query.category ? sql`and l.category = ${query.category}` : sql``}
        ${query.county ? sql`and l.county = ${query.county}` : sql``}
        ${query.condition ? sql`and l.condition = ${query.condition}` : sql``}
        ${query.minPriceCents != null ? sql`and l.price_cents >= ${query.minPriceCents}` : sql``}
        ${query.maxPriceCents != null ? sql`and l.price_cents <= ${query.maxPriceCents}` : sql``}
        ${
          q
            ? sql`and (
                to_tsvector('english', l.title || ' ' || coalesce(l.brand, '') || ' ' || l.description)
                  @@ websearch_to_tsquery('english', ${q})
                or l.title ilike ${like} or l.brand ilike ${like})`
            : sql``
        }
        ${order}
        limit ${pageSize} offset ${(query.page - 1) * pageSize}`;
      const total = rows.length ? Number(rows[0].total) : 0;
      return {
        items: await hydrate(rows, viewerId),
        page: query.page,
        pageSize,
        total,
      };
    },

    getListing: one,

    async listingPhotos(id) {
      const rows = await sql<PhotoDbRow[]>`
        select * from market_listing_photos where listing_id = ${id} order by position, created_at`;
      return rows.map((p) => ({
        id: p.id,
        storageKey: p.storage_key,
        url: p.url,
        width: p.width,
        height: p.height,
        position: p.position,
      }));
    },

    async createListing(id, sellerId, fields, photos) {
      await sql.begin(async (tx) => {
        await tx`insert into market_listings ${tx({ id, seller_id: sellerId, ...fieldColumns(fields) })}`;
        await replacePhotos(tx, id, photos);
      });
      return (await one(id, sellerId))!;
    },

    async updateListing(id, fields, photos) {
      await sql.begin(async (tx) => {
        await tx`update market_listings set ${tx({ ...fieldColumns(fields), updated_at: new Date() })}
                 where id = ${id}`;
        await replacePhotos(tx, id, photos);
      });
      return (await one(id, null))!;
    },

    async setListingStatus(id, status) {
      const rows = await sql`
        update market_listings
        set status = ${status}, updated_at = now(),
            sold_at = case when ${status} = 'sold' then now() else null end
        where id = ${id} returning id`;
      if (!rows.length) return null;
      return one(id, null);
    },

    async listBySeller(sellerId) {
      const rows = await sql<ListingRow[]>`
        ${select(sellerId)} ${from}
        where l.seller_id = ${sellerId} and l.status <> 'removed'
        order by l.created_at desc`;
      return hydrate(rows, sellerId);
    },

    async countActiveBySeller(sellerId) {
      const [row] = await sql<{ n: string }[]>`
        select count(*)::text as n from market_listings where seller_id = ${sellerId} and status = 'active'`;
      return Number(row.n);
    },

    async getProfile(userId) {
      const rows = await sql<
        ProfileRow[]
      >`select * from market_profiles where user_id = ${userId}`;
      return rows.length ? toProfile(rows[0]) : null;
    },

    async upsertProfile(userId, input: ProfileInputParsed) {
      const [row] = await sql<ProfileRow[]>`
        insert into market_profiles (user_id, display_name, county, contact_email, contact_phone, contact_whatsapp, bio)
        values (${userId}, ${input.displayName}, ${input.county ?? null}, ${input.contactEmail ?? null},
                ${input.contactPhone ?? null}, ${input.contactWhatsapp ?? false}, ${input.bio ?? null})
        on conflict (user_id) do update set
          display_name = excluded.display_name,
          county = excluded.county,
          contact_email = excluded.contact_email,
          contact_phone = excluded.contact_phone,
          contact_whatsapp = excluded.contact_whatsapp,
          bio = excluded.bio,
          updated_at = now()
        returning *`;
      return toProfile(row);
    },

    async getSellerPage(sellerId, viewerId): Promise<SellerPage | null> {
      const profiles = await sql<
        ProfileRow[]
      >`select * from market_profiles where user_id = ${sellerId}`;
      if (!profiles.length) return null;
      const p = profiles[0];
      const [stats] = await sql<
        StatsRow[]
      >`select * from market_seller_stats where user_id = ${sellerId}`;
      const [active, sold, reviews, ratings] = await Promise.all([
        sql<ListingRow[]>`${select(viewerId)} ${from}
          where l.seller_id = ${sellerId} and l.status = 'active' order by l.created_at desc`,
        sql<ListingRow[]>`${select(viewerId)} ${from}
          where l.seller_id = ${sellerId} and l.status = 'sold' order by l.sold_at desc nulls last limit 24`,
        sql<
          ReviewRow[]
        >`${reviewSelect} where r.seller_id = ${sellerId} order by r.created_at desc limit 50`,
        sql<
          { rating: number }[]
        >`select rating from market_reviews where seller_id = ${sellerId}`,
      ]);
      return {
        seller: {
          id: p.user_id,
          displayName: p.display_name,
          county: p.county as Profile["county"],
          memberSince: iso(p.created_at),
          ratingAvg: avg(stats?.rating_avg),
          ratingCount: num(stats?.rating_count),
          soldCount: num(stats?.sold_count),
          bio: p.bio,
        },
        stats: {
          activeCount: num(stats?.active_count),
          soldCount: num(stats?.sold_count),
          listingCount: num(stats?.listing_count),
          ratingAvg: avg(stats?.rating_avg),
          ratingCount: num(stats?.rating_count),
          ratingHistogram: histogram(ratings.map((r) => r.rating)),
        },
        active: await hydrate(active, viewerId),
        sold: await hydrate(sold, viewerId),
        reviews: reviews.map(toReview),
      };
    },

    async listSaved(userId) {
      const rows = await sql<ListingRow[]>`
        ${select(userId)} ${from}
        join market_saved s on s.listing_id = l.id and s.user_id = ${userId}
        where l.status <> 'removed'
        order by s.created_at desc`;
      return hydrate(rows, userId);
    },

    async setSaved(userId, listingId, saved) {
      if (saved) {
        await sql`insert into market_saved (user_id, listing_id) values (${userId}, ${listingId})
                  on conflict do nothing`;
      } else {
        await sql`delete from market_saved where user_id = ${userId} and listing_id = ${listingId}`;
      }
    },

    async recordEnquiry(userId, listingId) {
      await sql`insert into market_contact_reveals (user_id, listing_id) values (${userId}, ${listingId})
                on conflict do nothing`;
    },

    async hasEnquired(userId, listingId) {
      const rows = await sql`select 1 from market_contact_reveals
                             where user_id = ${userId} and listing_id = ${listingId}`;
      return rows.length > 0;
    },

    async enquiryCounts(sellerId) {
      const rows = await sql<{ listing_id: string; n: string }[]>`
        select c.listing_id, count(*)::text as n
        from market_contact_reveals c join market_listings l on l.id = c.listing_id
        where l.seller_id = ${sellerId} group by c.listing_id`;
      return Object.fromEntries(rows.map((r) => [r.listing_id, Number(r.n)]));
    },

    async getReview(reviewerId, listingId) {
      const rows = await sql<ReviewRow[]>`${reviewSelect}
        where r.reviewer_id = ${reviewerId} and r.listing_id = ${listingId}`;
      return rows.length ? toReview(rows[0]) : null;
    },

    async upsertReview(
      id,
      sellerId,
      reviewerId,
      listingId,
      input: ReviewInputParsed,
    ) {
      await sql`
        insert into market_reviews (id, seller_id, reviewer_id, listing_id, rating, comment)
        values (${id}, ${sellerId}, ${reviewerId}, ${listingId}, ${input.rating}, ${input.comment ?? null})
        on conflict (reviewer_id, listing_id) do update set
          rating = excluded.rating, comment = excluded.comment, updated_at = now()`;
      const rows = await sql<ReviewRow[]>`${reviewSelect}
        where r.reviewer_id = ${reviewerId} and r.listing_id = ${listingId}`;
      return toReview(rows[0]);
    },

    async reviewsGiven(reviewerId) {
      const rows = await sql<ReviewRow[]>`${reviewSelect}
        where r.reviewer_id = ${reviewerId} order by r.created_at desc`;
      return rows.map(toReview);
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
