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
import { Button } from "../../../ui";
import { buttonStyles } from "../../../ui/Button";
import { linkStyles } from "../../../ui/Link";
import { segmentedStyles } from "../../../ui/Segmented";
import { RING, tv } from "../../../ui/tv";
import { useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  ConfirmDialog,
  Empty,
  ListingGrid,
  LoadError,
  Notice,
  PageSkeleton,
  Stars,
  errorMessage,
  pane,
  sharedStyles,
  useAsync,
  usePageTitle,
} from "../components";
import ProfileForm from "./ProfileForm";
import { Link, paths } from "../router";
import type { Listing, MePayload } from "../../shared/types";
import { formatPrice, relativeAge } from "../../shared/validate";

const TABS = [
  { id: "listings", label: "My listings" },
  { id: "saved", label: "Saved" },
  { id: "reviews", label: "Reviews" },
  { id: "profile", label: "Profile" },
];

export const meStyles = tv({
  slots: {
    /** A heading with one thing to do beside it, on one line while it fits. */
    sectionHead: "flex flex-wrap items-center justify-between gap-x-5 gap-y-2",
    title: "m-0 text-title text-balance text-ink",
    lead: "m-0 text-lead text-ink",
    meta: "text-body text-ink-muted",
    quiet: "m-0 text-ink-muted",
    /*
     * The four sections of the account, drawn as the kit's Segmented but worn
     * by links: each one is a URL, so it stays an <a> the router takes over
     * rather than becoming a button (market/web/router.tsx has no `routed()`).
     * The track scrolls sideways where four words do not fit.
     */
    tabs: "max-w-full gap-0 self-start overflow-x-auto scrollbar-none",
    /*
     * A row of words rather than a row of controls, as the browse rail's chips
     * are: the body step, and the taller track market.css drew for them.
     */
    tab: "h-8.5 px-3 text-body leading-tight font-semibold no-underline",
    /**
     * How many are saved, in the tab that holds them: the caption step at the
     * tab's own leading and weight, in the muted ink. Not the kit's Count,
     * which is a filled badge for what has not been read yet.
     */
    count: "text-caption leading-tight text-ink-muted",

    // ---- my listings --------------------------------------------------------

    stack: "flex min-w-0 flex-col gap-5",
    list: "m-0 flex list-none flex-col gap-3 p-0",
    /*
     * A listing and what can be done to it, side by side until they cannot.
     * A pane with a control's inset rather than a page's, and a phone takes
     * the roomier right-hand side back off again.
     */
    item: "flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-3 p-3 pr-5 shadow-control max-wide:p-3",
    /** The whole of the listing is the link to it. */
    itemMain: [
      "flex min-w-0 shrink grow basis-70 items-center gap-3",
      "rounded-control text-ink no-underline",
      RING,
    ],
    thumb:
      "grid aspect-4/3 w-22 shrink-0 place-items-center overflow-hidden rounded-control bg-sunken text-line-strong max-wide:w-18",
    thumbImage: "block size-full object-cover",
    itemText: "flex min-w-0 flex-col gap-1",
    itemTitle: "truncate font-semibold",
    itemPrice: "text-ink-muted",

    // ---- reviews given ------------------------------------------------------

    /** One after another down the pane, hairlines between and none at the ends. */
    review:
      "flex flex-col gap-2 border-t border-line py-5 first:border-0 first:pt-0 last:pb-0",
    reviewHead: "flex flex-wrap items-center justify-between gap-2",
    comment: "m-0 max-w-measure whitespace-pre-wrap wrap-anywhere",
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

  if (!auth.loaded || (me.loading && !me.data)) return <PageSkeleton />;
  if (!auth.signedIn) {
    return (
      <Empty
        title="Sign in to see your account"
        icon={<UserRound size={24} aria-hidden="true" />}
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
      <div className={styles.sectionHead()}>
        <h1 className={styles.title()}>{data.profile.displayName}</h1>
        <Link
          to={paths.seller(data.profile.id)}
          className={buttonStyles({ variant: "link" })}
        >
          View your public seller page
        </Link>
      </div>
      <div
        className={segmentedStyles().base({ className: styles.tabs() })}
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
            className={segmentedStyles().item({ className: styles.tab() })}
          >
            {t.label}
            {t.id === "saved" && data.saved.length > 0 && (
              <small className={styles.count()}>{data.saved.length}</small>
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
            icon={<Heart size={24} aria-hidden="true" />}
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
        icon={<Tag size={24} aria-hidden="true" />}
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
      <li className={pane(styles.item())}>
        <Link to={paths.listing(listing.id)} className={styles.itemMain()}>
          <span className={styles.thumb()}>
            {listing.photos[0] ? (
              <img
                className={styles.thumbImage()}
                src={listing.photos[0].url}
                alt=""
                loading="lazy"
              />
            ) : (
              <ImageIcon size={20} aria-hidden="true" />
            )}
          </span>
          <span className={styles.itemText()}>
            <span className={styles.itemTitle()}>{listing.title}</span>
            <span className={styles.meta()}>
              <strong className={styles.itemPrice()}>
                {formatPrice(listing.priceCents, listing.currency)}
              </strong>{" "}
              · Listed {relativeAge(listing.createdAt)}
              {listing.status === "sold" && listing.soldAt
                ? ` · Sold ${relativeAge(listing.soldAt)}`
                : ""}
            </span>
            <span className={styles.meta()}>
              {enquiries} enquir{enquiries === 1 ? "y" : "ies"}
            </span>
          </span>
        </Link>
        <span className={shared.formActions()}>
          <Link
            to={paths.edit(listing.id)}
            className={buttonStyles({ variant: "pill", size: "sm" })}
          >
            <Pencil size={14} aria-hidden="true" /> Edit
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
      <div className={styles.sectionHead()}>
        <h2 className={styles.lead()}>Live ({active.length})</h2>
        <Link
          to={paths.sell()}
          className={buttonStyles({ variant: "pill", size: "sm" })}
        >
          <PlusCircle size={14} aria-hidden="true" /> New listing
        </Link>
      </div>
      {active.length ? (
        <ul className={styles.list()}>
          {active.map((l) => (
            <Row key={l.id} listing={l} />
          ))}
        </ul>
      ) : (
        <p className={styles.quiet()}>Nothing live right now.</p>
      )}
      {sold.length > 0 && (
        <>
          <h2 className={styles.lead()}>Sold ({sold.length})</h2>
          <ul className={styles.list()}>
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
  const styles = meStyles();
  const shared = sharedStyles();
  if (!data.reviewsGiven.length) {
    return (
      <Empty
        title="You have not reviewed anyone yet"
        icon={<Star size={24} aria-hidden="true" />}
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
    <section className={pane(shared.pane())}>
      {data.reviewsGiven.map((r) => (
        <div key={r.id} className={styles.review()}>
          <div className={styles.reviewHead()}>
            <Stars value={r.rating} />
            <span className={styles.meta()}>{relativeAge(r.createdAt)}</span>
          </div>
          <p className={styles.meta()}>
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
