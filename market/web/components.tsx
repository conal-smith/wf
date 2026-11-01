/**
 * Small presentational pieces shared by the marketplace pages. Anything that
 * talks to the API lives in the pages; these only render.
 */
import { UserButton } from "@clerk/clerk-react";
import {
  Heart,
  Camera,
  Image as ImageIcon,
  LogIn,
  PlusCircle,
  RotateCw,
  SearchX,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { CHART_HREF, spotHref } from "../../force5/src/siteNav";
import { usePageTitle as useSitePageTitle } from "../../shared/web/usePageTitle";
import {
  Avatar as KitAvatar,
  Button,
  Empty,
  Figure,
  Notice,
  Skeleton,
  SpotSearch,
  StarGlyphs,
  Tag,
  TopBar,
} from "../../ui";
import { buttonStyles } from "../../ui/Button";
import { linkStyles } from "../../ui/Link";
import { skeletonStyles } from "../../ui/Skeleton";
import { tabsStyles } from "../../ui/Tabs";
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
import { ApiRequestError } from "./api";

// ---- data helper -----------------------------------------------------------

export interface Async<T> {
  data: T | null;
  error: string | null;
  /**
   * The API said 404: the thing is not there, and asking again will not bring
   * it back. A page shows its not-found for this, not an error with a retry.
   */
  notFound: boolean;
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
    notFound: boolean;
    loading: boolean;
  }>({
    data: null,
    error: null,
    notFound: false,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null, notFound: false }));
    fn()
      .then(
        (data) =>
          alive &&
          setState({ data, error: null, notFound: false, loading: false }),
      )
      .catch(
        (e) =>
          alive &&
          setState({
            data: null,
            error: errorMessage(e),
            notFound: e instanceof ApiRequestError && e.status === 404,
            loading: false,
          }),
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

/*
 * The site's one top bar (ui/TopBar.tsx) with the marketplace's own few
 * actions in it. The words beside the icons go on a phone, so the bar's
 * search, the actions, Chart and the menu share 390px.
 */
export const headerStyles = tv({
  slots: {
    // The word beside the icon, where the row is wide enough to hold it.
    label: "hidden wide:inline",
    user: "inline-flex items-center px-1",
    name: "hidden items-center px-2 text-body text-ink-muted wide:inline-flex",
    actions: "flex items-center gap-2 max-wide:gap-1",
  },
});

/** A spot picked in the bar's search opens that spot's own page. */
const openSpot = (spot: { id: string }) => location.assign(spotHref(spot.id));

/**
 * `accentSell` fills the Sell button. A view gets one filled action, so the
 * shell passes it only on pages that have no primary of their own.
 */
export function MarketHeader({ accentSell = false }: { accentSell?: boolean }) {
  const auth = useMarketAuth();
  const styles = headerStyles();
  return (
    <TopBar
      search={<SpotSearch onPick={openSpot} />}
      view={{ to: "chart", href: CHART_HREF }}
      menu={<SiteMenu current="market" />}
      actions={
        /*
          The kit's Button is an anchor when it is given an href, but the
          marketplace's router takes a link over through its own <Link>. So a
          link that looks like a button wears the recipe's classes instead:
          one styling, either element.
        */
        <nav className={styles.actions()} aria-label="Marketplace">
          <Link
            className={buttonStyles({
              variant: accentSell ? "primary" : "outline",
            })}
            to={paths.sell()}
          >
            <PlusCircle size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>Sell</span>
          </Link>
          {auth.signedIn ? (
            <>
              <Link
                className={buttonStyles({ variant: "quiet" })}
                to={paths.me()}
                aria-label="Account"
              >
                <UserRound size={18} strokeWidth={1.75} aria-hidden="true" />
                <span className={styles.label()} aria-hidden="true">
                  Account
                </span>
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
              variant="quiet"
              aria-label="Sign in"
              onClick={auth.signIn}
              disabled={auth.provider === "none" || !auth.loaded}
              title={
                auth.provider === "none"
                  ? "Sign-in is not available on this version of the site"
                  : undefined
              }
            >
              <LogIn size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.label()}>Sign in</span>
            </Button>
          )}
        </nav>
      }
    />
  );
}

// ---- vocab lookups -----------------------------------------------------------

export const categoryLabel = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const conditionLabel = (id: string) =>
  CONDITIONS.find((c) => c.id === id)?.label ?? id;

// ---- stars -------------------------------------------------------------------

/**
 * A rating, in the chart's own star (ui/StarGlyphs): solid for what has been
 * earned, an outline for the half a star an average reaches past, and a dot
 * for each of the five it does not. The shape carries it, never the colour,
 * and the figure beside it says it again in the mono face.
 */
export const ratingStyles = tv({
  slots: {
    summary: "inline-flex flex-wrap items-center gap-x-1.5 gap-y-1",
    // "4.5 · 2": the average and how many it is the average of.
    figure: "font-mono text-caption text-ink-2 tabular-nums",
    // Nobody has rated them: a line of small print, not five empty marks.
    quiet: "font-body text-body text-ink-muted",
    picker: "inline-flex gap-1",
    // Under the pointer a star is lit, and a lit star draws no box: the run
    // of solid marks is what answers the hover.
    star: "text-ink-muted not-disabled:hover:bg-transparent",
  },
  variants: {
    /** Earned, or about to be: under the pointer the whole run fills in. */
    lit: { true: { star: "text-ink" } },
  },
});

/**
 * An average as whole stars and the half it reaches past: 4.5 is four solid
 * and an outline, 4.2 is four, 4.8 is five. The thresholds are the quarter
 * either side, which is where the old half-star drew its line.
 */
export function starsOf(value: number): { stars: number; potential: number } {
  const v = Math.max(0, Math.min(5, value));
  const stars = Math.floor(v + 0.25);
  return { stars, potential: v - stars >= 0.25 ? stars + 1 : stars };
}

export function Stars({
  value,
  size = 12,
}: {
  value: number | null;
  size?: number;
}) {
  const { stars, potential } = starsOf(value ?? 0);
  return (
    <StarGlyphs
      stars={stars}
      potential={potential}
      size={size}
      label={value == null ? "Not yet rated" : `${value} out of 5`}
    />
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
            size="md"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}: ${labels[n]}`}
            // The mark says the rating, not the control: a radio is not a
            // toggle, so the box stays quiet.
            className={ratingStyles({ lit }).star()}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(n)}
          >
            {/* One star, solid when lit and an outline when not. */}
            <StarGlyphs
              stars={lit ? 1 : 0}
              potential={1}
              slots="potential"
              size={22}
              label=""
            />
          </Button>
        );
      })}
    </div>
  );
}

export function SellerRating({
  seller,
  size = 11,
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
      <span className={styles.figure()}>
        {seller.ratingAvg?.toFixed(1)}
        <span aria-hidden="true"> · </span>
        <span className={sr()}> from </span>
        {/* The count says what it counts: a bare "· 1" beside the stars read as
            a second score. */}
        {seller.ratingCount} review{seller.ratingCount === 1 ? "" : "s"}
      </span>
    </span>
  );
}

/** Said to a screen reader and not drawn. */
const sr = tv({ base: "sr-only" });

// ---- ages --------------------------------------------------------------------

/**
 * How old something is, as the chart writes a figure: `3d`, `2w`, `5mo`. The
 * full words go to a screen reader beside it (`relativeAge`).
 */
export function shortAge(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

/** The age figure, with its words for a screen reader. */
export function Age({ iso, prefix = "Listed" }: { iso: string; prefix?: string }) {
  return (
    <time dateTime={iso}>
      <span aria-hidden="true">{shortAge(iso)}</span>
      <span className={sr()}>
        {prefix} {relativeAge(iso)}
      </span>
    </time>
  );
}

/** How recent a listing has to be to be marked new: a week. */
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The one listing on a page marked "new": the newest of them, if
 * it went up within the week. One mark on a view (docs/BRAND.md), so never
 * more than one card, and none where nothing is recent.
 */
export function newestFresh(
  listings: Listing[],
  now = Date.now(),
): string | null {
  let best: Listing | null = null;
  for (const l of listings)
    if (
      l.status === "active" &&
      (!best || Date.parse(l.createdAt) > Date.parse(best.createdAt))
    )
      best = l;
  return best && now - Date.parse(best.createdAt) < FRESH_MS ? best.id : null;
}

// ---- the price -------------------------------------------------------------

/**
 * The price, as a figure: the mono face's tabular digits, the number a card
 * and a listing are about. A sold one is struck through and muted.
 */
export const priceStyles = tv({
  base: "text-ink-muted line-through decoration-1",
});

export function Price({
  listing,
  size = "md",
  strike = false,
  className,
}: {
  listing: Pick<Listing, "priceCents" | "currency">;
  size?: "sm" | "md" | "lg";
  strike?: boolean;
  className?: string;
}) {
  return (
    <Figure
      size={size}
      className={strike ? priceStyles({ className }) : className}
      value={formatPrice(listing.priceCents, listing.currency)}
    />
  );
}

// ---- the face ----------------------------------------------------------------

/*
 * The face beside a seller's name: the kit's monogram, an initial on a soft
 * round. The one size a listing's seller row wants, and the large one for the
 * seller's own page.
 */
export const faceStyles = tv({
  base: "",
  variants: {
    // The kit's large face, a size down on a phone beside a title-sized name.
    large: { true: "max-wide:size-14 max-wide:text-lead" },
  },
});

export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  return (
    <KitAvatar
      name={name}
      size={large ? "lg" : "md"}
      className={faceStyles({ large })}
    />
  );
}

// ---- listing card ------------------------------------------------------------

/**
 * The classifieds: as many 240px columns as fit, two on a phone, kept apart
 * by space. Dimmed while a newer result replaces it.
 */
export const listingGridStyles = tv({
  base: [
    "grid grid-cols-cards gap-x-6 gap-y-8 transition-opacity duration-fast",
    "aria-busy:opacity-60 max-wide:grid-cols-2 max-wide:gap-x-3 max-wide:gap-y-6",
  ],
});

export const listingCardStyles = tv({
  slots: {
    // No box round an ad: the photograph in its soft card, the words under it.
    card: "group relative flex min-w-0 flex-col gap-2.5 rounded-surface text-ink no-underline",
    // The photograph, cut to the card's corner on the soft ground.
    media:
      "relative grid aspect-4/3 place-items-center overflow-hidden rounded-surface bg-sunken text-ink-muted",
    // Sold is said by the tag as well as by the colour draining out of it.
    image: "block size-full object-cover group-data-sold:grayscale",
    noPhoto: "flex min-w-0 flex-col items-center gap-1 text-body",
    badge: "absolute top-2 left-2",
    count: "absolute right-2 bottom-2",
    body: "flex flex-1 flex-col gap-1",
    // The price, and "new" beside it on the one card it marks.
    head: "flex min-h-7 items-center gap-2",
    // The name of the thing, never more than two lines.
    title:
      "m-0 line-clamp-2 font-body text-prose leading-tight font-semibold text-balance",
    // Where it is and how long it has been up, in a grey line.
    where:
      "flex min-w-0 items-baseline justify-between gap-2 text-body text-ink-muted",
    // On a phone the line runs out: the town gives way, the county stays,
    // because the county is what a buyer filters on.
    place: "flex min-w-0",
    town: "truncate",
    county: "shrink-0",
    meta: "mt-auto flex min-w-0 items-center justify-between gap-2 text-body text-ink-muted",
    condition: "truncate",
    seller: "flex shrink-0 items-center gap-1",
    hidden: "sr-only",
    // The three lines of a placeholder, as long as what they stand for.
    linePrice: "w-2/5",
    lineTitle: "w-17/20",
    lineMeta: "w-3/5",
  },
  variants: {
    /**
     * A card that is a link answers the pointer: the name underlines and the
     * photograph leans in a little. Nothing lifts. A placeholder does
     * neither; both stand still for a reader who has asked for less movement.
     */
    linked: {
      true: {
        card: RING,
        title: "decoration-1 underline-offset-3 group-hover:underline",
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
  fresh = false,
  hideSaved = false,
  hideSeller = false,
}: {
  listing: Listing;
  showStatus?: boolean;
  /** "New" in a tag beside the price: one card on a view, at most. */
  fresh?: boolean;
  /** On the Saved tab every card is saved, and a badge saying so says nothing. */
  hideSaved?: boolean;
  /** On the seller's own page every card is theirs: their rating is in the head. */
  hideSeller?: boolean;
}) {
  const cover = listing.photos[0];
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
            <ImageIcon size={24} strokeWidth={1.5} aria-hidden="true" />
            <span>No photo</span>
          </span>
        )}
        {showStatus && listing.status !== "active" ? (
          <Tag tone="glass" className={styles.badge()}>
            {listing.status === "sold" ? "Sold" : "Removed"}
          </Tag>
        ) : listing.saved && !hideSaved ? (
          <Tag tone="glass" className={styles.badge()}>
            <Heart size={10} fill="currentColor" aria-hidden="true" /> Saved
          </Tag>
        ) : null}
        {listing.photos.length > 1 && (
          <Tag tone="glass" className={styles.count()}>
            <Camera size={11} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.hidden()}>Photos:</span>{" "}
            {listing.photos.length}
          </Tag>
        )}
      </div>
      <div className={styles.body()}>
        <div className={styles.head()}>
          <Price listing={listing} />
          {fresh && <Tag data-fresh>new</Tag>}
        </div>
        <h3 className={styles.title()}>{listing.title}</h3>
        <span className={styles.where()}>
          <span className={styles.place()}>
            <span className={styles.hidden()}>In </span>
            {listing.town && (
              <span className={styles.town()}>{listing.town}</span>
            )}
            {/* The comma travels with the county, so a cut town still reads
                "Castlegregor…, Kerry". A plain space would be trimmed at the
                start of a flex item; this one is not. */}
            <span className={styles.county()}>
              {listing.town ? ",\u00a0" : ""}
              {listing.county}
            </span>
          </span>
          <Age iso={listing.createdAt} />
        </span>
        <div className={styles.meta()}>
          <span className={styles.condition()}>
            {conditionLabel(listing.condition)}
          </span>
          {listing.seller.ratingCount > 0 && !hideSeller && (
            // Whose stars they are is written, not left to a hover a phone
            // never has: five stars beside "Fair" read as the item's own.
            <span
              className={styles.seller()}
              title={`Seller rated ${listing.seller.ratingAvg?.toFixed(1)} from ${listing.seller.ratingCount} review${listing.seller.ratingCount === 1 ? "" : "s"}`}
            >
              <span>Seller</span>
              <Stars value={listing.seller.ratingAvg} size={9} />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ListingGrid({
  listings,
  showStatus,
  markNew = false,
  busy = false,
  hideSaved,
  hideSeller,
}: {
  listings: Listing[];
  showStatus?: boolean;
  hideSaved?: boolean;
  hideSeller?: boolean;
  /** Mark the newest "new", if it is from this week. */
  markNew?: boolean;
  /** A newer result is on its way; what is shown is about to be replaced. */
  busy?: boolean;
}) {
  const fresh = markNew ? newestFresh(listings) : null;
  return (
    <div className={listingGridStyles()} aria-busy={busy}>
      {listings.map((l) => (
        <ListingCard
          key={l.id}
          listing={l}
          showStatus={showStatus}
          fresh={l.id === fresh}
          hideSaved={hideSaved}
          hideSeller={hideSeller}
        />
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

// ---- tabs --------------------------------------------------------------------

/*
 * The account's sections and a seller's history: the kit's tabs (ui/Tabs),
 * a row of words with the current one on a soft pill. The account's are links
 * the marketplace's router follows, which the kit's Tabs (buttons) cannot be,
 * so both pages wear its recipe here. How many a tab holds is a figure in it.
 */
export const tabStyles = tv({
  extend: tabsStyles,
  slots: {
    list: "flex max-w-full gap-1 overflow-x-auto scrollbar-none",
    // The row clips what overflows it, so the ring goes inside the tab, and
    // a thumb gets the kit's minimum.
    tab: "not-disabled:focus-visible:-outline-offset-2 pointer-coarse:min-h-touch",
    count: "font-mono text-label text-ink-muted tabular-nums",
  },
});

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
    /** A form's measure, where it stands on a page wider than it. */
    formWidth: "w-full max-w-form",
    /** The row of ways out of an empty state. */
    emptyActions: "flex flex-wrap justify-center gap-2",
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
    /** A grey line over or under a heading: where, since when, which step. */
    meta: "m-0 font-body text-body text-ink-muted",
    /** A page's head: the way back, the heading and what stands under it. */
    head: "flex min-w-0 flex-col gap-2",
    /** The way back, on a line of its own. */
    back: "flex",
  },
});

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

/**
 * What a link to nothing finds: a path that is no page, or a listing or seller
 * the API says is not there (gone, sold and removed, or never was). There is
 * nothing to retry, so the way on is back to the listings.
 */
export function NotFound({
  title = "That page does not exist",
  text = "The link may be old, or the listing may have been taken down.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <Empty
      as="h1"
      title={title}
      icon={<SearchX size={24} strokeWidth={1.75} />}
      actions={
        <Link to={paths.browse()} className={buttonStyles({ variant: "primary" })}>
          Browse listings
        </Link>
      }
    >
      <p>{text}</p>
    </Empty>
  );
}

/**
 * A page or a list that could not be fetched: a notice that says so plainly,
 * with the retry beside it.
 */
export function LoadError({
  title = "This could not be loaded",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Notice
      level="warn"
      alert
      title={title}
      action={
        onRetry && (
          <Button size="sm" onClick={onRetry}>
            <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" /> Try
            again
          </Button>
        )
      }
    >
      {message}
    </Notice>
  );
}

// ---- footer ------------------------------------------------------------------

export const footerStyles = tv({
  slots: {
    // The page's foot, kept off the page by space and nothing heavier, and
    // the last row on the page, so its foot clears a home bar.
    base: [
      "mt-16 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-4 pb-safe-6",
      // A phone has no room for two ends of a row, so they become two rows.
      "max-wide:mt-12 max-wide:flex-col max-wide:items-start",
    ],
    note: "m-0 font-body text-body text-ink-muted",
    links: "flex flex-wrap gap-x-5 gap-y-2 font-body text-body text-ink-2",
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
        <a className={link} href={CHART_HREF}>
          Back to the wind map
        </a>
      </nav>
    </footer>
  );
}

/** The way back to the classifieds, as the chart writes "← Chart". */
export function BackLink({
  to = paths.browse(),
  children = "All listings",
}: {
  to?: string;
  children?: ReactNode;
}) {
  return (
    <div className={sharedStyles().back()}>
      <Link to={to} className={buttonStyles({ variant: "link", size: "sm" })}>
        <span aria-hidden="true">←</span> {children}
      </Link>
    </div>
  );
}

// ---- misc --------------------------------------------------------------------

export function SaveButton({
  saved,
  busy,
  disabled = false,
  onToggle,
}: {
  saved: boolean;
  busy: boolean;
  /** No way to sign in on this build: a Save that does nothing is not offered. */
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      // Saved says so in the word and in the filled heart beside it, so the
      // box stays quiet and never rivals the view's one filled action.
      pressed={saved ? "worded" : false}
      disabled={busy || disabled}
      onClick={onToggle}
    >
      <Heart
        size={16}
        strokeWidth={1.5}
        fill={saved ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

export const usePageTitle = (title: string) =>
  useSitePageTitle(title, "Market");
