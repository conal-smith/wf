# wingfoil.ie Market

A free classifieds marketplace for second-hand wingfoiling gear, in the spirit
of DoneDeal and Gumtree: members list what they no longer ride, buyers browse,
save, ask for the seller's contact details and deal directly. The site takes no
cut and holds no money. Sellers build a public history and a star rating from
the people who actually contacted them.

It is a self-contained package in `market/`, separate from the wind map. The
two share the Force5 design bundle, the root `package.json`, and one line in
`src/main.tsx` that hands every `/market` URL to this bundle.

```
market/
  shared/          types, vocabularies (categories, counties…) and zod schemas
                   used by BOTH the API and the browser
  api/             Hono + Node service: Postgres, Clerk verification, photo storage
    migrations/    plain SQL, applied in order on boot
    src/           app.ts (routes) · repo-pg.ts · repo-memory.ts · storage.ts · auth.ts
  web/             React pages mounted under /market by src/main.tsx
  Dockerfile       the API image for Railway
  docker-compose.yml  a local Postgres
  .env.example     every variable, documented
```

## What it does

- **Browse** with search (Postgres full-text plus title/brand match), filters
  for category, county, condition and price, three sort orders, paging.
- **Listings** with up to 8 photos (resized in the browser to ≤1600px JPEG and
  uploaded straight to object storage), title, description, category,
  condition, brand, size, year, price in EUR or GBP, county and town.
- **Accounts** via Clerk. A seller profile (display name, county, contact email
  and/or phone, WhatsApp opt-in, bio) is required before the first listing.
- **Contact reveal**: signed-in buyers ask for the seller's details on a
  listing. That is recorded as an enquiry, which the seller sees as a count on
  each listing.
- **Ratings and reviews**: a buyer who revealed a seller's contact can leave a
  1–5 star review with a comment, once per listing, editable later. Sellers
  cannot review themselves.
- **Seller pages** (`/market/seller/:id`): rating, review count and histogram,
  items sold, live listings, sold history, all reviews.
- **My account**: live and sold listings with enquiry counts, mark as sold /
  relist / remove, saved listings, reviews given, profile editing.

## Run it locally

Two processes: the Vite site and the API. No Clerk account or object store is
needed for development.

```bash
npm install

# 1. a database (or skip this and use MARKET_DB=memory below)
npm run market:db                     # Postgres 16 on 127.0.0.1:55432

# 2. the API, with a dev identity switch and photos on disk
DATABASE_URL=postgres://market:market@127.0.0.1:55432/market \
MARKET_AUTH_MODE=dev MARKET_STORAGE=local npm run market:api

# 3. the site, signed in as a fixed dev user; /api is proxied to the API
VITE_MARKET_DEV_USER=aoife npm run dev
# open http://127.0.0.1:5173/market
```

`MARKET_AUTH_MODE=dev` accepts `Authorization: Bearer dev:<name>` and the site
sends exactly that when `VITE_MARKET_DEV_USER` is set. Both are refused when
`NODE_ENV=production`. `MARKET_DB=memory` runs with no database at all (state
is lost on restart), which is what the unit tests use.

Tests: `npm test` runs `market/api/src/app.test.ts` against the in-memory
repository with a fake storage driver, covering validation, ownership, photo
cleanup, status visibility, saving, enquiries, reviews and seller stats.

## Deploy on Railway

The marketplace is two Railway services plus one bucket:

1. **Postgres** – add Railway's Postgres. It injects `DATABASE_URL` into any
   service you reference it from. Migrations run automatically on boot.
2. **market-api** – a service built from this repo with the Dockerfile path
   set to `market/Dockerfile` (build context is the repo root). Variables:

   | Variable                                                     | Value                                                                                              |
   | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`                                               | `${{Postgres.DATABASE_URL}}`                                                                       |
   | `MARKET_CORS_ORIGINS`                                        | `https://wingfoil.ie` (comma-separate previews)                                                    |
   | `MARKET_PUBLIC_URL`                                          | the service's public URL                                                                           |
   | `CLERK_SECRET_KEY`                                           | from the Clerk dashboard                                                                           |
   | `CLERK_AUTHORIZED_PARTIES`                                   | `https://wingfoil.ie` (blocks tokens minted for other origins)                                     |
   | `MARKET_STORAGE`                                             | `s3`                                                                                               |
   | `MARKET_S3_BUCKET`, `MARKET_S3_ENDPOINT`, `MARKET_S3_REGION` | your bucket; for R2 the endpoint is `https://<account>.r2.cloudflarestorage.com` and region `auto` |
   | `MARKET_S3_PUBLIC_BASE_URL`                                  | the bucket's public/CDN URL (photos are read straight from it)                                     |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                 | a key scoped to that bucket: PutObject and DeleteObject on `market/*`                              |

   Generate a domain for the service; `GET /api/market/health` is the health
   check.

3. **Object storage** for photos. Cloudflare R2, AWS S3 or a Railway bucket all
   work through the same S3 driver. Two things must be true of the bucket:
   - Public read (or fronted by a CDN) for everything under `market/`, because
     listing pages link to the photos directly.
   - A CORS rule allowing `PUT` from the website origin with the
     `Content-Type` header, because browsers upload directly with a presigned
     URL. `force5/deploy/s3-cors.example.json` is the same shape.

   If you would rather not run a bucket at first, `MARKET_STORAGE=local` with a
   Railway volume mounted at `/data` and `MARKET_UPLOAD_DIR=/data` stores
   photos on the API's disk and serves them from `/api/market/uploads/…`.
   Fine for launch traffic; move to a bucket before it matters.

4. **The website** needs two build-time variables wherever it is built:
   `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_MARKET_API_URL=https://<market-api
domain>`. The static host must rewrite `/market/*` to `index.html` (the same
   SPA fallback the map already needs for any deep link).

   There is nothing on disk at `/market`, `/market/sell` or
   `/market/listing/:id`: the site is one `index.html` and `src/main.tsx` reads
   the pathname to decide which bundle to mount. Three hosts, three answers, and
   all three are already handled:
   - `vite preview` has the fallback built in; nothing to configure.
   - `deploy/local/Caddyfile` does it with `try_files {path} /index.html`.
   - Cloudflare Pages (and Netlify) read `public/_redirects`, which ships two
     rules — `/market` and `/market/*` to `/index.html 200`, and nothing
     broader. A blanket `/*` rule would be wrong: the origin may also serve the
     ingest output under `/weather` and `/marine`, and every loader in the
     product gates on `!response.ok` and then parses the body. A missing
     snapshot, a pruned frame, a model that has not published yet and a failed
     API call all have actionable messages that a 200 HTML body would turn into
     a parse error. `deploy/local/Caddyfile` keeps `/weather/*` and `/marine/*`
     out of its `try_files` for the same reason. A host that reads neither
     file needs the same two rewrites configured by hand, or every direct load
     and refresh under `/market` 404s.

5. **Clerk**: create an application, enable the sign-in methods you want, add
   `wingfoil.ie` as an allowed origin. Nothing else: the API only ever reads
   the `sub` claim of the session token, and the profile stores what the
   member types, not what Clerk holds.

## API

All routes are under `/api/market`. Authenticated routes take
`Authorization: Bearer <Clerk session token>`. Errors are
`{ error, message, details? }`; validation failures are `400` with
`details` keyed by field.

| Method  | Path                                                                          | Auth       | Purpose                                                     |
| ------- | ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| GET     | `/health`                                                                     |            | liveness                                                    |
| GET     | `/meta`                                                                       |            | categories, conditions, counties, limits                    |
| GET     | `/listings?q&category&county&condition&minPriceCents&maxPriceCents&sort&page` | optional   | browse active listings                                      |
| GET     | `/listings/:id`                                                               | optional   | one listing; removed ones only for the owner                |
| POST    | `/listings`                                                                   | required   | create (needs a profile; max 20 live per seller)            |
| PUT     | `/listings/:id`                                                               | owner      | edit; the photo array is the full desired set               |
| POST    | `/listings/:id/status`                                                        | owner      | `{ status: active \| sold \| removed }`                     |
| GET     | `/listings/:id/contact`                                                       | required   | seller contact; records an enquiry                          |
| PUT     | `/listings/:id/saved`                                                         | required   | `{ saved: boolean }`                                        |
| GET     | `/listings/:id/review`                                                        | required   | may the viewer review, and their existing review            |
| PUT     | `/listings/:id/review`                                                        | required   | `{ rating 1–5, comment? }`, create or update                |
| GET     | `/sellers/:id`                                                                | optional   | public seller page with stats, listings, reviews            |
| GET     | `/me`                                                                         | required   | profile, own listings, saved, enquiry counts, reviews given |
| PUT     | `/me`                                                                         | required   | create or update the profile                                |
| POST    | `/uploads`                                                                    | required   | `{ contentType, byteLength }` → presigned PUT               |
| PUT/GET | `/uploads/*`                                                                  | signed URL | local storage driver only                                   |

Photo flow: the browser resizes, calls `POST /uploads`, `PUT`s the bytes to
the returned URL, then includes `{ key, width, height }` in the listing. The
API only accepts keys it issued to that user (`market/<userId>/…`). Photos
dropped from a listing, or belonging to a removed listing, are deleted from
storage. Abandoned uploads that never reach a listing are not yet swept; a
lifecycle rule on the bucket prefix is the cheap fix.

## Data model

Tables are prefixed `market_` so the database can be shared.

- `market_profiles` – one per Clerk user who has set up selling. Contact
  details live here and are only served through the contact endpoint.
- `market_listings` – the listing; `status` is `active | sold | removed`.
  A removed listing keeps its row (reviews still point at it) but is hidden.
- `market_listing_photos` – ordered photos with their storage key and URL.
- `market_saved` – a member's saved listings.
- `market_contact_reveals` – who asked for whose contact on which listing.
- `market_reviews` – one per (reviewer, listing); `seller_id <> reviewer_id`.
- `market_seller_stats` – a view: live/sold/total counts, mean rating, count.
- `market_migrations` – what has been applied.

## Design

The pages consume the Force5 bundle in `design/` and nothing else: tokens via
`--sem-*` custom properties, and the `surface`, `button`, `chip`, `search-field`
and `segmented` components. The marketplace added two type steps to the bundle
(`sem.text.lead`, `sem.text.prose`, ruling dated 2026-09-16 in
`design/foundations/principles.md`) because a content page needed something
between 12px body and 25px title. Form fields (`.mk-field`) are product CSS for
now and are recorded in the bundle's Gaps list as the next component to
promote. Every non-token literal in `market/web/market.css` is a layout measure
and carries a `ds-lint-allow` reason.

## Not yet built

- In-app messaging. Contact is by phone, WhatsApp or email, DoneDeal-style.
- Moderation and reporting. Sellers can remove their own listings; there is no
  admin role, report button, or word filter.
- Rate limiting and abuse controls beyond the per-seller listing cap and body
  size limits. Put the API behind Railway's or a CDN's rate limiting.
- Email notifications (new enquiry, new review).
- Navigation from the map to `/market`. The route works; the link is the
  map's call.
