import { SearchX, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Figure,
  Headline,
  headlineStyles,
  Kicker,
  SearchField,
  Select,
  TextInput,
} from "../../../ui";
import { buttonStyles } from "../../../ui/Button";
import { RING, tv } from "../../../ui/tv";
import { useApi } from "../api";
import {
  Empty,
  GridSkeleton,
  ListingGrid,
  LoadError,
  Pager,
  categoryLabel,
  conditionLabel,
  sharedStyles,
  useAsync,
  usePageTitle,
} from "../components";
import { Link, navigate, paths, useLocation } from "../router";
import {
  CATEGORIES,
  CONDITIONS,
  COUNTIES,
  type ListingQuery,
} from "../../shared/types";
import {
  listingQueryToParams,
  parseListingQuery,
  parsePriceInput,
} from "../../shared/validate";

export const browseStyles = tv({
  slots: {
    hero: "flex flex-col gap-4 max-wide:gap-3",
    search: "w-full max-w-dialog-wide",
    /*
     * The categories, as a broadsheet runs its sections along a line between
     * two rules: the mono label, and the one being read set in the display
     * face's italic. One line that scrolls on a phone, bleeding to the screen
     * edge so the word cut off at it says there is more.
     */
    rail: [
      "flex flex-wrap items-stretch gap-x-1 border-0 border-y border-ink",
      "max-wide:-mx-3 max-wide:flex-nowrap max-wide:overflow-x-auto max-wide:scrollbar-none max-wide:px-2",
    ],
    chip: [
      "inline-flex h-control-md shrink-0 cursor-pointer items-center px-2.5",
      "border-0 bg-transparent font-mono text-label whitespace-nowrap text-ink-2 uppercase",
      "touch-manipulation transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:bg-sunken not-disabled:hover:text-ink",
      // On: the display face's italic, heavier, on the paper's second sheet,
      // as the site menu marks where you are. Not colour alone.
      "aria-pressed:bg-sunken aria-pressed:font-display aria-pressed:text-prose aria-pressed:font-semibold aria-pressed:tracking-normal aria-pressed:text-ink aria-pressed:normal-case aria-pressed:italic",
      RING,
      "not-disabled:focus-visible:-outline-offset-2",
    ],
    filters: "flex flex-wrap items-center gap-2",
    // The way in to the filters on a phone, and nothing at all above it.
    toggle: [
      "hidden",
      "max-wide:inline-flex max-wide:h-touch max-wide:flex-1 max-wide:shrink",
      "max-wide:rounded-control max-wide:border-line-strong max-wide:shadow-none",
    ],
    panel:
      "flex flex-auto flex-wrap items-center gap-2 max-wide:order-3 max-wide:hidden max-wide:basis-full",
    select: "grow-0 shrink basis-50",
    price: "flex items-center gap-1 text-ink-muted",
    priceField: "w-28 max-wide:w-auto max-wide:flex-1",
    sort: "ml-auto inline-flex items-center gap-2 max-wide:ml-0 max-wide:flex-1",
    sortField: "min-w-43 max-wide:min-w-0 max-wide:flex-1",
    // The section head over the ads: how many, and what narrows them.
    // No rule of its own: every ad under it brings its heavy one.
    head: "flex min-h-control-md flex-wrap items-center justify-between gap-x-5 gap-y-2",
    count: "m-0 inline-flex items-baseline gap-2 font-display text-lead",
    active: "flex flex-auto flex-wrap items-center justify-end gap-x-2 gap-y-1",
    // A removable filter: the chip is the button. It is the one control on
    // this page the kit has no part for, so it carries the kit's own coarse
    // minimum by hand — a filter is taken off with a thumb as often as the
    // rail's section beside it is put on.
    token: [
      "inline-flex h-control-sm items-center gap-1 rounded-full border border-line bg-sunken pr-2 pl-3",
      "font-mono text-caption text-ink-2 cursor-pointer",
      "transition-colors duration-fast pointer-coarse:min-h-touch",
      "not-disabled:hover:border-ink not-disabled:hover:bg-inverse not-disabled:hover:text-ink-inverse",
      RING,
    ],
  },
  variants: {
    // Below the toggle's breakpoint the folded filters unfold into a well of
    // their own, under the row that opened them.
    open: {
      true: {
        panel:
          "max-wide:grid max-wide:grid-cols-1 max-wide:gap-3 max-wide:bg-sunken max-wide:p-3",
      },
    },
  },
});

/** "Mon 5 Oct", as the dateline over the classifieds gives it. */
const dateline = (now = new Date()) =>
  now
    .toLocaleDateString("en-IE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(",", "");

export default function BrowsePage() {
  usePageTitle("Second-hand wingfoil gear");
  const api = useApi();
  const { search } = useLocation();
  const query = useMemo(() => parseListingQuery(search), [search]);
  const key = search.toString();
  const result = useAsync(() => api.listListings(query), [api, key]);

  // The search box is typed into freely and only applied on submit or a pause.
  const [text, setText] = useState(query.q ?? "");
  useEffect(() => setText(query.q ?? ""), [query.q]);
  useEffect(() => {
    if (text === (query.q ?? "")) return;
    const timer = window.setTimeout(
      () => update({ q: text || undefined, page: 1 }),
      400,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const update = (patch: Partial<ListingQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) next.page = 1;
    navigate(paths.browse(listingQueryToParams(next)), { replace: true });
  };

  const [minText, setMinText] = useState(
    query.minPriceCents != null ? String(query.minPriceCents / 100) : "",
  );
  const [maxText, setMaxText] = useState(
    query.maxPriceCents != null ? String(query.maxPriceCents / 100) : "",
  );
  const applyPrice = () => {
    const min = parsePriceInput(minText);
    const max = parsePriceInput(maxText);
    update({
      minPriceCents: min ?? undefined,
      maxPriceCents: max ?? undefined,
    });
  };

  const [filtersOpen, setFiltersOpen] = useState(false);
  const styles = browseStyles({ open: filtersOpen });
  const shared = sharedStyles();
  const headline = headlineStyles();

  const active = Boolean(
    query.q ||
    query.category ||
    query.county ||
    query.condition ||
    query.minPriceCents != null ||
    query.maxPriceCents != null,
  );

  const clearAll = () => {
    setMinText("");
    setMaxText("");
    setText("");
    navigate(paths.browse(), { replace: true });
  };

  // Every narrowing of the results, as something that can be taken back off.
  const priceLabel = () => {
    const min = query.minPriceCents != null ? query.minPriceCents / 100 : null;
    const max = query.maxPriceCents != null ? query.maxPriceCents / 100 : null;
    if (min != null && max != null) return `€${min} to €${max}`;
    return min != null ? `From €${min}` : `Up to €${max}`;
  };
  const tokens: { key: string; label: string; remove: () => void }[] = [];
  if (query.q)
    tokens.push({
      key: "q",
      label: `“${query.q}”`,
      remove: () => {
        setText("");
        update({ q: undefined });
      },
    });
  if (query.category)
    tokens.push({
      key: "category",
      label: categoryLabel(query.category),
      remove: () => update({ category: undefined }),
    });
  if (query.county)
    tokens.push({
      key: "county",
      label: `Co. ${query.county}`,
      remove: () => update({ county: undefined }),
    });
  if (query.condition)
    tokens.push({
      key: "condition",
      label: conditionLabel(query.condition),
      remove: () => update({ condition: undefined }),
    });
  if (query.minPriceCents != null || query.maxPriceCents != null)
    tokens.push({
      key: "price",
      label: priceLabel(),
      remove: () => {
        setMinText("");
        setMaxText("");
        update({ minPriceCents: undefined, maxPriceCents: undefined });
      },
    });
  // Behind the phone's Filters button: everything but the search and category.
  const folded = tokens.filter(
    (t) => t.key !== "q" && t.key !== "category",
  ).length;

  const total = result.data?.total;

  return (
    <>
      <section className={styles.hero()} aria-labelledby="browse-title">
        <div className={shared.dateline()}>
          <Kicker as="span" tone="ink">
            Classifieds
          </Kicker>
          <Kicker as="span">{dateline()}</Kicker>
        </div>
        <Headline id="browse-title">
          Second-hand gear<span className={headline.mark()}>:</span>{" "}
          <em className={headline.soft()}>across Ireland</em>
        </Headline>
        <form
          className={styles.search()}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: text || undefined });
          }}
        >
          <SearchField
            size="hero"
            enterKeyHint="search"
            aria-label="Search listings"
            placeholder="Brand, model or size…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            {text && (
              <Button
                icon
                aria-label="Clear search"
                onClick={() => setText("")}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            )}
          </SearchField>
        </form>
      </section>

      <div className={styles.rail()} role="group" aria-label="Category">
        <button
          type="button"
          className={styles.chip()}
          aria-pressed={!query.category}
          onClick={() => update({ category: undefined })}
        >
          All gear
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={styles.chip()}
            aria-pressed={query.category === c.id}
            title={c.hint}
            onClick={() =>
              update({ category: query.category === c.id ? undefined : c.id })
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className={styles.filters()}>
        <Button
          variant="pill"
          className={styles.toggle()}
          aria-expanded={filtersOpen}
          aria-controls="browse-filters"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
          Filters{folded ? ` (${folded})` : ""}
        </Button>
        <div
          className={styles.panel()}
          id="browse-filters"
          role="group"
          aria-label="Filters"
        >
          <Select
            className={styles.select()}
            aria-label="County"
            active={Boolean(query.county)}
            value={query.county ?? ""}
            onChange={(e) =>
              update({
                county: (e.target.value || undefined) as ListingQuery["county"],
              })
            }
          >
            <option value="">All counties</option>
            {COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            className={styles.select()}
            aria-label="Condition"
            active={Boolean(query.condition)}
            value={query.condition ?? ""}
            onChange={(e) =>
              update({
                condition: (e.target.value ||
                  undefined) as ListingQuery["condition"],
              })
            }
          >
            <option value="">Any condition</option>
            {CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <div className={styles.price()} role="group" aria-label="Price">
            <TextInput
              className={styles.priceField()}
              aria-label="Minimum price in euro"
              prefix="€"
              inputMode="numeric"
              placeholder="Min"
              active={query.minPriceCents != null}
              value={minText}
              onChange={(e) => setMinText(e.target.value)}
              onBlur={applyPrice}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
            />
            <span aria-hidden="true">–</span>
            <TextInput
              className={styles.priceField()}
              aria-label="Maximum price in euro"
              prefix="€"
              inputMode="numeric"
              placeholder="Max"
              active={query.maxPriceCents != null}
              value={maxText}
              onChange={(e) => setMaxText(e.target.value)}
              onBlur={applyPrice}
              onKeyDown={(e) => e.key === "Enter" && applyPrice()}
            />
          </div>
        </div>
        <div className={styles.sort()}>
          <Select
            className={styles.sortField()}
            aria-label="Sort by"
            value={query.sort}
            onChange={(e) =>
              update({ sort: e.target.value as ListingQuery["sort"] })
            }
          >
            <option value="newest">Newest first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </Select>
        </div>
      </div>

      {!result.error && (
        <div className={styles.head()}>
          <h2 className={styles.count()} aria-live="polite">
            {total == null ? (
              "Loading listings…"
            ) : (
              <>
                <Figure value={total.toLocaleString("en-IE")} />{" "}
                {`listing${total === 1 ? "" : "s"}`}
              </>
            )}
          </h2>
          {tokens.length > 0 && (
            <div className={styles.active()}>
              {tokens.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={styles.token()}
                  aria-label={`Remove filter: ${t.label}`}
                  onClick={t.remove}
                >
                  {t.label}
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
              {tokens.length > 1 && (
                <Button variant="link" onClick={clearAll}>
                  Clear all
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {result.error ? (
        <LoadError
          title="The listings could not be loaded"
          message={result.error}
          onRetry={result.reload}
        />
      ) : !result.data ? (
        <GridSkeleton />
      ) : result.data.items.length === 0 ? (
        <Empty
          title={active ? "Nothing matches that search" : "No listings yet"}
          icon={<SearchX size={24} strokeWidth={1.5} aria-hidden="true" />}
          className={shared.emptyPane()}
        >
          <p>
            {active
              ? "Try a broader search, or take a filter off."
              : "Be the first to list something you no longer ride."}
          </p>
          <div className={shared.emptyActions()}>
            {active ? (
              <Button variant="pill" onClick={clearAll}>
                Clear all filters
              </Button>
            ) : (
              <Link
                to={paths.sell()}
                className={buttonStyles({ variant: "pill" })}
              >
                List your gear
              </Link>
            )}
          </div>
        </Empty>
      ) : (
        <>
          <ListingGrid
            listings={result.data.items}
            busy={result.loading}
            markNew
          />
          <Pager
            page={result.data.page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            onPage={(p) => {
              update({ page: p });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </>
      )}
    </>
  );
}
