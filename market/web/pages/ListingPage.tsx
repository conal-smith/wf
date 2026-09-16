import {
  ArrowLeft,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Avatar,
  Field,
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
        <Notice kind="warn">{result.error}</Notice>
      </>
    );
  }
  if (!listing)
    return (
      <div
        className="mk-skeleton"
        style={{ aspectRatio: "16 / 6" }}
        aria-busy="true"
      />
    );

  return (
    <>
      <BackLink />
      <article className="mk-detail">
        <Gallery listing={listing} />
        <Aside listing={listing} onChange={(l) => result.setData(l)} />
      </article>
      <section className="mk-pane mk-stack" aria-labelledby="mk-desc">
        <h2 className="mk-lead" id="mk-desc">
          Description
        </h2>
        <p className="mk-prose">{listing.description}</p>
      </section>
      {auth.signedIn && !listing.isOwner && <ReviewSection listing={listing} />}
    </>
  );
}

function BackLink() {
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

function Gallery({ listing }: { listing: Listing }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [listing.id]);
  const photo = listing.photos[index];
  return (
    <div>
      <div className="mk-gallery__main">
        {photo ? (
          <img
            src={photo.url}
            alt={`${listing.title}, photo ${index + 1} of ${listing.photos.length}`}
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
          />
        ) : (
          <div className="mk-empty">
            <ImageIcon size={32} aria-hidden="true" />
            <p className="mk-caption">No photos yet</p>
          </div>
        )}
      </div>
      {listing.photos.length > 1 && (
        <div className="mk-gallery__thumbs" role="group" aria-label="Photos">
          {listing.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="mk-thumb"
              aria-pressed={i === index}
              aria-label={`Photo ${i + 1}`}
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

  const setStatus = async (status: Listing["status"]) => {
    if (
      status === "removed" &&
      !window.confirm("Remove this listing? Its photos will be deleted.")
    )
      return;
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
    }
  };

  const where = listing.town
    ? `${listing.town}, Co. ${listing.county}`
    : `Co. ${listing.county}`;
  const whatsappNumber = contact?.phone
    ?.replace(/^0/, "353")
    .replace(/^\+/, "");

  return (
    <aside className="mk-pane mk-stack">
      <div className="mk-stack--tight">
        <p className="mk-price">
          {formatPrice(listing.priceCents, listing.currency)}
        </p>
        <h1 className="mk-lead">{listing.title}</h1>
        <p className="mk-caption">
          Listed {relativeAge(listing.createdAt)} · {where}
        </p>
      </div>

      <div className="mk-chips">
        {listing.status !== "active" && (
          <span className="f5-chip">
            {listing.status === "sold" ? "Sold" : "Removed"}
          </span>
        )}
        <span className="f5-chip">{categoryLabel(listing.category)}</span>
        <span className="f5-chip">{conditionLabel(listing.condition)}</span>
        {listing.brand && <span className="f5-chip">{listing.brand}</span>}
        {listing.sizeLabel && (
          <span className="f5-chip">{listing.sizeLabel}</span>
        )}
        {listing.year && <span className="f5-chip">{listing.year}</span>}
      </div>

      {listing.isOwner ? (
        <div className="mk-form__actions">
          <Link
            to={paths.edit(listing.id)}
            className="f5-button f5-button--pill"
          >
            <Pencil size={15} aria-hidden="true" /> Edit
          </Link>
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
            onClick={() => setStatus("removed")}
          >
            Remove listing
          </button>
        </div>
      ) : listing.status !== "active" ? (
        <Notice>
          This item has been {listing.status}. The seller may have other gear
          listed.
        </Notice>
      ) : contact ? (
        <div className="mk-pane--sunken mk-pane mk-contact" aria-live="polite">
          <p className="mk-eyebrow">Contact {contact.displayName}</p>
          {contact.phone && (
            <a className="mk-link" href={`tel:${contact.phone}`}>
              <Phone size={15} aria-hidden="true" /> {contact.phone}
            </a>
          )}
          {contact.whatsapp && whatsappNumber && (
            <a
              className="mk-link"
              href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I'm interested in your wingfoil.ie listing: ${listing.title}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={15} aria-hidden="true" /> WhatsApp
            </a>
          )}
          {contact.email && (
            <a
              className="mk-link"
              href={`mailto:${contact.email}?subject=${encodeURIComponent(`wingfoil.ie: ${listing.title}`)}`}
            >
              <Mail size={15} aria-hidden="true" /> {contact.email}
            </a>
          )}
          <p className="mk-caption">
            Meet somewhere public, check the gear before paying, and never pay a
            deposit to hold an item.
          </p>
        </div>
      ) : (
        <div className="mk-form__actions">
          <button
            type="button"
            className="f5-button f5-button--primary f5-button--lg"
            disabled={contactBusy || auth.provider === "none"}
            onClick={reveal}
          >
            {auth.signedIn
              ? "Show contact details"
              : "Sign in to contact seller"}
          </button>
          <SaveButton
            saved={Boolean(listing.saved)}
            busy={saveBusy}
            onToggle={toggleSave}
          />
        </div>
      )}
      {auth.provider === "none" && !listing.isOwner && (
        <p className="mk-caption">
          Sign-in is not configured on this build, so contact details are
          hidden.
        </p>
      )}
      {error && <Notice kind="warn">{error}</Notice>}

      <hr className="mk-divider" />

      <Link
        to={paths.seller(listing.seller.id)}
        className="mk-seller mk-link"
        style={{ textDecoration: "none" }}
      >
        <Avatar name={listing.seller.displayName} />
        <span className="mk-stack--tight" style={{ minWidth: 0 }}>
          <span className="mk-lead" style={{ display: "block" }}>
            {listing.seller.displayName}
          </span>
          <SellerRating seller={listing.seller} />
          <span className="mk-caption" style={{ display: "block" }}>
            {listing.seller.soldCount} sold · member since{" "}
            {new Date(listing.seller.memberSince).getFullYear()}
            {listing.seller.county ? ` · Co. ${listing.seller.county}` : ""}
          </span>
        </span>
      </Link>
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
              <Star size={15} aria-hidden="true" />{" "}
              {e.existing ? "Update review" : "Post review"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
