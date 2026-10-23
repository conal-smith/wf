// Tidal stream curves for the channels the currents model cannot see.
//
// At 1-2 km an ocean model has the timing and direction of the tide right but
// not a narrow channel's speed: Strangford Narrows is land in the Marine
// Institute's grid, and a harbour mouth is a cell or two. For those places the
// pilotage guides publish what the stream does: its spring peak each way, and
// when it turns relative to high or low water at a reference port. This turns
// that, and the tide predictions the site already has for a station that keeps
// the port's time, into a speed and a direction at any hour.
//
// The shape between two turns is half a sine, zero at each turn and the peak
// half way, which is how a semi-diurnal stream rises and falls (the rule of
// thirds is the same curve, rounded). The peak is the spring rate scaled by
// that tide's range against the station's mean spring range: a stream's rate
// goes with the range, so a neap tide of half the range runs at about half the
// rate. A rough guide, as the figures it is made from are; never for safety.
import data from "./tidalStreams.json";
import type { TideCurve, TideEvent } from "./tides";

export type Stream = "flood" | "ebb";

export interface StreamTurn {
  /** The tide event at the station the turn is timed from. */
  at: "high" | "low";
  /** Minutes after that event (negative: before it) that the stream turns. */
  offsetMinutes: number;
  /** The stream that starts there. */
  begins: Stream;
}

export interface StreamDirection {
  /** The bearing the water runs towards, degrees true. */
  towards: number;
  /** The guides' rate at mean springs, knots. */
  springKnots: number;
}

export interface TidalStreamSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The tide station (marine/tides.json) the turns are timed from. */
  station: string;
  /** What the guides time it from, as they say it. */
  reference: string;
  /** When each stream starts, in a few words for the map's information. */
  timing: string;
  stationNote: string;
  turns: StreamTurn[];
  flood: StreamDirection;
  ebb: StreamDirection;
  /** How long the stream stands slack at a turn, where the guides say. */
  slackMinutes?: number;
  /** The station's mean spring range, metres, that `springKnots` belongs to. */
  springRangeMetres: number;
  springRangeNote: string;
  note: string;
  sources: { title: string; url: string }[];
}

export interface TidalStreamAt {
  stream: Stream;
  /** Within the guides' slack at a turn, or running under half a knot. */
  slack: boolean;
  knots: number;
  /** Where the water runs to, degrees true. */
  towards: number;
  /** The peak of this stream, at this tide's range. */
  peakKnots: number;
  /** This tide's range at the station, metres. */
  rangeMetres: number;
  /** When this stream began and when the next begins, ms. */
  from: number;
  until: number;
}

export const TIDAL_STREAM_SITES: readonly TidalStreamSite[] =
  data.sites as TidalStreamSite[];

/** Below this a stream reads as slack whatever the clock says. */
export const SLACK_KNOTS = 0.5;
/**
 * How far a tide's range may move its peak from the spring rate: a big spring
 * a little past it, the smallest neap no lower than this share of it. The
 * scaling is a rule of thumb, so it is not stretched to the extremes.
 */
export const RANGE_SCALE = [0.3, 1.2] as const;

const MINUTE = 60000;

/** Every turn the station's events give, in time order. */
export function streamTurns(
  site: Pick<TidalStreamSite, "turns">,
  events: readonly TideEvent[],
): { time: number; begins: Stream }[] {
  const turns: { time: number; begins: Stream }[] = [];
  for (const event of events)
    for (const turn of site.turns)
      if (turn.at === event.kind)
        turns.push({
          time: Date.parse(event.time) + turn.offsetMinutes * MINUTE,
          begins: turn.begins,
        });
  return turns
    .filter((turn) => Number.isFinite(turn.time))
    .sort((a, b) => a.time - b.time);
}

/**
 * The range of the tide a stream belongs to: the high water nearest the
 * middle of the stream, less the mean of the low waters either side of it.
 */
export function tideRange(
  events: readonly TideEvent[],
  middle: number,
): number | null {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  let high = -1;
  sorted.forEach((event, index) => {
    if (event.kind !== "high") return;
    if (
      high < 0 ||
      Math.abs(Date.parse(event.time) - middle) <
        Math.abs(Date.parse(sorted[high].time) - middle)
    )
      high = index;
  });
  if (high < 0) return null;
  const lows = [sorted[high - 1], sorted[high + 1]].filter(
    (event): event is TideEvent => event?.kind === "low",
  );
  if (!lows.length) return null;
  const low = lows.reduce((sum, event) => sum + event.height, 0) / lows.length;
  const range = sorted[high].height - low;
  return range > 0 ? range : null;
}

/**
 * The stream at a site at `time`, from its station's predicted tide, or null
 * outside the predictions (or where they do not bracket the hour with a turn
 * each side).
 */
export function tidalStreamAt(
  site: TidalStreamSite,
  curve: Pick<TideCurve, "events">,
  time: number,
): TidalStreamAt | null {
  const turns = streamTurns(site, curve.events);
  const next = turns.findIndex((turn) => turn.time > time);
  if (next <= 0) return null;
  const from = turns[next - 1];
  const until = turns[next];
  // Two turns of the same stream in a row: an event is missing.
  if (from.begins === until.begins) return null;
  const range = tideRange(curve.events, (from.time + until.time) / 2);
  if (range === null) return null;
  const scale = Math.min(
    RANGE_SCALE[1],
    Math.max(RANGE_SCALE[0], range / site.springRangeMetres),
  );
  const direction = site[from.begins];
  const peakKnots = direction.springKnots * scale;
  const knots =
    peakKnots *
    Math.sin((Math.PI * (time - from.time)) / (until.time - from.time));
  const half = ((site.slackMinutes ?? 0) / 2) * MINUTE;
  const slack =
    knots < SLACK_KNOTS || time - from.time < half || until.time - time < half;
  return {
    stream: from.begins,
    slack,
    knots,
    towards: direction.towards,
    peakKnots,
    rangeMetres: range,
    from: from.time,
    until: until.time,
  };
}
