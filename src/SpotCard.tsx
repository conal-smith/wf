import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { spotHref } from "../force5/src/siteNav";
import type { Rider } from "../force5/src/stars";
import { convert, type Units } from "../force5/src/units";
import { compass, type Spot } from "../force5/src/weather";
import { HourStars } from "./RatingDetail";
import {
  FacingCompass,
  ShoreGlyph,
  StarToggle,
  StarsHelp,
  TideWave,
  WindArrow,
} from "./glyphs";
import type { PlaceHour } from "./ratings";
import { clock, dayShort } from "./strip";

/**
 * The popup on a light: the selected hour at a glance, in figures and
 * glyphs, the star that keeps the spot, and the way to its page.
 */
export default function SpotCard({
  spot,
  time,
  hour,
  tide,
  starred,
  onToggleStar,
  onClose,
  rider,
  units,
}: {
  spot: Spot;
  time: number | null;
  hour: PlaceHour | undefined;
  tide: number | null;
  starred: boolean;
  onToggleStar: () => void;
  onClose: () => void;
  rider: Rider;
  units: Units;
}) {
  const speed = (kn: number) => Math.round(convert(kn / 1.94384449, units));
  const r = hour?.rating;
  return (
    <section
      className="spot-card"
      role="dialog"
      aria-label={`${spot.name} at a glance`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="sc-top">
        <StarToggle on={starred} name={spot.name} onToggle={onToggleStar} />
        <h3>{spot.name}</h3>
        <button
          type="button"
          className="sc-close"
          aria-label="Close spot information"
          onClick={onClose}
        >
          <X size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="sc-meta">
        <FacingCompass facing={spot.facing} size={16} />
        {spot.county && <span>{spot.county}</span>}
      </div>
      {time !== null && (
        <div className="sc-when">
          <span className="when">
            {dayShort(time)} {clock(time)}
          </span>
          {r ? (
            <HourStars
              hour={hour}
              time={time}
              facing={spot.facing ?? null}
              rider={rider}
              size={13}
            />
          ) : (
            <span className="sc-dark">
              {hour && !hour.daylight ? "dark" : hour ? "" : "…"}
            </span>
          )}
          <StarsHelp />
        </div>
      )}
      {hour && hour.windKn !== null && (
        <p className="sc-line">
          {hour.from !== null && <WindArrow from={hour.from} />}
          <b>{speed(hour.windKn)}</b>
          {hour.gustKn !== null && <span>g{speed(hour.gustKn)}</span>}
          {hour.from !== null && <span>{compass(hour.from)}</span>}
          {hour.from !== null && (
            <ShoreGlyph from={hour.from} facing={spot.facing} size={15} />
          )}
          {r?.potential ? (
            <>
              <span aria-hidden="true">·</span>
              <b>{r.wing.own ?? r.wing.recommended}</b>
              <span>m</span>
            </>
          ) : null}
        </p>
      )}
      {tide !== null && (
        <p className="sc-line">
          <TideWave />
          <span>{tide.toFixed(1)} m</span>
        </p>
      )}
      <div className="sc-acts">
        <Button
          variant="primary"
          size="sm"
          href={spotHref(spot.id)}
          data-spot-page-link
        >
          Spot page →
        </Button>
      </div>
    </section>
  );
}
