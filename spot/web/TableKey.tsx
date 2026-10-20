/**
 * The day tables' key, under the last day: what the frame over the wind
 * means, why a gust is red, and what the waves' figures count. Each line
 * leads with the mark as the table draws it, so a rider matches the two by
 * eye; the same words are on the marks' own titles in the table.
 */
import type { Units } from "../../force5/src/units";
import { Figure, Kicker } from "../../ui";
import { tv } from "../../ui/tv";
import { WindArrow } from "./glyphs";
import { RangeAxis, type Band } from "./RangeBar";
import { windIn } from "./spot";

const styles = tv({
  slots: {
    key: "mt-8 flex flex-col gap-2 font-body text-body text-ink-2",
    list: "m-0 flex flex-col gap-2.5 p-0",
    // A mark and its words; the marks share the frame's width, 112px.
    item: "flex items-center gap-4",
    mark: "m-0 flex w-28 shrink-0 font-mono text-caption text-ink-2 tabular-nums",
    words: "m-0",
    unit: "text-ink-muted",
  },
});

/** "The gust, in red where it jumps": the rule `gustJumps` (./spot) applies. */
export function gustWords(units: Units, unitText: string): string {
  return `The gust, raised. In red where it jumps well over the wind: ${windIn(10, units)} ${unitText} or more above it, or 60% more.`;
}

/** What the frame over the wind says, for its column's head and the key. */
export function rangeKeyWords(unitText: string): string {
  return `Your wind range in ${unitText}, for the rider chosen above: the least you can ride on, the sweet spot (shaded) and the most you can hold.`;
}

export function TableKey({
  band,
  units,
  unitText,
}: {
  band: Band;
  units: Units;
  unitText: string;
}) {
  const s = styles();
  return (
    <section
      className={s.key()}
      aria-labelledby="table-key-title"
      data-table-key
    >
      <Kicker as="h2" id="table-key-title">
        Reading the tables
      </Kicker>
      <dl className={s.list()}>
        <div className={s.item()}>
          <dt className={s.mark()}>
            <RangeAxis band={band} units={units} />
          </dt>
          <dd className={s.words()}>
            {rangeKeyWords(unitText)} In each hour&rsquo;s frame the dot is the
            wind, the orange tail runs to its gust, and an arrowhead is a wind
            outside your range. Tap or click it for every model&rsquo;s wind.
          </dd>
        </div>
        <div className={s.item()}>
          <dt className={s.mark()}>
            <Figure
              size="sm"
              value={windIn(14, units)}
              sup={windIn(25, units)}
              alarm
            />
          </dt>
          <dd className={s.words()}>{gustWords(units, unitText)}</dd>
        </div>
        <div className={s.item()}>
          <dt className={s.mark()}>
            <span>
              <WindArrow from={135} size={14} /> 0.6
              <span className={s.unit()}>m</span> 5
              <span className={s.unit()}>s</span>
            </span>
          </dt>
          <dd className={s.words()}>
            Waves: their height in metres and their period, the seconds between
            them. The arrow points the way they run, as the wind&rsquo;s does.
          </dd>
        </div>
      </dl>
    </section>
  );
}
