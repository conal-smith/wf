import { useState } from "react";
import { Figure, Headline, Kicker, StarGlyphs } from "../../../ui";
import { linkStyles } from "../../../ui/Link";
import { tv } from "../../../ui/tv";
import { useApi } from "../api";
import {
  Age,
  Avatar,
  BackLink,
  Empty,
  ListingGrid,
  LoadError,
  NotFound,
  PageSkeleton,
  Stars,
  sharedStyles,
  tabStyles,
  useAsync,
  usePageTitle,
} from "../components";
import { Link, paths } from "../router";

export const sellerStyles = tv({
  slots: {
    // The seller, and the breakdown of their rating beside them: three to two
    // at the listing's breakpoint, but on the profile's 260px floor, not the
    // detail panel's 320, which would take 8px off the name at 900 wide.
    head: "grid min-w-0 items-start gap-x-10 gap-y-6 rail:grid-cols-profile",
    who: "flex min-w-0 items-center gap-4",
    column: "flex min-w-0 flex-col gap-4",
    // The seller's own words: the broadsheet's deck, in the body's italic.
    bio: "m-0 max-w-measure font-body text-prose text-ink-2 italic whitespace-pre-wrap wrap-anywhere",

    // ---- the figures, as the chart sets a day's: a ruled row of cells,
    // a hairline between them, the figure over its mono label.
    // On a phone the rating takes a row of its own and the three counts
    // share the one under it.
    stats:
      "m-0 grid grid-cols-4 border-0 border-y border-ink max-wide:grid-cols-3",
    stat: [
      "flex min-w-0 flex-col-reverse justify-end gap-1 border-0 border-line px-3 py-3 first:pl-0",
      "not-first:border-l",
      "max-wide:first:col-span-3 max-wide:first:border-b max-wide:nth-2:border-l-0 max-wide:nth-2:pl-0",
    ],
    statValue: "m-0 flex flex-wrap items-center gap-2",

    // ---- the rating breakdown, as the chart sets the chance it rides: a
    // hairline box filled from the left in magenta's wash.
    breakdown: "flex min-w-0 flex-col gap-3",
    histogram: "grid grid-cols-meter items-center gap-x-3 gap-y-2",
    bar: "h-3 overflow-hidden border border-line",
    fill: "block h-full bg-wash/25",
    figure: "font-mono text-caption text-ink-2 tabular-nums",

    // ---- the reviews, one under another on hairlines
    reviews: "flex flex-col",
    review:
      "flex flex-col gap-2 border-0 border-b border-line py-4 first:pt-1",
    between: "flex flex-wrap items-center justify-between gap-2",
    row: "flex flex-wrap items-center gap-3",
    reviewer: "font-display text-prose font-semibold italic",
    about: "m-0 text-body text-ink-muted",
    prose: "m-0 max-w-measure text-prose whitespace-pre-wrap wrap-anywhere",
  },
});

export default function SellerPage({ id }: { id: string }) {
  const api = useApi();
  const result = useAsync(() => api.getSeller(id), [api, id]);
  const page = result.data;
  usePageTitle(page ? page.seller.displayName : "Seller");
  const [tab, setTab] = useState<"active" | "sold" | "reviews">("active");
  const styles = sellerStyles();
  const shared = sharedStyles();
  const tabs = tabStyles();

  if (result.notFound)
    return (
      <NotFound
        title="No seller here"
        text="The link may be old, or the seller may have closed their account."
      />
    );
  if (result.error) {
    return (
      <>
        <BackLink />
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
        <BackLink />
        <PageSkeleton />
      </>
    );

  const { seller, stats } = page;
  const total = stats.ratingCount || 1;
  const since = new Date(seller.memberSince).toLocaleDateString("en-IE", {
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <BackLink />
      <section className={styles.head()} aria-labelledby="seller-name">
        <div className={styles.column()}>
          <div className={shared.dateline()}>
            <Kicker as="span" tone="ink">
              Seller
            </Kicker>
            <Kicker as="span">
              Since {since}
              {seller.county ? ` · Co. ${seller.county}` : ""}
            </Kicker>
          </div>
          <div className={styles.who()}>
            <Avatar name={seller.displayName} large />
            <Headline id="seller-name">{seller.displayName}</Headline>
          </div>
          {seller.bio && <p className={styles.bio()}>{seller.bio}</p>}
          <dl className={styles.stats()}>
            <Stat label="Rating">
              <span className={styles.statValue()}>
                <Figure
                  value={
                    stats.ratingAvg == null ? "–" : stats.ratingAvg.toFixed(1)
                  }
                />
                <Stars value={stats.ratingAvg} size={12} />
              </span>
            </Stat>
            <Stat label={stats.ratingCount === 1 ? "Review" : "Reviews"}>
              <Figure value={stats.ratingCount} />
            </Stat>
            <Stat label="Sold">
              <Figure value={stats.soldCount} />
            </Stat>
            <Stat label="Live">
              <Figure value={stats.activeCount} />
            </Stat>
          </dl>
        </div>
        <div className={styles.breakdown()}>
          <Kicker tone="ink">Ratings</Kicker>
          {stats.ratingCount ? (
            <div
              className={styles.histogram()}
              role="table"
              aria-label="Star rating breakdown"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n} role="row" style={{ display: "contents" }}>
                  <span role="cell">
                    <StarGlyphs
                      stars={n}
                      size={10}
                      label={`${n} star${n === 1 ? "" : "s"}`}
                    />
                  </span>
                  <span className={styles.bar()} role="cell" aria-hidden="true">
                    <span
                      className={styles.fill()}
                      style={{
                        width: `${(stats.ratingHistogram[n] / total) * 100}%`,
                      }}
                    />
                  </span>
                  <span className={styles.figure()} role="cell">
                    {stats.ratingHistogram[n]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.about()}>
              No reviews yet. Buyers who get in touch through a listing can rate{" "}
              {seller.displayName}.
            </p>
          )}
        </div>
      </section>

      <div className={tabs.list()} role="tablist" aria-label="Seller history">
        {(
          [
            ["active", "Live", stats.activeCount],
            ["sold", "Sold", stats.soldCount],
            ["reviews", "Reviews", stats.ratingCount],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-label={`${label} (${count})`}
            className={tabs.tab()}
            onClick={() => setTab(key)}
          >
            {label} <span className={tabs.count()}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "active" &&
        (page.active.length ? (
          <ListingGrid listings={page.active} hideSeller />
        ) : (
          <Empty title="Nothing live right now">
            <p>When {seller.displayName} lists something, it will show here.</p>
          </Empty>
        ))}
      {tab === "sold" &&
        (page.sold.length ? (
          <ListingGrid listings={page.sold} showStatus hideSeller />
        ) : (
          <Empty title="No sales recorded yet" />
        ))}
      {tab === "reviews" &&
        (page.reviews.length ? (
          <section className={styles.reviews()} aria-label="Reviews">
            {page.reviews.map((r) => (
              <div key={r.id} className={styles.review()}>
                <div className={styles.between()}>
                  <span className={styles.row()}>
                    <Stars value={r.rating} size={12} />
                    <span className={styles.reviewer()}>
                      {r.reviewer.displayName}
                    </span>
                  </span>
                  <Kicker as="span">
                    <Age iso={r.createdAt} prefix="Reviewed" />
                  </Kicker>
                </div>
                <p className={styles.about()}>
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

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const styles = sellerStyles();
  return (
    // The label comes first in the source, as a <dl> wants it, and the
    // figure is drawn over it, as the chart sets a figure over its name.
    <div className={styles.stat()}>
      <dt>
        <Kicker as="span">{label}</Kicker>
      </dt>
      <dd className={styles.statValue()}>{children}</dd>
    </div>
  );
}
