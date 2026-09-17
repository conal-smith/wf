import { Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../api";
import {
  Empty,
  GridSkeleton,
  ListingGrid,
  LoadError,
  Pager,
  Select,
  TextInput,
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
      <section className="mk-hero" aria-labelledby="mk-browse-title">
        <h1 className="mk-title" id="mk-browse-title">
          Second-hand wingfoil gear, across Ireland
        </h1>
        <form
          className="f5-search mk-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: text || undefined });
          }}
        >
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Search listings"
            placeholder="Search by brand, model or size"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text && (
            <button
              type="button"
              className="f5-button f5-button--icon"
              aria-label="Clear search"
              onClick={() => setText("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </form>
      </section>

      <div className="mk-rail" role="group" aria-label="Category">
        <button
          type="button"
          className="f5-button f5-button--pill"
          aria-pressed={!query.category}
          onClick={() => update({ category: undefined })}
        >
          All gear
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="f5-button f5-button--pill"
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

      <div className="mk-filters" data-open={filtersOpen}>
        <button
          type="button"
          className="f5-button f5-button--pill mk-filters__toggle"
          aria-expanded={filtersOpen}
          aria-controls="mk-filters-panel"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters{folded ? ` (${folded})` : ""}
        </button>
        <div
          className="mk-filters__panel"
          id="mk-filters-panel"
          role="group"
          aria-label="Filters"
        >
          <Select
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
          <div className="mk-price-range" role="group" aria-label="Price">
            <TextInput
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
        <div className="mk-sort">
          <Select
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
        <div className="mk-results-head">
          <h2 className="mk-results-head__count" aria-live="polite">
            {total == null
              ? "Loading listings…"
              : `${total.toLocaleString("en-IE")} listing${total === 1 ? "" : "s"}`}
          </h2>
          {tokens.length > 0 && (
            <div className="mk-results-head__active">
              {tokens.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="mk-token"
                  aria-label={`Remove filter: ${t.label}`}
                  onClick={t.remove}
                >
                  {t.label}
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
              {tokens.length > 1 && (
                <button
                  type="button"
                  className="f5-button f5-button--link"
                  onClick={clearAll}
                >
                  Clear all
                </button>
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
          icon={<SearchX size={24} aria-hidden="true" />}
        >
          <p>
            {active
              ? "Try a broader search, or take a filter off."
              : "Be the first to list something you no longer ride."}
          </p>
          <div className="mk-empty__actions">
            {active ? (
              <button
                type="button"
                className="f5-button f5-button--pill"
                onClick={clearAll}
              >
                Clear all filters
              </button>
            ) : (
              <Link to={paths.sell()} className="f5-button f5-button--pill">
                List your gear
              </Link>
            )}
          </div>
        </Empty>
      ) : (
        <>
          <ListingGrid listings={result.data.items} busy={result.loading} />
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
