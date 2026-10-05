import { StarGlyphs } from "../ui/StarGlyphs";
import { StarTip } from "./StarTip";
import {
  ESTIMATE_WEIGHT_KG,
  SESSION_LABEL,
  SHORE_LABEL,
  starsText,
  windBand,
  type Rider,
} from "../force5/src/stars";
import { compass } from "../force5/src/weather";
import { ShoreGlyph, WindArrow } from "./glyphs";
import type { PlaceHour } from "./ratings";
import { clock, dayShort } from "./strip";

const SKILL_WORD: Record<Rider["skill"], string> = {
  beginner: "learning",
  intermediate: "intermediate",
  advanced: "advanced",
};

/** Who the stars are for, in figures: "80 kg intermediate · best 14–24 kn". */
export function riderLine(rider: Rider) {
  const band = windBand(rider);
  const kg = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  return `${rider.weightKg === null ? "~" : ""}${kg} kg ${SKILL_WORD[rider.skill]} · best ${Math.round(band.sweetLow)}–${Math.round(band.sweetHigh)} kn`;
}

/** Why an hour has the stars it has: the card the stars open. */
export function RatingDetail({
  hour,
  time,
  facing,
  rider,
}: {
  hour: PlaceHour;
  time: number;
  facing: number | null;
  rider: Rider;
}) {
  const r = hour.rating;
  if (!r) return null;
  const wing = r.wing.own ?? r.wing.recommended;
  return (
    <div className="rating-detail">
      <div className="rd-head">
        <span>
          {dayShort(time)} · {clock(time)}
        </span>
        <StarGlyphs stars={r.stars} potential={r.potential} size={12} />
      </div>
      <p className="rd-verdict">
        <i>{SESSION_LABEL[r.session]}</i>
        {r.potential > 0 && (
          <>
            {" "}
            on a <b>{wing} m</b>
          </>
        )}
      </p>
      <ul>
        {hour.from !== null && hour.windKn !== null && (
          <li>
            <WindArrow from={hour.from} size={12} /> {compass(hour.from)}{" "}
            {Math.round(hour.windKn)}
            {hour.gustKn !== null && ` g${Math.round(hour.gustKn)}`} kn
            {r.liftKn >= 0.95 && (
              <>
                {" "}
                → rides like <b>{Math.round(r.rideKn)}</b>
              </>
            )}
          </li>
        )}
        {hour.from !== null && (
          <li>
            <ShoreGlyph from={hour.from} facing={facing} size={15} />{" "}
            {r.shore ? SHORE_LABEL[r.shore] : "facing unknown: wind alone"}
          </li>
        )}
        {r.reasons.map((reason) => (
          <li key={reason} className="rd-reason">
            − {reason}
          </li>
        ))}
        {!r.reasons.length && r.stars === r.potential && (
          <li className="rd-none">Nothing taken off</li>
        )}
      </ul>
      <p className="rd-foot">
        <span>{riderLine(rider)}</span>
        <a href="/stars">How?</a>
      </p>
    </div>
  );
}

/** An hour's stars, with their explanation on hover, focus or a tap. */
export function HourStars({
  hour,
  time,
  facing,
  rider,
  size = 9.5,
  slots = "five",
  compact = false,
}: {
  hour: PlaceHour | undefined;
  time: number;
  facing: number | null;
  rider: Rider;
  size?: number;
  /** "potential" stops at the last faded star, for a narrow cell. */
  slots?: "five" | "potential";
  /** The figure instead of the glyphs, for the narrowest cells. */
  compact?: boolean;
}) {
  const r = hour?.rating;
  if (!hour || !r) return null;
  return (
    <StarTip
      label={`${clock(time)}: ${
        r.potential
          ? starsText(r)
          : `No stars, ${SESSION_LABEL[r.session].toLowerCase()}`
      }`}
      detail={
        <RatingDetail hour={hour} time={time} facing={facing} rider={rider} />
      }
    >
      {compact ? (
        <span className="stars-n" aria-hidden="true">
          {r.stars}
          <small>★</small>
        </span>
      ) : (
        <StarGlyphs
          stars={r.stars}
          potential={r.potential}
          size={size}
          slots={slots}
        />
      )}
    </StarTip>
  );
}
