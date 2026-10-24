import { beaufortPath } from "./beaufortPath";
import { tv } from "./tv";

/*
 * A wind in forces, as the old charts wrote it: the staff and its feathers
 * (beaufortPath.ts), and the force's number beside it, so nobody has to count
 * feathers. Drawn in currentColor and set in the text around it, so it takes a
 * cell's size, weight and colour: a red gust is a red glyph.
 */
export const beaufortGlyphStyles = tv({
  slots: {
    base: "inline-flex items-center gap-px whitespace-nowrap align-middle",
    glyph: "block shrink-0 overflow-visible",
    staff: "fill-none stroke-current",
    pennant: "fill-current stroke-current",
    number: "",
  },
});

/** "Force 5": a force as it is written out and read aloud. */
export const forceLabel = (force: number) => `Force ${force}`;

export interface BeaufortGlyphProps {
  /** The force, 0 to 12. */
  force: number;
  /**
   * The glyph's height in px: 17 beside a table's figure, 10 for a gust
   * written small. The number is the text's own size.
   */
  size?: number;
  /** Leave the number off, where it is written beside the glyph already. */
  bare?: boolean;
  /**
   * What a screen reader hears: "Force 5" by default. An empty string says the
   * words are already beside it, and hides the glyph.
   */
  label?: string;
  className?: string;
}

export function BeaufortGlyph({
  force,
  size = 14,
  bare = false,
  label,
  className,
}: BeaufortGlyphProps) {
  const styles = beaufortGlyphStyles();
  const f = Math.min(12, Math.max(0, Math.round(force)));
  const drawing = beaufortPath(f, size);
  return (
    <span
      className={styles.base({ className })}
      data-force={f}
      {...(label === ""
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label ?? forceLabel(f) })}
    >
      <svg
        className={styles.glyph()}
        width={drawing.width}
        height={drawing.height}
        viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <path
          className={styles.staff()}
          d={drawing.stroke}
          strokeWidth={drawing.strokeWidth}
          strokeLinecap="round"
        />
        {drawing.fill && (
          <path
            className={styles.pennant()}
            d={drawing.fill}
            strokeWidth={drawing.strokeWidth * 0.6}
            strokeLinejoin="round"
          />
        )}
      </svg>
      {!bare && (
        <span className={styles.number()} aria-hidden="true">
          {f}
        </span>
      )}
    </span>
  );
}
