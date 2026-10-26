/**
 * "How the stars work", at /stars: the rating in figures, for the rider the
 * page is set to. The one model the stars come from, the rider's choice, and
 * the others as context only; the four numbers the stars come from (ours, or
 * the rider's own from Customise) and what a steady wind is worth on them;
 * the gusts, read lighter; the five ways the wind meets a beach and what each
 * costs; the warnings that replace the stars; the dark; the wing; and one
 * hour from the live forecast worked through line by line. The arithmetic is
 * force5/src/stars.ts, read here rather than restated, except the ledger
 * (ledger.ts), which is tested against it.
 *
 * `?spot=<id>` picks the place the worked example comes from; the map's "?"
 * can pass the one in view.
 */
import { useEffect, useMemo, useState } from "react";
import { starsFromAt, leadText, type StarsChoice } from "../../force5/src/lead";
import { loadPrefs, saveRider } from "../../force5/src/prefs";
import { onPrefsChange } from "../../shared/web/riderSync";
import { shoreFacing } from "../../force5/src/shoreFacing";
import {
  CHART_HREF,
  CUSTOMISE_HREF,
  mapSpotHref,
  spotHref,
} from "../../force5/src/siteNav";
import {
  GUST_EASE_KN,
  NEVER,
  OURS,
  directionCosts,
  rateHour,
  starsText,
  windBand,
  windStars,
  type Rider,
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
import { RiderSwitch, riderWords } from "./RiderSwitch";
import { HOUR, clock, dayNames, dublinDate } from "./spot";
import { useWidth } from "./useWidth";
import { WarningMark } from "./Warnings";

const styles = tv({
  slots: {
    main: "flex flex-col gap-4 pt-4 pb-12",
    deck: "m-0 font-body text-lead font-normal text-ink-2 italic",
    // The key: the glyphs in a column of their own, the words beside them,
    // so the lines start together.
    glyphs:
      "m-0 grid list-none grid-cols-meter items-center gap-x-3 gap-y-2 p-0 font-body text-body text-ink-2",
    glyph: "col-span-3 grid grid-cols-subgrid items-center",
    glyphMark: "flex",
    dark: ["text-ink-muted", MONO_LABEL],
    section: "flex flex-col gap-2 pt-4",
    p: "m-0 font-body text-prose text-ink-2",
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
    // An example hour's stars, and what they come to in figures beside them.
    rated: "flex flex-wrap items-center gap-x-2 gap-y-0.5",
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
  const customise = (
    <a className={s.link()} href={CUSTOMISE_HREF} data-customise-link>
      Customise
    </a>
  );

  // Back to the spot the reader came from, or to the chart as it opens: the
  // worked example's place is not one to send them to.
  return (
    <SpotFrame back={named ? mapSpotHref(named) : CHART_HREF}>
      <main className={s.main()} ref={chartRef}>
        <Headline>
          How the stars <em className={h.soft()}>work</em>
        </Headline>
        <p className={s.deck()}>
          We rate every daylight hour out of five stars, from four numbers:
          ours, unless you have made them your own in Customise, from the site
          menu.
        </p>
        <RiderSwitch rider={rider} onChange={changeRider} />
        <ul className={s.glyphs()}>
          <li className={s.glyph()}>
            <span className={s.glyphMark()}>
              <StarGlyphs stars={3} potential={5} size={14} />
            </span>
            <span className="col-span-2">
              Solid stars are the rating. Outlined stars are stars the steady
              wind earned that the gusts or the shore took off, and nothing
              else.
            </span>
          </li>
          <li className={s.glyph()}>
            <span className={s.glyphMark()}>
              <StarGlyphs stars={1} potential={2} size={14} />
            </span>
            <span className="col-span-2">
              A dot is a star out of reach: not even the steady wind alone would
              have earned it.
            </span>
          </li>
          <li className={s.glyph()}>
            <span className={s.glyphMark()}>
              <WarningMark level="orange" />
            </span>
            <span className="col-span-2">
              An orange or red Met &Eacute;ireann warning replaces the stars for
              the hours it covers.
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

        <section className={s.section()} aria-labelledby="forecast">
          <SectionHeading id="forecast">
            1. One forecast, <em className="font-normal">your choice</em>
          </SectionHeading>
          <p className={s.p()}>
            Every hour is rated from one forecast model&rsquo;s own wind, gust
            and direction, never from a mix of several: the model you pick to
            see, on the map and here. Unless you pick another that is HARMONIE,
            Met &Eacute;ireann&rsquo;s 2 km model, for as far as its run reaches
            (about two and a half days). Past the end of any model&rsquo;s run
            ECMWF takes over, which runs fifteen days. Where one hands over to
            the other, the spot page says so between the hours.
          </p>
          <p className={s.p()}>
            Your stars now come from{" "}
            <b className="font-semibold" data-stars-from-text>
              {leadText(starsFromAt(rider.starsFrom))}
            </b>
            . Change the model above, under &ldquo;Model&rdquo;, or in the
            map&rsquo;s Display options: it is the same choice everywhere.
          </p>
          <p className={s.p()}>
            The other models are still shown: as faint ticks against your range
            in each hour&rsquo;s card, and as how far the models agree. That is
            context. It never changes the stars.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="band">
          <SectionHeading id="band">
            2. How much wind <em className="font-normal">suits you</em>
          </SectionHeading>
          <p className={s.p()}>
            The stars come from four numbers: too light, the two ends of the
            sweet spot, and too much, in gusts. Ours are {OURS.wind.min},{" "}
            {OURS.wind.sweetLow}&ndash;{OURS.wind.sweetHigh} and {OURS.wind.max}{" "}
            knots, and everyone starts from them. Move them in {customise}, from
            the site menu, and the stars are your own.
          </p>
          <BandTable rider={rider} />
          <p className={s.p()}>
            A steady wind under too light gets no stars. At too light it gets
            one, then a star a knot up to four; five through the sweet spot;
            then fewer, down to one star 5 knots under too much, and none from 3
            knots under it.
          </p>
          <ScoreChart rider={rider} width={width} />
        </section>

        <section className={s.section()} aria-labelledby="gusts">
          <SectionHeading id="gusts">
            3. The gusts, <em className="font-normal">read lighter</em>
          </SectionHeading>
          <p className={s.p()}>
            The stars rate the steady wind, the average: it is what holds you up
            on the foil. A gust past too much leaves the hour no stars at all,
            not even outlined ones. Otherwise the gust is read {GUST_EASE_KN}{" "}
            knots lighter, on the same scale as the steady wind, and if that is
            worth fewer stars the hour takes the lower. The stars it loses that
            way are drawn as outlines. There is nothing else to set for gusty
            wind.
          </p>
          <GustTable rider={rider} />
        </section>

        <section className={s.section()} aria-labelledby="beach">
          <SectionHeading id="beach">
            4. Wind <em className="font-normal">direction</em>
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
            Cross-offshore takes a star off unless you say otherwise: a drift
            downwind takes you out, not in. Offshore is never: no stars in any
            wind, for everyone, because we don&rsquo;t recommend going out in
            it. The rest cost nothing unless you set them to in {customise}.
            Stars the shore takes off are drawn as outlines.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="off">
          <SectionHeading id="off">
            5. What else <em className="font-normal">changes the stars</em>
          </SectionHeading>
          <p className={s.p()}>
            Only the warnings. Outlined stars only ever mean stars lost to the
            gusts or the shore; everything else is shown beside the stars and
            leaves them as they are.
          </p>
          <OtherTable />
          <p className={s.small()}>
            Hover over or tap an hour&rsquo;s stars to see what it lost, and
            why.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="wing">
          <SectionHeading id="wing">
            6. Which <em className="font-normal">wing</em>
          </SectionHeading>
          <p className={s.p()}>
            We suggest a wing size for every hour, from your weight. For an
            80&nbsp;kg rider that is about 5.5&nbsp;m² at 15 knots, 4.5&nbsp;m²
            at 20 knots and 3&nbsp;m² at 30 knots.
          </p>
          <p className={s.p()}>
            If you have told us which wings you own, we pick the smallest one
            that is big enough. Your weight and your wings never change the
            stars.
          </p>
        </section>

        <section className={s.section()} aria-labelledby="example">
          <SectionHeading id="example">
            7. An <em className="font-normal">example</em>
          </SectionHeading>
          <p className={s.p()}>
            One hour from the live forecast, worked through step by step.
          </p>
          <WorkedExample spotId={spotId} rider={rider} />
        </section>

        <p className={s.small()}>wingfoil.ie star rating, version 7.</p>
      </main>
    </SpotFrame>
  );
}

/**
 * Whose stars the page sets out: ours, and the rider's own beside them when
 * they have their own, theirs marked.
 */
interface Column {
  key: "ours" | "own";
  name: string;
  rider: Rider;
  you: boolean;
}
function columns(rider: Rider): Column[] {
  const ours: Column = {
    key: "ours",
    name: "Ours",
    rider: { ...rider, custom: null },
    you: !rider.custom,
  };
  return rider.custom
    ? [ours, { key: "own", name: "Your own", rider, you: true }]
    : [ours];
}

const knots = (value: number) => String(Number(value.toFixed(1)));

/** The four numbers, ours and the rider's own: "11", "15–22", "35". */
function BandTable({ rider }: { rider: Rider }) {
  const s = styles();
  return (
    <>
      <table className={s.table()} data-band-table>
        <thead>
          <tr>
            <th className={s.th()}>Stars</th>
            <th className={s.th()}>Too light</th>
            <th className={s.th()}>Sweet spot</th>
            <th className={s.th()}>Too much</th>
          </tr>
        </thead>
        <tbody>
          {columns(rider).map((column) => {
            const band = windBand(column.rider);
            return (
              <tr
                key={column.key}
                className={column.you ? s.you() : undefined}
                data-band={column.key}
              >
                <td className={s.td()}>
                  {column.name}{" "}
                  {column.you && (
                    <PenNote as="span" size="sm">
                      you
                    </PenNote>
                  )}
                </td>
                <td className={s.td({ className: s.num() })}>
                  {knots(band.min)}
                </td>
                <td className={s.td({ className: s.num() })}>
                  {knots(band.sweetLow)}–{knots(band.sweetHigh)}
                </td>
                <td className={s.td({ className: s.num() })}>
                  {knots(band.max)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={s.figures()}>
        In knots, too much in gusts. Your weight does not move them.
      </p>
    </>
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

/** Stars for a steady wind, against the wind, on the rider's four numbers. */
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
    path += `${path ? "L" : "M"}${X(k).toFixed(1)} ${Y(windStars(k, band)).toFixed(1)}`;
  // Too light, the sweet spot and too much are named in one row over the
  // plot, where the curve never reaches: beside their lines inside it, a
  // name sat on the curve's climb on a phone. Too light's name ends at its
  // line and too much's starts at its own, each kept inside the chart, and
  // the sweet spot's sits between them, clear of both.
  const narrow = W < 520;
  const minText = `${narrow ? "light" : "too light"} ${knots(band.min)}`;
  const maxText = `${narrow ? "much" : "too much"} ${knots(band.max)}`;
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
  const whose = rider.custom ? "on your own numbers" : "on ours";
  const label = `Stars for a steady wind, ${whose}: none below ${knots(band.min)} kn, one at ${knots(band.min)}, five from ${knots(band.sweetLow)} to ${knots(band.sweetHigh)} kn, one at ${knots(band.max - 5)} kn, none from ${knots(band.max - 3)}.`;
  const at = (k: number) => Math.round(windStars(k, band));
  return (
    <svg
      className={styles().chart()}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      data-score-chart
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
            cy={Y(windStars(hover, band))}
            r={3}
          />
          <text
            className={c.readout()}
            x={X(hover) > W - 120 ? X(hover) - 6 : X(hover) + 6}
            y={Y(0) - 6}
            textAnchor={X(hover) > W - 120 ? "end" : "start"}
          >
            {hover} kn → {at(hover)}★
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * The hours the stars were agreed on (25 October 2026), a steady wind and a
 * wind with its gusts, rated live: ours, and the rider's own beside them.
 */
const GUST_EXAMPLES: readonly { wind: number; gust: number | null }[] = [
  { wind: 15, gust: 25 },
  { wind: 20, gust: 25 },
  { wind: 20, gust: 30 },
  { wind: 25, gust: 30 },
  { wind: 30, gust: null },
  { wind: 22, gust: 35 },
  { wind: 32, gust: null },
  { wind: 10, gust: null },
];

function GustTable({ rider }: { rider: Rider }) {
  const s = styles();
  const cols = columns(rider);
  return (
    <>
      <table className={s.table()} data-gust-table>
        <thead>
          <tr>
            <th className={s.th({ className: s.when() })}>Wind</th>
            {cols.map((column) => (
              <th
                key={column.key}
                className={s.th({
                  className: column.you && cols.length > 1 ? s.you() : "",
                })}
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GUST_EXAMPLES.map(({ wind, gust }) => {
            const what =
              gust === null
                ? `${wind} kn${wind === 32 ? " or more" : ""}, steady`
                : `${wind} kn gusting ${gust}`;
            return (
              <tr key={what}>
                <td className={s.td()}>{what}</td>
                {cols.map((column) => {
                  const rated = rateHour(
                    { windKn: wind, gustKn: gust, from: null, daylight: true },
                    { facing: null },
                    column.rider,
                  )!;
                  const outlined = rated.potential - rated.stars;
                  return (
                    <td
                      key={column.key}
                      className={s.td({
                        className: [
                          s.num(),
                          s.wraps(),
                          column.you && cols.length > 1 ? s.you() : "",
                        ],
                      })}
                      data-rated={column.key}
                      data-example-stars={rated.stars}
                      data-example-potential={rated.potential}
                    >
                      <span className={s.rated()}>
                        <StarGlyphs
                          stars={rated.stars}
                          potential={rated.potential}
                          size={12}
                          label={starsText(rated)}
                        />
                        <span aria-hidden="true">
                          {rated.stars}
                          {outlined > 0 && ` + ${outlined} outlined`}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={s.figures()}>
        In knots, worked out as you read this, with no shore to take anything
        off.
      </p>
    </>
  );
}

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
 * Stars off as the table sets them: "−1 star", "none", "never". A
 * non-breaking space holds each figure to its word, so a phone's narrow
 * column can wrap a cost but never ends a line on "−1".
 */
function starsOff(off: number): string {
  if (!off) return "none";
  if (off >= NEVER) return "never";
  return `−${off} star${off === 1 ? "" : "s"}`;
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
  const cols = columns(rider);
  return (
    <table className={s.table()} data-shore-table>
      <thead>
        <tr>
          <th className={s.th()}>Wind</th>
          {cols.map((column) => (
            <th
              key={column.key}
              className={s.th({
                className: column.you && cols.length > 1 ? s.you() : undefined,
              })}
            >
              {column.name}
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
            {cols.map((column) => (
              <td
                key={column.key}
                className={s.td({
                  className: [
                    s.num(),
                    s.wraps(),
                    column.you && cols.length > 1 ? s.you() : "",
                  ],
                })}
              >
                {starsOff(directionCosts(column.rider)[sector.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What else there is to an hour, and what it does to the stars: for everyone alike. */
function OtherTable() {
  const s = styles();
  const rows: [string, string][] = [
    ["An orange or red Met Éireann warning", "replaced by the warning"],
    ["A yellow warning", "shown, nothing off"],
    ["The models disagree", "nothing"],
    ["How far upwind you can ride", "nothing"],
    ["Your weight, or your wings", "nothing"],
  ];
  return (
    <table className={s.table()} data-other-table>
      <thead>
        <tr>
          <th className={s.th({ className: s.when() })}>If</th>
          <th className={s.th()}>Stars</th>
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
function useExample(spotId: string, choice: StarsChoice | undefined): Example {
  const [state, setState] = useState<Example>({ kind: "loading" });
  // The choice by its value: the rider is read afresh on every change, and
  // the example is read again only when the model changes.
  const chosen = JSON.stringify(choice ?? null);
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
        { now, from: starsFromAt(choice) },
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
  }, [spotId, chosen]);
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
  const example = useExample(spotId, rider.starsFrom);
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
        . Stars: {riderWords(rider)}.
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
