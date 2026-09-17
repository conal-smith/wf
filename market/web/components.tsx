/**
 * Small presentational pieces shared by the marketplace pages. Anything that
 * talks to the API lives in the pages; these only render.
 */
import { UserButton } from "@clerk/clerk-react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  Info,
  LogIn,
  Map as MapIcon,
  PlusCircle,
  Star,
  StarHalf,
  UserRound,
  Wind,
} from "lucide-react";
import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
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

export function MarketHeader() {
  const auth = useMarketAuth();
  return (
    <header className="mk-header">
      <div className="f5-surface f5-surface--pill mk-header__bar">
        <Link
          to={paths.browse()}
          className="mk-brand"
          aria-label="wingfoil.ie Market, home"
        >
          <Wind size={22} aria-hidden="true" />
          <span>
            wingfoil<span className="mk-brand__domain">.ie</span>
          </span>
          <span className="f5-chip f5-chip--eyebrow">Market</span>
        </Link>
        <nav className="mk-header__actions" aria-label="Marketplace">
          <a className="f5-button f5-button--pill f5-button--sm" href="/">
            <MapIcon size={15} aria-hidden="true" />
            <span className="mk-header__label">Map</span>
          </a>
          <Link
            className="f5-button f5-button--pill f5-button--sm"
            to={paths.sell()}
          >
            <PlusCircle size={15} aria-hidden="true" />
            <span>Sell</span>
          </Link>
          {auth.signedIn ? (
            <>
              <Link
                className="f5-button f5-button--pill f5-button--sm"
                to={paths.me()}
              >
                <UserRound size={15} aria-hidden="true" />
                <span className="mk-header__label">My listings</span>
              </Link>
              {auth.provider === "clerk" ? (
                <span className="mk-header__user">
                  <UserButton />
                </span>
              ) : (
                <span className="mk-header__user mk-caption mk-header__label">
                  {auth.identity.name}
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              className="f5-button f5-button--pill f5-button--sm"
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
            </button>
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

export function Stars({
  value,
  size = 14,
}: {
  value: number | null;
  size?: number;
}) {
  const v = value ?? 0;
  return (
    <span
      className="mk-stars"
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
          <Star key={n} size={size} data-empty="true" aria-hidden="true" />
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
      className="mk-rating-pick"
      role="radiogroup"
      aria-label="Rating"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-pressed={n <= value}
          data-lit={hover ? n <= hover : undefined}
          aria-label={`${n} star${n === 1 ? "" : "s"}: ${labels[n]}`}
          className="f5-button f5-button--icon f5-button--sm"
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          <Star
            size={22}
            fill={n <= (hover || value) ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      ))}
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
  if (!seller.ratingCount)
    return <span className="mk-caption">No ratings yet</span>;
  return (
    <span className="mk-row" style={{ gap: "var(--sem-space-gap-tight)" }}>
      <Stars value={seller.ratingAvg} size={size} />
      <span className="mk-caption">
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
  return (
    <Link
      to={paths.listing(listing.id)}
      className="mk-card"
      data-status={listing.status}
    >
      <div className="mk-card__media">
        {cover ? (
          <img
            src={cover.url}
            alt=""
            loading="lazy"
            width={cover.width ?? undefined}
            height={cover.height ?? undefined}
          />
        ) : (
          <ImageIcon size={28} aria-hidden="true" />
        )}
        {showStatus && listing.status !== "active" && (
          <span className="f5-chip f5-chip--glass mk-card__badge">
            {listing.status === "sold" ? "Sold" : "Removed"}
          </span>
        )}
        {listing.saved && !showStatus && (
          <span className="f5-chip f5-chip--glass mk-card__badge">
            <Heart size={10} fill="currentColor" aria-hidden="true" /> Saved
          </span>
        )}
      </div>
      <div className="mk-card__body">
        <p className="mk-lead">
          {formatPrice(listing.priceCents, listing.currency)}
        </p>
        <h3 className="mk-card__title">{listing.title}</h3>
        <p className="mk-caption">
          {where} · {conditionLabel(listing.condition)}
        </p>
        <div className="mk-card__meta">
          <span className="mk-caption">{relativeAge(listing.createdAt)}</span>
          {listing.seller.ratingCount > 0 && (
            <span
              className="mk-caption mk-row"
              style={{ gap: "var(--sem-space-gap-tight)" }}
            >
              <Star size={10} fill="currentColor" aria-hidden="true" />
              {listing.seller.ratingAvg?.toFixed(1)}
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
}: {
  listings: Listing[];
  showStatus?: boolean;
}) {
  return (
    <div className="mk-grid">
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} showStatus={showStatus} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="mk-grid" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mk-skeleton" />
      ))}
    </div>
  );
}

// ---- notices -----------------------------------------------------------------

export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={`mk-notice ${kind === "warn" ? "mk-notice--warn" : ""}`}
      role={kind === "warn" ? "alert" : "status"}
    >
      {kind === "warn" ? (
        <AlertTriangle size={16} aria-hidden="true" />
      ) : (
        <Info size={16} aria-hidden="true" />
      )}
      <div>{children}</div>
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mk-empty mk-pane">
      <ImageIcon size={28} aria-hidden="true" />
      <p className="mk-lead">{title}</p>
      {children}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mk-pager" aria-label="Pages">
      <button
        type="button"
        className="f5-button f5-button--pill"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </button>
      <span className="mk-caption">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="f5-button f5-button--pill"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

// ---- form fields -------------------------------------------------------------

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className="mk-field" data-invalid={Boolean(error)}>
      <label className="mk-field__label" htmlFor={htmlFor}>
        {label} {hint && <small>{hint}</small>}
      </label>
      {children}
      {error && (
        <span className="mk-caption mk-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextInput({
  prefix,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { prefix?: ReactNode }) {
  return (
    <div className="mk-field__control">
      {prefix && <span className="mk-field__prefix">{prefix}</span>}
      <input {...props} />
    </div>
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="mk-field__control">
      <textarea {...props} />
    </div>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="mk-field__control mk-field__control--select">
      <select {...props} />
      <ChevronDown size={16} aria-hidden="true" />
    </div>
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
    <button
      type="button"
      className="f5-button f5-button--pill"
      aria-pressed={saved}
      disabled={busy}
      onClick={onToggle}
    >
      <Heart
        size={16}
        fill={saved ? "currentColor" : "none"}
        aria-hidden="true"
      />
      {saved ? "Saved" : "Save"}
    </button>
  );
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — wingfoil.ie Market`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
