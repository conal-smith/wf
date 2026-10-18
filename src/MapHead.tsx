import { useId, useMemo, useRef, useState } from "react";
import { SearchField } from "../ui/SearchField";
import { StarGlyphs } from "../ui/StarGlyphs";
import { Wordmark } from "../ui/Wordmark";
import { SiteMenu } from "../force5/src/SiteMenu";
import type { Spot } from "../force5/src/weather";
import { hourWind, type PlaceHour } from "./ratings";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * The chart's head, top left: the site menu, the name, and "Find a spot…",
 * whose list opens under the box as the reader types.
 */
export default function MapHead({
  spots,
  starred,
  hourAt,
  onPick,
}: {
  spots: readonly Spot[];
  starred: readonly string[];
  /** A place's rated hour at the time the map shows, where there is one. */
  hourAt: (id: string) => PlaceHour | null;
  onPick: (spot: Spot) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** The list closes a moment after the field loses focus, so a tap on it lands. */
  const closing = useRef(0);
  const list = useId();
  const hits = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return [];
    return spots
      .filter(
        (s) =>
          fold(s.name).includes(q) ||
          fold(s.county ?? "").startsWith(q) ||
          (s.aliases ?? []).some((a) => fold(a).includes(q)),
      )
      .sort(
        (a, b) =>
          Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) ||
          Number(starred.includes(b.id)) - Number(starred.includes(a.id)) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 9);
  }, [query, spots, starred]);
  const pick = (spot: Spot) => {
    setQuery("");
    setOpen(false);
    input.current?.blur();
    onPick(spot);
  };
  const showing = open && query.trim().length > 0;
  return (
    <header className="map-head chart-box">
      <SiteMenu current="map" size="sm" />
      <a className="map-brand" href="/" aria-label="wingfoil.ie, the chart">
        <Wordmark size="sm" />
      </a>
      <div className="find">
        <SearchField
          ref={input}
          size="md"
          aria-label="Find a spot"
          placeholder="Find a spot…"
          autoComplete="off"
          role="combobox"
          aria-expanded={showing}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={
            showing && hits[active] ? `${list}-${active}` : undefined
          }
          value={query}
          onChange={(event) => {
            clearTimeout(closing.current);
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            clearTimeout(closing.current);
            setOpen(true);
          }}
          onBlur={() => {
            clearTimeout(closing.current);
            closing.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (query) setQuery("");
              else input.current?.blur();
              event.stopPropagation();
              return;
            }
            if (!hits.length) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(
                (i) =>
                  (i + (event.key === "ArrowDown" ? 1 : -1) + hits.length) %
                  hits.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(hits[active]);
            }
          }}
        />
        {showing && (
          <ul id={list} className="results chart-box" role="listbox" aria-label="Spots">
            {hits.length ? (
              hits.map((spot, i) => {
                const hour = hourAt(spot.id);
                return (
                  <li
                    key={spot.id}
                    id={`${list}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="spot-row"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      pick(spot);
                    }}
                  >
                    <b>{spot.name}</b>
                    <small>{spot.county}</small>
                    {hour?.rating && (
                      <span className="spot-hour">
                        <StarGlyphs
                          stars={hour.rating.stars}
                          potential={hour.rating.potential}
                          size={10}
                        />
                        <span>{hourWind(hour)}</span>
                      </span>
                    )}
                  </li>
                );
              })
            ) : (
              <li className="none">No spot by that name.</li>
            )}
          </ul>
        )}
      </div>
    </header>
  );
}
