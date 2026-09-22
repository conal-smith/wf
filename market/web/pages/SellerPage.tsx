import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Pane } from "../../../ui";
import { paneStyles } from "../../../ui/Pane";
import { buttonStyles } from "../../../ui/Button";
import { linkStyles } from "../../../ui/Link";
import { RING, tv } from "../../../ui/tv";
import { useApi } from "../api";
import {
  Avatar,
  Empty,
  ListingGrid,
  LoadError,
  PageSkeleton,
  Stars,
  useAsync,
  usePageTitle,
} from "../components";
import { Link, paths } from "../router";
import { relativeAge } from "../../shared/validate";

export const sellerStyles = tv({
  slots: {
    // The seller, and the breakdown of their rating beside them: three to two
    // at the listing's breakpoint, but on the profile's 260px floor, not the
    // detail panel's 320, which would take 8px off the name at 900 wide.
    head: "grid min-w-0 items-start gap-6 rail:grid-cols-profile",
    who: "flex min-w-0 items-start gap-3",
    column: "flex min-w-0 flex-col gap-5",
    tight: "flex min-w-0 flex-col gap-1",
    stats: "flex flex-wrap gap-x-8 gap-y-5",
    stat: "grid gap-1",
    statValue: "flex flex-wrap items-center gap-1",

    // ---- the rating breakdown
    // The sunken box keeps the hairline it always had, in no colour.
    breakdown:
      "flex min-w-0 flex-col gap-5 rounded-control border border-transparent",
    histogram: "grid grid-cols-meter items-center gap-x-3 gap-y-2",
    bar: "h-2 overflow-hidden rounded-full bg-sunken",
    fill: "block h-full rounded-full bg-accent",

    /*
     * The tabs. A tablist is not one of the kit's parts — ui/Segmented is a
     * group of toggles, and these carry `role="tab"` — so the track and its
     * items are drawn here, at the sizes market.css gave them: a line of
     * words rather than a row of raised controls. On a coarse pointer they
     * take the kit's own minimum, like every other control a thumb lands on.
     */
    tabs: "inline-flex max-w-full self-start overflow-x-auto scrollbar-none rounded-full bg-sunken p-1",
    tab: [
      "inline-flex h-8.5 shrink-0 cursor-pointer items-center justify-center gap-1",
      "rounded-full border-0 bg-transparent px-3 py-0 font-sans text-body leading-tight font-semibold",
      "whitespace-nowrap text-ink-muted no-underline touch-manipulation",
      "transition-colors duration-fast pointer-coarse:min-h-touch",
      // The track is already sunken, so a hover lifts towards the card.
      "not-disabled:hover:bg-card/60 not-disabled:hover:text-ink",
      // The chosen one is lifted off the track: fill and shadow, not colour.
      "aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-control",
      "not-disabled:aria-pressed:hover:bg-card",
      // The ring is drawn inside the tab, as the segmented track always drew
      // it: the track scrolls sideways, so a ring outside would be cut off
      // along its top and bottom edges.
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],

    // ---- the reviews
    review:
      "flex flex-col gap-2 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0",
    row: "flex flex-wrap items-center gap-2",
    between: "flex flex-wrap items-center justify-between gap-2",

    // ---- the words
    title: "m-0 text-title text-balance text-ink",
    lead: "m-0 text-lead text-ink",
    eyebrow: "m-0 text-eyebrow text-ink-muted uppercase",
    quiet: "m-0 text-body text-ink-muted",
    prose: "m-0 max-w-measure whitespace-pre-wrap wrap-anywhere",
  },
});

export default function SellerPage({ id }: { id: string }) {
  const api = useApi();
  const result = useAsync(() => api.getSeller(id), [api, id]);
  const page = result.data;
  usePageTitle(page ? page.seller.displayName : "Seller");
  const [tab, setTab] = useState<"active" | "sold" | "reviews">("active");
  const styles = sellerStyles();

  if (result.error) {
    return (
      <>
        <Back />
        <LoadError
          title="This seller could not be loaded"
          message={result.error}
          onRetry={result.reload}
        />
      </>
    );
  }
  if (!page)
    return (
      <>
        <Back />
        <PageSkeleton />
      </>
    );

  const { seller, stats } = page;
  const total = stats.ratingCount || 1;

  return (
    <>
      <Back />
      <section
        className={paneStyles({ standing: true, className: styles.head() })}
        aria-labelledby="seller-name"
      >
        <div className={styles.who()}>
          <Avatar name={seller.displayName} large />
          <div className={styles.column()}>
            <div className={styles.tight()}>
              <h1 className={styles.title()} id="seller-name">
                {seller.displayName}
              </h1>
              <p className={styles.quiet()}>
                Member since{" "}
                {new Date(seller.memberSince).toLocaleDateString("en-IE", {
                  month: "long",
                  year: "numeric",
                })}
                {seller.county ? ` · Co. ${seller.county}` : ""}
              </p>
            </div>
            <div className={styles.stats()}>
              <Stat label="Rating">
                <span className={styles.statValue()}>
                  <Stars value={stats.ratingAvg} size={16} />
                  <span className={styles.lead()}>
                    {stats.ratingAvg == null ? "–" : stats.ratingAvg.toFixed(1)}
                  </span>
                </span>
              </Stat>
              <Stat label="Reviews">
                <span className={styles.lead()}>{stats.ratingCount}</span>
              </Stat>
              <Stat label="Sold">
                <span className={styles.lead()}>{stats.soldCount}</span>
              </Stat>
              <Stat label="Live">
                <span className={styles.lead()}>{stats.activeCount}</span>
              </Stat>
            </div>
            {seller.bio && <p className={styles.prose()}>{seller.bio}</p>}
          </div>
        </div>
        <Pane kind="sunken" className={styles.breakdown()}>
          <p className={styles.eyebrow()}>Rating breakdown</p>
          {stats.ratingCount ? (
            <div
              className={styles.histogram()}
              role="table"
              aria-label="Star rating breakdown"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n} role="row" style={{ display: "contents" }}>
                  <span className={styles.quiet()} role="cell">
                    {n}★
                  </span>
                  <span className={styles.bar()} role="cell" aria-hidden="true">
                    <span
                      className={styles.fill()}
                      style={{
                        width: `${(stats.ratingHistogram[n] / total) * 100}%`,
                      }}
                    />
                  </span>
                  <span className={styles.quiet()} role="cell">
                    {stats.ratingHistogram[n]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.quiet()}>
              No reviews yet. Ratings come from buyers who contacted{" "}
              {seller.displayName} through a listing.
            </p>
          )}
        </Pane>
      </section>

      <div className={styles.tabs()} role="tablist" aria-label="Seller history">
        {(
          [
            ["active", `Live (${stats.activeCount})`],
            ["sold", `Sold (${stats.soldCount})`],
            ["reviews", `Reviews (${stats.ratingCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-pressed={tab === id}
            className={styles.tab()}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "active" &&
        (page.active.length ? (
          <ListingGrid listings={page.active} />
        ) : (
          <Empty title="Nothing live right now">
            <p>When {seller.displayName} lists something, it will show here.</p>
          </Empty>
        ))}
      {tab === "sold" &&
        (page.sold.length ? (
          <ListingGrid listings={page.sold} showStatus />
        ) : (
          <Empty title="No sales recorded yet" />
        ))}
      {tab === "reviews" &&
        (page.reviews.length ? (
          <section className={paneStyles({ standing: true })}>
            {page.reviews.map((r) => (
              <div key={r.id} className={styles.review()}>
                <div className={styles.between()}>
                  <span className={styles.row()}>
                    <Stars value={r.rating} />
                    <strong>{r.reviewer.displayName}</strong>
                  </span>
                  <span className={styles.quiet()}>
                    {relativeAge(r.createdAt)}
                  </span>
                </div>
                <p className={styles.quiet()}>
                  About{" "}
                  <Link
                    to={paths.listing(r.listingId)}
                    className={linkStyles()}
                  >
                    {r.listingTitle}
                  </Link>
                </p>
                {r.comment && <p className={styles.prose()}>{r.comment}</p>}
              </div>
            ))}
          </section>
        ) : (
          <Empty title="No reviews yet" />
        ))}
    </>
  );
}

function Back() {
  return (
    <div>
      <Link to={paths.browse()} className={buttonStyles({ size: "sm" })}>
        <ArrowLeft size={15} aria-hidden="true" /> All listings
      </Link>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const styles = sellerStyles();
  return (
    <div className={styles.stat()}>
      <span className={styles.eyebrow()}>{label}</span>
      {children}
    </div>
  );
}
