import type { ReactNode } from "react";
import { ArrowDown, ArrowUpRight, MapPin, TriangleAlert } from "lucide-react";
import { Button, Figure, Kicker, StarGlyphs } from "../../ui";
import { MONO_LABEL } from "../../ui/tv";
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
  size = 11,
}: {
  stars: number;
  potential?: number;
  size?: number;
}) {
  return <StarGlyphs stars={stars} potential={potential} size={size} />;
}

const OFFSHORE = /offshore/;

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={["text-ink-muted", MONO_LABEL].join(" ")}>{label}</dt>
      <dd className="m-0 truncate">{value}</dd>
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
        className="flex items-center gap-3 border-0 border-b border-line py-2.5 font-body text-ink"
        aria-label={`${card.name}, ${card.county}`}
        data-spot-card={card.id}
      >
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-baseline gap-2">
            <span className="truncate font-display text-prose leading-tight font-semibold italic">
              {card.name}
            </span>
            <span className={["shrink-0 text-ink-muted", MONO_LABEL].join(" ")}>
              {card.county}
            </span>
          </p>
          {best ? (
            <p className="m-0 flex items-center gap-1.5 truncate font-mono text-caption text-ink-2 tabular-nums">
              <Stars stars={best.stars} potential={best.potential} size={9} />
              {best.local.replace(/^(\w+), \d+ \w+, /, "$1 ")} · {best.wind_kn}{" "}
              kn {best.direction} · {best.own_wing_m2 ?? best.wing_m2} m²
              {offshore && <span className="text-warn"> · {best.shore}</span>}
            </p>
          ) : (
            <p className="m-0 font-body text-caption text-ink-muted italic">
              {card.note}
            </p>
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
          <MapPin size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </article>
    );
  return (
    <article
      className="flex flex-col gap-3 rounded-surface border border-ink bg-card paper-grain p-4 font-body text-ink inset-shadow-frame shadow-card"
      aria-label={`${card.name}, ${card.county}`}
      data-spot-card={card.id}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 truncate font-display text-lead leading-tight font-semibold italic">
            {card.name}
          </h3>
          <Kicker>{card.county}</Kicker>
        </div>
        {best && (
          <Stars stars={best.stars} potential={best.potential} size={14} />
        )}
      </header>

      {best ? (
        <>
          <p className="m-0 font-mono text-caption font-semibold text-ink tabular-nums">
            {best.local}
          </p>
          <dl className="m-0 grid grid-cols-3 gap-2 border-0 border-t border-line pt-2">
            <Fact
              label="Wind"
              value={
                <Figure
                  value={Math.round(best.wind_kn)}
                  sup={
                    best.gust_kn === null ? undefined : Math.round(best.gust_kn)
                  }
                  unit="kn"
                  label={`${best.wind_kn} knots${best.gust_kn === null ? "" : `, gusting ${best.gust_kn}`}`}
                />
              }
            />
            <Fact
              label="From"
              value={
                <span className="inline-flex items-center gap-1 font-mono text-body font-semibold">
                  <ArrowDown
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    style={{ transform: `rotate(${best.direction_deg}deg)` }}
                  />
                  {best.direction}
                </span>
              }
            />
            <Fact
              label={best.own_wing_m2 !== null ? "Your wing" : "Wing"}
              value={
                <Figure value={best.own_wing_m2 ?? best.wing_m2} unit="m²" />
              }
            />
          </dl>
          {best.shore && (
            <p
              className={[
                "m-0 inline-flex items-center gap-1 self-start rounded-full border px-2 py-0.5 font-mono text-caption",
                offshore
                  ? "border-warn bg-warn-ground text-warn"
                  : "border-line bg-sunken text-ink-2",
              ].join(" ")}
            >
              {offshore && (
                <TriangleAlert size={12} strokeWidth={1.5} aria-hidden="true" />
              )}
              {best.shore[0].toUpperCase() + best.shore.slice(1)}
              {offshore && ": blows you away from the beach"}
            </p>
          )}
        </>
      ) : (
        <p className="m-0 font-body text-body text-ink-2 italic">{card.note}</p>
      )}

      {card.windows.length > 0 && (
        <div className="flex flex-col gap-1">
          <Kicker>Other windows</Kicker>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
            {card.windows.map((w) => (
              <li key={w.from}>
                <Button
                  variant="pill"
                  size="sm"
                  className="gap-1.5 tabular-nums"
                  onClick={() => show(w)}
                  aria-label={`Show ${card.name} at ${w.local}, ${w.stars} stars`}
                >
                  {w.local.replace(/^(\w+), \d+ \w+, /, "$1 ")}
                  <Stars stars={w.stars} size={8} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        <Button variant="pill" size="sm" onClick={() => show(best)}>
          <MapPin size={14} strokeWidth={1.5} aria-hidden="true" />
          Show on map
        </Button>
        <Button
          variant="link"
          size="sm"
          href={`/spot/${encodeURIComponent(card.id)}`}
        >
          Spot page
          <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <span className="ml-auto font-mono text-caption text-ink-muted tabular-nums">
          {card.rider.weightKg} kg{card.rider.assumed ? " (assumed)" : ""} ·{" "}
          {SKILL_LABEL[card.rider.skill]}
        </span>
      </footer>
    </article>
  );
}
