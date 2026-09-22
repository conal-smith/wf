/**
 * Small presentational pieces shared by the marketplace pages. Anything that
 * talks to the API lives in the pages; these only render.
 */
import { UserButton } from "@clerk/clerk-react";
import {
  AlertTriangle,
  Heart,
  Camera,
  Image as ImageIcon,
  LogIn,
  MapPin,
  PlusCircle,
  RotateCw,
  Star,
  StarHalf,
  UserRound,
  Wind,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { usePageTitle as useSitePageTitle } from "../../shared/web/usePageTitle";
import { Button, Chip, Empty, Skeleton } from "../../ui";
import { buttonStyles } from "../../ui/Button";
import { linkStyles } from "../../ui/Link";
import { paneStyles } from "../../ui/Pane";
import { skeletonStyles } from "../../ui/Skeleton";
import { RING, tv } from "../../ui/tv";
import { useMarketAuth } from "./auth";
import { Link, paths } from "./router";
import {
  CATEGORIES,
  CONDITIONS,
  type Listing,
  type SellerSummary,
} from "../shared/types";
import { formatPrice, relativeAge } from "../shared/validate";

// ---- data helper -----------------------------------------------------------

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((current: T | null) => T | null)) => void;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch(
        (e) =>
          alive &&
          setState({ data: null, error: errorMessage(e), loading: false }),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return {
    ...state,
    reload: () => setTick((t) => t + 1),
    setData: (update) =>
      setState((s) => ({
        ...s,
        data:
          typeof update === "function"
            ? (update as (c: T | null) => T | null)(s.data)
            : update,
      })),
  };
}

// ---- header ----------------------------------------------------------------

export const headerStyles = tv({
  slots: {
    // The bar sits clear of a notch: the top inset is the larger of the two.
    base: "sticky top-0 z-header pt-safe-3 pb-3",
    // A card, not glass: there is no map under it to show through, and white
    // reads as lifted where glass over the content ground reads as disabled.
    bar: [
      "flex min-h-control-lg items-center gap-2 rounded-pill border border-line bg-card py-1 pr-2 pl-3 shadow-marker",
      // The site menu now starts the bar. Below the label breakpoint the bar's
      // own insets pay for it rather than a label being squeezed onto two
      // lines: a round control needs less inset than a word does anyway.
      "max-wide:gap-1 max-wide:px-1",
    ],
    brand: [
      "inline-flex items-center gap-2 rounded-control font-sans text-lead whitespace-nowrap text-ink no-underline",
      RING,
    ],
    domain: "font-normal text-ink-muted",
    actions: "ml-auto flex items-center gap-1",
    // The word beside the icon, where the row is wide enough to hold it.
    label: "hidden wide:inline",
    user: "inline-flex items-center px-2",
    name: "hidden items-center px-2 text-body text-ink-muted wide:inline-flex",
    // Only where the bar has room: at 390px these eight pixels are the
    // difference between "Sign in" on one line and on two.
    sell: "wide:px-3",
  },
});

/**
 * `accentSell` fills the Sell button. A view gets one filled action, so the
 * shell passes it only on pages that have no primary of their own.
 */
export function MarketHeader({ accentSell = false }: { accentSell?: boolean }) {
  const auth = useMarketAuth();
  const styles = headerStyles();
  return (
    <header className={styles.base()}>
      <div className={styles.bar()}>
        <SiteMenu current="market" size="sm" />
        <Link
          to={paths.browse()}
          className={styles.brand()}
          aria-label="wingfoil.ie Market, home"
        >
          <Wind size={22} aria-hidden="true" />
          <span>
            wingfoil<span className={styles.domain()}>.ie</span>
          </span>
          <Chip eyebrow>Market</Chip>
        </Link>
        {/*
          The wind map is reached through the site menu at the start of the bar,
          not a button of its own here: one control per destination. The footer
          link stays — it is at the other end of the page, not beside it.
        */}
        <nav className={styles.actions()} aria-label="Marketplace">
          {/*
            The kit's Button is an anchor when it is given an href, but the
            marketplace's router takes a link over through its own <Link>. So a
            link that looks like a button wears the recipe's classes instead:
            one styling, either element.
          */}
          <Link
            className={buttonStyles({
              variant: accentSell ? "primary" : "pill",
              size: "sm",
              className: accentSell ? styles.sell() : undefined,
            })}
            to={paths.sell()}
          >
            <PlusCircle size={15} aria-hidden="true" />
            <span>Sell</span>
          </Link>
          {auth.signedIn ? (
            <>
              <Link
                className={buttonStyles({ variant: "pill", size: "sm" })}
                to={paths.me()}
              >
                <UserRound size={15} aria-hidden="true" />
                <span className={styles.label()}>My listings</span>
              </Link>
              {auth.provider === "clerk" ? (
                <span className={styles.user()}>
                  <UserButton />
                </span>
              ) : (
                <span className={styles.name()}>{auth.identity.name}</span>
              )}
            </>
          ) : (
            <Button
              variant="pill"
              size="sm"
              onClick={auth.signIn}
              disabled={auth.provider === "none" || !auth.loaded}
              title={
                auth.provider === "none"
                  ? "Sign-in is not configured on this build"
                  : undefined
              }
            >
              <LogIn size={15} aria-hidden="true" />
              <span>Sign in</span>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}

// ---- vocab lookups -----------------------------------------------------------

export const categoryLabel = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const conditionLabel = (id: string) =>
  CONDITIONS.find((c) => c.id === id)?.label ?? id;

// ---- stars -------------------------------------------------------------------

/**
 * The three ways a rating is drawn: read back as five marks, summarised beside
 * them, and picked. S3 gives all three the one pair of colours — the accent
 * for what has been earned, the strong line for what has not — and a star is
 * filled as well as recoloured, so none of them is said in colour alone.
 */
export const ratingStyles = tv({
  slots: {
    marks: "inline-flex items-center gap-0.5 text-accent",
    empty: "text-line-strong",
    summary: "flex flex-wrap items-center gap-1",
    quiet: "text-body text-ink-muted",
    picker: "inline-flex gap-1",
    // Under the pointer a star is lit, and a lit star draws no box: the run
    // of filled marks is what answers the hover, as it always did.
    star: "text-line-strong not-disabled:hover:bg-transparent",
  },
  variants: {
    /** Earned, or about to be: under the pointer the whole run lights up. */
    lit: { true: { star: "text-accent" } },
  },
});

export function Stars({
  value,
  size = 14,
}: {
  value: number | null;
  size?: number;
}) {
  const v = value ?? 0;
  const styles = ratingStyles();
  return (
    <span
      className={styles.marks()}
      role="img"
      aria-label={value == null ? "Not yet rated" : `${v} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) =>
        v >= n - 0.25 ? (
          <Star key={n} size={size} fill="currentColor" aria-hidden="true" />
        ) : v >= n - 0.75 ? (
          <StarHalf
            key={n}
            size={size}
            fill="currentColor"
            aria-hidden="true"
          />
        ) : (
          <Star
            key={n}
            className={styles.empty()}
            size={size}
            aria-hidden="true"
          />
        ),
      )}
    </span>
  );
}

export function RatingPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const labels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <div
      className={ratingStyles().picker()}
      role="radiogroup"
      aria-label="Rating"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = n <= (hover || value);
        return (
          <Button
            key={n}
            icon
            size="sm"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}: ${labels[n]}`}
            // The colour is the mark's, not the control's: a radio is not a
            // toggle, so the box stays quiet and the star says the rating.
            className={ratingStyles({ lit }).star()}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(n)}
          >
            <Star
              size={22}
              fill={lit ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </Button>
        );
      })}
    </div>
  );
}

export function SellerRating({
  seller,
  size = 12,
}: {
  seller: SellerSummary;
  size?: number;
}) {
  const styles = ratingStyles();
  if (!seller.ratingCount)
    return <span className={styles.quiet()}>No ratings yet</span>;
  return (
    <span className={styles.summary()}>
      <Stars value={seller.ratingAvg} size={size} />
      <span className={styles.quiet()}>
        {seller.ratingAvg?.toFixed(1)} ({seller.ratingCount})
      </span>
    </span>
  );
}

export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`mk-avatar ${large ? "mk-avatar--lg" : ""}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

// ---- listing card ------------------------------------------------------------

/** As many 240px columns as fit, two on a phone; dimmed while it is replaced. */
export const listingGridStyles = tv({
  base: [
    "grid grid-cols-cards gap-5 transition-opacity duration-fast",
    "aria-busy:opacity-60 max-wide:grid-cols-2 max-wide:gap-3",
  ],
});

export const listingCardStyles = tv({
  slots: {
    card: [
      "group relative flex flex-col overflow-hidden rounded-surface border border-line bg-card",
      "text-ink no-underline shadow-control max-wide:rounded-control",
    ],
    media:
      "relative grid aspect-4/3 place-items-center overflow-hidden bg-sunken text-line-strong",
    // Sold is said by the badge as well as by the colour draining out of it.
    image: "block size-full object-cover group-data-sold:grayscale",
    noPhoto: "flex min-w-0 flex-col items-center gap-1",
    badge: "absolute top-3 left-3",
    count: "absolute right-3 bottom-3",
    body: "flex flex-1 flex-col gap-1 p-3",
    price: "m-0 text-lead text-ink",
    // The prose step at the tight leading, and never more than two lines.
    title: "m-0 line-clamp-2 text-prose leading-tight font-normal",
    meta: "mt-auto flex items-center justify-between gap-2 pt-2 text-body text-ink-muted",
    where: "flex min-w-0 items-center gap-1",
    place: "truncate",
    rating: "inline-flex items-center gap-1 text-ink-2",
    quiet: "m-0 text-body text-ink-muted",
    hidden: "sr-only",
    // The three lines of a placeholder, as long as what they stand for.
    linePrice: "w-2/5",
    lineTitle: "w-17/20",
    lineMeta: "w-3/5",
  },
  variants: {
    /**
     * A card that is a link lifts under the pointer and pushes into its cover
     * a little; a placeholder does neither. Both stand still for a reader who
     * has asked for less movement.
     */
    linked: {
      true: {
        card: [
          "transition duration-base motion-reduce:transition-none",
          "not-disabled:hover:shadow-surface motion-safe:not-disabled:hover:-translate-y-1",
          RING,
        ],
        image: [
          "transition duration-base motion-reduce:transition-none",
          "motion-safe:group-hover:scale-104",
        ],
      },
    },
    /** The shape of what is loading, breathing where the cover will be. */
    loading: { true: { media: "animate-pulse motion-reduce:animate-none" } },
  },
  defaultVariants: { linked: true },
});

export function ListingCard({
  listing,
  showStatus = false,
}: {
  listing: Listing;
  showStatus?: boolean;
}) {
  const cover = listing.photos[0];
  const where = listing.town
    ? `${listing.town}, ${listing.county}`
    : listing.county;
  const styles = listingCardStyles();
  return (
    <Link
      to={paths.listing(listing.id)}
      className={styles.card()}
      data-sold={listing.status === "sold" ? "" : undefined}
    >
      <div className={styles.media()}>
        {cover ? (
          <img
            className={styles.image()}
            src={cover.url}
            alt=""
            loading="lazy"
            decoding="async"
            width={cover.width ?? undefined}
            height={cover.height ?? undefined}
          />
        ) : (
          <span className={styles.noPhoto()}>
            <ImageIcon size={28} aria-hidden="true" />
            <span className={styles.quiet()}>No photo</span>
          </span>
        )}
        {showStatus && listing.status !== "active" ? (
          <Chip tone="glass" className={styles.badge()}>
            {listing.status === "sold" ? "Sold" : "Removed"}
          </Chip>
        ) : listing.saved ? (
          <Chip tone="glass" className={styles.badge()}>
            <Heart size={10} fill="currentColor" aria-hidden="true" /> Saved
          </Chip>
        ) : null}
        {listing.photos.length > 1 && (
          <Chip tone="glass" className={styles.count()}>
            <Camera size={10} aria-hidden="true" />
            <span className={styles.hidden()}>Photos:</span>{" "}
            {listing.photos.length}
          </Chip>
        )}
      </div>
      <div className={styles.body()}>
        <p className={styles.price()}>
          {formatPrice(listing.priceCents, listing.currency)}
        </p>
        <h3 className={styles.title()}>{listing.title}</h3>
        <div className={styles.meta()}>
          <span className={styles.where()}>
            <MapPin size={12} aria-hidden="true" />
            <span className={styles.place()}>{where}</span>
          </span>
          {listing.seller.ratingCount > 0 && (
            <span
              className={styles.rating()}
              title={`Seller rated ${listing.seller.ratingAvg?.toFixed(1)} from ${listing.seller.ratingCount} review${listing.seller.ratingCount === 1 ? "" : "s"}`}
            >
              <Star size={11} fill="currentColor" aria-hidden="true" />
              <span className={styles.hidden()}>Seller rating</span>
              {listing.seller.ratingAvg?.toFixed(1)}
            </span>
          )}
        </div>
        <p className={styles.quiet()}>
          {conditionLabel(listing.condition)} · {relativeAge(listing.createdAt)}
        </p>
      </div>
    </Link>
  );
}

export function ListingGrid({
  listings,
  showStatus,
  busy = false,
}: {
  listings: Listing[];
  showStatus?: boolean;
  /** A newer result is on its way; what is shown is about to be replaced. */
  busy?: boolean;
}) {
  return (
    <div className={listingGridStyles()} aria-busy={busy}>
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} showStatus={showStatus} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  const styles = listingCardStyles({ linked: false, loading: true });
  return (
    <div
      className={listingGridStyles()}
      aria-busy="true"
      aria-label="Loading listings"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.card()} aria-hidden="true">
          <div className={styles.media()} />
          <div className={styles.body()}>
            <Skeleton className={styles.linePrice()} />
            <Skeleton className={styles.lineTitle()} />
            <Skeleton className={styles.lineMeta()} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- the kit's own, under the names the pages already call them -------------

/*
 * A field, a notice, an empty state, a pager and a modal question are the
 * kit's, not the marketplace's: ui/ draws each of them the way the rest of the
 * site draws it. They are handed on from here rather than imported page by
 * page so that the pages read as they always did, and so the one import that
 * has to change when a piece moves is this one.
 */
export {
  ConfirmDialog,
  Empty,
  Field,
  Notice,
  Pager,
  Select,
  TextArea,
  TextInput,
} from "../../ui";

// ---- the pieces the pages share that the kit has no part for ----------------

export const sharedStyles = tv({
  slots: {
    /*
     * The marketplace's content pane: the kit's Pane, at the page inset rather
     * than a panel's, and lifted off the content ground as every other box on
     * these pages is. The phone takes the panel inset back, there being less
     * page to spend.
     */
    pane: "p-6 shadow-control max-wide:p-5",
    /*
     * The same pane under an empty state, which brings a generous inset of its
     * own on a wide screen and so is given only the lift. A phone takes the
     * pane's inset back here too: there is not room for both.
     */
    emptyPane: "shadow-control max-wide:p-5",
    /*
     * The row of ways out of an empty state. Inside `Empty`'s own body, which
     * is a centred column, so this only has to lay its own buttons out — and
     * stand a little further off than the sentence above it.
     */
    emptyActions: "mt-2 flex flex-wrap justify-center gap-2",
    /** The whole page, while there is nothing of it to draw yet. */
    skeleton: "min-h-69",
    /** A column of fields, read down. */
    form: "grid gap-5",
    /*
     * Fields that belong together, side by side while each still has the room
     * to be read in, and one to a line once they do not.
     */
    formRow: "grid grid-cols-fields gap-x-3 gap-y-5",
    /** What a form is answered with, and whatever is said beside it. */
    formActions: "flex flex-wrap items-center gap-x-3 gap-y-2",
  },
});

/**
 * The kit's Pane worn by an element of the page's own choosing — a <section>,
 * a <li> — with the marketplace's inset and whatever that element lays out
 * inside it. The component would be a <div>, and these boxes are not.
 */
export const pane = (...classes: string[]) =>
  paneStyles({ className: classes.join(" ") });

/**
 * A page that has not arrived. It says it is busy itself: there is nothing
 * under it to carry that, which is what the kit's Skeleton expects of its
 * holder.
 */
export function PageSkeleton() {
  const styles = sharedStyles();
  return (
    <div
      className={skeletonStyles({
        shape: "block",
        className: styles.skeleton(),
      })}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

/** A page or a list that could not be fetched: say so plainly and offer the retry. */
export function LoadError({
  title = "This could not be loaded",
  message,
  onRetry,
  children,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const styles = sharedStyles();
  return (
    <div role="alert">
      <Empty
        kind="warn"
        title={title}
        icon={<AlertTriangle size={24} />}
        className={styles.emptyPane()}
      >
        <p>{message}</p>
        <div className={styles.emptyActions()}>
          {onRetry && (
            <Button variant="pill" onClick={onRetry}>
              <RotateCw size={15} aria-hidden="true" /> Try again
            </Button>
          )}
          {children}
        </div>
      </Empty>
    </div>
  );
}

// ---- footer ------------------------------------------------------------------

export const footerStyles = tv({
  slots: {
    base: [
      // The last row on the page, so its foot clears a home bar.
      "mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-6 pb-safe-6",
      // A phone has no room for two ends of a row, so they become two rows.
      "max-wide:flex-col max-wide:items-start",
    ],
    note: "m-0 text-body text-ink-muted",
    links: "flex flex-wrap gap-x-5 gap-y-2 text-body text-ink-muted",
  },
});

export function MarketFooter() {
  const styles = footerStyles();
  // In a list of nothing but links, ink alone says "link": no underlines.
  const link = linkStyles({ plain: true });
  return (
    <footer className={styles.base()}>
      <p className={styles.note()}>© {new Date().getFullYear()} wingfoil.ie</p>
      <nav className={styles.links()} aria-label="Footer">
        <Link className={link} to={paths.browse()}>
          Browse gear
        </Link>
        <Link className={link} to={paths.sell()}>
          Sell your gear
        </Link>
        <a className={link} href="/">
          Back to the wind map
        </a>
      </nav>
    </footer>
  );
}

// ---- misc --------------------------------------------------------------------

export function SaveButton({
  saved,
  busy,
  onToggle,
}: {
  saved: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="pill"
      size="lg"
      // Saved says so in the word and in the filled heart beside it, so the
      // box stays quiet and never rivals the view's one filled action.
      pressed={saved ? "worded" : false}
      disabled={busy}
      onClick={onToggle}
    >
      <Heart
        size={16}
        fill={saved ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

export const usePageTitle = (title: string) =>
  useSitePageTitle(title, "Market");
