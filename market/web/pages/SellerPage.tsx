import { useState } from "react";
import { Figure, Heading, StarGlyphs } from "../../../ui";
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
    name: "flex min-w-0 flex-col gap-1",
    column: "flex min-w-0 flex-col gap-5",
    // The seller's own words, in plain prose.
    bio: "m-0 max-w-measure font-body text-prose text-ink-2 whitespace-pre-wrap wrap-anywhere",

    // ---- the figures, as a row of cells in one soft card, a hairline
    // between them inside it, the figure over its label. On a phone the
    // rating takes a row of its own and the three counts share the one
    // under it.
    stats:
      "m-0 grid grid-cols-4 rounded-surface bg-sunken max-wide:grid-cols-3",
    stat: [
      "flex min-w-0 flex-col-reverse justify-end gap-1 border-0 border-line px-4 py-3.5",
      "not-first:border-l",
      "max-wide:first:col-span-3 max-wide:first:border-b max-wide:nth-2:border-l-0",
    ],
    statLabel: "font-body text-body text-ink-muted",
    statValue: "m-0 flex flex-wrap items-center gap-2",

    // ---- the rating breakdown: a soft bar filled from the left.
    breakdown: "flex min-w-0 flex-col gap-3",
    histogram: "grid grid-cols-meter items-center gap-x-3 gap-y-2",
    bar: "h-2 overflow-hidden rounded-full bg-sunken",
    fill: "block h-full rounded-full bg-ink-2",
    figure: "font-mono text-label text-ink-2 tabular-nums",

    // ---- the reviews, as rows in one soft card
    reviews: "m-0 list-none divide-y divide-line rounded-surface bg-sunken p-0",
    review: "flex flex-col gap-2 px-4 py-3.5",
    between: "flex flex-wrap items-center justify-between gap-2",
    row: "flex flex-wrap items-center gap-3",
    reviewer: "font-body text-prose font-semibold",
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
          <div className={styles.who()}>
            <Avatar name={seller.displayName} large />
            <div className={styles.name()}>
              <Heading level="page" id="seller-name">
                {seller.displayName}
              </Heading>
              <p className={styles.about()}>
                Seller since {since}
                {seller.county ? ` · Co. ${seller.county}` : ""}
              </p>
            </div>
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
          <Heading level="card" as="h2">
            Ratings
          </Heading>
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
          <ul className={styles.reviews()} aria-label="Reviews">
            {page.reviews.map((r) => (
              <li key={r.id} className={styles.review()}>
                <div className={styles.between()}>
                  <span className={styles.row()}>
                    <Stars value={r.rating} size={12} />
                    <span className={styles.reviewer()}>
                      {r.reviewer.displayName}
                    </span>
                  </span>
                  <span className={styles.about()}>
                    <Age iso={r.createdAt} prefix="Reviewed" />
                  </span>
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
              </li>
            ))}
          </ul>
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
      <dt className={styles.statLabel()}>{label}</dt>
      <dd className={styles.statValue()}>{children}</dd>
    </div>
  );
}
