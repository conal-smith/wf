/**
 * "How the stars work", at /stars: the rating in figures, for the rider the
 * page is set to. The wind you can ride, what it is worth against your band,
 * the five ways the wind meets a beach and what each costs, solid and faded,
 * the dark, the wing, and one hour from the live forecast worked through line
 * by line. The arithmetic is force5/src/stars.ts, read here rather than
 * restated, except the ledger (ledger.ts), which is tested against it.
 *
 * `?spot=<id>` picks the place the worked example comes from; the map's "?"
 * can pass the one in view.
 */
import { useEffect, useMemo, useState } from "react";
import { loadPrefs, saveRider } from "../../force5/src/prefs";
import { onPrefsChange } from "../../shared/web/riderSync";
import { shoreFacing } from "../../force5/src/shoreFacing";
import { mapSpotHref, spotHref } from "../../force5/src/siteNav";
import {
  SKILLS,
  directionCosts,
  gustCurve,
  rateOn,
  rideableWind,
  savedCustom,
  starsText,
  windBand,
  windScore,
  type Rider,
  type Skill,
} from "../../force5/src/stars";
import {
  findSpot,
  loadSpots,
  spotForecast,
  type RidingSpot,
  type SpotForecast,
} from "../../mcp/api/forecast";
import { siteSource } from "../../shared/web/forecastSource";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Headline,
  PenNote,
  SectionHeading,
  Skeleton,
  StarGlyphs,
  headlineStyles,
} from "../../ui";
import { MONO_LABEL, tv } from "../../ui/tv";
import { SpotFrame } from "./Frame";
import { ledger, type Ledger } from "./ledger";
import { RiderSwitch, SKILL_LABEL, riderWords } from "./RiderSwitch";
import { HOUR, clock, dayNames, dublinDate } from "./spot";
import { useWidth } from "./useWidth";

const styles = tv({
  slots: {
    main: "flex flex-col gap-4 pt-4 pb-12",
    deck: "m-0 font-body text-lead font-normal text-ink-2 italic",
    // The key: the glyphs in a column of their own, the words beside them,
    // so the three lines start together.
    glyphs:
      "m-0 grid list-none grid-cols-meter items-center gap-x-3 gap-y-2 p-0 font-body text-body text-ink-2",
    glyph: "col-span-3 grid grid-cols-subgrid items-center",
    glyphMark: "flex",
    dark: ["text-ink-muted", MONO_LABEL],
    section: "flex flex-col gap-2 pt-4",
    p: "m-0 font-body text-prose text-ink-2",
    examples: "m-0 list-none p-0 font-body text-prose text-ink-2",
    figures: "m-0 font-mono text-caption text-ink-muted tabular-nums",
    table: "w-full border-collapse font-body text-body",
    th: [
      "border-0 border-b border-ink px-1.5 py-1 text-left whitespace-nowrap text-ink-muted",
      MONO_LABEL,
    ],
    td: "border-0 border-b border-line px-1.5 py-1.5 align-top text-ink",
    num: "font-mono text-caption whitespace-nowrap tabular-nums",
    you: "bg-chart-magenta/7",
    // A sector's name and its degrees each hold together; on a phone the
    // degrees go under the name rather than breaking as "0–" and "30°".
    sector: "whitespace-nowrap",
    degrees:
      "ml-1 font-mono text-caption whitespace-nowrap text-ink-muted max-wide:ml-0 max-wide:block",
    // On a phone the costs may wrap, between the words their non-breaking
    // spaces leave free, so the first column keeps room for its words.
    wraps: "max-wide:whitespace-normal",
    when: "w-1/2",
    total: "border-t-2 border-ink font-semibold",
    right: "text-right",
    chart: "block select-none",
    small: "m-0 font-body text-body text-ink-muted italic",
    link: "rounded-control text-ink underline underline-offset-4 hover:text-chart-magenta",
  },
});

/** Where the worked example comes from, unless the address names a place. */
const DEFAULT_SPOT = "brandon";

export default function StarsPage() {
  usePageTitle("How the stars work", "Wind map");
  const s = styles();
  const h = headlineStyles();
  const [rider, setRider] = useState<Rider>(() => loadPrefs().rider);
  useEffect(() => onPrefsChange(() => setRider(loadPrefs().rider)), []);
  const changeRider = (next: Rider) => setRider(saveRider(next).rider);
  const named = new URLSearchParams(window.location.search).get("spot");
  const spotId = named ?? DEFAULT_SPOT;
  const [chartRef, width] = useWidth<HTMLElement>(640);

  // Back to the spot the reader came from, or to the chart as it opens: the
  // worked example's place is not one to send them to.
  return (
    <SpotFrame back={named ? mapSpotHref(named) : "/"}>
      <main className={s.main()} ref={chartRef}>
        <Headline>
          How the stars <em className={h.soft()}>work</em>
        </Headline>
        <p className={s.deck()}>
          We rate every daylight hour out of five stars. The rating depends on
          your level and your weight, so set those first.
        </p>
        <RiderSwitch rider={rider} onChange={changeRider} />
        <ul className={s.glyphs()}>
          <li className={s.glyph()}>
            <span className={s.glyphMark()}>
              <StarGlyphs stars={3} potential={5} size={14} />
            </span>
            <span className="col-span-2">
              Solid stars are the rating. Outlined stars are what the wind speed
              alone would have earned, before anything was taken off.
            </span>
          </li>
          <li className={s.glyph()}>
            <span className={s.glyphMark()}>
              <StarGlyphs stars={1} potential={2} size={14} />
            </span>
            <span className="col-span-2">
              A dot is a star out of reach: not even the wind speed alone would
              have earned it.
            </span>
          </li>
          <li className={s.glyph()}>
            {/* A dark hour draws no stars at all; what stands for it on the
                spot page is its fold, so that is the mark here. */}
            <span className={s.dark()} aria-hidden="true">
              Dark
            </span>
            <span className="col-span-2">
              Hours in the dark are not rated: from sunset to sunrise they are
              folded away, and draw no stars.
            </span>
          </li>
        </ul>

        <section className={s.section()} aria-labelledby="ride">
          <SectionHeading id="ride">
            1. The steady wind, <em className="font-normal">not the gusts</em>
          </SectionHeading>
          <p className={s.p()}>
            The stars rate the steady wind, the average: it is what holds you up
            on the foil, and what decides whether a session is on. Below your
            minimum a gust is a chance to get up, so it can lift the hour to
            your minimum, worth a star, and no further. Above it, the gusts take
            stars off only when they are strong (section 4).
          </p>
          <p className={s.p()}>
            Learners get the smallest boost, because they still drop off the
            foil in the lulls.
          </p>
          <RideExamples rider={rider} />
        </section>

        <section className={s.section()} aria-labelledby="band">
          <SectionHeading id="band">
            2. How much wind <em className="font-normal">suits you</em>
          </SectionHeading>
          <p className={s.p()}>
            Each level has its own range. Below the minimum you cannot stay up
            on the foil for long. In the middle of the sweet spot the hour gets
            five stars. Past the maximum it is more than you will want to hold.
          </p>
          <ScoreChart rider={rider} width={width} />
          <BandTable rider={rider} />
        </section>

        <section className={s.section()} aria-labelledby="beach">
          <SectionHeading id="beach">
            3. Wind <em className="font-normal">direction</em>
          </SectionHeading>
          <p className={s.p()}>
            What matters is the angle between the wind and the beach. Onshore
            wind blows straight in from the sea. Offshore wind blows straight
            out to sea, and that is the dangerous one: if you fall or break
            something, it carries you away from land.
          </p>
          <Sectors width={width} />
          <ShoreTable rider={rider} />
          <p className={s.p()}>
            Cross-offshore costs learners the most, because a learner drifts
            downwind and ends up further out. An advanced rider can get back
            upwind, so it costs them least. Offshore costs the most stars of
            all.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="off">
          <SectionHeading id="off">
            4. What else <em className="font-normal">takes stars off</em>
          </SectionHeading>
          <p className={s.p()}>
            Strong gusts. It is how strong a gust is that counts, not how far it
            runs over the average: up to the first figure it costs nothing, then
            more and more, to the most from the second.
          </p>
          <GustTable rider={rider} />
          <OtherTable />
          <p className={s.small()}>
            Hover over or tap an hour&rsquo;s stars to see what it lost, and
            why.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="wing">
          <SectionHeading id="wing">
            5. Which <em className="font-normal">wing</em>
          </SectionHeading>
          <p className={s.p()}>
            We suggest a wing size for every hour. For an 80 kg rider that is
            about 5.5 m² at 15 knots, 4.5 m² at 20 knots and 3 m² at 30 knots.
            Learners get a size bigger, advanced riders a little smaller.
          </p>
          <p className={s.p()}>
            If you have told us which wings you own, we pick the smallest one
            that is big enough. If none of them suits the wind, the hour loses a
            star.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="example">
          <SectionHeading id="example">
            6. An <em className="font-normal">example</em>
          </SectionHeading>
          <p className={s.p()}>
            One hour from the live forecast, worked through step by step.
          </p>
          <WorkedExample spotId={spotId} rider={rider} />
        </section>

        <p className={s.small()}>wingfoil.ie star rating, version 4.</p>
      </main>
    </SpotFrame>
  );
}

function RideExamples({ rider }: { rider: Rider }) {
  const s = styles();
  const pairs: [number, number][] = [
    [9, 17],
    [12, 20],
    [18, 27],
  ];
  return (
    <ul className={s.examples()} data-ride-examples>
      {pairs.map(([w, g]) => (
        <li key={w}>
          {w} knots gusting {g} is rated as{" "}
          <b>{rideableWind(w, g, rider).toFixed(1)} knots</b>
        </li>
      ))}
    </ul>
  );
}

const chartStyles = tv({
  slots: {
    sweet: "fill-chart-magenta/8",
    grid: "stroke-ink/10",
    axis: "fill-ink-muted font-mono text-eyebrow tabular-nums",
    line: "fill-none stroke-ink",
    mark: "stroke-chart-magenta/60",
    markText: "fill-chart-magenta font-mono text-eyebrow",
    cursor: "stroke-ink-muted",
    readout: "fill-ink font-mono text-caption font-semibold",
    dot: "fill-ink",
  },
});

/** About how wide a character of the eyebrow mono is, its tracking included. */
const EYEBROW_CHAR = 7.4;

/** Stars on the wind alone, against the wind you can ride, for this rider. */
function ScoreChart({ rider, width }: { rider: Rider; width: number }) {
  const c = chartStyles();
  const band = windBand(rider);
  const W = width;
  const H = 170;
  const left = 30;
  const right = 14;
  const X = (k: number) => left + (k / 40) * (W - left - right);
  const Y = (stars: number) => H - 24 - (stars / 5) * (H - 44);
  const [hover, setHover] = useState<number | null>(null);
  let path = "";
  for (let k = 0; k <= 40; k += 0.25)
    path += `${path ? "L" : "M"}${X(k).toFixed(1)} ${Y(windScore(k, band)).toFixed(1)}`;
  // The floor, the sweet spot and the ceiling are named in one row over the
  // plot, where the curve never reaches: beside their lines inside it,
  // "minimum 10" sat on the curve's climb on a phone. The floor's name ends at
  // its line and the ceiling's starts at its own, each kept inside the chart,
  // and the sweet spot's sits between them, clear of both.
  const narrow = W < 520;
  const minText = `${narrow ? "min" : "minimum"} ${Math.round(band.min)}`;
  const maxText = `${narrow ? "max" : "maximum"} ${Math.round(band.max)}`;
  const textWidth = (text: string) => text.length * EYEBROW_CHAR;
  const minEnd = Math.max(X(0) + textWidth(minText), X(band.min) - 4);
  const maxStart = Math.min(W - 2 - textWidth(maxText), X(band.max) + 4);
  const half = textWidth("sweet spot") / 2;
  const names = {
    min: minEnd,
    max: maxStart,
    sweet: Math.min(
      Math.max((X(band.sweetLow) + X(band.sweetHigh)) / 2, minEnd + 8 + half),
      maxStart - 8 - half,
    ),
  };
  const label = `Stars on the wind alone for ${riderWords(rider)}: none below ${Math.round(band.min - 2)} kn, five from ${Math.round(band.sweetLow + (band.sweetHigh - band.sweetLow) / 4)} to ${Math.round(band.sweetHigh - (band.sweetHigh - band.sweetLow) / 4)} kn, two at ${Math.round(band.max)} kn, none past ${Math.round(band.max + 6)}.`;
  return (
    <svg
      className={styles().chart()}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const k = ((event.clientX - box.left - left) / (W - left - right)) * 40;
        setHover(k < 0 || k > 40 ? null : Math.round(k));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <rect
        className={c.sweet()}
        x={X(band.sweetLow)}
        y={Y(5)}
        width={X(band.sweetHigh) - X(band.sweetLow)}
        height={Y(0) - Y(5)}
      />
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <g key={n}>
          <line className={c.grid()} x1={X(0)} x2={X(40)} y1={Y(n)} y2={Y(n)} />
          <text className={c.axis()} x={X(0) - 6} y={Y(n) + 3} textAnchor="end">
            {n}★
          </text>
        </g>
      ))}
      {(W < 520 ? [0, 10, 20, 30, 40] : [0, 5, 10, 15, 20, 25, 30, 35, 40]).map(
        (k) => (
          <text
            key={k}
            className={c.axis()}
            x={X(k)}
            y={H - 8}
            textAnchor={k === 40 ? "end" : "middle"}
          >
            {k === 40 ? "40 kn" : k}
          </text>
        ),
      )}
      <path className={c.line()} d={path} strokeWidth={1.8} />
      {[band.min, band.max].map((k) => (
        <line
          key={k}
          className={c.mark()}
          x1={X(k)}
          x2={X(k)}
          y1={Y(5)}
          y2={Y(0)}
          strokeDasharray="3 3"
        />
      ))}
      <text
        className={c.markText()}
        x={names.min}
        y={Y(5) - 5}
        textAnchor="end"
      >
        {minText}
      </text>
      <text
        className={c.markText()}
        x={names.sweet}
        y={Y(5) - 5}
        textAnchor="middle"
      >
        sweet spot
      </text>
      <text className={c.markText()} x={names.max} y={Y(5) - 5}>
        {maxText}
      </text>
      {hover !== null && (
        <g aria-hidden="true">
          <line
            className={c.cursor()}
            x1={X(hover)}
            x2={X(hover)}
            y1={Y(5)}
            y2={Y(0)}
          />
          <circle
            className={c.dot()}
            cx={X(hover)}
            cy={Y(windScore(hover, band))}
            r={3}
          />
          <text
            className={c.readout()}
            x={X(hover) > W - 120 ? X(hover) - 6 : X(hover) + 6}
            y={Y(0) - 6}
            textAnchor={X(hover) > W - 120 ? "end" : "start"}
          >
            {hover} kn → {windScore(hover, band).toFixed(1)}★
          </text>
        </g>
      )}
    </svg>
  );
}

function BandTable({ rider }: { rider: Rider }) {
  const s = styles();
  const kg = rider.weightKg ?? 80;
  return (
    <>
      <table className={s.table()} data-band-table>
        <thead>
          <tr>
            <th className={s.th()}>Level</th>
            <th className={s.th()}>Minimum</th>
            <th className={s.th()}>Sweet spot</th>
            <th className={s.th()}>Maximum</th>
          </tr>
        </thead>
        <tbody>
          {[...SKILLS, ...(savedCustom(rider) ? (["yours"] as const) : [])].map(
            (skill) => {
              const band = windBand(columnRider(rider, skill));
              const you = skill === (rider.custom ? "yours" : rider.skill);
              return (
                <tr key={skill} className={you ? s.you() : undefined}>
                  <td className={s.td()}>
                    {skill === "yours" ? "Your own" : SKILL_LABEL[skill]}{" "}
                    {you && (
                      <PenNote as="span" size="sm">
                        you
                      </PenNote>
                    )}
                  </td>
                  <td className={s.td({ className: s.num() })}>
                    {Math.round(band.min)}
                  </td>
                  <td className={s.td({ className: s.num() })}>
                    {Math.round(band.sweetLow)}–{Math.round(band.sweetHigh)}
                  </td>
                  <td className={s.td({ className: s.num() })}>
                    {Math.round(band.max)}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
      <p className={s.figures()}>
        In knots, for someone who weighs {kg} kg. Heavier riders need more wind,
        lighter riders less.
      </p>
    </>
  );
}

/** A level's own rating for this rider's weight, without their custom one. */
const standard = (rider: Rider, skill: Skill): Rider => ({
  ...rider,
  skill,
  custom: null,
  keptCustom: null,
});

/** The levels as columns, and the rider's own after them when they have one, rating or kept. */
type Column = Skill | "yours";
const columns = (rider: Rider): Column[] => [
  ...SKILLS,
  ...(savedCustom(rider) ? (["yours"] as const) : []),
];
const columnRider = (rider: Rider, column: Column) =>
  column === "yours" ? rateOn(rider, "custom") : standard(rider, column);
const isYou = (rider: Rider, column: Column) =>
  column === (rider.custom ? "yours" : rider.skill);
const columnName = (column: Column) =>
  column === "yours" ? "Yours" : SKILL_LABEL[column];

/** The five ways the wind meets a beach, as stars.ts `shoreAngle` cuts them. */
const SECTORS = [
  {
    from: 0,
    to: 30,
    name: "onshore",
    key: "onshore",
    words: "Onshore",
    away: false,
    tint: 0.55,
  },
  {
    from: 30,
    to: 70,
    name: "cross-on",
    key: "crossOn",
    words: "Cross-onshore",
    away: false,
    tint: 0.32,
  },
  {
    from: 70,
    to: 110,
    name: "cross",
    key: "cross",
    words: "Cross-shore",
    away: false,
    tint: 0.16,
  },
  {
    from: 110,
    to: 150,
    name: "cross-off",
    key: "crossOff",
    words: "Cross-offshore",
    away: true,
    tint: 0.22,
  },
  {
    from: 150,
    to: 180,
    name: "offshore",
    key: "offshore",
    words: "Offshore",
    away: true,
    tint: 0.42,
  },
] as const;

/**
 * Stars off as the table sets them: "−1½ stars", "none". A non-breaking space
 * holds each figure to its word, so a phone's narrow column can wrap a cost
 * but never ends a line on "−1".
 */
function starsOff(off: number): string {
  if (!off) return "none";
  const whole = Math.floor(off);
  const figure = `−${whole || ""}${off % 1 ? "½" : ""}`;
  return `${figure}\u00a0star${off === 1 ? "" : "s"}`;
}

const sectorStyles = tv({
  slots: {
    sea: "fill-sea-3",
    land: "fill-land",
    toward: "fill-depth stroke-card",
    away: "fill-pen stroke-card",
    shore: "stroke-ink",
    deg: "fill-ink-muted font-mono text-eyebrow",
    name: "fill-ink stroke-card font-body text-body italic",
    seaWord: "fill-depth font-mono text-eyebrow",
    landWord: "fill-relief font-mono text-eyebrow",
    beach: "fill-ink",
    beachWord: "fill-ink font-mono text-eyebrow",
  },
});

function Sectors({ width }: { width: number }) {
  const c = sectorStyles();
  const R = 118;
  // The sea and the land reach this far past the dial, room for its degrees
  // and their names; the figure is drawn to hold all of that, so "SEA" and
  // "0°" are not cut off at its top.
  const PAD = 24;
  const cx = 160;
  const cy = R + PAD;
  const H = 2 * (R + PAD);
  const D = Math.PI / 180;
  const pt = (a: number, r: number) =>
    [cx + Math.sin(a * D) * r, cy - Math.cos(a * D) * r] as const;
  const wedge = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0, R);
    const [x1, y1] = pt(a1, R);
    return `M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`;
  };
  const size = Math.min(380, width);
  return (
    <svg
      className={styles().chart({ className: "mx-auto" })}
      width={size}
      height={(size * H) / 320}
      viewBox={`0 0 320 ${H}`}
      role="img"
      aria-label="The wind against the beach, measured from straight onshore: onshore within 30 degrees, cross-onshore 30 to 70, cross-shore 70 to 110, cross-offshore 110 to 150, offshore from 150 to 180, either side."
      data-sectors
    >
      <rect
        className={c.sea()}
        x={cx - R - 30}
        y={cy - R - PAD}
        width={2 * R + 60}
        height={R + PAD}
      />
      <rect
        className={c.land()}
        x={cx - R - 30}
        y={cy}
        width={2 * R + 60}
        height={R + PAD}
      />
      {SECTORS.map((sector) =>
        [wedge(sector.from, sector.to), wedge(-sector.to, -sector.from)].map(
          (d, i) => (
            <path
              key={`${sector.name}-${i}`}
              className={sector.away ? c.away() : c.toward()}
              d={d}
              fillOpacity={sector.tint}
              strokeWidth={1}
            />
          ),
        ),
      )}
      <line
        className={c.shore()}
        x1={cx - R - 30}
        x2={cx + R + 30}
        y1={cy}
        y2={cy}
        strokeWidth={2}
      />
      {[0, 30, 70, 110, 150, 180].flatMap((a) =>
        (a === 0 || a === 180 ? [a] : [a, -a]).map((b) => {
          const [x, y] = pt(b, R + 11);
          return (
            <text
              key={b}
              className={c.deg()}
              x={x}
              y={y + 3}
              textAnchor="middle"
            >
              {a}°
            </text>
          );
        }),
      )}
      {SECTORS.map((sector) => {
        const [x, y] = pt((sector.from + sector.to) / 2, R * 0.66);
        // Cross-shore's middle is the beach line itself: its name sits just
        // above it, on the sea, rather than on the line, struck through.
        const below = sector.name === "cross" ? -5 : 4;
        return (
          <text
            key={sector.name}
            className={c.name()}
            x={x}
            y={y + below}
            textAnchor="middle"
            paintOrder="stroke"
            strokeWidth={3}
          >
            {sector.name}
          </text>
        );
      })}
      <text className={c.seaWord()} x={cx - R - 24} y={cy - R - 10}>
        SEA
      </text>
      <text className={c.landWord()} x={cx - R - 24} y={cy + R + 18}>
        LAND
      </text>
      <circle className={c.beach()} cx={cx} cy={cy} r={3} />
      <text className={c.beachWord()} x={cx + 8} y={cy - 6}>
        beach
      </text>
    </svg>
  );
}

function ShoreTable({ rider }: { rider: Rider }) {
  const s = styles();
  return (
    <table className={s.table()} data-shore-table>
      <thead>
        <tr>
          <th className={s.th()}>Wind</th>
          {columns(rider).map((column) => (
            <th
              key={column}
              className={s.th({
                className: isYou(rider, column) ? s.you() : undefined,
              })}
            >
              {columnName(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SECTORS.map((sector) => (
          <tr key={sector.name}>
            <td className={s.td()}>
              <span className={s.sector()}>{sector.words}</span>
              <span className={s.degrees()}>
                {sector.from}–{sector.to}°
              </span>
            </td>
            {columns(rider).map((column) => (
              <td
                key={column}
                className={s.td({
                  className: [
                    s.num(),
                    s.wraps(),
                    isYou(rider, column) ? s.you() : "",
                  ],
                })}
              >
                {starsOff(
                  directionCosts(columnRider(rider, column))[sector.key],
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The gusts' curve for each level, at this rider's weight, and theirs. */
function GustTable({ rider }: { rider: Rider }) {
  const s = styles();
  const rows: [string, (column: Column) => string][] = [
    [
      "No effect up to",
      (column) =>
        `${Math.round(gustCurve(columnRider(rider, column)).fine)}\u00a0kn`,
    ],
    [
      "Most off from",
      (column) =>
        `${Math.round(gustCurve(columnRider(rider, column)).worst)}\u00a0kn`,
    ],
    [
      "Most off",
      (column) => starsOff(gustCurve(columnRider(rider, column)).most),
    ],
  ];
  return (
    <table className={s.table()} data-gust-table>
      <thead>
        <tr>
          <th className={s.th()}>Gusts</th>
          {columns(rider).map((column) => (
            <th
              key={column}
              className={s.th({
                className: isYou(rider, column) ? s.you() : undefined,
              })}
            >
              {columnName(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([what, figure]) => (
          <tr key={what}>
            <td className={s.td()}>{what}</td>
            {columns(rider).map((column) => (
              <td
                key={column}
                className={s.td({
                  className: [
                    s.num(),
                    s.wraps(),
                    isYou(rider, column) ? s.you() : "",
                  ],
                })}
              >
                {figure(column)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The rest, the same for every level. */
function OtherTable() {
  const s = styles();
  const rows: [string, string][] = [
    ["The forecast models disagree", "−1\u00a0star"],
    ["The models differ a little", "−¼\u00a0star"],
    ["None of your wings suits the wind", "−1\u00a0star"],
  ];
  return (
    <table className={s.table()} data-other-table>
      <thead>
        <tr>
          <th className={s.th({ className: s.when() })}>If</th>
          <th className={s.th()}>Every level</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([when, cost]) => (
          <tr key={when}>
            <td className={s.td()}>{when}</td>
            <td className={s.td({ className: [s.num(), s.wraps()] })}>
              {cost}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Example =
  | { kind: "loading" }
  | { kind: "none"; message: string }
  | { kind: "ready"; spot: RidingSpot; forecast: SpotForecast };

/** The forecast for the example's place, the next two days, hourly. */
function useExample(spotId: string): Example {
  const [state, setState] = useState<Example>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    (async () => {
      const source = siteSource();
      const spots = await loadSpots(source);
      const spot =
        spots.find((place) => place.id === spotId) ??
        findSpot(spots, DEFAULT_SPOT).spot;
      if (!spot)
        return {
          kind: "none",
          message: "No place to take an example from.",
        } as const;
      const now = Date.now();
      const from = Math.floor(now / HOUR) * HOUR;
      const forecast = await spotForecast(
        source,
        spot,
        { from, to: from + 48 * HOUR, stepHours: 1 },
        { now },
      );
      return { kind: "ready", spot, forecast } as const;
    })().then(
      (next) => live && setState(next),
      () =>
        live &&
        setState({
          kind: "none",
          message: "The forecast could not be read just now.",
        }),
    );
    return () => {
      live = false;
    };
  }, [spotId]);
  return state;
}

/**
 * The hour to work through: one that lost a star to something, so there is
 * something to show; else the best; else the first daylight hour.
 */
function pickHour(forecast: SpotForecast, facing: number | null, rider: Rider) {
  const worked = forecast.hours.flatMap((hour) => {
    if (!hour.daylight || !hour.wind) return [];
    const w = hour.wind;
    const result = ledger(
      {
        windKn: w.wind_kn,
        gustKn: w.gust_kn,
        from: w.direction_deg,
        agreement: w.agreement,
      },
      facing,
      rider,
    );
    return result ? [{ hour, result }] : [];
  });
  const cut = worked.filter(
    ({ result }) => result.stars > 0 && result.stars < result.potential,
  );
  const pool = cut.length ? cut : worked;
  return pool.reduce<(typeof pool)[number] | null>(
    (best, x) => (!best || x.result.stars > best.result.stars ? x : best),
    null,
  );
}

function WorkedExample({ spotId, rider }: { spotId: string; rider: Rider }) {
  const s = styles();
  const example = useExample(spotId);
  const facing = example.kind === "ready" ? shoreFacing(example.spot.id) : null;
  const picked = useMemo(
    () =>
      example.kind === "ready"
        ? pickHour(example.forecast, facing, rider)
        : null,
    [example, facing, rider],
  );
  if (example.kind === "loading")
    return <Skeleton shape="block" className="min-h-40" />;
  if (example.kind === "none")
    return <p className={s.small()}>{example.message}</p>;
  if (!picked)
    return (
      <p className={s.small()}>
        There is no daylight hour with a forecast at {example.spot.name} in the
        next two days to show.
      </p>
    );
  const { hour, result } = picked;
  const time = Date.parse(hour.time);
  const w = hour.wind!;
  const now = Date.now();
  return (
    <>
      <LedgerTable
        title={`${example.spot.name}, ${dayNames(dublinDate(time), now).short} ${clock(time)}`}
        reading={`${w.direction} ${w.wind_kn.toFixed(1)} g${w.gust_kn === null ? "–" : w.gust_kn.toFixed(1)} kn`}
        ledger={result}
      />
      <p className={s.figures()}>
        <StarGlyphs
          stars={result.rating.stars}
          potential={result.rating.potential}
          size={14}
          label={starsText(result.rating)}
        />{" "}
        on the{" "}
        <a className={s.link()} href={spotHref(example.spot.id)}>
          spot page
        </a>
        , for {riderWords(rider)}.
      </p>
    </>
  );
}

function LedgerTable({
  title,
  reading,
  ledger: worked,
}: {
  title: string;
  reading: string;
  ledger: Ledger;
}) {
  const s = styles();
  return (
    <table className={s.table()} data-ledger>
      <tbody>
        <tr>
          <th
            scope="row"
            className={s.td({ className: "text-left font-normal" })}
          >
            {title}
          </th>
          <td className={s.td({ className: [s.num(), s.right()] })}>
            {reading}
          </td>
        </tr>
        {worked.lines.map((line) => (
          <tr key={line.what}>
            <th
              scope="row"
              className={s.td({
                className: [
                  "text-left font-normal",
                  line.total ? s.total() : "",
                ],
              })}
            >
              {line.what}
            </th>
            <td
              className={s.td({
                className: [s.num(), s.right(), line.total ? s.total() : ""],
              })}
            >
              {line.figure}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
