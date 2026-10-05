import type { ReactNode } from "react";
import { ArrowDown, ArrowUpRight, MapPin, TriangleAlert } from "lucide-react";
import { Button } from "../../ui";
import {
  SKILL_LABEL,
  type MapAction,
  type SpotCardData,
  type WindowChip,
} from "../shared/protocol";

/** Solid stars for the rating, outlines for what a kinder day would add. */
export function Stars({
  stars,
  potential = stars,
  className = "",
}: {
  stars: number;
  potential?: number;
  className?: string;
}) {
  const label = `${stars} of 5 star${stars === 1 ? "" : "s"}${potential > stars ? `, ${potential} possible` : ""}`;
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center tracking-tight ${className}`}
    >
      <span aria-hidden="true" className="text-ink">
        {"★".repeat(stars)}
      </span>
      <span aria-hidden="true" className="text-ink-disabled">
        {"☆".repeat(Math.max(0, potential - stars))}
      </span>
      {stars === 0 && potential === 0 && (
        <span aria-hidden="true" className="text-ink-muted">
          –
        </span>
      )}
    </span>
  );
}

const OFFSHORE = /offshore/;

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-eyebrow text-ink-muted uppercase">{label}</dt>
      <dd className="m-0 truncate text-prose font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

export interface SpotCardProps {
  card: SpotCardData;
  /** One line of facts and a Show button: the runners-up under a full card. */
  compact?: boolean;
  /** Move the map: select the spot and go to a window. */
  onShow: (actions: MapAction[]) => void;
}

/**
 * A spot, rated: the best window's stars and the wind behind them, the wing
 * to take, and the other good windows as chips. Every number here comes from
 * the forecast tool, never from Gust's prose.
 */
export function SpotCard({ card, onShow, compact = false }: SpotCardProps) {
  const best = card.best;
  const show = (window: WindowChip | null) =>
    onShow([
      { type: "select_spot", id: card.id },
      ...(window ? [{ type: "set_time", iso: window.from } as const] : []),
    ]);
  const offshore = best?.shore ? OFFSHORE.test(best.shore) : false;
  if (compact)
    return (
      <article
        className="flex items-center gap-3 rounded-control border border-line bg-card px-4 py-3 font-sans text-ink shadow-control"
        aria-label={`${card.name}, ${card.county}`}
        data-spot-card={card.id}
      >
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-baseline gap-2">
            <span className="truncate text-prose leading-tight font-semibold">
              {card.name}
            </span>
            <span className="shrink-0 text-caption text-ink-muted">
              {card.county}
            </span>
          </p>
          {best ? (
            <p className="m-0 truncate text-caption text-ink-2">
              <Stars stars={best.stars} potential={best.potential} />{" "}
              {best.local.replace(/^(\w+), \d+ \w+, /, "$1 ")} · {best.wind_kn}{" "}
              kn {best.direction} · {best.own_wing_m2 ?? best.wing_m2} m²
              {offshore && <span className="text-warn"> · {best.shore}</span>}
            </p>
          ) : (
            <p className="m-0 text-caption text-ink-muted">{card.note}</p>
          )}
        </div>
        <Button
          variant="pill"
          size="sm"
          icon
          aria-label={`Show ${card.name} on the map`}
          title="Show on map"
          onClick={() => show(best)}
        >
          <MapPin size={14} aria-hidden="true" />
        </Button>
      </article>
    );
  return (
    <article
      className="flex flex-col gap-3 rounded-control border border-line bg-card p-4 font-sans text-ink shadow-control"
      aria-label={`${card.name}, ${card.county}`}
      data-spot-card={card.id}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-prose leading-tight font-semibold">
            {card.name}
          </h3>
          <p className="m-0 text-caption text-ink-muted">{card.county}</p>
        </div>
        {best && (
          <Stars
            stars={best.stars}
            potential={best.potential}
            className="shrink-0 text-lead"
          />
        )}
      </header>

      {best ? (
        <>
          <p className="m-0 text-body font-semibold text-ink-2">
            {best.local}
            <span className="font-normal text-ink-muted">
              {" "}
              · {best.session}
            </span>
          </p>
          <dl className="m-0 grid grid-cols-4 gap-2">
            <Fact label="Wind" value={`${best.wind_kn} kn`} />
            <Fact
              label="Gusts"
              value={best.gust_kn === null ? "–" : `${best.gust_kn} kn`}
            />
            <Fact
              label="From"
              value={
                <span className="inline-flex items-center gap-1">
                  <ArrowDown
                    size={13}
                    aria-hidden="true"
                    style={{ transform: `rotate(${best.direction_deg}deg)` }}
                  />
                  {best.direction}
                </span>
              }
            />
            <Fact
              label={best.own_wing_m2 !== null ? "Your wing" : "Wing"}
              value={`${best.own_wing_m2 ?? best.wing_m2} m²`}
            />
          </dl>
          {best.shore && (
            <p
              className={[
                "m-0 inline-flex items-center gap-1 self-start rounded-full px-2 py-1 text-caption",
                offshore ? "bg-warn-ground text-warn" : "bg-sunken text-ink-2",
              ].join(" ")}
            >
              {offshore && <TriangleAlert size={12} aria-hidden="true" />}
              {best.shore[0].toUpperCase() + best.shore.slice(1)}
              {offshore && ": blows you away from the beach"}
            </p>
          )}
        </>
      ) : (
        <p className="m-0 text-body text-ink-muted">{card.note}</p>
      )}

      {card.windows.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-eyebrow text-ink-muted uppercase">
            Other windows
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
            {card.windows.map((w) => (
              <li key={w.from}>
                <Button
                  variant="pill"
                  size="sm"
                  className="text-caption font-normal"
                  onClick={() => show(w)}
                  aria-label={`Show ${card.name} at ${w.local}, ${w.stars} stars`}
                >
                  {w.local.replace(/^(\w+), \d+ \w+, /, "$1 ")}
                  <Stars stars={w.stars} className="text-caption" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        <Button variant="pill" size="sm" onClick={() => show(best)}>
          <MapPin size={14} aria-hidden="true" />
          Show on map
        </Button>
        <Button
          variant="quiet"
          size="sm"
          href={`/spot/${encodeURIComponent(card.id)}`}
        >
          Spot page
          <ArrowUpRight size={14} aria-hidden="true" />
        </Button>
        <span className="ml-auto text-caption text-ink-muted">
          {card.rider.weightKg} kg{card.rider.assumed ? " (assumed)" : ""} ·{" "}
          {SKILL_LABEL[card.rider.skill]}
        </span>
      </footer>
    </article>
  );
}
