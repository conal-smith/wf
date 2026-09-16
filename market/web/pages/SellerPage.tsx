import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useApi } from "../api";
import {
  Avatar,
  Empty,
  ListingGrid,
  Notice,
  Stars,
  useAsync,
  usePageTitle,
} from "../components";
import { Link, paths } from "../router";
import { relativeAge } from "../../shared/validate";

export default function SellerPage({ id }: { id: string }) {
  const api = useApi();
  const result = useAsync(() => api.getSeller(id), [api, id]);
  const page = result.data;
  usePageTitle(page ? page.seller.displayName : "Seller");
  const [tab, setTab] = useState<"active" | "sold" | "reviews">("active");

  if (result.error) {
    return (
      <>
        <Back />
        <Notice kind="warn">{result.error}</Notice>
      </>
    );
  }
  if (!page)
    return (
      <div
        className="mk-skeleton"
        style={{ aspectRatio: "16 / 6" }}
        aria-busy="true"
      />
    );

  const { seller, stats } = page;
  const total = stats.ratingCount || 1;

  return (
    <>
      <Back />
      <section className="mk-pane mk-detail" aria-labelledby="mk-seller-name">
        <div className="mk-seller" style={{ alignItems: "flex-start" }}>
          <Avatar name={seller.displayName} large />
          <div className="mk-stack--tight" style={{ minWidth: 0 }}>
            <h1 className="mk-title" id="mk-seller-name">
              {seller.displayName}
            </h1>
            <p className="mk-caption">
              Member since{" "}
              {new Date(seller.memberSince).toLocaleDateString("en-IE", {
                month: "long",
                year: "numeric",
              })}
              {seller.county ? ` · Co. ${seller.county}` : ""}
            </p>
            <div
              className="mk-stats"
              style={{ marginTop: "var(--sem-space-gap-loose)" }}
            >
              <Stat label="Rating">
                <span
                  className="mk-row"
                  style={{ gap: "var(--sem-space-gap-tight)" }}
                >
                  <Stars value={stats.ratingAvg} size={16} />
                  <span className="mk-lead">
                    {stats.ratingAvg == null ? "–" : stats.ratingAvg.toFixed(1)}
                  </span>
                </span>
              </Stat>
              <Stat label="Reviews">
                <span className="mk-lead">{stats.ratingCount}</span>
              </Stat>
              <Stat label="Sold">
                <span className="mk-lead">{stats.soldCount}</span>
              </Stat>
              <Stat label="Live">
                <span className="mk-lead">{stats.activeCount}</span>
              </Stat>
            </div>
            {seller.bio && (
              <p
                className="mk-prose"
                style={{ marginTop: "var(--sem-space-gap-loose)" }}
              >
                {seller.bio}
              </p>
            )}
          </div>
        </div>
        <div className="mk-pane mk-pane--sunken mk-stack--tight">
          <p className="mk-eyebrow">Rating breakdown</p>
          {stats.ratingCount ? (
            <div
              className="mk-histogram"
              role="table"
              aria-label="Star rating breakdown"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n} role="row" style={{ display: "contents" }}>
                  <span className="mk-caption" role="cell">
                    {n}★
                  </span>
                  <span
                    className="mk-histogram__bar"
                    role="cell"
                    aria-hidden="true"
                  >
                    <span
                      className="mk-histogram__fill"
                      style={{
                        width: `${(stats.ratingHistogram[n] / total) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="mk-caption" role="cell">
                    {stats.ratingHistogram[n]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mk-caption">
              No reviews yet. Ratings come from buyers who contacted{" "}
              {seller.displayName} through a listing.
            </p>
          )}
        </div>
      </section>

      <div className="f5-segmented" role="tablist" aria-label="Seller history">
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
            className="f5-segmented__item"
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
          <Empty title="Nothing live right now" />
        ))}
      {tab === "sold" &&
        (page.sold.length ? (
          <ListingGrid listings={page.sold} showStatus />
        ) : (
          <Empty title="No sales recorded yet" />
        ))}
      {tab === "reviews" &&
        (page.reviews.length ? (
          <section className="mk-pane">
            {page.reviews.map((r) => (
              <div key={r.id} className="mk-review mk-stack--tight">
                <div className="mk-row mk-row--between">
                  <span className="mk-row">
                    <Stars value={r.rating} />
                    <span className="mk-body">{r.reviewer.displayName}</span>
                  </span>
                  <span className="mk-caption">{relativeAge(r.createdAt)}</span>
                </div>
                <p className="mk-caption">
                  About{" "}
                  <Link to={paths.listing(r.listingId)} className="mk-link">
                    {r.listingTitle}
                  </Link>
                </p>
                {r.comment && <p className="mk-prose mk-body">{r.comment}</p>}
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
    <p>
      <Link
        to={paths.browse()}
        className="f5-button f5-button--pill f5-button--sm"
      >
        <ArrowLeft size={15} aria-hidden="true" /> All listings
      </Link>
    </p>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mk-stat">
      <span className="mk-eyebrow">{label}</span>
      {children}
    </div>
  );
}
