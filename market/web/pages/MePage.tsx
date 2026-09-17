import { Pencil, PlusCircle } from "lucide-react";
import { useState } from "react";
import { useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Empty,
  ListingGrid,
  Notice,
  Stars,
  errorMessage,
  useAsync,
  usePageTitle,
} from "../components";
import ProfileForm from "./ProfileForm";
import { Link, navigate, paths } from "../router";
import type { Listing, MePayload } from "../../shared/types";
import { formatPrice, relativeAge } from "../../shared/validate";

const TABS = [
  { id: "listings", label: "My listings" },
  { id: "saved", label: "Saved" },
  { id: "reviews", label: "Reviews" },
  { id: "profile", label: "Profile" },
];

export default function MePage({ tab }: { tab: string }) {
  usePageTitle("My account");
  const api = useApi();
  const auth = useMarketAuth();
  const me = useAsync(
    () => (auth.signedIn ? api.me() : Promise.resolve(null)),
    [api, auth.signedIn],
  );
  const current = TABS.some((t) => t.id === tab) ? tab : "listings";

  if (!auth.loaded || me.loading)
    return (
      <div
        className="mk-skeleton"
        style={{ aspectRatio: "16 / 6" }}
        aria-busy="true"
      />
    );
  if (!auth.signedIn) {
    return (
      <section className="mk-pane mk-stack">
        <h1 className="mk-title">Your marketplace</h1>
        <p className="mk-muted">
          Sign in to see your listings, saved gear and reviews.
        </p>
        {auth.provider !== "none" && (
          <div className="mk-form__actions">
            <button
              type="button"
              className="f5-button f5-button--primary f5-button--lg"
              onClick={auth.signIn}
            >
              Sign in
            </button>
          </div>
        )}
      </section>
    );
  }
  if (me.error || !me.data)
    return (
      <Notice kind="warn">{me.error ?? "Could not load your account."}</Notice>
    );
  const data = me.data;

  return (
    <>
      <div className="mk-section-head">
        <h1 className="mk-title">
          {data.profile ? data.profile.displayName : "Your marketplace"}
        </h1>
        {data.profile && (
          <Link
            to={paths.seller(data.profile.id)}
            className="f5-button f5-button--link"
          >
            View your public seller page
          </Link>
        )}
      </div>
      <div
        className="f5-segmented"
        role="tablist"
        aria-label="Account sections"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={paths.me(t.id)}
            role="tab"
            aria-selected={current === t.id}
            aria-pressed={current === t.id}
            className="f5-segmented__item"
          >
            {t.label}
            {t.id === "saved" && data.saved.length > 0 && (
              <small>{data.saved.length}</small>
            )}
          </Link>
        ))}
      </div>
      {current === "listings" && (
        <MyListings data={data} onChange={me.setData} />
      )}
      {current === "saved" &&
        (data.saved.length ? (
          <ListingGrid listings={data.saved} showStatus />
        ) : (
          <Empty title="Nothing saved yet">
            <p className="mk-caption">
              Tap Save on a listing to keep an eye on it here.
            </p>
          </Empty>
        ))}
      {current === "reviews" && <ReviewsGiven data={data} />}
      {current === "profile" && (
        <section className="mk-pane">
          <ProfileForm
            profile={data.profile}
            onSaved={(profile) =>
              me.setData((d) => (d ? { ...d, profile } : d))
            }
          />
        </section>
      )}
    </>
  );
}

function MyListings({
  data,
  onChange,
}: {
  data: MePayload;
  onChange: (u: (d: MePayload | null) => MePayload | null) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const setStatus = async (listing: Listing, status: Listing["status"]) => {
    if (
      status === "removed" &&
      !window.confirm(`Remove "${listing.title}"? Its photos will be deleted.`)
    )
      return;
    setBusy(listing.id);
    setError("");
    try {
      const updated = await api.setStatus(listing.id, status);
      onChange((d) =>
        d
          ? {
              ...d,
              listings:
                status === "removed"
                  ? d.listings.filter((l) => l.id !== listing.id)
                  : d.listings.map((l) => (l.id === listing.id ? updated : l)),
            }
          : d,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!data.profile) {
    return (
      <Empty title="Set up your seller profile to start listing">
        <button
          type="button"
          className="f5-button f5-button--primary"
          onClick={() => navigate(paths.me("profile"))}
        >
          Create profile
        </button>
      </Empty>
    );
  }
  if (!data.listings.length) {
    return (
      <Empty title="You have nothing listed">
        <Link to={paths.sell()} className="f5-button f5-button--primary">
          <PlusCircle size={16} aria-hidden="true" /> List something
        </Link>
      </Empty>
    );
  }

  const active = data.listings.filter((l) => l.status === "active");
  const sold = data.listings.filter((l) => l.status === "sold");

  const Row = ({ listing }: { listing: Listing }) => {
    const enquiries = data.enquiries[listing.id] ?? 0;
    return (
      <li className="mk-pane mk-row mk-row--between">
        <Link
          to={paths.listing(listing.id)}
          className="mk-row mk-link"
          style={{ textDecoration: "none", minWidth: 0, flex: "1 1 240px" }}
        >
          <span
            className="mk-photo"
            style={{ width: "var(--sem-control-height-lg)", flex: "0 0 auto" }}
          >
            {listing.photos[0] && <img src={listing.photos[0].url} alt="" />}
          </span>
          <span className="mk-stack--tight" style={{ minWidth: 0 }}>
            <span className="mk-lead" style={{ display: "block" }}>
              {listing.title}
            </span>
            <span className="mk-caption" style={{ display: "block" }}>
              {formatPrice(listing.priceCents, listing.currency)} · listed{" "}
              {relativeAge(listing.createdAt)} · {enquiries} enquir
              {enquiries === 1 ? "y" : "ies"}
              {listing.status === "sold" && listing.soldAt
                ? ` · sold ${relativeAge(listing.soldAt)}`
                : ""}
            </span>
          </span>
        </Link>
        <span className="mk-form__actions">
          <Link
            to={paths.edit(listing.id)}
            className="f5-button f5-button--pill f5-button--sm"
          >
            <Pencil size={14} aria-hidden="true" /> Edit
          </Link>
          {listing.status === "active" ? (
            <button
              type="button"
              className="f5-button f5-button--pill f5-button--sm"
              disabled={busy === listing.id}
              onClick={() => setStatus(listing, "sold")}
            >
              Mark as sold
            </button>
          ) : (
            <button
              type="button"
              className="f5-button f5-button--pill f5-button--sm"
              disabled={busy === listing.id}
              onClick={() => setStatus(listing, "active")}
            >
              Relist
            </button>
          )}
          <button
            type="button"
            className="f5-button f5-button--link"
            disabled={busy === listing.id}
            onClick={() => setStatus(listing, "removed")}
          >
            Remove
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="mk-stack">
      {error && <Notice kind="warn">{error}</Notice>}
      <div className="mk-section-head">
        <h2 className="mk-lead">Live ({active.length})</h2>
        <Link
          to={paths.sell()}
          className="f5-button f5-button--pill f5-button--sm"
        >
          <PlusCircle size={14} aria-hidden="true" /> New listing
        </Link>
      </div>
      {active.length ? (
        <ul
          className="mk-stack--tight"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
          {active.map((l) => (
            <Row key={l.id} listing={l} />
          ))}
        </ul>
      ) : (
        <p className="mk-muted">Nothing live right now.</p>
      )}
      {sold.length > 0 && (
        <>
          <h2 className="mk-lead">Sold ({sold.length})</h2>
          <ul
            className="mk-stack--tight"
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {sold.map((l) => (
              <Row key={l.id} listing={l} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReviewsGiven({ data }: { data: MePayload }) {
  if (!data.reviewsGiven.length) {
    return (
      <Empty title="You have not reviewed anyone yet">
        <p className="mk-caption">
          After you contact a seller you can rate how the sale went, from their
          listing page.
        </p>
      </Empty>
    );
  }
  return (
    <section className="mk-pane">
      {data.reviewsGiven.map((r) => (
        <div key={r.id} className="mk-review mk-stack--tight">
          <div className="mk-row mk-row--between">
            <Stars value={r.rating} />
            <span className="mk-caption">{relativeAge(r.createdAt)}</span>
          </div>
          <p className="mk-caption">
            On{" "}
            <Link to={paths.listing(r.listingId)} className="mk-link">
              {r.listingTitle}
            </Link>
          </p>
          {r.comment && <p className="mk-prose mk-body">{r.comment}</p>}
        </div>
      ))}
    </section>
  );
}
