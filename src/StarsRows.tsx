import { Sailboat, Star } from "lucide-react";
import RowLabel from "./RowLabel";
import type { DockColumn } from "../force5/src/timeline";
import {
  ESTIMATE_WEIGHT_KG,
  SESSION_LABEL,
  SHORE_LABEL,
  starsText,
  type HourRating,
  type Rider,
  type StarWindow,
} from "../force5/src/stars";
import { dayLabel, timeLabel } from "../force5/src/weather";

interface Props {
  columns: readonly DockColumn[];
  ratings: readonly (HourRating | null)[];
  selected: number;
  rider: Rider;
  /** Null where the shore is not known well enough to rate against. */
  facing: number | null;
  showStars: boolean;
  showWing: boolean;
}

export const STARS_HELP =
  "How good each hour looks for wing foiling, out of five. Solid stars are what the hour is worth here; faded ones are what the wind alone would give if the direction, the gusts or the models had been kinder. Rated for the rider in Display options.";
export const WING_HELP =
  "The wing size the stars assume for that hour, in square metres: your own wing where you have listed them, otherwise what a rider of your weight and level would usually take.";

/** Solid stars, then faded ones, told apart by shape as well as by tone. */
export function StarGlyphs({
  stars,
  potential,
}: {
  stars: number;
  potential: number;
}) {
  return (
    <span
      className="stars-glyphs"
      role="img"
      aria-label={starsText({ stars, potential })}
    >
      {Array.from({ length: potential }, (_, index) => (
        <Star
          key={index}
          size={10}
          aria-hidden="true"
          className={index < stars ? "star-solid" : "star-faded"}
          fill={index < stars ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

/**
 * The best stretch still ahead, for the toolbar: its stars, when, and on what
 * wing. Selecting it takes the timeline there.
 */
export function BestWindow({
  window,
  rating,
  from,
  to,
  onShow,
}: {
  window: StarWindow;
  /** The rating of the window's first column, for the wing it assumes. */
  rating: HourRating;
  from: string;
  to: string;
  onShow: () => void;
}) {
  const wing = rating.wing.own ?? rating.wing.recommended;
  const when = `${dayLabel(from)} ${timeLabel(from)}–${timeLabel(to)}`;
  return (
    <button
      className="best-window"
      onClick={onShow}
      aria-label={`Best window: ${starsText({
        stars: window.stars,
        potential: window.stars,
      })}, ${when}, on a ${wing} square metre wing. Show it.`}
      title="The best stretch still ahead, rated on its weakest hour"
    >
      <StarGlyphs stars={window.stars} potential={window.stars} />
      <span>
        {when} · {wing} m²
      </span>
    </button>
  );
}

/** Everything a cell's stars rest on, in the words the tooltip uses. */
export function ratingTitle(rating: HourRating): string {
  const wing =
    rating.wing.own === null
      ? `${rating.wing.recommended} m² wing`
      : `your ${rating.wing.own} m² wing`;
  return [
    `${starsText(rating)} · ${SESSION_LABEL[rating.session]}`,
    rating.shore ? SHORE_LABEL[rating.shore] : null,
    wing,
    ...rating.reasons,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The two rows the stars add to the dock, under the wind and above the sea:
 * the rating per column and the wing it assumes. Dark columns stay empty rather
 * than rated zero — nobody is out there to be disappointed.
 */
export default function StarsRows({
  columns,
  ratings,
  selected,
  rider,
  facing,
  showStars,
  showWing,
}: Props) {
  const weight = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  const help = `${STARS_HELP} Now: ${weight} kg${
    rider.weightKg === null ? " (an estimate until you set yours)" : ""
  }, ${rider.skill}${
    rider.wings.length ? `, wings ${rider.wings.join(", ")} m²` : ""
  }.${
    facing === null
      ? " This spot's shore direction is not known well enough, so the wind direction is not rated here."
      : ` The shore is taken to face ${Math.round(facing)}°, estimated from the map.`
  }`;
  return (
    <tbody className="stars-rows">
      {showStars && (
        <tr className="stars-row">
          <th scope="row">
            <RowLabel
              glyph={<Star size={18} aria-hidden="true" />}
              label="Stars"
              help={help}
              unit={`${rider.weightKg === null ? "~" : ""}${weight} kg`}
            />
          </th>
          {columns.map((column, at) => {
            const rating = ratings[at];
            return (
              <td
                key={column.validTime}
                className={`stars-cell${selected === at ? " selected-hour" : ""}`}
                title={rating ? ratingTitle(rating) : "Dark or no wind reading"}
              >
                {/* A column is as wide as its hours, never as its content:
                  the session's name lives in the tooltip, not the cell. */}
                {rating ? (
                  rating.potential ? (
                    <StarGlyphs
                      stars={rating.stars}
                      potential={rating.potential}
                    />
                  ) : (
                    <span
                      className="stars-none"
                      role="img"
                      aria-label={`No stars: ${SESSION_LABEL[rating.session].toLowerCase()}`}
                    >
                      –
                    </span>
                  )
                ) : null}
              </td>
            );
          })}
        </tr>
      )}
      {showWing && (
        <tr className="stars-row wing-row">
          <th scope="row">
            <RowLabel
              glyph={<Sailboat size={18} aria-hidden="true" />}
              label="Wing"
              help={WING_HELP}
              unit="m²"
            />
          </th>
          {columns.map((column, at) => {
            const rating = ratings[at];
            const size = rating?.potential
              ? (rating.wing.own ?? rating.wing.recommended)
              : null;
            return (
              <td
                key={column.validTime}
                className={selected === at ? "selected-hour" : ""}
              >
                {size === null ? "" : size.toFixed(1)}
              </td>
            );
          })}
        </tr>
      )}
    </tbody>
  );
}
