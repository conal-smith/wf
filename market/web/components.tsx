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
  PlusCircle,
  RotateCw,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { CHART_HREF } from "../../force5/src/siteNav";
import { usePageTitle as useSitePageTitle } from "../../shared/web/usePageTitle";
import {
  Avatar as KitAvatar,
  Button,
  Chip,
  Empty,
  Figure,
  PenLoop,
  PenNote,
  PenStrike,
  Puffin,
  Skeleton,
  StarGlyphs,
} from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { buttonStyles } from "../../ui/Button";
import { kickerStyles } from "../../ui/Kicker";
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
 * The site's masthead (ui/Masthead.tsx) with the marketplace's own few
 * actions. The bar's insets and the nameplate step down on a phone, so the
 * menu, the nameplate and both actions share 390px without a label wrapping.
 */
export const headerStyles = tv({
  slots: {
    // The word beside the icon, where the row is wide enough to hold it.
    label: "hidden wide:inline",
    user: "inline-flex items-center px-2",
    name: "hidden items-center px-2 text-body text-ink-muted wide:inline-flex",
  },
});

/**
 * `accentSell` fills the Sell button. A view gets one filled action, so the
 * shell passes it only on pages that have no primary of their own.
 */
export function MarketHeader({ accentSell = false }: { accentSell?: boolean }) {
  const auth = useMarketAuth();
  const styles = headerStyles();
  const masthead = mastheadStyles();
  return (
    <Masthead>
        <SiteMenu current="market" size="sm" ground="content" />
        <Link
          to={paths.browse()}
          className={masthead.brand()}
          aria-label="wingfoil.ie Market, home"
        >
          <MastheadMark section="Market" />
        </Link>
        {/*
          The wind map is reached through the site menu at the start of the bar,
          not a button of its own here: one control per destination. The footer
          link stays — it is at the other end of the page, not beside it.
        */}
        <nav className={masthead.actions()} aria-label="Marketplace">
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
            })}
            to={paths.sell()}
          >
            <PlusCircle size={15} strokeWidth={1.5} aria-hidden="true" />
            <span>Sell</span>
          </Link>
          {auth.signedIn ? (
            <>
              <Link
                className={buttonStyles({ variant: "pill", size: "sm" })}
                to={paths.me()}
              >
                <UserRound size={15} strokeWidth={1.5} aria-hidden="true" />
                <span className={styles.label()}>Account</span>
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
                  ? "Sign-in is not available on this version of the site"
                  : undefined
              }
            >
              <LogIn size={15} strokeWidth={1.5} aria-hidden="true" />
              <span>Sign in</span>
            </Button>
          )}
        </nav>
    </Masthead>
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
    quiet: "font-body text-body text-ink-muted italic",
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

/** How recent a listing has to be for the pen to call it new: a week. */
export const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The one listing on a page the pen loops "new" round: the newest of them, if
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
 * and a listing are about. A sold one is struck through in the pen, which is
 * the one mark that view carries.
 */
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
  const figure = (
    <Figure
      size={size}
      className={className}
      value={formatPrice(listing.priceCents, listing.currency)}
    />
  );
  return strike ? <PenStrike>{figure}</PenStrike> : figure;
}

// ---- the face ----------------------------------------------------------------

/*
 * The face beside a seller's name: the kit's monogram, an initial in the
 * display face's italic in an ink ring. The one size a listing's seller row
 * wants, and the large one for the seller's own page.
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
 * The classifieds: as many 240px columns as fit, two on a phone, each ad
 * under a heavy rule of its own. Dimmed while a newer result replaces it.
 */
export const listingGridStyles = tv({
  base: [
    "grid grid-cols-cards gap-x-6 gap-y-8 transition-opacity duration-fast",
    "aria-busy:opacity-60 max-wide:grid-cols-2 max-wide:gap-x-3 max-wide:gap-y-6",
  ],
});

export const listingCardStyles = tv({
  slots: {
    // A ruled Pane (ui/Pane `kind="ruled"`): the broadsheet's heavy rule over
    // each ad, and no box round it. The photograph stands in its own frame.
    card: "group relative flex min-w-0 flex-col gap-2 text-ink no-underline",
    // Where it is and how long it has been up, in the mono label, over the
    // photograph the way a classified's section line heads it.
    kicker: "flex min-w-0 items-baseline justify-between gap-2 text-ink-muted",
    // On a phone the line runs out: the town gives way, the county stays,
    // because the county is what a buyer filters on.
    where: "flex min-w-0",
    town: "truncate",
    county: "shrink-0",
    // The photograph on paper, in a hairline frame.
    media:
      "relative grid aspect-4/3 place-items-center overflow-hidden border border-line bg-sunken text-ink-muted",
    // Sold is said by the badge as well as by the colour draining out of it.
    image: "block size-full object-cover group-data-sold:grayscale",
    noPhoto: "flex min-w-0 flex-col items-center gap-1",
    badge: "absolute top-2 left-2",
    count: "absolute right-2 bottom-2",
    body: "flex flex-1 flex-col gap-1",
    // The price, and the pen's "new" beside it on the one card it marks.
    // The pen's loop reaches 12px past what it rings, so it stands that far
    // off the price.
    head: "flex min-h-7 items-center gap-5",
    fresh: "inline-block",
    // The name of the thing in the display face, never more than two lines.
    title:
      "m-0 line-clamp-2 font-display text-prose leading-tight font-semibold text-balance",
    meta: "mt-auto flex min-w-0 items-center justify-between gap-2 pt-1 text-ink-muted",
    condition: "truncate",
    seller: "flex shrink-0 items-center gap-1",
    quiet: "m-0",
    hidden: "sr-only",
    // The three lines of a placeholder, as long as what they stand for.
    linePrice: "w-2/5",
    lineTitle: "w-17/20",
    lineMeta: "w-3/5",
  },
  variants: {
    /**
     * A card that is a link answers the pointer the way a page does: the
     * name underlines and the photograph leans in a little. Paper does not
     * float, so nothing lifts. A placeholder does neither; both stand still
     * for a reader who has asked for less movement.
     */
    linked: {
      true: {
        card: RING,
        title:
          "decoration-1 underline-offset-3 group-hover:underline",
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
  /** The pen loops "new" beside the price: one card on a view, at most. */
  fresh?: boolean;
  /** On the Saved tab every card is saved, and a badge saying so says nothing. */
  hideSaved?: boolean;
  /** On the seller's own page every card is theirs: their rating is in the head. */
  hideSeller?: boolean;
}) {
  const cover = listing.photos[0];
  const styles = listingCardStyles();
  const label = kickerStyles;
  return (
    <Link
      to={paths.listing(listing.id)}
      className={paneStyles({ kind: "ruled", className: styles.card() })}
      data-sold={listing.status === "sold" ? "" : undefined}
    >
      <span className={label({ className: styles.kicker() })}>
        <span className={styles.where()}>
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
            <span className={label()}>No photo</span>
          </span>
        )}
        {showStatus && listing.status !== "active" ? (
          <Chip tone="glass" eyebrow className={styles.badge()}>
            {listing.status === "sold" ? "Sold" : "Removed"}
          </Chip>
        ) : listing.saved && !hideSaved ? (
          <Chip tone="glass" eyebrow className={styles.badge()}>
            <Heart size={10} fill="currentColor" aria-hidden="true" /> Saved
          </Chip>
        ) : null}
        {listing.photos.length > 1 && (
          <Chip tone="glass" className={styles.count()}>
            <Camera size={11} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.hidden()}>Photos:</span>{" "}
            {listing.photos.length}
          </Chip>
        )}
      </div>
      <div className={styles.body()}>
        <div className={styles.head()}>
          <Price listing={listing} />
          {fresh && (
            <PenLoop className={styles.fresh()} seed={7}>
              <PenNote as="span" size="sm">
                new
              </PenNote>
            </PenLoop>
          )}
        </div>
        <h3 className={styles.title()}>{listing.title}</h3>
        <div className={styles.meta()}>
          <span className={label({ className: styles.condition() })}>
            {conditionLabel(listing.condition)}
          </span>
          {listing.seller.ratingCount > 0 && !hideSeller && (
            // Whose stars they are is written, not left to a hover a phone
            // never has: five stars beside "Fair" read as the item's own.
            <span
              className={styles.seller()}
              title={`Seller rated ${listing.seller.ratingAvg?.toFixed(1)} from ${listing.seller.ratingCount} review${listing.seller.ratingCount === 1 ? "" : "s"}`}
            >
              <span className={label()}>Seller</span>
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
  /** Let the pen loop "new" round the newest, if it is from this week. */
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
        <div
          key={i}
          className={paneStyles({ kind: "ruled", className: styles.card() })}
          aria-hidden="true"
        >
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
 * The account's sections and a seller's history: a row of mono labels on a
 * hairline, the one being read underlined in ink and set heavier, as a
 * broadsheet heads the column you are in. A tablist is not one of the kit's
 * parts (ui/Segmented is a group of toggles), so it is drawn here, once, for
 * both pages. The row scrolls sideways where the words do not fit, so the
 * ring is drawn inside a tab, where the scrolling row cannot clip it.
 */
export const tabStyles = tv({
  slots: {
    list: "flex max-w-full overflow-x-auto scrollbar-none border-0 border-b border-ink",
    tab: [
      "inline-flex h-control-md shrink-0 cursor-pointer items-center gap-1.5 px-3",
      "border-0 border-b-3 border-transparent bg-transparent",
      "font-mono text-label whitespace-nowrap text-ink-muted uppercase no-underline",
      "touch-manipulation transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-transparent not-disabled:hover:text-ink",
      "aria-selected:border-ink aria-selected:font-semibold aria-selected:text-ink",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    // How many are in it, as a figure in the tab.
    count: "font-mono text-caption tabular-nums",
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
    /*
     * The marketplace's box, for what stands alone (a form, a gate): the
     * kit's Pane, one ink rule on grain, at the page inset rather than a
     * panel's. The phone takes the panel inset back, there being less page.
     */
    pane: "p-6 max-wide:p-5",
    /*
     * The same box under an empty state, which brings a generous inset of its
     * own on a wide screen. A phone takes the pane's inset back here too.
     */
    emptyPane: "max-wide:p-5",
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
    /*
     * The broadsheet's dateline over a page's head: what the page is on the
     * left, its figures on the right, in the mono label on a hairline.
     */
    dateline:
      "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-0 border-b border-line pb-1.5",
    /** A page's head: the dateline, the headline and what stands under it. */
    head: "flex min-w-0 flex-col gap-3",
    /** The way back, on a line of its own. */
    back: "flex",
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

export const notFoundStyles = tv({
  slots: {
    // A URL that is not a page: the puffin on his rock, and the pen's word.
    lost: "grid justify-items-center gap-4 py-14 text-center",
    lostTitle: "m-0 -rotate-1",
    lostText: "m-0 max-w-reading font-body text-prose text-ink-muted",
  },
});

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
  const styles = notFoundStyles();
  return (
    <section className={styles.lost()} aria-labelledby="not-found-title">
      <Puffin size={88} bob />
      <h1 className={styles.lostTitle()} id="not-found-title">
        <PenNote as="span">{title}</PenNote>
      </h1>
      <p className={styles.lostText()}>{text}</p>
      <Link to={paths.browse()} className={buttonStyles({ variant: "primary" })}>
        Browse listings
      </Link>
    </section>
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
        icon={<AlertTriangle size={24} strokeWidth={1.5} />}
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
      // The page's foot: the broadsheet's double rule, and the last row on the
      // page, so its foot clears a home bar.
      "mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3",
      "border-0 border-t-3 border-double border-ink pt-4 pb-safe-6",
      // A phone has no room for two ends of a row, so they become two rows.
      "max-wide:flex-col max-wide:items-start",
    ],
    note: "m-0 text-ink-muted",
    links: "flex flex-wrap gap-x-5 gap-y-2 font-body text-body text-ink-2",
  },
});

export function MarketFooter() {
  const styles = footerStyles();
  // In a list of nothing but links, ink alone says "link": no underlines.
  const link = linkStyles({ plain: true });
  return (
    <footer className={styles.base()}>
      <p className={kickerStyles({ className: styles.note() })}>
        © {new Date().getFullYear()} wingfoil.ie
      </p>
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
      variant="pill"
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
