import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Share2,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Avatar,
  ConfirmDialog,
  Field,
  LoadError,
  Notice,
  RatingPicker,
  SaveButton,
  SellerRating,
  Stars,
  TextArea,
  categoryLabel,
  conditionLabel,
  errorMessage,
  useAsync,
  usePageTitle,
} from "../components";
import { Link, navigate, paths } from "../router";
import type {
  Listing,
  ReviewEligibility,
  SellerContact,
} from "../../shared/types";
import { formatPrice, relativeAge } from "../../shared/validate";

export default function ListingPage({ id }: { id: string }) {
  const api = useApi();
  const auth = useMarketAuth();
  const result = useAsync(() => api.getListing(id), [api, id, auth.userId]);
  const listing = result.data;
  usePageTitle(listing ? listing.title : "Listing");

  if (result.error) {
    return (
      <>
        <BackLink />
        <LoadError
          title="This listing could not be loaded"
          message={result.error}
          onRetry={result.reload}
        />
      </>
    );
  }
  if (!listing)
    return (
      <>
        <BackLink />
        <div className="mk-skeleton" aria-busy="true" aria-label="Loading" />
      </>
    );

  const where = listing.town
    ? `${listing.town}, Co. ${listing.county}`
    : `Co. ${listing.county}`;
  const specs: [string, string | number | null][] = [
    ["Category", categoryLabel(listing.category)],
    ["Condition", conditionLabel(listing.condition)],
    ["Brand", listing.brand],
    ["Size", listing.sizeLabel],
    ["Year", listing.year],
    ["Location", where],
  ];

  return (
    <>
      <BackLink />
      <article className="mk-detail">
        <div className="mk-detail__gallery">
          <Gallery listing={listing} />
        </div>
        <Aside listing={listing} onChange={(l) => result.setData(l)} />
        <div className="mk-detail__body mk-stack mk-stack--loose">
          <section className="mk-pane mk-stack mk-stack--loose">
            <div className="mk-stack">
              <h2 className="mk-lead">Details</h2>
              <dl className="mk-specs">
                {specs.map(
                  ([label, value]) =>
                    value != null &&
                    value !== "" && (
                      <div key={label}>
                        <dt className="mk-meta">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ),
                )}
              </dl>
            </div>
            <hr className="mk-divider" />
            <div className="mk-stack">
              <h2 className="mk-lead">Description</h2>
              <p className="mk-prose">{listing.description}</p>
            </div>
          </section>
          {auth.signedIn && !listing.isOwner && (
            <ReviewSection listing={listing} />
          )}
        </div>
      </article>
    </>
  );
}

function BackLink() {
  return (
    <div>
      <Link to={paths.browse()} className="f5-button f5-button--sm">
        <ArrowLeft size={15} aria-hidden="true" /> All listings
      </Link>
    </div>
  );
}

function Gallery({ listing }: { listing: Listing }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [listing.id]);
  const count = listing.photos.length;
  const photo = listing.photos[index];
  const step = (delta: number) => setIndex((i) => (i + delta + count) % count);
  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="Photos"
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowLeft") step(-1);
        if (e.key === "ArrowRight") step(1);
      }}
    >
      <div className="mk-gallery__main">
        {photo ? (
          <img
            src={photo.url}
            alt={`${listing.title}, photo ${index + 1} of ${count}`}
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
          />
        ) : (
          <div className="mk-stack--tight" style={{ alignItems: "center" }}>
            <ImageIcon size={32} aria-hidden="true" />
            <p className="mk-meta">The seller has not added photos</p>
          </div>
        )}
        {count > 1 && (
          <>
            <button
              type="button"
              className="f5-button f5-button--pill f5-button--icon mk-gallery__nav mk-gallery__nav--prev"
              aria-label="Previous photo"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="f5-button f5-button--pill f5-button--icon mk-gallery__nav mk-gallery__nav--next"
              aria-label="Next photo"
              onClick={() => step(1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <span
              className="f5-chip f5-chip--glass mk-gallery__count"
              aria-hidden="true"
            >
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="mk-gallery__thumbs">
          {listing.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="mk-thumb"
              aria-pressed={i === index}
              aria-label={`Photo ${i + 1} of ${count}`}
              onClick={() => setIndex(i)}
            >
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Aside({
  listing,
  onChange,
}: {
  listing: Listing;
  onChange: (l: Listing) => void;
}) {
  const api = useApi();
  const auth = useMarketAuth();
  const [contact, setContact] = useState<SellerContact | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setContact(null), [listing.id]);

  const reveal = async () => {
    if (!auth.signedIn) return auth.signIn();
    setContactBusy(true);
    setError("");
    try {
      setContact(await api.getContact(listing.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setContactBusy(false);
    }
  };

  const toggleSave = async () => {
    if (!auth.signedIn) return auth.signIn();
    setSaveBusy(true);
    try {
      const next = !listing.saved;
      await api.setSaved(listing.id, next);
      onChange({ ...listing, saved: next });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const [confirmRemove, setConfirmRemove] = useState(false);
  const [shared, setShared] = useState(false);

  const share = async () => {
    const data = { title: listing.title, url: window.location.href };
    try {
      if (navigator.share) return await navigator.share(data);
      await navigator.clipboard.writeText(data.url);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // Dismissing the share sheet rejects; there is nothing to report.
    }
  };

  const setStatus = async (status: Listing["status"]) => {
    setStatusBusy(true);
    setError("");
    try {
      const updated = await api.setStatus(listing.id, status);
      if (status === "removed") navigate(paths.me());
      else onChange(updated);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStatusBusy(false);
      setConfirmRemove(false);
    }
  };

  const where = listing.town
    ? `${listing.town}, Co. ${listing.county}`
    : `Co. ${listing.county}`;
  const whatsappNumber = contact?.phone
    ?.replace(/^0/, "353")
    .replace(/^\+/, "");

  const shareButton = (
    <button
      type="button"
      className="f5-button f5-button--pill f5-button--icon f5-button--lg"
      aria-label={shared ? "Link copied" : "Share this listing"}
      title={shared ? "Link copied" : "Share"}
      onClick={share}
    >
      {shared ? (
        <Check size={18} aria-hidden="true" />
      ) : (
        <Share2 size={18} aria-hidden="true" />
      )}
    </button>
  );

  return (
    <aside className="mk-detail__aside mk-stack">
      <section className="mk-pane mk-stack">
        <div className="mk-stack--tight">
          {listing.status !== "active" && (
            <p>
              <span className="f5-chip f5-chip--warn">
                {listing.status === "sold" ? "Sold" : "Removed"}
              </span>
            </p>
          )}
          <h1 className="mk-lead">{listing.title}</h1>
          <p className="mk-price">
            {formatPrice(listing.priceCents, listing.currency)}
          </p>
          <p className="mk-meta">
            {where} · Listed {relativeAge(listing.createdAt)}
          </p>
        </div>

        {listing.isOwner ? (
          <div className="mk-stack">
            <div className="mk-actions">
              <Link
                to={paths.edit(listing.id)}
                className="f5-button f5-button--primary f5-button--lg"
              >
                <Pencil size={16} aria-hidden="true" /> Edit listing
              </Link>
              {shareButton}
            </div>
            <div className="mk-form__actions">
              {listing.status === "active" ? (
                <button
                  type="button"
                  className="f5-button f5-button--pill"
                  disabled={statusBusy}
                  onClick={() => setStatus("sold")}
                >
                  Mark as sold
                </button>
              ) : (
                <button
                  type="button"
                  className="f5-button f5-button--pill"
                  disabled={statusBusy}
                  onClick={() => setStatus("active")}
                >
                  Relist
                </button>
              )}
              <button
                type="button"
                className="f5-button f5-button--link"
                disabled={statusBusy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove listing
              </button>
            </div>
          </div>
        ) : listing.status !== "active" ? (
          <Notice>
            This item has been {listing.status}. The seller may have other gear
            listed.
          </Notice>
        ) : contact ? (
          <div
            className="mk-pane mk-pane--sunken mk-contact"
            aria-live="polite"
          >
            <p className="mk-eyebrow">Contact {contact.displayName}</p>
            {contact.phone && (
              <a className="mk-link" href={`tel:${contact.phone}`}>
                <Phone size={16} aria-hidden="true" /> {contact.phone}
              </a>
            )}
            {contact.whatsapp && whatsappNumber && (
              <a
                className="mk-link"
                href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I'm interested in your wingfoil.ie listing: ${listing.title}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </a>
            )}
            {contact.email && (
              <a
                className="mk-link"
                href={`mailto:${contact.email}?subject=${encodeURIComponent(`wingfoil.ie: ${listing.title}`)}`}
              >
                <Mail size={16} aria-hidden="true" /> {contact.email}
              </a>
            )}
          </div>
        ) : (
          <div className="mk-actions">
            <button
              type="button"
              className="f5-button f5-button--primary f5-button--lg"
              disabled={contactBusy || auth.provider === "none"}
              onClick={reveal}
            >
              {contactBusy
                ? "Fetching details…"
                : auth.signedIn
                  ? "Show contact details"
                  : "Sign in to contact seller"}
            </button>
            <SaveButton
              saved={Boolean(listing.saved)}
              busy={saveBusy}
              onToggle={toggleSave}
            />
            {shareButton}
          </div>
        )}
        {contact && !listing.isOwner && (
          <div className="mk-actions">
            <SaveButton
              saved={Boolean(listing.saved)}
              busy={saveBusy}
              onToggle={toggleSave}
            />
            {shareButton}
          </div>
        )}
        {auth.provider === "none" && !listing.isOwner && (
          <p className="mk-meta">
            Sign-in is not configured on this build, so contact details are
            hidden.
          </p>
        )}
        {error && <Notice kind="warn">{error}</Notice>}
      </section>

      <section className="mk-pane mk-stack" aria-label="Seller">
        <Link to={paths.seller(listing.seller.id)} className="mk-seller">
          <Avatar name={listing.seller.displayName} />
          <span className="mk-stack--tight">
            <span className="mk-lead">{listing.seller.displayName}</span>
            <SellerRating seller={listing.seller} />
          </span>
          <ChevronRight
            size={18}
            className="mk-seller__chevron"
            aria-hidden="true"
          />
        </Link>
        <p className="mk-meta">
          {listing.seller.soldCount} sold · Member since{" "}
          {new Date(listing.seller.memberSince).getFullYear()}
          {listing.seller.county ? ` · Co. ${listing.seller.county}` : ""}
        </p>
      </section>

      {!listing.isOwner && listing.status === "active" && (
        <Notice>
          <span className="mk-body">
            Meet somewhere public, check the gear before paying, and never pay a
            deposit to hold an item.
          </span>
        </Notice>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this listing?"
        confirmLabel="Remove listing"
        busy={statusBusy}
        onConfirm={() => setStatus("removed")}
        onCancel={() => setConfirmRemove(false)}
      >
        It will disappear from the marketplace and its photos will be deleted.
        This cannot be undone.
      </ConfirmDialog>
    </aside>
  );
}

function ReviewSection({ listing }: { listing: Listing }) {
  const api = useApi();
  const state = useAsync(
    () => api.reviewEligibility(listing.id),
    [api, listing.id],
  );
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (state.data?.existing) {
      setRating(state.data.existing.rating);
      setComment(state.data.existing.comment ?? "");
    }
  }, [state.data]);

  const submit = async () => {
    if (!rating) return setError("Pick a star rating first.");
    setBusy(true);
    setError("");
    try {
      const review = await api.putReview(listing.id, {
        rating,
        comment: comment || null,
      });
      state.setData((s) => (s ? { ...s, existing: review } : s));
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.details?.comment
          ? e.details.comment
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const e: ReviewEligibility | null = state.data;
  if (!e) return null;

  return (
    <section className="mk-pane mk-stack" aria-labelledby="mk-review">
      <div className="mk-section-head">
        <h2 className="mk-lead" id="mk-review">
          {e.existing
            ? "Your review of this seller"
            : `Rate ${listing.seller.displayName}`}
        </h2>
        {e.existing && <Stars value={e.existing.rating} />}
      </div>
      {e.reason === "no-enquiry" ? (
        <p className="mk-muted">
          Reviews are for people who actually got in touch. Once you have shown
          the seller's contact details, you can rate how the sale went.
        </p>
      ) : e.reason === "profile-required" ? (
        <p className="mk-muted">
          <Link to={paths.me("profile")} className="mk-link">
            Set up your profile
          </Link>{" "}
          first, so the seller knows who is reviewing them.
        </p>
      ) : (
        <form
          className="mk-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            void submit();
          }}
        >
          <Field label="Rating">
            <RatingPicker value={rating} onChange={setRating} />
          </Field>
          <Field
            label="What was it like?"
            hint="optional"
            htmlFor="mk-review-comment"
          >
            <TextArea
              id="mk-review-comment"
              value={comment}
              onChange={(ev) => setComment(ev.target.value)}
              maxLength={600}
              placeholder="Was the gear as described? Were they easy to deal with?"
            />
          </Field>
          {error && <Notice kind="warn">{error}</Notice>}
          {done && (
            <Notice>
              Thanks, your review is live on {listing.seller.displayName}'s
              profile.
            </Notice>
          )}
          <div className="mk-form__actions">
            <button
              type="submit"
              className="f5-button f5-button--pill"
              disabled={busy}
            >
              <Star size={15} aria-hidden="true" />
              {busy ? "Saving…" : e.existing ? "Update review" : "Post review"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
