import {
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { strikePath, underlinePath } from "./penPaths";
import { tv, type VariantProps } from "./tv";

/*
 * The red pen: somebody with the forecast in front of them, circling the one
 * hour worth going for and writing why in the margin. It is the loudest thing
 * on a page, so a view has one mark, two at most, and the mark is on the
 * thing that matters (docs/BRAND.md).
 *
 * The marks are decoration over words that already say the same thing: the
 * hour that is looped is also the best window in the text beside it. So they
 * are hidden from a screen reader, and each draws itself in once, as a hand
 * would, unless the reader has asked for less motion.
 */
export const penStyles = tv({
  slots: {
    wrap: "relative inline-block",
    // Tucked up under the words: a line box hangs below the letters.
    under:
      "pointer-events-none absolute inset-x-0 top-full h-2 -translate-y-1 overflow-visible",
    strike: "pointer-events-none absolute inset-0 overflow-visible",
    stroke:
      "fill-none stroke-pen stroke-2 opacity-90 animate-ink motion-reduce:animate-none",
  },
});

export const penNoteStyles = tv({
  // The pen's handwriting, a degree off the level, in the pen's darker ink so
  // it reads as words (4.9:1) where the strokes need only be seen (3:1).
  base: "m-0 origin-top-left -rotate-1 font-hand leading-tight font-normal text-pen-ink",
  variants: {
    size: {
      sm: "text-prose",
      md: "text-lead",
    },
  },
  defaultVariants: { size: "md" },
});

/** The size of a box, kept up to date as it changes. Nothing until it is laid out. */
function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setBox((old) => (old && old.w === w && old.h === h ? old : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return box;
}

interface MarkProps {
  children: ReactNode;
  className?: string;
}

function Stroke({ d }: { d: string }) {
  const styles = penStyles();
  return (
    <path
      className={styles.stroke()}
      d={d}
      pathLength={1}
      strokeDasharray="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** A quick stroke under its children: a word in the pen's note that carries it. */
export function PenUnderline({ children, className }: MarkProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const box = useBox(ref);
  const styles = penStyles();
  return (
    <span ref={ref} className={styles.wrap({ className })}>
      {children}
      {box && (
        <svg
          className={styles.under()}
          viewBox={`0 0 ${box.w} 8`}
          aria-hidden="true"
          focusable="false"
        >
          <Stroke d={underlinePath(0, 3, box.w)} />
        </svg>
      )}
    </span>
  );
}

/** A stroke through its children: what is off (offshore, sold, cancelled). */
export function PenStrike({ children, className }: MarkProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const box = useBox(ref);
  const styles = penStyles();
  return (
    <span ref={ref} className={styles.wrap({ className })}>
      {children}
      {box && (
        <svg
          className={styles.strike()}
          viewBox={`0 0 ${box.w} ${box.h}`}
          aria-hidden="true"
          focusable="false"
        >
          <Stroke d={strikePath(box.w, box.h)} />
        </svg>
      )}
    </span>
  );
}

export type PenNoteProps = VariantProps<typeof penNoteStyles> &
  Omit<HTMLAttributes<HTMLElement>, "children"> & {
    /** A paragraph by default; a span inside a line of something else. */
    as?: ElementType;
    className?: string;
    children: ReactNode;
    /** For a test or a script to find it by: `data-pen-note` and the like. */
    [data: `data-${string}`]: string | boolean | undefined;
  };

/**
 * The pen's note in the margin: the verdict in a few words, as somebody would
 * write it. "Go 13:00–16:00. Four stars on a 6 m." Never a paragraph. Any
 * other attribute (an id, `data-*`, `aria-*`) goes on the element.
 */
export function PenNote({
  as: Tag = "p",
  size,
  className,
  children,
  ...rest
}: PenNoteProps) {
  return (
    <Tag {...rest} className={penNoteStyles({ size, className })}>
      {children}
    </Tag>
  );
}
