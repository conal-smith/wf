import { SearchX, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Heading,
  SearchField,
  Select,
  TextInput,
} from "../../../ui";
import { buttonStyles } from "../../../ui/Button";
import { tv } from "../../../ui/tv";
import { useApi } from "../api";
import {
  Empty,
  GridSkeleton,
  ListingGrid,
  LoadError,
  Pager,
  categoryLabel,
  conditionLabel,
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
    hero: "flex flex-col gap-5 max-wide:gap-4",
    search: "w-full max-w-dialog-wide",
    /*
     * The categories, as the kit's choice chips: one pressed, the rest a
     * press away. One line that scrolls on a phone, bleeding to the screen
     * edge so the chip cut off at it says there is more.
     */
    rail: [
      "flex flex-wrap items-center gap-2",
      "max-wide:-mx-3 max-wide:flex-nowrap max-wide:overflow-x-auto max-wide:scrollbar-none max-wide:px-3",
    ],
    filters: "flex flex-wrap items-center gap-2",
    // The way in to the filters on a phone, and nothing at all above it.
    toggle: [
      "hidden",
      "max-wide:inline-flex max-wide:h-touch max-wide:flex-1 max-wide:shrink",
      // Open, it is on the soft ground, with the panel it opened.
      "aria-expanded:bg-sunken",
    ],
    panel:
      "flex flex-auto flex-wrap items-center gap-2 max-wide:order-3 max-wide:hidden max-wide:basis-full",
    select: "grow-0 shrink basis-50",
    price: "flex items-center gap-1 text-ink-muted",
    priceField: "w-28 max-wide:w-auto max-wide:flex-1",
    sort: "ml-auto inline-flex items-center gap-2 max-wide:ml-0 max-wide:flex-1",
    sortField: "min-w-43 max-wide:min-w-0 max-wide:flex-1",
    // The section head over the ads: how many, and what narrows them.
    head: "flex min-h-control-md flex-wrap items-center justify-between gap-x-5 gap-y-2",
    count: "m-0 font-body text-lead tracking-tight text-ink",
    active: "flex flex-auto flex-wrap items-center justify-end gap-x-2 gap-y-1",
  },
  variants: {
    // Below the toggle's breakpoint the folded filters unfold into a soft
    // card of their own, under the row that opened them.
    open: {
      true: {
        panel:
          "max-wide:grid max-wide:grid-cols-1 max-wide:gap-3 max-wide:rounded-surface max-wide:bg-sunken max-wide:p-3",
      },
    },
  },
});

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
  // The pause applies the search through the newest `update`, which holds the
  // newest query: a chip or county picked while typing must survive it.
  const latestUpdate = useRef<(patch: Partial<ListingQuery>) => void>(() => {});
  useEffect(() => {
    if (text === (query.q ?? "")) return;
    const timer = window.setTimeout(
      () => latestUpdate.current({ q: text || undefined, page: 1 }),
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
  latestUpdate.current = update;

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
        <Heading
          level="page"
          id="browse-title"
          lead={`Second-hand wingfoil gear, bought and sold across all ${COUNTIES.length} counties.`}
        >
          Market
        </Heading>
        <form
          className={styles.search()}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: text || undefined });
          }}
        >
          <SearchField
            size="lg"
            enterKeyHint="search"
            aria-label="Search listings"
            placeholder="Brand, model or size…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          >
            {text && (
              <Button
                variant="quiet"
                size="sm"
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
        <Chip
          pressed={!query.category}
          onClick={() => update({ category: undefined })}
        >
          All gear
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            pressed={query.category === c.id}
            title={c.hint}
            onClick={() =>
              update({ category: query.category === c.id ? undefined : c.id })
            }
          >
            {c.label}
          </Chip>
        ))}
      </div>

      <div className={styles.filters()}>
        <Button
          variant="outline"
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
            {total == null
              ? "Loading listings…"
              : `${total.toLocaleString("en-IE")} listing${total === 1 ? "" : "s"}`}
          </h2>
          {tokens.length > 0 && (
            <div className={styles.active()}>
              {tokens.map((t) => (
                <Chip
                  key={t.key}
                  removable
                  aria-label={`Remove filter: ${t.label}`}
                  onClick={t.remove}
                >
                  {t.label}
                </Chip>
              ))}
              {tokens.length > 1 && (
                <Button variant="quiet" size="sm" onClick={clearAll}>
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
          icon={<SearchX size={24} strokeWidth={1.75} />}
          actions={
            active ? (
              <Button onClick={clearAll}>Clear all filters</Button>
            ) : (
              <Link
                to={paths.sell()}
                className={buttonStyles({ variant: "outline" })}
              >
                List your gear
              </Link>
            )
          }
        >
          <p>
            {active
              ? "Try a broader search, or take a filter off."
              : "Be the first to list something you no longer ride."}
          </p>
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
