/**
 * The top bar's search: a field that finds a riding place as the rider types,
 * on every page that has the bar (ui/TopBar.tsx). An ARIA combobox: the field
 * owns a list box of results under it, the arrow keys move through them, Enter
 * picks, Escape clears and then closes, and "/" anywhere on the page comes to
 * it. With nothing typed it offers the rider's own spots and the ones they
 * look at most. There are about 150 places, so the list is filtered at once,
 * with no wait between a key and its results (shared/web/spotSearch.ts).
 *
 * On a phone the field folds into a round button; pressed, it opens as a
 * field the width of the screen over the bar, with the results under it.
 *
 * What a pick does is the page's: the finder and a spot's page go to the
 * spot's page; the chart flies to the spot and opens it there.
 */
import { Search, X } from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { favourites } from "../shared/web/favourites";
import { findSpots, matchIn, type Findable } from "../shared/web/spotSearch";
import { Button } from "./Button";
import { NO_RING, tv } from "./tv";

export const spotSearchStyles = tv({
  slots: {
    root: "relative min-w-0",
    // The field: a soft grey pill that widens a little and comes onto the
    // ground, with an ink edge, while it is in use.
    field: [
      "flex h-control-md w-80 min-w-0 items-center gap-2 rounded-full border border-transparent bg-well pr-2.5 pl-3.5",
      "font-body text-body text-ink-muted transition-all duration-fast motion-reduce:transition-none",
      "focus-within:w-100 focus-within:border-ink focus-within:bg-ground focus-within:ring-3 focus-within:ring-focus/20",
      "max-wide:hidden",
      // A phone's search, opened: a field the width of the screen over the bar.
      "group-data-phone/search:max-wide:fixed group-data-phone/search:max-wide:inset-x-0 group-data-phone/search:max-wide:top-0",
      "group-data-phone/search:max-wide:z-dialog group-data-phone/search:max-wide:flex group-data-phone/search:max-wide:h-14",
      "group-data-phone/search:max-wide:w-full group-data-phone/search:max-wide:rounded-none group-data-phone/search:max-wide:border-0",
      "group-data-phone/search:max-wide:border-b group-data-phone/search:max-wide:border-line group-data-phone/search:max-wide:bg-ground",
      "group-data-phone/search:max-wide:px-safe-4",
    ],
    input: [
      "h-full w-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0",
      "font-body text-body text-ink placeholder:text-ink-muted placeholder:opacity-100",
      "pointer-coarse:text-input",
      NO_RING,
    ],
    key: "rounded-mark border border-line px-1.5 font-body text-label font-medium text-ink-muted",
    clear: "size-7 pointer-coarse:size-9",
    cancel: "hidden group-data-phone/search:max-wide:inline-flex",
    // On a phone, the round button the field folds into.
    open: "wide:hidden",
    // The results: a sheet under the field; on a phone, the screen under the
    // field opened over the bar.
    panel: [
      "absolute top-12 left-0 z-dialog flex w-full min-w-95 flex-col rounded-surface bg-ground p-1.5 text-ink shadow-sheet ring-1 ring-line",
      "max-h-120",
      "max-wide:fixed max-wide:inset-x-0 max-wide:top-14 max-wide:bottom-0 max-wide:max-h-none max-wide:min-w-0",
      "max-wide:rounded-none max-wide:p-2 max-wide:pb-safe-4 max-wide:shadow-none max-wide:ring-0",
    ],
    // The results scroll between the panel's edges; the foot stays.
    list: "min-h-0 flex-1 overflow-y-auto overscroll-contain",
    groupName:
      "px-2.5 pt-2 pb-1.5 font-body text-label font-medium text-ink-muted",
    option: [
      "flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 max-wide:min-h-13",
      "aria-selected:bg-well",
    ],
    words: "grid min-w-0 flex-1 gap-0.5",
    name: "min-w-0 truncate font-body text-prose font-semibold text-ink",
    mark: "bg-transparent text-inherit underline decoration-chart-magenta decoration-2 underline-offset-3",
    county: "min-w-0 truncate font-body text-label text-ink-muted",
    detail:
      "flex shrink-0 flex-col items-end gap-0.75 font-body text-body font-semibold text-ink",
    none: "px-2.5 py-4 font-body text-prose text-ink-2",
    // Said to a screen reader as the results change.
    status: "sr-only",
    foot: "flex shrink-0 justify-between gap-3 border-0 border-t border-line px-2.5 pt-2 pb-1 font-body text-label text-ink-muted max-wide:hidden",
  },
});

/** The results a query shows at once. */
const SHOWN = 8;
/** The rider's own spots offered with nothing typed. */
const OFFERED = 6;

export interface SpotSearchProps<S extends Findable> {
  /** The places, where the page has them already. */
  spots?: readonly S[];
  /** Else, how to read them: asked the first time the search is opened. */
  load?: () => Promise<readonly S[]>;
  onPick: (spot: S) => void;
  /** The right of a result, where it is cheap: today's wind and stars. */
  describe?: (spot: S) => ReactNode;
  /** What `describe` shows, said at the foot. */
  describeLabel?: string;
  /** What Enter does, said at the foot. */
  enterLabel?: string;
  className?: string;
}

interface Group<S> {
  name: string;
  spots: S[];
}

/** The site's own list of places, read once and kept, for a page without them. */
let shared: Promise<Findable[]> | null = null;
export function loadPlaces(): Promise<Findable[]> {
  shared ??= fetch(`${import.meta.env.BASE_URL}riding-locations.json`)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<unknown>;
    })
    .then((rows) =>
      Array.isArray(rows)
        ? rows.flatMap((row): Findable[] =>
            row && typeof row.id === "string" && typeof row.name === "string"
              ? [
                  {
                    id: row.id,
                    name: row.name,
                    county: typeof row.county === "string" ? row.county : "",
                  },
                ]
              : [],
          )
        : [],
    )
    .catch((e) => {
      shared = null;
      throw e;
    });
  return shared;
}

/** The query's part of a name, underlined. */
function Named({ name, query }: { name: string; query: string }) {
  const at = matchIn(name, query);
  if (!at) return <>{name}</>;
  return (
    <>
      {name.slice(0, at[0])}
      <mark className={spotSearchStyles().mark()}>
        {name.slice(at[0], at[1])}
      </mark>
      {name.slice(at[1])}
    </>
  );
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function SpotSearch<S extends Findable>({
  spots: given,
  load,
  onPick,
  describe,
  describeLabel,
  enterLabel = "Enter opens the forecast",
  className,
}: SpotSearchProps<S>) {
  const s = spotSearchStyles();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState<readonly S[] | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const spots = given ?? loaded;

  const fav = favourites();
  // The same snapshot on a server render, where there is no storage.
  const favState = useSyncExternalStore(fav.subscribe, fav.get, fav.get);

  const want = open || phone;
  useEffect(() => {
    if (!want || given || loaded || failed) return;
    let current = true;
    (load ?? (loadPlaces as unknown as () => Promise<readonly S[]>))().then(
      (rows) => current && setLoaded(rows),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [want, given, loaded, failed, load]);

  const typed = query.trim().length > 0;
  const groups: Group<S>[] = useMemo(() => {
    if (!spots) return [];
    if (typed)
      return [
        {
          name: "Spots",
          spots: findSpots(spots, query, favState.starred).slice(0, SHOWN),
        },
      ];
    const byId = new Map(spots.map((spot) => [spot.id, spot]));
    const starred = favState.starred
      .map((x) => byId.get(x))
      .filter((x): x is S => !!x)
      .slice(0, OFFERED);
    const recent = fav
      .frequent(OFFERED)
      .map((v) => byId.get(v.id))
      .filter((x): x is S => !!x && !favState.starred.includes(x.id))
      .slice(0, Math.max(0, OFFERED - starred.length));
    return [
      { name: "Your spots", spots: starred },
      { name: "You look at", spots: recent },
    ].filter((g) => g.spots.length);
  }, [spots, query, typed, favState]);
  const options = groups.flatMap((g) => g.spots);
  const at = Math.min(active, Math.max(0, options.length - 1));

  // "/" from anywhere on the page that is not a field: to the search.
  useEffect(() => {
    const slash = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (typing(event.target) || event.defaultPrevented) return;
      // Not under a dialog: the page behind it is not the rider's to search.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (window.matchMedia?.("(max-width: 719px)").matches) setPhone(true);
      input.current?.focus();
    };
    window.addEventListener("keydown", slash);
    return () => window.removeEventListener("keydown", slash);
  }, []);

  // The phone's field takes the focus as it opens over the bar.
  useEffect(() => {
    if (phone) input.current?.focus();
  }, [phone]);

  const close = (back = false) => {
    setOpen(false);
    setActive(0);
    if (phone) {
      setPhone(false);
      if (back) opener.current?.focus();
    }
  };
  const pick = (spot: S) => {
    setQuery("");
    close();
    input.current?.blur();
    onPick(spot);
  };

  const showing = want && (typed || options.length > 0 || !spots);
  // The result the keys are on stays in view as they move through a long list.
  useEffect(() => {
    if (showing && typeof document !== "undefined")
      document
        .getElementById(`${listId}-${at}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [showing, at, listId]);
  const status = !spots
    ? failed
      ? "The spots could not be read just now."
      : "Loading the spots…"
    : typed
      ? options.length
        ? options.length === 1
          ? "1 spot"
          : `${options.length} spots`
        : `No spots match “${query.trim()}”`
      : "";

  return (
    <div
      ref={root}
      className={s.root({ className: ["group/search", className] })}
      data-phone={phone || undefined}
      data-spot-search
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (to instanceof Node && root.current?.contains(to)) return;
        // A phone's search stays open over the bar until it is cancelled.
        if (!phone) close();
      }}
    >
      <div className={s.field()}>
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          inputMode="search"
          className={s.input()}
          placeholder="Search spots"
          aria-label="Search spots"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showing && options[at] ? `${listId}-${at}` : undefined
          }
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) {
                // The words go, and the list with them; the field stays.
                setQuery("");
                setActive(0);
                setOpen(false);
              } else {
                close(true);
                if (!phone) input.current?.blur();
              }
              return;
            }
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
              return;
            }
            if (!options.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const by = event.key === "ArrowDown" ? 1 : -1;
              setActive((at + by + options.length) % options.length);
            } else if (event.key === "Enter" && showing) {
              event.preventDefault();
              pick(options[at]);
            }
          }}
          data-spot-search-field
        />
        {query ? (
          <Button
            variant="quiet"
            size="sm"
            icon
            className={s.clear()}
            aria-label="Clear the search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        ) : (
          !phone && (
            <kbd className={s.key()} aria-hidden="true">
              /
            </kbd>
          )
        )}
        <Button
          variant="quiet"
          size="sm"
          className={s.cancel()}
          onClick={() => {
            setQuery("");
            close(true);
          }}
        >
          Cancel
        </Button>
      </div>
      <Button
        ref={opener}
        icon
        className={s.open()}
        aria-label="Search spots"
        aria-expanded={phone}
        onClick={() => setPhone(true)}
        data-spot-search-open
      >
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      <span className={s.status()} role="status">
        {showing ? status : ""}
      </span>
      {showing && (
        <div className={s.panel()} data-spot-search-results>
          {spots && options.length > 0 ? (
            <div
              role="listbox"
              id={listId}
              aria-label="Spots"
              className={s.list()}
            >
              {groups.map((group, g) => {
                const first = groups
                  .slice(0, g)
                  .reduce((n, x) => n + x.spots.length, 0);
                const nameId = `${id}-g${g}`;
                return (
                  <Fragment key={group.name}>
                    <div role="group" aria-labelledby={nameId}>
                      <div
                        className={s.groupName()}
                        id={nameId}
                        role="presentation"
                      >
                        {group.name}
                      </div>
                      {group.spots.map((spot, k) => {
                        const index = first + k;
                        return (
                          <div
                            key={spot.id}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={index === at}
                            className={s.option()}
                            onPointerDown={(event) => event.preventDefault()}
                            onPointerMove={() =>
                              index !== at && setActive(index)
                            }
                            onClick={() => pick(spot)}
                            data-spot-option={spot.id}
                          >
                            <span className={s.words()}>
                              <span className={s.name()}>
                                <Named name={spot.name} query={query} />
                              </span>
                              {spot.county && (
                                <span className={s.county()}>
                                  {spot.county}
                                </span>
                              )}
                            </span>
                            {describe && (
                              <span className={s.detail()}>
                                {describe(spot)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <p className={s.none()} id={listId} data-spot-search-none>
              {status || "Type a spot’s name or its county."}
            </p>
          )}
          {spots && options.length > 0 && (
            <div className={s.foot()} aria-hidden="true">
              <span>{enterLabel}</span>
              {describe && describeLabel && <span>{describeLabel}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
