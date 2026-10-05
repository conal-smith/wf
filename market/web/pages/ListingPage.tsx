import {
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Share2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Chip,
  Kicker,
  Pane,
  Puffin,
  SectionHeading,
} from "../../../ui";
import { paneStyles } from "../../../ui/Pane";
import { buttonStyles } from "../../../ui/Button";
import { linkStyles } from "../../../ui/Link";
import { RING, tv } from "../../../ui/tv";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Avatar,
  BackLink,
  ConfirmDialog,
  Field,
  LoadError,
  Notice,
  PageSkeleton,
  Price,
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
import { relativeAge } from "../../shared/validate";

export const listingStyles = tv({
  slots: {
    // Two columns where there is room for them: what is being read, and the
    // ad that stands beside it. Under the rail's breakpoint the placement
    // falls away and the three children stack in the order they are written,
    // which puts the ad between the photographs and the particulars.
    detail: "grid items-start gap-x-8 gap-y-8 rail:grid-cols-detail max-wide:gap-y-6",
    gallery: "min-w-0 rail:col-start-1 rail:row-start-1",
    body: "flex min-w-0 flex-col gap-8 rail:col-start-1 rail:row-start-2",
    // The ad spans both rows and stays in view while the body scrolls under
    // it, clear of the sticky masthead: its bar, its inset and the gap.
    aside: [
      "flex min-w-0 flex-col gap-6",
      "rail:col-start-2 rail:row-start-1 rail:row-span-2 rail:sticky rail:top-22.5",
    ],

    // ---- the photographs
    // On paper, in a hairline frame, and never cropped.
    frame: [
      "relative grid aspect-4/3 place-items-center overflow-hidden",
      "border border-line bg-sunken text-ink-muted",
    ],
    // Contained, not cropped: a board photographed end-on is the whole point.
    photo: "block size-full object-contain",
    noPhoto: "flex min-w-0 flex-col items-center gap-2",
    // Over the photograph, so it carries the deeper shadow a marker has.
    nav: "absolute top-1/2 -translate-y-1/2 shadow-marker",
    count: "absolute right-3 bottom-3",
    thumbs: "-mx-1 mt-2 flex gap-2 overflow-x-auto scrollbar-none p-1",
    /*
     * A thumbnail is the one control on this page ui/ has no part for, so it
     * carries the kit's ring by hand. It is 76 by 57, four to three like the
     * picture it stands for, which is well past the coarse-pointer minimum,
     * so it asks for none. The chosen one is outlined in ink as well as
     * brought forward: an opacity on its own is not a state a reader can name.
     * The fill is named again under the pointer so that the site reset's
     * `button:enabled:hover` does not lay its wash over it.
     */
    thumb: [
      "w-19 shrink-0 cursor-pointer overflow-hidden rounded-none border border-line bg-sunken p-0",
      "aspect-4/3 opacity-65 transition-opacity duration-fast",
      "not-disabled:hover:bg-sunken not-disabled:hover:opacity-100",
      "focus-visible:opacity-100",
      // The focus ring takes the chosen one's place while it is there.
      "aria-pressed:opacity-100 aria-pressed:not-focus-visible:outline-2",
      "aria-pressed:not-focus-visible:outline-offset-1 aria-pressed:not-focus-visible:outline-ink",
      RING,
    ],
    thumbImage: "block size-full object-cover",

    // ---- the ad
    // The one box on the page: the chart's, ruled twice, for what matters.
    ad: "flex min-w-0 flex-col gap-5",
    stack: "flex min-w-0 flex-col gap-4",
    tight: "flex min-w-0 flex-col gap-1",
    kickerRow: "flex flex-wrap items-center gap-x-3 gap-y-1",
    actions: "flex items-center gap-2",
    /*
     * The action takes whatever the row has left after the controls beside it,
     * and on a phone that is less than its words: they wrap onto a second line
     * inside the same height, at the tighter leading that lets two fit, rather
     * than pushing the share button out past the edge of the panel.
     */
    fill: "min-w-0 grow shrink text-center leading-tight whitespace-normal",
    formActions: "flex flex-wrap items-center gap-x-3 gap-y-2",
    // The ways to reach the seller, once asked for: a well on the second sheet.
    contact: "grid gap-3 p-4",
    contactRow: "inline-flex items-center gap-2 font-mono text-body wrap-anywhere",

    // ---- the seller, under a rule in the same column
    seller: [
      "group flex min-w-0 items-center gap-3 rounded-control py-1 text-ink no-underline",
      RING,
    ],
    sellerName:
      "font-display text-lead italic decoration-1 underline-offset-3 group-hover:underline",
    // It leans towards the page it opens, unless movement has been declined.
    chevron: [
      "ml-auto shrink-0 text-ink-muted transition-transform duration-fast",
      "group-hover:translate-x-1 motion-reduce:transition-none",
    ],

    // ---- the Almanac's word, signed by the puffin
    almanac: "flex items-end gap-3",
    almanacText: "m-0 flex min-w-0 flex-col gap-1",
    saying: "font-body text-body text-ink-2 italic",

    // ---- the body, and the review form under it
    section: "flex min-w-0 flex-col gap-4",
    // The particulars, as the chart sets a table: the name in the body face,
    // the figure set right in the mono, a hairline between rows.
    specs: "m-0 grid gap-x-8 wide:grid-cols-2",
    spec: "flex min-w-0 items-baseline justify-between gap-4 border-0 border-b border-line py-2",
    term: "font-body text-prose text-ink-2",
    value: "m-0 text-right font-mono text-body font-medium wrap-anywhere",
    form: "grid gap-5",

    // ---- the words
    title: "m-0 font-display text-title text-balance text-ink",
    quiet: "m-0 text-body text-ink-muted",
    muted: "m-0 text-ink-muted",
    // A line of paragraph that carries nothing but a mark of its own.
    bare: "m-0",
    prose: "m-0 max-w-measure text-prose whitespace-pre-wrap wrap-anywhere",
  },
  variants: {
    /** Which edge of the photograph a step through it sits on. */
    side: {
      prev: { nav: "left-3" },
      next: { nav: "right-3" },
    },
  },
});

export default function ListingPage({ id }: { id: string }) {
  const api = useApi();
  const auth = useMarketAuth();
  const result = useAsync(() => api.getListing(id), [api, id, auth.userId]);
  const listing = result.data;
  usePageTitle(listing ? listing.title : "Listing");
  const styles = listingStyles();

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
        <PageSkeleton />
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
      <article className={styles.detail()}>
        <div className={styles.gallery()}>
          <Gallery listing={listing} />
        </div>
        <Aside listing={listing} onChange={(l) => result.setData(l)} />
        <div className={styles.body()}>
          <section
            className={styles.section()}
            aria-labelledby="listing-details"
          >
            <SectionHeading id="listing-details">Particulars</SectionHeading>
            <dl className={styles.specs()}>
              {specs.map(
                ([label, value]) =>
                  value != null &&
                  value !== "" && (
                    <div className={styles.spec()} key={label}>
                      <dt className={styles.term()}>{label}</dt>
                      <dd className={styles.value()}>{value}</dd>
                    </div>
                  ),
              )}
            </dl>
          </section>
          <section
            className={styles.section()}
            aria-labelledby="listing-description"
          >
            <SectionHeading id="listing-description">
              Description
            </SectionHeading>
            <p className={styles.prose()}>{listing.description}</p>
          </section>
          {auth.signedIn && !listing.isOwner && (
            <ReviewSection listing={listing} />
          )}
        </div>
      </article>
    </>
  );
}

function Gallery({ listing }: { listing: Listing }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [listing.id]);
  const count = listing.photos.length;
  const photo = listing.photos[index];
  const step = (delta: number) => setIndex((i) => (i + delta + count) % count);
  const styles = listingStyles();
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
      <div className={styles.frame()}>
        {photo ? (
          <img
            className={styles.photo()}
            src={photo.url}
            alt={`${listing.title}, photo ${index + 1} of ${count}`}
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
          />
        ) : (
          <div className={styles.noPhoto()}>
            <ImageIcon size={32} strokeWidth={1.25} aria-hidden="true" />
            <Kicker>The seller has not added photos</Kicker>
          </div>
        )}
        {count > 1 && (
          <>
            <Button
              variant="pill"
              icon
              className={listingStyles({ side: "prev" }).nav()}
              aria-label="Previous photo"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
            </Button>
            <Button
              variant="pill"
              icon
              className={listingStyles({ side: "next" }).nav()}
              aria-label="Next photo"
              onClick={() => step(1)}
            >
              <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
            </Button>
            <Chip tone="glass" className={styles.count()} aria-hidden="true">
              {index + 1} / {count}
            </Chip>
          </>
        )}
      </div>
      {count > 1 && (
        <div className={styles.thumbs()}>
          {listing.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={styles.thumb()}
              aria-pressed={i === index}
              aria-label={`Photo ${i + 1} of ${count}`}
              onClick={() => setIndex(i)}
            >
              <img
                className={styles.thumbImage()}
                src={p.url}
                alt=""
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * S4, the sign-in gate. The action is offered to everybody and says what it
 * does; pressing it while signed out opens sign-in and does nothing else, so
 * nobody is asked to sign in before they are told what for. Exported because
 * there is no DOM under the unit tests: this is what a press comes to.
 */
export function gated(
  auth: { signedIn: boolean; signIn: () => void },
  act: () => Promise<void>,
): Promise<void> {
  if (!auth.signedIn) {
    auth.signIn();
    return Promise.resolve();
  }
  return act();
}

export function Aside({
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
  const styles = listingStyles();

  useEffect(() => setContact(null), [listing.id]);

  const reveal = () =>
    gated(auth, async () => {
      setContactBusy(true);
      setError("");
      try {
        setContact(await api.getContact(listing.id));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setContactBusy(false);
      }
    });

  const toggleSave = () =>
    gated(auth, async () => {
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
    });

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
    <Button
      variant="pill"
      icon
      size="lg"
      aria-label={shared ? "Link copied" : "Share this listing"}
      title={shared ? "Link copied" : "Share"}
      onClick={share}
    >
      {shared ? (
        <Check size={18} aria-hidden="true" />
      ) : (
        <Share2 size={18} aria-hidden="true" />
      )}
    </Button>
  );

  return (
    <aside className={styles.aside()}>
      <section
        className={paneStyles({ double: true, className: styles.ad() })}
        aria-labelledby="listing-title"
      >
        <div className={styles.stack()}>
          <div className={styles.kickerRow()}>
            {listing.status !== "active" && (
              <Chip tone="warn" eyebrow>
                {listing.status === "sold" ? "Sold" : "Removed"}
              </Chip>
            )}
            <Kicker as="span">
              {categoryLabel(listing.category)} ·{" "}
              {conditionLabel(listing.condition)}
            </Kicker>
          </div>
          <h1 className={styles.title()} id="listing-title">
            {listing.title}
          </h1>
          <div className={styles.tight()}>
            <p className={styles.bare()}>
              <Price
                listing={listing}
                size="lg"
                strike={listing.status === "sold"}
              />
            </p>
            <Kicker>
              {where} · Listed {relativeAge(listing.createdAt)}
            </Kicker>
          </div>
        </div>

        {listing.isOwner ? (
          <div className={styles.stack()}>
            <div className={styles.actions()}>
              <Link
                to={paths.edit(listing.id)}
                className={buttonStyles({
                  variant: "primary",
                  size: "lg",
                  className: styles.fill(),
                })}
              >
                <Pencil size={16} strokeWidth={1.5} aria-hidden="true" /> Edit
                listing
              </Link>
              {shareButton}
            </div>
            <div className={styles.formActions()}>
              {listing.status === "active" ? (
                <Button
                  variant="pill"
                  disabled={statusBusy}
                  onClick={() => setStatus("sold")}
                >
                  Mark as sold
                </Button>
              ) : (
                <Button
                  variant="pill"
                  disabled={statusBusy}
                  onClick={() => setStatus("active")}
                >
                  Relist
                </Button>
              )}
              <Button
                variant="link"
                disabled={statusBusy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove listing
              </Button>
            </div>
          </div>
        ) : listing.status !== "active" ? (
          <Notice>
            This item has been {listing.status}. The seller may have other gear
            listed.
          </Notice>
        ) : contact ? (
          <Pane kind="sunken" className={styles.contact()} aria-live="polite">
            <Kicker tone="ink">Contact {contact.displayName}</Kicker>
            {contact.phone && (
              <a
                className={linkStyles({ className: styles.contactRow() })}
                href={`tel:${contact.phone}`}
              >
                <Phone size={16} strokeWidth={1.5} aria-hidden="true" />{" "}
                {contact.phone}
              </a>
            )}
            {contact.whatsapp && whatsappNumber && (
              <a
                className={linkStyles({ className: styles.contactRow() })}
                href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I'm interested in your wingfoil.ie listing: ${listing.title}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" />{" "}
                WhatsApp
              </a>
            )}
            {contact.email && (
              <a
                className={linkStyles({ className: styles.contactRow() })}
                href={`mailto:${contact.email}?subject=${encodeURIComponent(`wingfoil.ie: ${listing.title}`)}`}
              >
                <Mail size={16} strokeWidth={1.5} aria-hidden="true" />{" "}
                {contact.email}
              </a>
            )}
          </Pane>
        ) : (
          <div className={styles.actions()}>
            <Button
              variant="primary"
              size="lg"
              className={styles.fill()}
              disabled={contactBusy || auth.provider === "none"}
              onClick={reveal}
            >
              {contactBusy
                ? "Fetching details…"
                : auth.signedIn
                  ? "Show contact details"
                  : "Sign in to contact seller"}
            </Button>
            <SaveButton
              saved={Boolean(listing.saved)}
              busy={saveBusy}
              onToggle={toggleSave}
            />
            {shareButton}
          </div>
        )}
        {contact && !listing.isOwner && (
          <div className={styles.actions()}>
            <SaveButton
              saved={Boolean(listing.saved)}
              busy={saveBusy}
              onToggle={toggleSave}
            />
            {shareButton}
          </div>
        )}
        {auth.provider === "none" && !listing.isOwner && (
          <p className={styles.quiet()}>
            Sign-in is not configured on this build, so contact details are
            hidden.
          </p>
        )}
        {error && <Notice kind="warn">{error}</Notice>}
      </section>

      <section className={styles.section()} aria-label="Seller">
        <SectionHeading size="kicker" rule="thin" as="h2">
          Seller
        </SectionHeading>
        <Link to={paths.seller(listing.seller.id)} className={styles.seller()}>
          <Avatar name={listing.seller.displayName} />
          <span className={styles.tight()}>
            <span className={styles.sellerName()}>
              {listing.seller.displayName}
            </span>
            <SellerRating seller={listing.seller} />
          </span>
          <ChevronRight
            size={18}
            strokeWidth={1.5}
            className={styles.chevron()}
            aria-hidden="true"
          />
        </Link>
        <Kicker>
          {listing.seller.soldCount} sold · Since{" "}
          {new Date(listing.seller.memberSince).getFullYear()}
          {listing.seller.county ? ` · Co. ${listing.seller.county}` : ""}
        </Kicker>
      </section>

      {!listing.isOwner && listing.status === "active" && (
        <aside className={styles.almanac()} aria-label="The Almanac's advice">
          <Puffin size={44} />
          <p className={styles.almanacText()}>
            <span className={styles.saying()}>
              Meet somewhere public, see the gear before you pay, and never
              send a deposit to hold it.
            </span>
            <Kicker as="span">The Almanac</Kicker>
          </p>
        </aside>
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
  const styles = listingStyles();

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
    <section
      className={styles.section()}
      aria-labelledby="listing-review-title"
    >
      <SectionHeading
        id="listing-review-title"
        aside={e.existing && <Stars value={e.existing.rating} size={14} />}
      >
        {e.existing
          ? "Your review of this seller"
          : `Rate ${listing.seller.displayName}`}
      </SectionHeading>
      {e.reason === "no-enquiry" ? (
        <p className={styles.muted()}>
          Show the seller's contact details first; then you can rate how the
          sale went.
        </p>
      ) : e.reason === "profile-required" ? (
        <p className={styles.muted()}>
          <Link to={paths.me("profile")} className={linkStyles()}>
            Set up your profile
          </Link>{" "}
          first, so the seller knows who is reviewing them.
        </p>
      ) : (
        <form
          className={styles.form()}
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
            htmlFor="listing-review-comment"
          >
            <TextArea
              id="listing-review-comment"
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
          <div className={styles.formActions()}>
            <Button type="submit" variant="pill" disabled={busy}>
              {busy ? "Saving…" : e.existing ? "Update review" : "Post review"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
