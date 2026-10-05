import {
  Heart,
  Image as ImageIcon,
  Pencil,
  PlusCircle,
  Star,
  Tag,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { Button, Kicker, SectionHeading } from "../../../ui";
import { buttonStyles } from "../../../ui/Button";
import { linkStyles } from "../../../ui/Link";
import { RING, tv } from "../../../ui/tv";
import { useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Age,
  ConfirmDialog,
  Empty,
  ListingGrid,
  LoadError,
  Notice,
  PageSkeleton,
  Price,
  Stars,
  errorMessage,
  pane,
  sharedStyles,
  tabStyles,
  useAsync,
  usePageTitle,
} from "../components";
import ProfileForm from "./ProfileForm";
import { Link, paths } from "../router";
import type { Listing, MePayload } from "../../shared/types";

const TABS = [
  { id: "listings", label: "My listings" },
  { id: "saved", label: "Saved" },
  { id: "reviews", label: "Reviews" },
  { id: "profile", label: "Profile" },
];

export const meStyles = tv({
  slots: {
    /** A heading with one thing to do beside it, on one line while it fits. */
    sectionHead: "flex flex-wrap items-end justify-between gap-x-5 gap-y-2",
    title: "m-0 font-display text-title text-balance text-ink",

    // ---- my listings --------------------------------------------------------

    stack: "flex min-w-0 flex-col gap-4",
    group: "flex min-w-0 flex-col gap-1",
    /** One listing to a row, a hairline under each, as a ledger sets them. */
    list: "m-0 flex list-none flex-col p-0",
    /*
     * A listing and what can be done to it, side by side until they cannot.
     */
    item: "flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-3 border-0 border-b border-line py-3",
    /** The whole of the listing is the link to it. */
    itemMain: [
      "group flex min-w-0 shrink grow basis-70 items-center gap-3",
      "rounded-control text-ink no-underline",
      RING,
    ],
    // The photograph on paper, in its hairline frame; a sold one goes grey.
    thumb:
      "grid aspect-4/3 w-22 shrink-0 place-items-center overflow-hidden border border-line bg-sunken text-ink-muted max-wide:w-18",
    thumbImage: "block size-full object-cover group-data-sold:grayscale",
    itemText: "flex min-w-0 flex-col gap-1",
    itemTitle:
      "truncate font-display text-prose font-semibold decoration-1 underline-offset-3 group-hover:underline",
    itemFigures: "flex flex-wrap items-baseline gap-x-3 gap-y-1",
    actions: "flex flex-wrap items-center gap-2",

    // ---- reviews given ------------------------------------------------------

    /** One after another, hairlines between. */
    review:
      "flex flex-col gap-2 border-0 border-b border-line py-4 first:pt-1",
    reviewHead: "flex flex-wrap items-center justify-between gap-2",
    about: "m-0 text-body text-ink-muted",
    comment: "m-0 max-w-measure text-prose whitespace-pre-wrap wrap-anywhere",
  },
});

export default function MePage({ tab }: { tab: string }) {
  usePageTitle("My account");
  const api = useApi();
  const auth = useMarketAuth();
  const me = useAsync(
    () => (auth.signedIn ? api.me() : Promise.resolve(null)),
    [api, auth.signedIn],
  );
  const current = TABS.some((t) => t.id === tab) ? tab : "listings";

  const styles = meStyles();
  const shared = sharedStyles();
  const tabs = tabStyles();

  if (!auth.loaded || (me.loading && !me.data)) return <PageSkeleton />;
  if (!auth.signedIn) {
    return (
      <Empty
        title="Sign in to see your account"
        icon={<UserRound size={24} strokeWidth={1.5} aria-hidden="true" />}
        className={shared.emptyPane()}
      >
        <p>Your listings, saved gear and reviews all live here.</p>
        {auth.provider !== "none" && (
          <div className={shared.emptyActions()}>
            <Button variant="primary" size="lg" onClick={auth.signIn}>
              Sign in
            </Button>
          </div>
        )}
      </Empty>
    );
  }
  if (me.error || !me.data)
    return (
      <LoadError
        title="Your account could not be loaded"
        message={me.error ?? "Try again in a moment."}
        onRetry={me.reload}
      />
    );
  const data = me.data;

  return (
    <>
      <div className={shared.head()}>
        <div className={shared.dateline()}>
          <Kicker as="span" tone="ink">
            Your account
          </Kicker>
          <Link
            to={paths.seller(data.profile.id)}
            className={buttonStyles({ variant: "link", size: "sm" })}
          >
            Your public page <span aria-hidden="true">→</span>
          </Link>
        </div>
        <h1 className={styles.title()}>{data.profile.displayName}</h1>
      </div>
      <div className={tabs.list()} role="tablist" aria-label="Account sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={paths.me(t.id)}
            role="tab"
            aria-selected={current === t.id}
            className={tabs.tab()}
          >
            {t.label}
            {t.id === "saved" && data.saved.length > 0 && (
              <small className={tabs.count()}>{data.saved.length}</small>
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
          <Empty
            title="Nothing saved yet"
            icon={<Heart size={24} strokeWidth={1.5} aria-hidden="true" />}
            className={shared.emptyPane()}
          >
            <p>Tap Save on a listing to keep an eye on it here.</p>
            <div className={shared.emptyActions()}>
              <Link
                to={paths.browse()}
                className={buttonStyles({ variant: "pill" })}
              >
                Browse gear
              </Link>
            </div>
          </Empty>
        ))}
      {current === "reviews" && <ReviewsGiven data={data} />}
      {current === "profile" && (
        <section className={pane(shared.pane())}>
          <ProfileForm
            profile={data.profile}
            requireContact={data.listings.some((l) => l.status === "active")}
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

  const [removing, setRemoving] = useState<Listing | null>(null);
  const styles = meStyles();
  const shared = sharedStyles();

  const setStatus = async (listing: Listing, status: Listing["status"]) => {
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
      setRemoving(null);
    }
  };

  if (!data.listings.length) {
    return (
      <Empty
        title="You have nothing listed"
        icon={<Tag size={24} strokeWidth={1.5} aria-hidden="true" />}
        className={shared.emptyPane()}
      >
        <p>Gear you no longer ride is gear someone else is looking for.</p>
        <div className={shared.emptyActions()}>
          <Link
            to={paths.sell()}
            className={buttonStyles({ variant: "primary" })}
          >
            <PlusCircle size={16} aria-hidden="true" /> List something
          </Link>
        </div>
      </Empty>
    );
  }

  const active = data.listings.filter((l) => l.status === "active");
  const sold = data.listings.filter((l) => l.status === "sold");

  const Row = ({ listing }: { listing: Listing }) => {
    const enquiries = data.enquiries[listing.id] ?? 0;
    return (
      <li className={styles.item()}>
        <Link
          to={paths.listing(listing.id)}
          className={styles.itemMain()}
          data-sold={listing.status === "sold" ? "" : undefined}
        >
          <span className={styles.thumb()}>
            {listing.photos[0] ? (
              <img
                className={styles.thumbImage()}
                src={listing.photos[0].url}
                alt=""
                loading="lazy"
              />
            ) : (
              <ImageIcon size={20} strokeWidth={1.5} aria-hidden="true" />
            )}
          </span>
          <span className={styles.itemText()}>
            <span className={styles.itemTitle()}>{listing.title}</span>
            <span className={styles.itemFigures()}>
              <Price listing={listing} size="sm" />
              <Kicker as="span">
                {listing.status === "sold" && listing.soldAt ? (
                  <Age iso={listing.soldAt} prefix="Sold" />
                ) : (
                  <Age iso={listing.createdAt} />
                )}
                {" · "}
                {enquiries} enquir{enquiries === 1 ? "y" : "ies"}
              </Kicker>
            </span>
          </span>
        </Link>
        <span className={styles.actions()}>
          <Link
            to={paths.edit(listing.id)}
            className={buttonStyles({ variant: "pill", size: "sm" })}
          >
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
          </Link>
          {listing.status === "active" ? (
            <Button
              variant="pill"
              size="sm"
              disabled={busy === listing.id}
              onClick={() => setStatus(listing, "sold")}
            >
              Mark as sold
            </Button>
          ) : (
            <Button
              variant="pill"
              size="sm"
              disabled={busy === listing.id}
              onClick={() => setStatus(listing, "active")}
            >
              Relist
            </Button>
          )}
          <Button
            variant="link"
            disabled={busy === listing.id}
            onClick={() => setRemoving(listing)}
          >
            Remove
          </Button>
        </span>
      </li>
    );
  };

  return (
    <div className={styles.stack()}>
      <ConfirmDialog
        open={removing != null}
        title="Remove this listing?"
        confirmLabel="Remove listing"
        busy={busy != null}
        onConfirm={() => removing && setStatus(removing, "removed")}
        onCancel={() => setRemoving(null)}
      >
        “{removing?.title}” will disappear from the marketplace and its photos
        will be deleted. This cannot be undone.
      </ConfirmDialog>
      {error && <Notice kind="warn">{error}</Notice>}
      <section className={styles.group()} aria-labelledby="me-live">
        <SectionHeading
          id="me-live"
          aside={
            <Link
              to={paths.sell()}
              className={buttonStyles({ variant: "pill", size: "sm" })}
            >
              <PlusCircle size={14} strokeWidth={1.5} aria-hidden="true" /> New
              listing
            </Link>
          }
        >
          Live ({active.length})
        </SectionHeading>
        {active.length ? (
          <ul className={styles.list()}>
            {active.map((l) => (
              <Row key={l.id} listing={l} />
            ))}
          </ul>
        ) : (
          <p className={styles.about()}>Nothing live right now.</p>
        )}
      </section>
      {sold.length > 0 && (
        <section className={styles.group()} aria-labelledby="me-sold">
          <SectionHeading id="me-sold">Sold ({sold.length})</SectionHeading>
          <ul className={styles.list()}>
            {sold.map((l) => (
              <Row key={l.id} listing={l} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReviewsGiven({ data }: { data: MePayload }) {
  const styles = meStyles();
  const shared = sharedStyles();
  if (!data.reviewsGiven.length) {
    return (
      <Empty
        title="You have not reviewed anyone yet"
        icon={<Star size={24} strokeWidth={1.5} aria-hidden="true" />}
        className={shared.emptyPane()}
      >
        <p>
          After you contact a seller you can rate how the sale went, from their
          listing page.
        </p>
      </Empty>
    );
  }
  return (
    <section aria-label="Reviews you have given">
      {data.reviewsGiven.map((r) => (
        <div key={r.id} className={styles.review()}>
          <div className={styles.reviewHead()}>
            <Stars value={r.rating} size={12} />
            <Kicker as="span">
              <Age iso={r.createdAt} prefix="Reviewed" />
            </Kicker>
          </div>
          <p className={styles.about()}>
            On{" "}
            <Link to={paths.listing(r.listingId)} className={linkStyles()}>
              {r.listingTitle}
            </Link>
          </p>
          {r.comment && <p className={styles.comment()}>{r.comment}</p>}
        </div>
      ))}
    </section>
  );
}
