import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "../api";
import {
  Empty,
  GridSkeleton,
  ListingGrid,
  Notice,
  Pager,
  Select,
  TextInput,
  useAsync,
  usePageTitle,
} from "../components";
import { navigate, paths, useLocation } from "../router";
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

  const active = Boolean(
    query.q ||
    query.category ||
    query.county ||
    query.condition ||
    query.minPriceCents != null ||
    query.maxPriceCents != null,
  );

  return (
    <>
      <section className="mk-hero" aria-labelledby="mk-browse-title">
        <div className="mk-hero__intro mk-stack--tight">
          <p className="mk-eyebrow">Free to list, free to browse</p>
          <h1 className="mk-title" id="mk-browse-title">
            Second-hand wingfoil gear, across Ireland
          </h1>
          <p className="mk-muted">
            Wings, boards, foils and the rest, sold by the people who ride the
            same spots. No fees, no middlemen: find it here, then deal directly
            with the seller.
          </p>
        </div>
        <form
          className="f5-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: text || undefined });
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search listings"
            placeholder="Search by brand, model or size"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text && (
            <button
              type="button"
              className="f5-button f5-button--icon f5-button--sm"
              aria-label="Clear search"
              onClick={() => setText("")}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </form>
      </section>

      <div className="mk-chips" role="group" aria-label="Category">
        <button
          type="button"
          className="f5-button f5-button--pill f5-button--sm"
          aria-pressed={!query.category}
          onClick={() => update({ category: undefined })}
        >
          All gear
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="f5-button f5-button--pill f5-button--sm"
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

      <div className="mk-filters">
        <div className="mk-field">
          <label className="mk-field__label" htmlFor="mk-f-county">
            County
          </label>
          <Select
            id="mk-f-county"
            value={query.county ?? ""}
            onChange={(e) =>
              update({
                county: (e.target.value || undefined) as ListingQuery["county"],
              })
            }
          >
            <option value="">Anywhere</option>
            {COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="mk-field">
          <label className="mk-field__label" htmlFor="mk-f-condition">
            Condition
          </label>
          <Select
            id="mk-f-condition"
            value={query.condition ?? ""}
            onChange={(e) =>
              update({
                condition: (e.target.value ||
                  undefined) as ListingQuery["condition"],
              })
            }
          >
            <option value="">Any</option>
            {CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mk-field">
          <label className="mk-field__label" htmlFor="mk-f-min">
            Min price
          </label>
          <TextInput
            id="mk-f-min"
            prefix="€"
            inputMode="numeric"
            placeholder="0"
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === "Enter" && applyPrice()}
          />
        </div>
        <div className="mk-field">
          <label className="mk-field__label" htmlFor="mk-f-max">
            Max price
          </label>
          <TextInput
            id="mk-f-max"
            prefix="€"
            inputMode="numeric"
            placeholder="Any"
            value={maxText}
            onChange={(e) => setMaxText(e.target.value)}
            onBlur={applyPrice}
            onKeyDown={(e) => e.key === "Enter" && applyPrice()}
          />
        </div>
        <div className="mk-field">
          <label className="mk-field__label" htmlFor="mk-f-sort">
            Sort
          </label>
          <Select
            id="mk-f-sort"
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
        <p className="mk-caption mk-filters__count" aria-live="polite">
          {result.data
            ? `${result.data.total} listing${result.data.total === 1 ? "" : "s"}`
            : ""}
          {active && (
            <>
              {" · "}
              <button
                type="button"
                className="f5-button f5-button--link"
                onClick={() => {
                  setMinText("");
                  setMaxText("");
                  navigate(paths.browse(), { replace: true });
                }}
              >
                Clear filters
              </button>
            </>
          )}
        </p>
      </div>

      {result.error ? (
        <Notice kind="warn">
          {result.error}{" "}
          <button
            type="button"
            className="f5-button f5-button--link"
            onClick={result.reload}
          >
            Try again
          </button>
        </Notice>
      ) : result.loading && !result.data ? (
        <GridSkeleton />
      ) : result.data && result.data.items.length === 0 ? (
        <Empty
          title={active ? "Nothing matches those filters" : "No listings yet"}
        >
          <p className="mk-caption">
            {active
              ? "Widen the search or clear a filter."
              : "Be the first: list something you no longer ride."}
          </p>
        </Empty>
      ) : result.data ? (
        <>
          <ListingGrid listings={result.data.items} />
          <Pager
            page={result.data.page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            onPage={(p) => update({ page: p })}
          />
        </>
      ) : null}
    </>
  );
}
